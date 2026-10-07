import { CallbackType } from './Enums';
import { Request } from './Request';

/**
 * Base response.
 */
export abstract class Response {
  readonly requestId: string;
  readonly responseType: string;

  protected constructor(requestId: string, responseType: string) {
    this.requestId = requestId;
    this.responseType = responseType;
  }
}

/**
 * Success response containing the original request.
 */
export class SuccessResponse extends Response {
  static readonly responseType: string = 'SuccessResponse';
  readonly request: Request;

  constructor(request: Request) {
    super(request.requestId, SuccessResponse.responseType);

    this.request = request;
  }
}

/**
 * Error response.
 */
export class ErrorResponse extends Response {
  static readonly responseType: string = 'ErrorResponse';
  readonly error: any;

  constructor(requestId: string, error: any) {
    super(requestId, ErrorResponse.responseType);

    this.error = error;
  }
}

/**
 * Load module response
 */
export class LoadModuleResponse extends Response {
  static readonly responseType: string = 'LoadModuleResponse';
  readonly wasmModule: any;

  constructor(requestId: string, wasmModule: any) {
    super(requestId, LoadModuleResponse.responseType);

    this.wasmModule = wasmModule;
  }
}

/**
 * Process image response
 */
export class ResultResponse extends Response {
  static readonly responseType: string = 'ResultResponse';
  readonly result: any;

  constructor(requestId: string, result: any) {
    super(requestId, ResultResponse.responseType);

    this.result = result;
  }
}

/**
 * Callback response
 */
export class CallbackResponse {
  readonly isCallback: boolean = true;
  readonly callbackType: CallbackType;
  readonly callbackParameters: any[];

  constructor(callbackType: CallbackType, callbackParameters: any[]) {
    this.callbackType = callbackType;
    this.callbackParameters = callbackParameters;
  }
}

/**
 * Verification callback response
 */
export class UploadCallbackResponse {
  readonly isUploadCallback: boolean = true;
  readonly url: string;
  readonly data: any;
  readonly isLastUpload: boolean;

  constructor(url: string, data: any, isLastUpload: boolean) {
    this.url = url;
    this.data = data;
    this.isLastUpload = isLastUpload;
  }
}

export class InvokeFunctionResponse<responseType> extends Response {
  static readonly responseType: string = 'InvokeFunctionResponse';
  readonly response: responseType | null;
  readonly error: any | null;

  constructor(requestId: string, response: responseType, error: any) {
    super(requestId, InvokeFunctionResponse.responseType);

    this.error = error;
    this.response = response;
  }

  static newResponse<ResponseType>(
    requestId: string,
    response: ResponseType,
  ): InvokeFunctionResponse<ResponseType> {
    return new InvokeFunctionResponse(requestId, response, null);
  }

  static newError<ResponseType>(
    requestId: string,
    error: any,
  ): InvokeFunctionResponse<ResponseType> {
    return new InvokeFunctionResponse(requestId, null, error);
  }
}
