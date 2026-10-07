import { RegisteredCallbacks } from './WorkerTypes';
import { generateUUID } from './Helper';
import { ImageSettings, ModuleURLs } from './Interfaces';

/**
 * Base request class.
 */
export abstract class Request {
  readonly action: string;
  readonly requestId: string;

  protected constructor(action: string) {
    this.action = action;
    this.requestId = generateUUID();
  }
}

/**
 * Load engine module request.
 */
export class LoadWasmModuleRequest extends Request {
  static readonly action: string = 'LoadEngineModule';
  readonly payload: string;
  readonly moduleURLs: ModuleURLs;

  constructor(moduleURLs: ModuleURLs, payload: string) {
    super(LoadWasmModuleRequest.action);
    this.moduleURLs = moduleURLs;
    this.payload = payload;
  }
}

/**
 * ID Scan Recognizer request.
 */
export class RecognizerRequest extends Request {
  static readonly action: string = 'Recognizer';
  readonly settings: any;
  readonly callbacks: RegisteredCallbacks;
  readonly enginesBaseUrl: string;
  readonly enginesSignedQuery: string;
  readonly token: string;
  readonly assetsKey: string;
  readonly assetsUploadLinks: string[];
  readonly sessionBaseUrl: string;

  constructor(
    settings: any,
    callbacks: RegisteredCallbacks,
    enginesBaseUrl: string,
    enginesSignedQuery: string,
    assetsKey: string,
    token: string,
    assetsUploadLinks: string[],
    sessionBaseUrl: string,
  ) {
    super(RecognizerRequest.action);

    this.settings = settings;
    this.callbacks = callbacks;
    this.enginesBaseUrl = enginesBaseUrl;
    this.enginesSignedQuery = enginesSignedQuery;
    this.assetsUploadLinks = assetsUploadLinks;
    this.assetsKey = assetsKey;
    this.token = token;
    this.sessionBaseUrl = sessionBaseUrl;
  }
}

/**
 * Process image request.
 */
export class ProcessImageRequest extends Request {
  static readonly action: string = 'ProcessImage';
  readonly image: ImageSettings;

  constructor(image: ImageSettings) {
    super(ProcessImageRequest.action);

    this.image = image;
  }

  getBuffer() {
    return [this.image.imageData.data.buffer];
  }
}

/**
 * Detect-shape request: one frame through the object detector only.
 *
 * Carries a frame like ProcessImage does, so it needs its own request rather
 * than riding the generic invoke path -- that has no way to hand a pixel buffer
 * to the WASM heap.
 */
export class DetectShapeRequest extends Request {
  static readonly action: string = 'DetectShape';
  readonly image: ImageSettings;

  constructor(image: ImageSettings) {
    super(DetectShapeRequest.action);

    this.image = image;
  }

  getBuffer() {
    return [this.image.imageData.data.buffer];
  }
}

/**
 * Good-location probe. Same shape as DetectShapeRequest
 * -- one frame to the detector -- but returns a boolean "is the ID well placed".
 */
export class DetectLocationRequest extends Request {
  static readonly action: string = 'DetectLocation';
  readonly image: ImageSettings;

  constructor(image: ImageSettings) {
    super(DetectLocationRequest.action);

    this.image = image;
  }

  getBuffer() {
    return [this.image.imageData.data.buffer];
  }
}

/**
 * Save Process request.
 */
export class SaveProcessingRequest extends Request {
  static readonly action: string = 'SaveProcess';
  readonly buffer: ArrayBuffer;
  /**
   * MIME type of `buffer`. The recorder negotiates its codec per browser, so
   * this cannot be assumed by the receiving end.
   */
  readonly mimeType: string;

  constructor(buffer: ArrayBuffer, mimeType: string = '') {
    super(SaveProcessingRequest.action);

    this.buffer = buffer;
    this.mimeType = mimeType;
  }

  getBuffer() {
    return [this.buffer];
  }
}

/**
 * Get result request.
 */
export class GetResultsRequest extends Request {
  static readonly action: string = 'GetResult';

  constructor() {
    super(GetResultsRequest.action);
  }
}

/**
 * Get result request.
 */
export class InvokeFunctionRequest extends Request {
  static readonly action: string = 'InvokeFunction';
  readonly funcName: string;
  readonly funcParams: Array<any>;

  constructor(funcName: string, funcParams: Array<any>) {
    super(InvokeFunctionRequest.action);

    this.funcName = funcName;
    this.funcParams = funcParams;
  }
}

/**
 * Load module request.
 */
export class DeleteRequest extends Request {
  static readonly action: string = 'Delete';

  constructor() {
    super(DeleteRequest.action);
  }
}
