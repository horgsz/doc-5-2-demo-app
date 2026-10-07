import { SdkError, ErrorCode } from './lib/SdkError';
import { CallbackType, RecognizerCallbacks, ImageSettings, ModuleURLs } from './lib/Interfaces';
import { RegisteredCallbacks, WASMFrame } from './lib/WorkerTypes';

import {
  Request,
  LoadWasmModuleRequest,
  ProcessImageRequest,
  DeleteRequest,
  RecognizerRequest,
  GetResultsRequest,
  InvokeFunctionRequest,
  SaveProcessingRequest,
  DetectShapeRequest,
  DetectLocationRequest, // good-location probe
} from './lib/Request';
import {
  CallbackResponse,
  ErrorResponse,
  ResultResponse,
  UploadCallbackResponse,
  InvokeFunctionResponse,
  SuccessResponse,
} from './lib/Response';
import { IDScanDetectionStatus, Quadrilateral } from './recognizers/IDScan/IDScan';
import { FaceScanDetectionStatus } from './recognizers/FaceScan/FaceScan';

type P27850Promise = {
  resolve: (data: Uint8Array) => void;
  reject: (error: any) => void;
};

/** How long a download may go without receiving anything before the read gives up. */
const ENGINE_DOWNLOAD_TIMEOUT_MS = 8000;

/**
 * SDK Worker.
 */
export default class OCRLabsSdkWorker {
  private context: Worker = self as any;
  private wasmModule: any;
  private recognizer: any;
  private callbacks: RecognizerCallbacks = {};
  private uploadCallback:
    | ((url: string, data: Uint8Array, isLastUpload: boolean) => void)
    | undefined;
  private p27850Promises: Record<string, P27850Promise> = {};

  constructor() {
    this.context.onmessage = (event: MessageEvent) => {
      const request = event.data;

      let actionOrResponseType: string = request.action ? request.action : request.responseType;

      switch (actionOrResponseType) {
        case LoadWasmModuleRequest.action:
          this.handleLoadEngineModule(request as LoadWasmModuleRequest);
          break;
        case RecognizerRequest.action:
          this.handleCreateRecognizer(request as RecognizerRequest);
          break;
        case ProcessImageRequest.action:
          this.handleProcessImage(request as ProcessImageRequest);
          break;
        case DetectShapeRequest.action:
          this.handleDetectShape(request as DetectShapeRequest);
          break;
        // Good-location probe.
        case DetectLocationRequest.action:
          this.handleDetectLocation(request as DetectLocationRequest);
          break;
        case SaveProcessingRequest.action:
          this.handleSaveProcess(request as SaveProcessingRequest);
          break;
        case GetResultsRequest.action:
          this.handleGetResults(request as GetResultsRequest);
          break;
        case InvokeFunctionRequest.action:
          this.handleInvokeFunction(request as InvokeFunctionRequest);
          break;
        case DeleteRequest.action:
          this.handleDelete(request as DeleteRequest);
          break;

        case InvokeFunctionResponse.responseType:
          this.handleInvokeFunctionResponse(request as InvokeFunctionResponse<any>);
          break;
        default:
          throw new SdkError(`${ErrorCode.WorkerUnknownAction}: ${actionOrResponseType}`);
      }
    };
  }

  handleInvokeFunctionResponse(response: InvokeFunctionResponse<any>): void {
    if (this.p27850Promises[response.requestId]) {
      let p27850Resp = response as InvokeFunctionResponse<Uint8Array>;
      let { resolve, reject } = this.p27850Promises[response.requestId];
      if (p27850Resp.error) {
        reject(p27850Resp.error);
      } else {
        resolve(p27850Resp.response);
      }
    } else {
      throw new SdkError(ErrorCode.UnknownInvokeFunctionResponse);
    }
  }

  /**
   * Handles loading wasm engine module.
   */
  async handleLoadEngineModule(request: LoadWasmModuleRequest) {
    if (this.wasmModule) {
      return this.handleSuccessResponse(request);
    }

    try {
      const moduleUrls: ModuleURLs = request.moduleURLs;

      try {
        // Dynamically import the Emscripten ES6 module
        const module: {
          default: (options: {
            locateFile?: (path: string) => string;
            p27850?: (transaction_token: string) => Promise<Uint8Array>;
            ocr6FetchTimeoutMs?: number;
          }) => Promise<any>;
        } = await import(moduleUrls.emsJSFile);

        let p27850 = this.p27850.bind(this);

        const instance = await module.default({
          locateFile: (path: string): string => {
            if (path.endsWith('.wasm')) return moduleUrls.wasmBinaryFile;
            if (path.endsWith('.data')) return moduleUrls.dataFile;
            return path;
          },
          p27850,
          // The 6.0 engine downloads document and language files during a read;
          // with nothing arriving for this long it gives up and the read
          // returns DataUnavailable. Other engines ignore it.
          ocr6FetchTimeoutMs: ENGINE_DOWNLOAD_TIMEOUT_MS,
        });

        this.wasmModule = instance;

        this.handleSuccessResponse(request);
      } catch (error: any) {
        this.handleErrorResponse(request, error);
      }
    } catch (error) {
      this.handleErrorResponse(request, new SdkError(ErrorCode.WorkerLoadFailure, null, error));
    }
  }

  p27850(transaction_token: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      let request = new InvokeFunctionRequest('p27850', [transaction_token]);

      this.p27850Promises[request.requestId] = {
        resolve,
        reject,
      };

      this.context.postMessage(request);
    });
  }

  /**
   * Creates the recognizer instance.
   */
  async handleCreateRecognizer(request: RecognizerRequest) {
    if (!this.wasmModule) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.WasmModuleMissing));
    }

    try {
      this.setupCallbacks(request.callbacks);
      this.setupUploadCallback();

      // A scan closed during a download frees its recognizer only once the
      // download has been cancelled, and the 6.0 engine refuses to build a
      // new one before then.
      if (typeof this.wasmModule.ocr6WhenIdle === 'function') {
        await this.wasmModule.ocr6WhenIdle(() => {});
      }

      this.recognizer = new this.wasmModule.Recognizer(request.settings);

      if (this.recognizer.setSessionBaseUrl) {
        await this.recognizer.setSessionBaseUrl(request.sessionBaseUrl);
      }

      await this.recognizer.registerUploadCallback(this.uploadCallback);
      await this.recognizer.registerMetadataCallbacks(this.callbacks);

      // These four come straight from the session response. A session that
      // omits any of them sends `undefined` across to a `std::string`
      // parameter, and embind rejects it with "Cannot pass non-string to
      // std::string" -- an error naming neither the argument nor the field
      // behind it. The call is left to fail as it did; this only says which
      // field caused it, which is the part that was impossible to work out.
      const credentials: { [key: string]: any } = {
        'engines_base_url': request.enginesBaseUrl,
        'engines_signed_query': request.enginesSignedQuery,
        'session token': request.token,
        'assets_public_encryption_key': request.assetsKey,
      };

      const missing = Object.keys(credentials).filter(
        name => typeof credentials[name] !== 'string',
      );

      if (missing.length) {
        console.warn(
          `IDVerse SDK: the session response supplied no ${missing.join(', ')}. ` +
            'Authentication will fail until the session provides them.',
        );
      }

      await this.recognizer.authenticate(
        request.enginesBaseUrl,
        request.enginesSignedQuery,
        request.token,
        request.assetsKey,
      );

      this.handleSuccessResponse(request);
    } catch (error) {
      this.handleErrorResponse(request, new SdkError(ErrorCode.RecognizerFailure, null, error));
    }
  }

  /**
   * Handles process image from video.
   */
  async handleProcessImage(request: ProcessImageRequest) {
    if (!this.recognizer) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.RecognizerMissing));
    }

    if (!request) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.ProcessImageParams));
    }

    const image: ImageSettings = request.image;

    if (!image) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.ProcessImageParams));
    }

    const imageData = image.imageData;

    const buffer = this.wasmModule._malloc(imageData.data.length);

    try {
      this.wasmModule.HEAPU8.set(imageData.data, buffer);
      const result = await this.recognizer.processImage(
        new WASMFrame(buffer, imageData.width, imageData.height, image.videoFrame),
      );

      this.wasmModule._free(buffer);

      this.context.postMessage(new ResultResponse(request.requestId, result));
    } catch (error: any) {
      this.wasmModule._free(buffer);

      this.handleErrorResponse(request, new SdkError(ErrorCode.ProcessImageFailure, null, error));
    }
  }

  /**
   * Runs one frame through the object detector only, to learn whether the
   * thing in front of the camera is a card or a passport.
   */
  async handleDetectShape(request: DetectShapeRequest) {
    if (!this.recognizer) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.RecognizerMissing));
    }

    const image: ImageSettings = request?.image;

    if (!image) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.ProcessImageParams));
    }

    const imageData = image.imageData;
    const buffer = this.wasmModule._malloc(imageData.data.length);

    try {
      this.wasmModule.HEAPU8.set(imageData.data, buffer);
      const result = await this.recognizer.detectDocumentShape(
        new WASMFrame(buffer, imageData.width, imageData.height, image.videoFrame),
      );

      this.wasmModule._free(buffer);

      this.context.postMessage(new ResultResponse(request.requestId, result));
    } catch (error: any) {
      this.wasmModule._free(buffer);

      this.handleErrorResponse(request, new SdkError(ErrorCode.ProcessImageFailure, null, error));
    }
  }

  /**
   * Good-location probe. Mirrors handleDetectShape but
   * calls the engine's detect() -> boolean.
   */
  async handleDetectLocation(request: DetectLocationRequest) {
    if (!this.recognizer) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.RecognizerMissing));
    }

    const image: ImageSettings = request?.image;
    if (!image) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.ProcessImageParams));
    }

    const imageData = image.imageData;
    const buffer = this.wasmModule._malloc(imageData.data.length);

    try {
      this.wasmModule.HEAPU8.set(imageData.data, buffer);
      const result = await this.recognizer.detect(
        new WASMFrame(buffer, imageData.width, imageData.height, image.videoFrame),
      );

      this.wasmModule._free(buffer);

      this.context.postMessage(new ResultResponse(request.requestId, result));
    } catch (error: any) {
      this.wasmModule._free(buffer);

      this.handleErrorResponse(request, new SdkError(ErrorCode.ProcessImageFailure, null, error));
    }
  }

  /**
   * Handles saving process.
   */
  async handleSaveProcess(request: SaveProcessingRequest) {
    if (!this.recognizer) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.RecognizerMissing));
    }

    try {
      const buffer: ArrayBuffer = request.buffer;

      const dataPtr = this.wasmModule._malloc(buffer.byteLength);
      this.wasmModule.HEAPU8.set(new Uint8Array(buffer), dataPtr);
      await this.recognizer.saveProcessData(
        dataPtr,
        buffer.byteLength,
        request.mimeType || 'video/webm',
      );
      this.wasmModule._free(dataPtr);

      this.context.postMessage(new ResultResponse(request.requestId, null));
    } catch (error: any) {
      this.handleErrorResponse(request, new SdkError(ErrorCode.ProcessImageFailure, null, error));
    }
  }

  /**
   * Handles getting scan result.
   */
  async handleGetResults(request: GetResultsRequest) {
    if (!this.recognizer) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.RecognizerMissing));
    }

    try {
      const results = await this.recognizer.getResults();

      this.context.postMessage(new ResultResponse(request.requestId, results));
    } catch (error: any) {
      this.handleErrorResponse(request, new SdkError(ErrorCode.GetResultFailure));
    }
  }

  /**
   * Handles getting scan result.
   */
  async handleInvokeFunction(request: InvokeFunctionRequest) {
    if (!this.recognizer) {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.RecognizerMissing));
    }

    const funcType = typeof this.recognizer[request.funcName];

    if (funcType === undefined || funcType !== 'function') {
      return this.handleErrorResponse(request, new SdkError(ErrorCode.InvokeFunctionFailure));
    }

    try {
      const results = await this.recognizer[request.funcName](...request.funcParams);
      this.context.postMessage(new ResultResponse(request.requestId, results));
    } catch (error: any) {
      this.handleErrorResponse(request, new SdkError(ErrorCode.GetResultFailure));
    }
  }

  /**
   * Handles deleting the engine instance.
   */
  async handleDelete(request: DeleteRequest) {
    if (this.recognizer) {
      await this.recognizer.delete();
      this.recognizer = null;
    }

    this.callbacks = {};
    this.uploadCallback = undefined;

    this.context.postMessage(new SuccessResponse(request));
  }

  /**
   * Notifies the event with a successful response.
   */
  handleSuccessResponse(request: Request): void {
    this.context.postMessage(new SuccessResponse(request));
  }

  /**
   * Notifies the event with an error response.
   */
  handleErrorResponse(request: Request, error: any) {
    this.context.postMessage(new ErrorResponse(request.requestId, error));
  }

  /**
   * Sets up the callbacks.
   */
  private setupCallbacks(registeredCallbacks: RegisteredCallbacks) {
    if (!registeredCallbacks) {
      return;
    }

    if (registeredCallbacks.onIDScanDetection) {
      this.callbacks.onIDScanDetection = (
        state: IDScanDetectionStatus,
        documentPosition: Quadrilateral,
      ) => {
        const msg = new CallbackResponse(CallbackType.onIDScanDetection, [state, documentPosition]);
        this.context.postMessage(msg);
      };
    } else {
      delete this.callbacks.onIDScanDetection;
    }

    if (registeredCallbacks.onFirstScan) {
      this.callbacks.onFirstScan = () => {
        const msg = new CallbackResponse(CallbackType.onFirstScan, []);
        this.context.postMessage(msg);
      };
    } else {
      delete this.callbacks.onFirstScan;
    }

    if (registeredCallbacks.onFaceScanDetection) {
      this.callbacks.onFaceScanDetection = (state: FaceScanDetectionStatus) => {
        const msg = new CallbackResponse(CallbackType.onFaceScanDetection, [state]);
        this.context.postMessage(msg);
      };
    } else {
      delete this.callbacks.onFaceScanDetection;
    }
  }

  /**
   * Sets up the callbacks.
   */
  private setupUploadCallback() {
    this.uploadCallback = (url: string, data: Uint8Array, isLastUpload: boolean) => {
      const msg = new UploadCallbackResponse(url, data, isLastUpload);
      this.context.postMessage(msg, [data.buffer]);
      this.wasmModule._free(data.byteOffset);
    };
  }
}
