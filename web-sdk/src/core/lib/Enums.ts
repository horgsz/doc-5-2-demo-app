/**
 * Defines the WASM load mode that will be loaded.
 */
export enum WasmMode {
  /**
   * This mode will load basic build which will work with all browsers that supports Web Assembly.
   */
  Basic = 'basic',
  /**
   * This mode will load SIMD build which will only work with browsers that supports:
   * - SIMD feature
   * - Bulk Memory
   * - Sign Extensions
   * - Non-trapping float-to-int conversions
   * Note: Loading this mode in a non-compatible browser will crash your app.
   */
  Simd = 'simd',
  /**
   * This mode will load SIMD features build (same as above) including multi-threaded processing.
   * Note: Loading this mode in a non-compatible browser will crash your app.
   */
  SimdThreads = 'simd-threads',
}

/**
 * Camera type (facing mode/direction).
 */
export enum CameraType {
  /**
   * Front (user) facing camera.
   */
  Front,
  /**
   * Back (environment) facing camera.
   */
  Back,
}

/**
 * How frames reach the engine.
 */
export enum CaptureMode {
  /**
   * Frames are pulled from the camera continuously and fed to the engine until
   * it reports a valid document.
   */
  Live,
  /**
   * Nothing is sent to the engine until a capture is taken. Each one submits
   * exactly one frame and returns feedback for it, and the user can capture
   * again as many times as they need.
   *
   * Semi-automatic rather than manual: the user presses the shutter when they
   * are ready, but if they do not, a visible countdown takes the frame for
   * them. This is the default behaviour.
   */
  SemiAuto,
}

/**
 * Camera resolution.
 */
export enum CameraResolution {
  Auto,
  VGA,
  HD,
  FULL_HD,
  UHD,
  // QHD (2560-wide, "2K") sits between FULL_HD and UHD by pixels but is appended
  // here so the existing values (UHD = 4, etc.) stay stable for callers. Code
  // that ranks resolutions must compare pixel widths, not the enum ordinal --
  // see Camera.resolutionWidth / Scanner.dynamicCapture.
  QHD,
}

/**
 * Available callback types.
 */
export enum CallbackType {
  onIDScanDetection,
  onFirstScan,
  onFaceScanDetection,
}

/**
 * Available callback types.
 */
export enum ParameterType {
  Settings,
  Callback,
}

/**
 * Screen orientation type.
 */
export enum OrientationType {
  PortraitPrimary = 'portrait-primary',
  PortraitSecondary = 'portrait-secondary',
  LandscapePrimary = 'landscape-primary',
  LandscapeSecondary = 'landscape-secondary',
}

/**
 * Defines SDK type.
 */
export enum SdkType {
  IDScan = 'id-scan',
  FaceScan = 'face-scan',
  DigitalCredentials = 'digital-credentials',
  DeviceInfo = 'p27850',
}
