/**
 * Regression guard for the semi-auto capture quiesce.
 *
 * During a capture the engine reads the frame while the live preview competes
 * for CPU, so capture() disables the camera TRACK to relieve that. It must NOT
 * pause()/play() the video element: startScanning wires videoFeed.onplay to
 * onStart(), which resets the semi-auto UI to the front side -- so a play() on
 * every capture made the shutter reappear and the label flip to "scan front of
 * ID" mid flip-to-back animation. This locks that in.
 */
import { Scanner } from './Scanner';
import { Camera } from './Camera';
import { CameraResolution, CameraType, CaptureMode } from './Enums';
import { ErrorCode } from './SdkError';
import { RecorderStrategy } from './SessionRecorder';
import { RecognizerState } from '../recognizers/Recognizer';

// jsdom has no ImageData constructor; capture() builds one.
if (typeof (global as any).ImageData === 'undefined') {
  (global as any).ImageData = class {
    data: any;
    width: number;
    height: number;
    constructor(data: any, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

/** Minimal `this` for Scanner.prototype.capture.call() -- no real camera/worker. */
function fakeScanner(track: any) {
  const videoFeed = {
    srcObject: { getVideoTracks: () => [track] },
    pause: jest.fn(),
    play: jest.fn().mockResolvedValue(undefined),
  };
  const self: any = {
    recognizer: { processImage: jest.fn().mockResolvedValue(RecognizerState.Empty) },
    videoFeed,
    capturing: false,
    shouldStopScanning: false,
    currentImage: null,
    currentRecognizerState: RecognizerState.Empty,
    onCaptureAccepted: null,
    stop: jest.fn(),
  };
  return { self, videoFeed };
}

describe('Scanner.capture() -- quiesce the camera without touching playback', () => {
  beforeEach(() => {
    jest.spyOn(Camera, 'getImageData').mockReturnValue({
      imageData: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('NEVER pauses or plays the video element', async () => {
    const { self, videoFeed } = fakeScanner({ enabled: true });
    await Scanner.prototype.capture.call(self);

    expect(videoFeed.pause).not.toHaveBeenCalled();
    expect(videoFeed.play).not.toHaveBeenCalled();
  });

  it('disables the track for the read and re-enables it afterwards', async () => {
    const log: boolean[] = [];
    const track: any = {};
    Object.defineProperty(track, 'enabled', {
      get: () => true,
      set: (v: boolean) => log.push(v),
    });
    const { self } = fakeScanner(track);

    await Scanner.prototype.capture.call(self);

    // down while the engine reads, back up in the finally
    expect(log).toEqual([false, true]);
  });

  it('re-enables the track even if the engine read throws', async () => {
    const log: boolean[] = [];
    const track: any = {};
    Object.defineProperty(track, 'enabled', {
      get: () => true,
      set: (v: boolean) => log.push(v),
    });
    const { self } = fakeScanner(track);
    self.recognizer.processImage = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(Scanner.prototype.capture.call(self)).rejects.toThrow('boom');
    expect(log[log.length - 1]).toBe(true); // finally re-enabled it
  });
});

/**
 * TEMP (dynamic-resolution capture). When the capture resolution is higher than
 * the preview's, capture() must raise the track for the single grab (waiting
 * until the feed delivers it) and drop it straight back -- so a memory-safe
 * 1080p preview still yields a 4K still on older iPhones. When they match, it
 * must not touch the track resolution at all (the previous behaviour).
 */
describe('Scanner.capture() -- dynamic-resolution capture', () => {
  beforeEach(() => {
    jest.spyOn(Camera, 'getImageData').mockReturnValue({
      imageData: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('bumps the track to the capture resolution for the grab, then restores it', async () => {
    const calls: Array<[number, boolean]> = [];
    jest
      .spyOn(Camera, 'setTrackWidth')
      .mockImplementation(async (_feed: any, width: number, wait: boolean = false) => {
        calls.push([width, wait]);
      });

    const { self } = fakeScanner({ enabled: true });
    self.dynamicCapture = true;
    self.captureResolution = CameraResolution.UHD; // 3840
    self.previewResolution = CameraResolution.FULL_HD; // 1920

    await Scanner.prototype.capture.call(self);

    // First a WAITED bump to the 4K width...
    expect(calls[0]).toEqual([3840, true]);
    // ...then (at least) one un-waited restore back to the 1080p width.
    expect(calls.some(([w, wait]) => w === 1920 && wait === false)).toBe(true);
  });

  it('leaves the track resolution untouched when preview and capture match', async () => {
    const spy = jest.spyOn(Camera, 'setTrackWidth').mockResolvedValue();
    const { self } = fakeScanner({ enabled: true });
    self.dynamicCapture = false;

    await Scanner.prototype.capture.call(self);

    expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * dynamicCapture ranks resolutions by pixel width, not the enum ordinal -- the
 * enum is not monotonic since QHD (2560, "2K") is appended after UHD (3840).
 */
describe('Scanner.dynamicCapture -- ranks by width, not enum ordinal', () => {
  const getter = Object.getOwnPropertyDescriptor(Scanner.prototype, 'dynamicCapture')!.get!;
  const isDynamic = (preview: CameraResolution, capture: CameraResolution): boolean =>
    getter.call({ previewResolution: preview, captureResolution: capture } as any);

  it('1080p preview + 4K capture is dynamic (a real bump)', () => {
    expect(isDynamic(CameraResolution.FULL_HD, CameraResolution.UHD)).toBe(true);
  });

  it('4K preview + 2K(QHD) capture is NOT dynamic, despite QHD outranking UHD in the enum', () => {
    // QHD ordinal (5) > UHD ordinal (4), but 2560 < 3840 -- width must win.
    expect(isDynamic(CameraResolution.UHD, CameraResolution.QHD)).toBe(false);
  });

  it('equal resolutions are NOT dynamic', () => {
    expect(isDynamic(CameraResolution.QHD, CameraResolution.QHD)).toBe(false);
  });
});

/**
 * Found by the simulator: a camera lost mid-scan (track ended) went unnoticed
 * -- the shutter stayed up over the last frame -- and a Semi-auto scan whose
 * scanner was deleted (destroy(), close()) never settled its start().
 */
describe('Scanner.start() -- ends when its camera does', () => {
  /** A real Scanner on a fake camera, scanning in Semi-auto. */
  function semiAutoScanner() {
    const listeners: Record<string, Array<() => void>> = {};
    const track: any = {
      stop: jest.fn(),
      enabled: true,
      addEventListener: (type: string, listener: () => void) => (listeners[type] ??= []).push(listener),
      /** What the browser does when the camera goes away. */
      end: () => listeners.ended?.forEach(listener => listener()),
    };
    const videoFeed: any = {
      srcObject: { getVideoTracks: () => [track], getTracks: () => [track] },
      play: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
    };
    const scanner = new Scanner({} as any, {
      cameraFeed: videoFeed,
      cameraType: CameraType.Front, // no start-up delay
      captureMode: CaptureMode.SemiAuto,
      recorderStrategy: RecorderStrategy.Disabled,
    } as any);
    return { scanner, track };
  }

  it('a camera lost mid-scan fails the scan: CameraNotAvailable', async () => {
    const { scanner, track } = semiAutoScanner();
    const scan = scanner.start();

    track.end();

    await expect(scan).rejects.toMatchObject({ code: ErrorCode.CameraNotAvailable });
  });

  it('delete() ends a running scan rather than leaving it pending', async () => {
    const { scanner } = semiAutoScanner();
    const scan = scanner.start();

    scanner.delete();

    await expect(scan).rejects.toMatchObject({ code: ErrorCode.RecognizerMissing });
  });

  it('pause() stops the scan clock: a paused scan does not time out', () => {
    // Found by the simulator (live/pause): the second idle minute's pause and
    // the scanner's own timeout fired together, and the timeout ended the scan
    // from under the pause screen.
    jest.useFakeTimers();
    try {
      const { scanner } = semiAutoScanner();
      const s: any = scanner;
      // The global timer: in this environment window.setTimeout is the mock
      // window's own, which jest does not fake (in a browser they are one).
      s.timeoutSchedule = setTimeout(() => (s.timedOut = true), 60000);

      scanner.pause();
      jest.advanceTimersByTime(61000);

      expect(s.timedOut).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('Live: a frame the engine could not download data for is reported, and the next waits', async () => {
    // 6.0's on-demand engine answers DataUnavailable when a document or
    // language file it needed did not arrive. The stream must carry on -- but
    // not at frame rate, asking the same failing server again every frame.
    jest.spyOn(Camera, 'getImageData').mockReturnValue({
      imageData: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
    } as any);
    const later = jest.spyOn(window, 'setTimeout').mockImplementation((() => 0) as any);
    try {
      const s: any = Object.create(Scanner.prototype);
      Object.assign(s, {
        recognizer: { processImage: jest.fn().mockResolvedValue(RecognizerState.DataUnavailable) },
        videoFeed: {},
        shouldStopScanning: false,
        scanningPaused: false,
        cancelled: false,
        timedOut: false,
        timeoutSchedule: 1, // the scan clock is already running
        stop: jest.fn(),
        onDataUnavailable: jest.fn(),
      });

      s.processFrame(); // settles only when the stream ends
      await new Promise(r => setTimeout(r, 0));

      expect(s.onDataUnavailable).toHaveBeenCalledTimes(1);
      expect(s.stop).not.toHaveBeenCalled();
      expect(later).toHaveBeenLastCalledWith(expect.any(Function), 2000);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('a camera lost after the scan has finished changes nothing', async () => {
    const { scanner, track } = semiAutoScanner();
    const scan = scanner.start();
    scanner.endScan(RecognizerState.Valid);

    track.end();

    await expect(scan).resolves.toBe(RecognizerState.Valid);
  });
});
