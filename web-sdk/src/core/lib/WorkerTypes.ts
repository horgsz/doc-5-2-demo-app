export class RegisteredCallbacks {
  onIDScanDetection = false;
  onFirstScan = false;
  onFaceScanDetection = false;
}

/**
 * An image wrapper for wasm.
 */
export class WASMFrame {
  readonly data: number;
  readonly width: number;
  readonly height: number;
  readonly videoFrame: boolean;

  constructor(data: number, width: number, height: number, videoFrame: boolean) {
    this.data = data;
    this.width = width;
    this.height = height;
    this.videoFrame = videoFrame;
  }
}
