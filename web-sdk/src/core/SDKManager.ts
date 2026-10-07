import { SdkError, ErrorCode } from './lib/SdkError';
import {
  CallbackType,
  RecognizerCallbacks,
  EventHandler,
  ModuleURLs,
  RecognizerSettings,
} from './lib/Interfaces';
import {
  LoadWasmModuleRequest,
  ProcessImageRequest,
  Request,
  RecognizerRequest,
  DeleteRequest,
  InvokeFunctionRequest,
  SaveProcessingRequest,
} from './lib/Request';
import {
  CallbackResponse,
  UploadCallbackResponse,
  Response,
  InvokeFunctionResponse,
  ErrorResponse,
  SuccessResponse,
} from './lib/Response';
import { IDScanDetectionStatus, Quadrilateral } from './recognizers/IDScan/IDScan';
import { FaceScanDetectionStatus } from './recognizers/FaceScan/FaceScan';
import { RegisteredCallbacks } from './lib/WorkerTypes';
import { Session, SessionResponse } from './lib/Session';
import { FileUploader } from './lib/FileUploader';

/**
 * SDK Manager.
 */
export class SDKManager {
  private readonly worker: Worker;
  private eventHandlers: { [key: string]: any } = {};
  private callbacks: RecognizerCallbacks = {};
  private fileUploader: FileUploader;
  private enginesBaseUrl: string;
  private enginesSignedQuery: string;
  private assetsKey: string;
  private assetsUploadLinks: string[] = [];
  /** Undefined when the session offers no device-info module. */
  // @ts-expect-error: Is called by the worker, TypeScript just doesn't realise that
  private p27850: Function | undefined;

  public session?: Session;
  public onUploadsComplete?: () => void;

  constructor(worker: Worker, p27850: Function | undefined, reject: (message: SdkError) => void) {
    this.worker = worker;
    this.fileUploader = new FileUploader();
    this.enginesBaseUrl = '';
    this.enginesSignedQuery = '';
    this.assetsKey = '';
    this.p27850 = p27850;

    this.worker.onmessage = (event: MessageEvent) => this.handleEvents(event);
    // Fires when the browser cannot start the worker at all -- a dropped fetch
    // of the worker script is the usual cause, and it is transient: the same
    // URL is reachable a moment later. The ErrorEvent carries the only detail
    // there is, so surface it instead of dropping it -- discarding it once made
    // every such failure an undiagnosable "Failed to load the worker." A same-
    // origin worker gives real message/filename/line; a cross-origin one is
    // opaque ("Script error.") and there is nothing more to report. SDK.load()
    // retries on this code before giving up.
    this.worker.onerror = (event: ErrorEvent) => {
      const where = event?.filename
        ? ` at ${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}`
        : '';
      const detail = event?.message
        ? `${event.message}${where}`
        : 'no detail (opaque worker error)';
      reject(
        new SdkError(
          ErrorCode.WorkerLoadFailure,
          `Failed to load the worker: ${detail}.`,
          event?.error ?? undefined,
        ),
      );
    };
  }

  /**
   * Loads the wasm module.
   *
   * @param urls Module URLs.
   * @param payload Authentication payload.
   * @param assetsLinks Assets upload links.
   *
   * @returns SDKManager instance.
   */
  public loadWasmModule(
    urls: ModuleURLs,
    session: Session,
    permission: SessionResponse,
  ): Promise<SDKManager> {
    this.enginesBaseUrl = permission.engines_base_url;
    this.enginesSignedQuery = permission.engines_signed_query;
    this.assetsUploadLinks = permission.assets_upload_links;
    this.assetsKey = permission.assets_public_encryption_key;
    this.session = session;
    return new Promise((resolve, reject) => {
      const request = new LoadWasmModuleRequest(urls, permission.engine_payload);
      this.handleRequest(request, () => resolve(this), reject);
    });
  }

  /**
   * Creates Recognizer instance.
   *
   * @param settings Recognizer settings.
   * @param callbacks Recognizer registered callbacks.
   *
   * @returns Recognizer instance.
   */
  public createRecognizer(
    settings: RecognizerSettings,
    callbacks: RecognizerCallbacks,
  ): Promise<SDKManager> {
    return new Promise((resolve, reject) => {
      if (!this.session) {
        reject('No Session.');
        return;
      }

      const request = new RecognizerRequest(
        settings,
        this.findRegisteredCallbacks(callbacks),
        this.enginesBaseUrl,
        this.enginesSignedQuery,
        this.assetsKey,
        this.session.token,
        this.assetsUploadLinks,
        this.session.apiBaseUrl,
      );

      this.callbacks = callbacks;

      this.handleRequest(request, async () => resolve(this), reject);
    });
  }

  /**
   * Checks enabled callbacks.
   */
  private findRegisteredCallbacks(callbacks: RecognizerCallbacks): RegisteredCallbacks {
    const request = new RegisteredCallbacks();

    request.onIDScanDetection = !!callbacks.onIDScanDetection;
    request.onFirstScan = !!callbacks.onFirstScan;
    request.onFaceScanDetection = !!callbacks.onFaceScanDetection;

    return request;
  }

  /**
   * Handles requests.
   *
   * @param request Worker request.
   * @param resolve Success response function.
   * @param reject Error response function.
   */
  public async handleRequest(
    request: Request,
    resolve: EventHandler,
    reject: (message: string) => void,
  ) {
    this.eventHandlers[request.requestId] = this.createEventHandler(resolve, reject);

    if (request.action === ProcessImageRequest.action) {
      this.worker.postMessage(request, (request as ProcessImageRequest).getBuffer());
    } else if (request.action === SaveProcessingRequest.action) {
      this.worker.postMessage(request, (request as SaveProcessingRequest).getBuffer());
    } else if (request.action === InvokeFunctionRequest.action) {
      this.worker.postMessage(request);
    } else {
      this.worker.postMessage(request);
    }
  }

  /**
   * Creates event handler.
   *
   * @param resolve Success response function.
   * @param reject Error response function.
   *
   * @returns EventHandler response.
   */
  private createEventHandler(
    resolve: EventHandler,
    reject: (message: string) => void,
  ): EventHandler {
    return response => {
      switch (response.responseType) {
        case ErrorResponse.responseType:
          return reject(response.error);
        case SuccessResponse.responseType:
          resolve(response.request);
          break;
        default:
          resolve(response);
      }
    };
  }

  /**
   * Handles worker events.
   *
   * @param event Event data.
   */
  private async handleEvents(event: MessageEvent): Promise<void> {
    if ('isCallback' in event.data) {
      const msg = event.data as CallbackResponse;

      switch (msg.callbackType) {
        case CallbackType.onIDScanDetection:
          if (typeof this.callbacks.onIDScanDetection === 'function') {
            this.callbacks.onIDScanDetection(
              msg.callbackParameters[0] as IDScanDetectionStatus,
              msg.callbackParameters[1] as Quadrilateral,
            );
          }
          break;
        case CallbackType.onFirstScan:
          if (typeof this.callbacks.onFirstScan === 'function') {
            this.callbacks.onFirstScan();
          }
          break;
        case CallbackType.onFaceScanDetection:
          if (typeof this.callbacks.onFaceScanDetection === 'function') {
            this.callbacks.onFaceScanDetection(
              msg.callbackParameters[0] as FaceScanDetectionStatus,
            );
          }
          break;
        default:
          throw new SdkError(ErrorCode.UnknownCallback);
      }
    } else if ('isUploadCallback' in event.data) {
      const msg = event.data as UploadCallbackResponse;
      this.fileUploader.uploadFile(
        msg.url,
        new Blob([msg.data as BlobPart], { type: 'application/octet-stream' }),
        msg.isLastUpload,
      );
      // Check if it's a request from the worker
    } else if ('action' in event.data) {
      let request = event.data as Request;

      switch (request.action) {
        case InvokeFunctionRequest.action:
          this.handldeInvokeFunctionRequest(request as InvokeFunctionRequest);
          break;
        default:
          console.log(request);
          throw new SdkError(ErrorCode.WorkerUnknownAction);
      }
    } else {
      const response: Response = event.data;

      const eventHandler = this.eventHandlers[response.requestId];
      if (eventHandler) {
        eventHandler(response);
      }
      delete this.eventHandlers[response.requestId];
    }
  }

  handldeInvokeFunctionRequest(request: InvokeFunctionRequest) {
    let func = this[request.funcName] as Function;

    // Optional modules leave their entry point undefined -- device info is the
    // usual one, when the session offers no such module. The engine still asks
    // for it, and an unanswered request would hang the scan, so refuse it
    // explicitly and let the engine carry on without.
    if (typeof func !== 'function') {
      this.worker.postMessage(
        InvokeFunctionResponse.newError(
          request.requestId,
          new SdkError(
            ErrorCode.InvokeFunctionFailure,
            `"${request.funcName}" is not available in this session.`,
          ),
        ),
      );
      return;
    }

    try {
      let returnValue = func.apply(this, request.funcParams);

      if (returnValue instanceof Promise) {
        returnValue.then(
          returnValue => {
            this.worker.postMessage(
              InvokeFunctionResponse.newResponse(request.requestId, returnValue),
            );
          },
          error => {
            this.worker.postMessage(InvokeFunctionResponse.newError(request.requestId, error));
          },
        );
      } else {
        this.worker.postMessage(InvokeFunctionResponse.newResponse(request.requestId, returnValue));
      }
    } catch (e) {
      this.worker.postMessage(InvokeFunctionResponse.newError(request.requestId, e));
    }
  }

  /**
   * Checks if all states are completed.
   *
   * @param expectLastUpload Whether a session recording was handed to the
   *   engine, whose upload is the last one. Without one there is nothing to
   *   wait for beyond the uploads already under way.
   */
  public async checkUploadStatus(expectLastUpload: boolean = true): Promise<void> {
    try {
      const result = await this.fileUploader.areAllUploadsComplete(expectLastUpload);
      if (result) {
        this.onUploadsComplete?.();
        this.clearUploads();
      } else {
        throw new SdkError(ErrorCode.SdkManagerFailure, 'Failed to complete.');
      }
    } catch (error) {
      this.clearUploads();
      throw new SdkError(ErrorCode.SdkManagerFailure, 'Failed to complete.', error);
    }
  }

  /**
   * Clears all uploads.
   */
  private clearUploads(): void {
    this.fileUploader.clearUploads();
  }

  /**
   * Deletes Recognizer instance.
   */
  public deleteRecognizer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new DeleteRequest();
      this.handleRequest(
        request,
        () => resolve(),
        e => reject(e),
      );
    });
  }

  /**
   * Clean up the instance.
   */
  public delete(): void {
    if (this.worker) this.worker.terminate();
    this.eventHandlers = {};
  }
}

export default SDKManager;
