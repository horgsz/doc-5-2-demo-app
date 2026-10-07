import { RecognizerSettings } from '../../lib/Interfaces';
import { Recognizer } from '../Recognizer';

/**
 * Defines face scan engine.
 */
export enum FaceScanProcessStatus {
  /**
   * Nothing has been detected.
   */
  Empty,
  /**
   * All the requirements has been recognized successfully.
   */
  Pass,
  /**
   * Failed to pass face scan requirements.
   */
  Fail,
}

/**
 * Defines FaceScan detection status.
 *
 * Note: This status is only available for live process.
 */
export enum FaceScanDetectionStatus {
  /**
   * Nothing has been detected.
   */
  Empty,
  /**
   * All the requirements has been recognized successfully.
   */
  Valid,
  /**
   * More than one face has been detected.
   */
  MultipleFaces,
  /**
   * Bad light.
   */
  NoFace,
  /**
   * Bad light.
   */
  BadLight,
}

export interface FaceScanRecognizerSettings extends RecognizerSettings {}

/**
 * FaceScan Scan process results.
 */
export interface FaceScanRecognizerResult {
  readonly status: FaceScanProcessStatus;
}

export class FaceScanRecognizer extends Recognizer {
  /**
   * Get the process results.
   */
  getResults(): Promise<FaceScanRecognizerResult> {
    return this.invoke<FaceScanRecognizerResult>('getResults', []);
  }
}

/**
 * Defines Face Scan Wrapper containing liveness_id.
 */
export class FaceScanResultWrapper {
  /**
   * Id of the face scan result that has been uploaded/submitted.
   */
  readonly liveness_id: String;

  /**
   * Face Scan recognizer result.
   */
  readonly face_scan_recognizer_result: FaceScanRecognizerResult;

  constructor(liveness_id: String, face_scan_recognizer_result: FaceScanRecognizerResult) {
    this.liveness_id = liveness_id;
    this.face_scan_recognizer_result = face_scan_recognizer_result;
  }
}
