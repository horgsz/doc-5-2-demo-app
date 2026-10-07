import { SdkError, ErrorCode } from './lib/SdkError';
import SDKManager from './SDKManager';
import {
  RecognizerCallbacks,
  ImageSettings,
  ModuleURLs,
  ScannerSettings,
  LoadSettings,
  SdkType,
} from './lib/Interfaces';
import { IDScanRecognizer, IDScanRecognizerSettings } from './recognizers/IDScan/IDScan';
import { FaceScanRecognizer, FaceScanRecognizerSettings } from './recognizers/FaceScan/FaceScan';
import { Recognizer } from './recognizers/Recognizer';
import { Scanner } from './lib/Scanner';
import { getWasmMode } from './lib/Helper';
import type { DigitalCredentials } from '../IDVerseSDK/digital-credentials/DigitalCredentials';

/**
 * Instantiates the worker from its own fetched bytes rather than handing the URL
 * straight to `new Worker(url)`.
 *
 * `new Worker(url, { type: 'module' })` makes the browser fetch the script
 * itself, and when that fetch is dropped or starved -- e.g. Start ID Scan
 * pressed again while a previous attempt's ~17MB engine + on-demand DB downloads
 * still saturate the connection -- it surfaces as an opaque `worker.onerror`
 * with no message and no status code: impossible to diagnose or handle
 * precisely, and (since the worker is `max-age=0`) it re-validates over the
 * network on every creation, so a warmed cache does not save it. Fetching the
 * script here turns that into a normal `fetch()` -- a real HTTP status, a real
 * network error, retryable by the caller -- and then creates the Worker from an
 * in-memory Blob, so its start cannot depend on the network at all. The engine
 * module the worker imports is an absolute URL, so it still resolves from the
 * blob-origin worker.
 *
 * Falls back to a direct worker only if Blob-URL workers are unavailable (e.g. a
 * CSP that forbids `worker-src blob:`); by then the script is warm in the cache.
 */
async function createWorker(workerFilePath: string): Promise<Worker> {
  let code: string;
  try {
    const response = await fetch(workerFilePath, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new SdkError(
        ErrorCode.WorkerLoadFailure,
        `Failed to load the worker: script HTTP ${response.status}.`,
      );
    }
    code = await response.text();
  } catch (error) {
    if (error instanceof SdkError) throw error;
    // Network/fetch failure -- transient, and now carrying a real reason instead
    // of the opaque worker error.
    throw new SdkError(
      ErrorCode.WorkerLoadFailure,
      `Failed to load the worker: script fetch failed (${(error as Error)?.message ?? error}).`,
      error,
    );
  }

  try {
    const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const worker = new Worker(blobUrl, { type: 'module' });
    // The worker has taken the blob by the time this returns; free it shortly so
    // the object URL does not leak for the life of the page.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    return worker;
  } catch (error) {
    // Blob workers blocked (e.g. CSP worker-src). The fetch above left the
    // script in the HTTP cache, so the direct worker should read it without
    // another network round-trip.
    return new Worker(workerFilePath, { type: 'module' });
  }
}

/**
 * Loads WebAssembly instance and creates SDK Manager.
 * @param payload Session Response.
 */
export function load(
  settings: LoadSettings,
  workerFilePath: string,
  p27850: Function,
): Promise<any> {
  return new Promise(async (resolve, reject) => {
    try {
      if (settings.sdkType == SdkType.DigitalCredentials) {
        return reject(
          new SdkError(
            ErrorCode.WorkerInitFailure,
            'Use sdk.loadDigitalCredentials() for the Digital Credentials SDK.',
          ),
        );
      }

      // Session response payload.
      const { module_urls } = settings.permission;

      // SDK Module URLs.
      const wasmType = await getWasmMode();
      const { engine, data, loader } = module_urls[`${settings.sdkType}/${wasmType}`];

      const moduleUrls = {
        wasmBinaryFile: engine,
        dataFile: data,
        emsJSFile: loader,
      } as ModuleURLs;

      // Creating the worker can fail transiently: the worker script's fetch can
      // be dropped or starved (a retry pressed while a prior attempt's large
      // engine/DB downloads still hold the connection), which is why the same
      // URLs probe 200 a moment later. createWorker() fetches the script itself
      // so that failure is a diagnosable, retryable fetch rather than an opaque
      // worker.onerror, and instantiates from a Blob so a successful fetch can't
      // then drop at worker-creation. Retry a few times before surfacing it -- a
      // genuine, non-transient failure fails the same way each attempt and still
      // reports, now with the real reason attached.
      const MAX_WORKER_LOAD_ATTEMPTS = 4;
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_WORKER_LOAD_ATTEMPTS; attempt++) {
        let worker: Worker | undefined;

        try {
          worker = await createWorker(workerFilePath);
          const activeWorker = worker;
          const manager = await new Promise((res, rej) => {
            new SDKManager(activeWorker, p27850, rej)
              .loadWasmModule(moduleUrls, settings.session, settings.permission)
              .then(res)
              .catch(rej);
          });
          return resolve(manager);
        } catch (err) {
          lastError = err;
          worker?.terminate();

          const transient = err instanceof SdkError && err.code === ErrorCode.WorkerLoadFailure;
          if (!transient || attempt === MAX_WORKER_LOAD_ATTEMPTS) {
            break;
          }

          // Growing backoff so a momentary network/server hiccup -- or a prior
          // attempt's large downloads -- has cleared before the next attempt.
          await new Promise(r => setTimeout(r, 250 * attempt));
        }
      }

      throw lastError instanceof SdkError
        ? lastError
        : new SdkError(ErrorCode.WorkerLoadFailure, 'Failed to load the worker.', lastError);
    } catch (error) {
      if (error instanceof SdkError) {
        return reject(error);
      }

      reject(new SdkError(ErrorCode.WorkerInitFailure, 'Failed to load the SDK.', error));
    }
  });
}

/**
 * Loads the device-info module, if the session offers one.
 *
 * The module is optional: a session response that does not list it is a session
 * without device info, not a broken session. It used to be destructured
 * unconditionally, so a missing entry threw during `connectedCallback` and took
 * the whole SDK down with it -- reported as the generic "Failed to load the
 * SDK.", which named neither the module nor the reason.
 *
 * @returns the module's entry point, or `undefined` when the session has none.
 */
export function loadP27850(settings: LoadSettings): Promise<Function | undefined> {
  return new Promise(async (resolve, reject) => {
    try {
      if (settings.sdkType != SdkType.DeviceInfo) {
        return reject(
          new SdkError(ErrorCode.WorkerInitFailure, 'Use sdk.load() for IdScan and Liveness SDKs.'),
        );
      }

      const { module_urls } = settings.permission;
      const deviceInfo = module_urls?.[`${SdkType.DeviceInfo}`];

      if (!deviceInfo || !deviceInfo.loader || !deviceInfo.engine) {
        console.warn(
          `IDVerse SDK: the session response lists no "${SdkType.DeviceInfo}" module, ` +
            'so device info is unavailable. Scanning is unaffected.',
        );
        return resolve(undefined);
      }

      const { engine, loader } = deviceInfo;

      const { default: initWasmModule, p27850 } = await import(loader);
      await initWasmModule({ module_or_path: engine });

      resolve(p27850);
    } catch (error) {
      console.error(error);
      if (error instanceof SdkError) {
        return reject(error);
      }

      reject(new SdkError(ErrorCode.WorkerInitFailure, 'Failed to load the SDK.', error));
    }
  });
}

/**
 * Loads the WebAssembly instance for the Digital Credentials module.
 */
export function loadDigitalCredentials(settings: LoadSettings): Promise<DigitalCredentials> {
  return new Promise(async (resolve, reject) => {
    try {
      if (settings.sdkType != SdkType.DigitalCredentials) {
        return reject(
          new SdkError(ErrorCode.WorkerInitFailure, 'Use sdk.load() for IdScan and Liveness SDKs.'),
        );
      }

      const { module_urls } = settings.permission;

      const { engine, loader } = module_urls[`${SdkType.DigitalCredentials}`];

      const wasmModule = await import(loader);
      await wasmModule.default({ module_or_path: engine });

      const instance = await new wasmModule.DigitalCredentials(
        settings.session.apiBaseUrl,
        settings.session.token,
      );

      resolve(instance);
    } catch (error) {
      if (error instanceof SdkError) {
        return reject(error);
      }

      reject(new SdkError(ErrorCode.WorkerInitFailure, 'Failed to load the SDK.', error));
    }
  });
}

/**
 * Creates ID Scan recognizer instance.
 *
 * @param sdkManager SDK Manager instance.
 * @param settings ID Scan recognizer settings.
 * @param callbacks ID Scan callbacks.
 * @returns IDScanRecognizer instance.
 */
export function createIDScanRecognizer(
  sdkManager: SDKManager,
  settings: IDScanRecognizerSettings,
  callbacks: RecognizerCallbacks,
): Promise<IDScanRecognizer> {
  return new Promise((resolve, reject) => {
    if (typeof sdkManager !== 'object') {
      return reject(new SdkError(ErrorCode.SdkManagerMissing));
    }

    sdkManager
      .createRecognizer(settings, callbacks)
      .then((manager: SDKManager) => resolve(new IDScanRecognizer(manager)))
      .catch(error => reject(error));
  });
}

/**
 * Creates FaceScan recognizer instance.
 *
 * @param sdkManager SDK Manager instance.
 * @param settings FaceScan recognizer settings.
 * @param callbacks FaceScan callbacks.
 * @returns FaceScanRecognizer instance.
 */
export function createFaceScanRecognizer(
  sdkManager: SDKManager,
  settings: FaceScanRecognizerSettings,
  callbacks: RecognizerCallbacks,
): Promise<FaceScanRecognizer> {
  return new Promise((resolve, reject) => {
    if (typeof sdkManager !== 'object') {
      return reject(new SdkError(ErrorCode.SdkManagerMissing));
    }

    sdkManager
      .createRecognizer(settings, callbacks)
      .then(manager => resolve(new FaceScanRecognizer(manager)))
      .catch(error => reject(error));
  });
}

/**
 * Creates Scanner instance.
 *
 * @param recognizer Recognizer instance.
 * @param scannerSettings scan manager settings.
 * @returns Scanner instance.
 */
export function createScanner(
  recognizer: Recognizer,
  scannerSettings: ScannerSettings,
): Promise<Scanner> {
  return new Promise((resolve, reject) => {
    if (typeof recognizer !== 'object') {
      return reject(new SdkError(ErrorCode.RecognizerMissing));
    }

    Scanner.create(recognizer, scannerSettings).then(resolve).catch(reject);
  });
}

/**
 * Checks if browser is supported.
 */
export function isBrowserSupported(): boolean {
  return typeof WebAssembly === 'object';
}

/**
 * Creates image data from input file.
 */
export function getImageDataFromInput(input: HTMLInputElement): Promise<ImageSettings> {
  return new Promise((resolve, reject) => {
    if (!input || !input.files || input.files.length === 0) {
      return reject('Failed to get input file.');
    }

    /**
     * Get image element.
     */
    const getImageEl = (src: string): Promise<any> => {
      return new Promise((r, j) => {
        var image = new Image();
        image.src = src;
        image.onload = () => r(image);
        image.onerror = e => j(e);
      });
    };

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const image = await getImageEl(reader.result as string);
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');

        // @ts-ignore
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        // @ts-ignore
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        resolve(new ImageSettings(imageData, false));
      } catch (err) {
        reject(err);
      }
    };

    reader.readAsDataURL(input.files[0]);
  });
}
