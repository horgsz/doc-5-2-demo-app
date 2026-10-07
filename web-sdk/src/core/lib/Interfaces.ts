import { IDScanDetectionStatus, Quadrilateral } from '../recognizers/IDScan/IDScan';
import { FaceScanDetectionStatus } from '../recognizers/FaceScan/FaceScan';
import { CameraType, CameraResolution, CaptureMode, SdkType } from './Enums';
import { Session, SessionResponse } from './Session';
import { RecorderStrategy } from './SessionRecorder';

export * from './Enums';
export { RecorderStrategy } from './SessionRecorder';
export type { SessionRecorderSettings, SessionRecording } from './SessionRecorder';

export class LoadSettings {
  public permission: SessionResponse;
  public sdkType: SdkType;
  public session: Session;

  constructor(permission: SessionResponse, sdkType: SdkType, session: Session) {
    this.permission = permission;
    this.sdkType = sdkType;
    this.session = session;
  }
}

/**
 * Web worker event handler.
 */
export interface EventHandler {
  (msg: any): void;
}

/**
 * Defines WASM module files.
 */
export interface ModuleURLs {
  /**
   * IDVerse SDK wasm binary file.
   */
  wasmBinaryFile: string;
  /**
   * IDVerse SDK resources file.
   */
  dataFile: string;
  /**
   * IDVerse SDK emscripten JS file.
   */
  emsJSFile: string;
}

/**
 * Defines scanner settings.
 */
export interface ScannerSettings {
  /**
   * Defines the camera facing type.
   */
  cameraType: CameraType;
  /**
   * Camera video feed element. (<video />)
   */
  cameraFeed?: HTMLVideoElement;
  /**
   * Camera resolution. In SemiAuto this is the resolution the preview stream
   * runs at.
   */
  cameraResolution?: CameraResolution;
  /**
   * TEMP (dynamic-resolution capture): resolution to momentarily switch the
   * camera track up to for a single SemiAuto capture, then drop straight back
   * to `cameraResolution`. When set higher than `cameraResolution`, a cheap
   * low-res preview (memory-safe on older iPhones) still yields a full-res
   * still. Omit (or set equal to `cameraResolution`) to keep a constant
   * resolution -- the previous behaviour.
   */
  captureResolution?: CameraResolution;
  /**
   * Whether frames are submitted continuously or one at a time on a button
   * press. Defaults to `CaptureMode.Live`.
   */
  captureMode?: CaptureMode;
  /**
   * Called when the process started.
   */
  onStart?: { (): void };
  /**
   * Allow orientation screen landscape.
   */
  disableScreenLandscape?: boolean;
  /**
   * Called when screen orientation changes.
   * This function will be triggered if `disableScreenLandscape` is set to true.
   */
  onScreenLandscape?: { (): void };
  /**
   * Enables API verification.
   */
  enableApiVerification?: boolean;
  /**
   * Process delay in milliseconds.
   */
  startAfter?: number;
  /**
   * Encoder bitrate for the session recording. Defaults to 1Mbps, which is
   * more than the default size and frame rate can use.
   *
   * Note this only decides how large the file is. It is not what makes
   * recording expensive -- see `recorderWidth` and `recorderFrameRate`.
   */
  videoBitsPerSecond?: number;
  /**
   * How the session is recorded. Defaults to `RecorderStrategy.Auto`, which
   * encodes video where the browser supports it and falls back to a
   * Motion-JPEG timelapse where it does not. Set to `Disabled` to record
   * nothing.
   */
  recorderStrategy?: RecorderStrategy;
  /**
   * Long-edge width of the session recording, in pixels. Defaults to 640.
   *
   * This is the dominant cost of recording: encoder work scales with the pixel
   * count, so recording the camera's own resolution costs roughly (camera
   * width / this) squared as much.
   */
  recorderWidth?: number;
  /**
   * Frames per second sampled into the session recording. Defaults to 6.
   *
   * The other half of the cost. The recording is evidence that a real capture
   * happened, not something anyone watches for detail, so it does not need the
   * camera's frame rate.
   */
  recorderFrameRate?: number;
  /**
   * Set to scan face
   */
  isFaceScan?: boolean;
}

/**
 * Image settings.
 */
export class ImageSettings {
  readonly imageData: ImageData;
  readonly videoFrame: boolean;

  constructor(imageData: ImageData, videoFrame: boolean) {
    this.imageData = imageData;
    this.videoFrame = videoFrame;
  }
}

/**
 * Recognizer metadata callbacks.
 */
export class RecognizerCallbacks {
  /**
   * An optional function called when document process need more requirements.
   */
  onIDScanDetection?(state: IDScanDetectionStatus, documentPosition: Quadrilateral): void;
  /**
   * An optional called when first side of the document is successfully captured.
   * Usually when the front side is completed.
   */
  onFirstScan?(): void;
  /**
   * An optional function called when face scan process need more requirements.
   */
  onFaceScanDetection?(state: FaceScanDetectionStatus): void;
}

export interface RecognizerSettings {
  /**
   * Whether to run the DFA Engine. (Optional)
   */
  enableDFA?: boolean;
  /**
   * Whether to run the FaceMatch Engine. (Optional)
   */
  enableFaceMatch?: boolean;
  /**
   * SDK version.
   */
  SDKVersion?: string;
}
