import SDKManager from '../SDKManager';
import { ImageSettings } from '../lib/Interfaces';
import {
  DetectShapeRequest,
  DetectLocationRequest, // good-location probe
  InvokeFunctionRequest,
  ProcessImageRequest,
  SaveProcessingRequest,
} from '../lib/Request';
import { ResultResponse } from '../lib/Response';

/**
 * Defines engine response state.
 */
export enum RecognizerState {
  /**
   * Nothing has been detected.
   */
  Empty,
  /**
   * All the requirements has been recognized successfully.
   */
  Valid,
  /**
   * The recognizer has detected something but it needs more requirements.
   */
  Incomplete,
  /**
   * The recognizer has timed out.
   */
  Timeout,
  /**
   * The read needed a document or language file the engine could not
   * download (6.0's on-demand data). Nothing was read: the user can try again.
   */
  DataUnavailable,
}

export class Recognizer {
  readonly sdkManager: SDKManager;

  constructor(sdkManager: SDKManager) {
    this.sdkManager = sdkManager;
  }

  /**
   * Process an image.
   */
  public processImage(image: ImageSettings): Promise<RecognizerState> {
    return new Promise((resolve, reject) => {
      const request = new ProcessImageRequest(image);

      this.sdkManager.handleRequest(
        request,
        (response: ResultResponse) => resolve(response.result as RecognizerState),
        reject,
      );
    });
  }

  /**
   * Run one frame through the object detector only. Cheaper than processImage
   * and it leaves the scan state alone.
   */
  protected detectShape<T>(image: ImageSettings): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = new DetectShapeRequest(image);

      this.sdkManager.handleRequest(
        request,
        (response: ResultResponse) => resolve(response.result as T),
        reject,
      );
    });
  }

  /**
   * Good-location probe. One frame through the detector,
   * returns whether the ID is well placed. Same plumbing as detectShape.
   */
  protected detectLocation<T>(image: ImageSettings): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = new DetectLocationRequest(image);

      this.sdkManager.handleRequest(
        request,
        (response: ResultResponse) => resolve(response.result as T),
        reject,
      );
    });
  }

  /**
   * Get recognizer results.
   */
  public invoke<T>(funcName: string, funcParams: Array<any>): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = new InvokeFunctionRequest(funcName, funcParams);
      this.sdkManager.handleRequest(
        request,
        (response: ResultResponse) => resolve(response.result as T),
        reject,
      );
    });
  }

  /**
   * Get the payload.
   */
  async getPayload(): Promise<string> {
    return this.invoke<string>('getPayload', []);
  }

  /**
   * Get the presigned s3 link.
   */
  saveProcessData(buffer: ArrayBuffer, mimeType: string = ''): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = new SaveProcessingRequest(buffer, mimeType);

      this.sdkManager.handleRequest(request, () => resolve(), reject);
    });
  }

  /**
   * Make the recognizer unusable and free resources.
   */
  public delete(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        await this.sdkManager.deleteRecognizer();
        resolve();
      } catch (e: any) {
        reject(e);
      }
    });
  }
}
