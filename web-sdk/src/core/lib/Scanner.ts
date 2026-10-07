import { Camera } from './Camera';
import { CameraResolution, CameraType, CaptureMode, ScannerSettings } from './Interfaces';
import { ErrorCode, SdkError } from './SdkError';
import { Recognizer, RecognizerState } from '../recognizers/Recognizer';
import { OrientationType } from './Interfaces';
import { onScreenOrientationChange, readScreenOrientation } from './Orientation';
import { RecorderStrategy, SessionRecorder, SessionRecording } from './SessionRecorder';

/** Live: the pause before the next frame after one the engine could not download data for. */
const DATA_UNAVAILABLE_RETRY_MS = 2000;

export class Scanner {
  /**
   * Video feed element.
   */
  private videoFeed: HTMLVideoElement | null;
  /**
   * Recognizer instance.
   */
  private recognizer: Recognizer | null;
  /**
   * Recorder instance.
   */
  private recorder: SessionRecorder | null = null;
  /**
   * Kept so the recorder can be rebuilt when the scan is reset.
   */
  private recorderSettings: ScannerSettings;
  /**
   * Whether to stop detecting or not.
   */
  private shouldStopScanning: boolean = false;
  /**
   * Whether the detection is paused or not.
   */
  private scanningPaused: boolean = false;
  /**
   * Whether the detection is cancelled or not.
   */
  private cancelled: boolean = false;

  /**
   * Whether the detection is timed out or not.
   */
  private timedOut: boolean = false;
  /**
   * Allow screen landscape mode.
   */
  private disableScreenLandscape: boolean | undefined;
  /**
   * Called when the process started.
   */
  private onStart: { (): void } | undefined;
  /**
   * Landscape detection callback. Works only if `disableScreenLandscape` is set to true.
   */
  private onScreenLandscape: { (): void } | undefined;
  /**
   * Process complete callback.
   */
  private onScanComplete: { (state: RecognizerState): void } | null = null;
  /**
   * Fails the running start() -- the camera went away under it.
   */
  private failScan: { (error: SdkError): void } | null = null;
  /**
   * Process timeout.
   */
  private timeoutMs: number = 60000;
  /**
   * Start the process x milliseconds.
   */
  private startAfter: number = 0;
  /**
   * Schedules timeout .
   */
  private timeoutSchedule: number = 0;
  /**
   * Current image frame.
   */
  public currentImage: ImageData | null = null;
  /**
   * Whether to delay the process before starting.
   */
  private delay: boolean = false;

  private currentRecognizerState: RecognizerState = RecognizerState.Empty;
  /**
   * Live streams frames continuously; SemiAuto submits one frame per capture().
   */
  private captureMode: CaptureMode = CaptureMode.Live;
  /**
   * TEMP (dynamic-resolution capture): the resolution the preview stream runs
   * at, and the (usually higher) resolution to switch to for a single capture.
   * When {@link dynamicCapture} is true, capture() raises the track to the
   * capture resolution for the grab and drops it straight back -- a cheap
   * preview with a full-res still. Equal by default (no switching).
   */
  private previewResolution: CameraResolution = CameraResolution.FULL_HD;
  private captureResolution: CameraResolution = CameraResolution.FULL_HD;
  /**
   * Guards against overlapping captures while one is still being processed.
   */
  private capturing: boolean = false;
  /**
   * Asked before a valid capture is allowed to end the scan. Resolving false
   * keeps the camera open and reports the frame as `Incomplete`, so the user
   * can take another one -- used to let them review a weak read first.
   */
  public onCaptureAccepted: (() => Promise<boolean>) | null = null;
  /**
   * Live: a frame could not be read because the engine could not download the
   * data it needed. The stream carries on, a little later.
   */
  public onDataUnavailable: (() => void) | null = null;
  /**
   * The last recording produced, kept for callers that want to inspect or
   * download it after the scan.
   */
  public lastRecording: SessionRecording | null = null;

  constructor(recognizer: Recognizer, settings: ScannerSettings) {
    this.videoFeed = settings.cameraFeed || document.createElement('video');
    this.recognizer = recognizer;
    this.disableScreenLandscape = settings.disableScreenLandscape;
    this.onStart = settings.onStart;
    this.onScreenLandscape = settings.onScreenLandscape;
    this.startAfter = settings.startAfter || 0;
    this.captureMode = settings.captureMode ?? CaptureMode.Live;
    this.previewResolution = settings.cameraResolution ?? CameraResolution.FULL_HD;
    this.captureResolution = settings.captureResolution ?? this.previewResolution;
    this.recorderSettings = settings;
    this.recorder = this.createRecorder();

    if (settings.cameraType === CameraType.Back) {
      this.delay = true;
    }

    if (this.disableScreenLandscape) {
      onScreenOrientationChange(() => this.checkOrientationType(readScreenOrientation().type));
    }

    // A camera that goes away mid-scan -- unplugged, claimed by another app,
    // permission withdrawn -- ends its track. Nothing listened, so the shutter
    // stayed up over the last frame and every press read that dead picture.
    // Our own track.stop() (closeCamera, delete) fires no 'ended'.
    const stream = this.videoFeed.srcObject as MediaStream | null;
    stream?.getVideoTracks?.()[0]?.addEventListener?.('ended', () => this.cameraLost());
  }

  /**
   * Fails the running scan when its camera has gone.
   */
  private cameraLost(): void {
    // Already handed back. (A scan that has finished is not failed: its
    // start() has settled.)
    if (!this.videoFeed) {
      return;
    }

    this.shouldStopScanning = true;
    this.recorder?.pause();
    this.failScan?.(new SdkError(ErrorCode.CameraNotAvailable));
  }

  /**
   * A static function fetches camera by side reference and creates `Scanner` instance.
   *
   * @param recognizer Recognizer instance.
   * @param scanSettings scan manager settings.
   *
   * @returns `Scanner` instance.
   */
  static async create(recognizer: Recognizer, scanSettings: ScannerSettings): Promise<Scanner> {
    return new Promise(async (resolve, reject) => {
      const isNotElement = !(scanSettings.cameraFeed instanceof Element);

      if (!scanSettings.cameraFeed || isNotElement) {
        scanSettings.cameraFeed = document.createElement('video');
      }

      if (!Camera.isMediaDevicesSupported()) {
        return reject(new SdkError(ErrorCode.MediaDevicesFailure));
      }

      try {
        const selectedCamera = await Camera.chooseCamera(scanSettings.cameraType);

        const stream = await Camera.bindStreamToVideoFeed(
          selectedCamera,
          scanSettings.cameraFeed,
          scanSettings.cameraType,
          scanSettings.cameraResolution != undefined
            ? scanSettings.cameraResolution
            : CameraResolution.FULL_HD,
        );

        // The stream is bound to the camera feed element by the call above; the
        // scanner reads frames from that element, so it is not needed here.
        void stream;

        resolve(new Scanner(recognizer, scanSettings));
      } catch (error: any) {
        console.error(error);

        switch (error.name) {
          case 'NotAllowedError':
          case 'PermissionDeniedError':
          case 'SecurityError':
            return reject(new SdkError(ErrorCode.CameraNotAllowed));
          case 'NotFoundError':
          case 'OverconstrainedError':
            return reject(new SdkError(ErrorCode.CameraNotFound));
          case 'AbortError':
          case 'NotReadableError':
            return reject(new SdkError(ErrorCode.CameraNotAvailable));
          default:
            return reject(new SdkError(ErrorCode.CameraBusy, error));
        }
      }
    });
  }

  /**
   * Starts scanning process.
   *
   * @returns Scan result state.
   */
  public start(): Promise<RecognizerState> {
    return new Promise(async (resolve, reject) => {
      if (!this.videoFeed) {
        reject(new SdkError(ErrorCode.VideoFeedMissing));
        return;
      }

      this.reset(true);
      this.onScanComplete = async (state: RecognizerState) => {
        resolve(state);
      };
      this.failScan = error => reject(error);

      // Check orientation type.
      this.checkOrientationType(readScreenOrientation().type);

      // Sleep function.
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

      try {
        if (this.delay) {
          // Wait 2 sec. for smooth camera transition.
          await sleep(1800);
        }
        this.videoFeed
          .play()
          .then(async () => {
            if (this.startAfter !== 0) {
              await sleep(this.startAfter);
            }
            if (this.onStart) this.onStart();
            // In Semi-auto mode nothing is sent to the engine until capture() is
            // called, so the camera runs but the recognition loop never starts.
            // start() still resolves through onScanComplete, which capture()
            // triggers via stop() once the engine reports a valid document.
            if (this.captureMode === CaptureMode.Live) {
              this.processFrame()
                .then()
                .catch(error => reject(error));
            }
            // Recording covers the session from the moment the feed is live,
            // in both modes. start() both begins and resumes, so a retry
            // continues the same recording rather than starting a new one.
            this.recorder?.start();
          })
          .catch(error => reject(new SdkError(ErrorCode.VideoFeedPlayFailure, null, error)));
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Submits a single frame to the engine and returns the state for that frame.
   *
   * This is the SemiAuto counterpart to the Live frame loop: the caller decides
   * when a frame is worth evaluating, and gets feedback for exactly that frame.
   * The frame is marked as a still, so the engine judges it on its own rather
   * than waiting for stability across a sequence.
   *
   * Callers can keep capturing until they get `Valid`; on `Valid` the scan is
   * finished and the promise returned by `start()` resolves.
   *
   * @returns The recognizer state for the submitted frame, or `Empty` if a
   * capture was already in flight or the scan is already finished.
   */
  /**
   * TEMP (dynamic-resolution capture): true when the capture resolution is
   * higher than the preview's, so capture() should bump the track up for the
   * grab and drop it back. Compares pixel widths, not the enum ordinal -- the
   * enum is not monotonic (QHD is appended after UHD).
   */
  private get dynamicCapture(): boolean {
    return (
      Camera.resolutionWidth(this.captureResolution) >
      Camera.resolutionWidth(this.previewResolution)
    );
  }

  public async capture(): Promise<RecognizerState> {
    if (!this.recognizer) {
      throw new SdkError(ErrorCode.RecognizerMissing);
    }

    if (!this.videoFeed) {
      throw new SdkError(ErrorCode.CameraFeedMissing);
    }

    // Ignore taps that arrive while the previous frame is still being processed
    // or after the scan has already completed.
    if (this.capturing || this.shouldStopScanning) {
      return RecognizerState.Empty;
    }

    this.capturing = true;

    // Camera track to quiesce while the engine reads the frame. Decoding and
    // compositing a 4K preview (and the ISP feeding it) competes with the
    // worker's DNN for the same cores on a phone -- measurably inflating the
    // OCR wall-clock -- and the UI shows a frozen frame throughout anyway.
    //
    // We disable the TRACK, never videoFeed.pause(): pausing the element re-
    // fires its `play` event on resume, and startScanning wires that to
    // onStart(), which resets the semi-auto capture UI to the front-side state
    // (shutter back, "scan front of ID", auto-capture re-armed) -- wrong on
    // every capture, and visibly broken across the flip-to-back animation.
    // Re-enabled in the finally, so a rejected capture resumes seamlessly.
    // Stable non-null handle: the guard above narrows this.videoFeed here, but
    // it can widen back across the awaits below (and in the finally).
    const feed = this.videoFeed;
    const stream = feed.srcObject as MediaStream | null;
    const videoTrack = stream?.getVideoTracks?.()[0] ?? null;

    // Press-to-engine timing, on the same channel as the engine's [perf]
    // lines. The frame grab (a UHD canvas readback) and the keep-copy are the
    // main-thread cost between the shutter and the engine starting.
    let perfCh: BroadcastChannel | null = null;
    try {
      perfCh = new BroadcastChannel('idv-perf');
    } catch (e) {
      /* no channel, no lines */
    }
    const t0 = performance.now();
    // The engine's verdict on this frame, for the perf line in the finally --
    // Valid/Incomplete/Empty is the fact that decides whether the review can
    // run at all, so it belongs in the same diagnostics stream.
    let verdict: RecognizerState | null = null;

    try {
      // Dynamic-resolution capture: raise the track to the capture resolution
      // for this one still (waiting until the feed actually delivers it), then
      // drop it straight back below. A 1080p preview stays cheap -- memory-safe
      // on older iPhones -- while the captured frame is full 4K. No-op unless
      // the capture resolution is higher than the preview's.
      if (this.dynamicCapture) {
        await Camera.setTrackWidth(feed, Camera.resolutionWidth(this.captureResolution), true);
      }
      const tBump = performance.now();

      const imageData = Camera.getImageData(feed, false);
      const tGrab = performance.now();

      this.currentImage = new ImageData(
        new Uint8ClampedArray(imageData.imageData.data),
        imageData.imageData.width,
        imageData.imageData.height,
      );
      const tCopy = performance.now();

      // Back to the preview resolution immediately, so the 4K capture buffers
      // are released before the OCR runs rather than held across it. Fire-and-
      // forget: the reconfigure settles while the engine works on the frame we
      // already grabbed. A safety-net restore also runs in `finally`.
      if (this.dynamicCapture) {
        void Camera.setTrackWidth(feed, Camera.resolutionWidth(this.previewResolution));
      }

      if (videoTrack) videoTrack.enabled = false;

      perfCh?.postMessage(
        `[perf] capture: bump ${Math.round(tBump - t0)} ms, grab ${Math.round(
          tGrab - tBump,
        )} ms, keep-copy ${Math.round(tCopy - tGrab)} ms (${imageData.imageData.width}x${
          imageData.imageData.height
        })`,
      );

      const state = await this.recognizer.processImage(imageData);
      verdict = state;

      if (state === RecognizerState.Valid) {
        // Give the caller a chance to hold the scan open -- a read the engine
        // accepted may still be one the user wants to redo.
        if (this.onCaptureAccepted && !(await this.onCaptureAccepted())) {
          return RecognizerState.Incomplete;
        }

        this.currentRecognizerState = state;
        this.stop();
      }

      return state;
    } finally {
      // Safety net: guarantee the preview is back at its normal resolution even
      // if the capture threw between the bump and the restore above. A no-op
      // when the stream is already there.
      if (this.dynamicCapture) {
        void Camera.setTrackWidth(feed, Camera.resolutionWidth(this.previewResolution));
      }
      // Re-enable the track whatever happened. The element was never paused, so
      // this fires no play/onplay event; on an accepted capture the frozen
      // overlay stays on top, on a rejection the live feed is back immediately.
      if (videoTrack) videoTrack.enabled = true;
      perfCh?.postMessage(
        `[perf] capture: total press-to-result ${Math.round(performance.now() - t0)} ms` +
          (verdict !== null ? `, state ${RecognizerState[verdict] ?? verdict}` : ''),
      );
      try {
        perfCh?.close();
      } catch (e) {
        /* already closed */
      }
      this.capturing = false;
    }
  }

  /**
   * Grabs one frame and asks the engine only what shape it sees -- card or
   * passport -- without submitting it as a capture.
   *
   * Nothing about the scan changes: no OCR runs, no feedback is emitted, and a
   * capture already in flight is left alone. Semi-auto capture uses this shortly
   * after the camera opens so its alignment guide matches the real document.
   *
   * @returns the detector's class, or -1 when nothing was seen.
   */
  public async detectShape(): Promise<number> {
    if (!this.recognizer || !this.videoFeed || this.shouldStopScanning) {
      return -1;
    }

    // A capture in flight owns the engine; the guide can wait for the next one.
    if (this.capturing) {
      return -1;
    }

    try {
      const imageData = Camera.getImageData(this.videoFeed, false);
      return await (this.recognizer as any).detectDocumentShape(imageData);
    } catch {
      // The guide is an aid, not a requirement -- a failure here just leaves
      // it at whatever shape it was already showing.
      return -1;
    }
  }

  /**
   * Good-location probe. Grabs a small (640-wide) frame
   * and asks the engine whether the ID is well placed. Cheap to create/send and
   * cheap to run (detector only) -- meant to be polled ~1x/second.
   */
  public async detectLocation(): Promise<{ good: boolean; shape: number; vertical: boolean }> {
    const none = { good: false, shape: -1, vertical: false };
    if (!this.recognizer || !this.videoFeed || this.shouldStopScanning || this.capturing) {
      return none;
    }

    try {
      const imageData = Camera.getImageData(this.videoFeed, true, 640);
      return (await (this.recognizer as any).detect(imageData)) ?? none;
    } catch {
      return none;
    }
  }

  /**
   * Cancels the scan process.
   */
  public cancel(): void {
    this.cancelled = true;
  }

  /**
   * Pauses the process.
   */
  public pause(): void {
    this.scanningPaused = true;

    // A paused scan is not timing out. Left running, the clock could fire
    // just as the pause took effect, and the frame still with the engine saw
    // `timedOut` and ended the scan from under the pause screen ("Capture
    // failed!" over "ID capture paused"). resume() starts it again.
    if (this.timeoutSchedule !== 0) {
      clearTimeout(this.timeoutSchedule);
      this.timeoutSchedule = 0;
    }
  }

  /**
   * Resets the process.
   */
  public reset(clearRecordedChuncks: boolean): void {
    this.shouldStopScanning = false;
    this.scanningPaused = false;
    this.cancelled = false;
    this.timedOut = false;

    if (clearRecordedChuncks) {
      // Discarding frames mid-recording would leave a video with a jump in it,
      // so a cleared recording is a new recorder.
      //
      // This also has to cover a null recorder: finishRecording() consumes the
      // recorder, and start() resets before recording, so a second scan on the
      // same Scanner would otherwise record nothing at all.
      this.recorder?.dispose();
      this.recorder = this.createRecorder();
    }

    if (this.timeoutSchedule !== 0) {
      clearTimeout(this.timeoutSchedule);
      this.timeoutSchedule = 0;
    }
  }

  /**
   * Pauses the process.
   */
  public resume(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (this.videoFeed && this.videoFeed.paused) {
        reject(new SdkError(ErrorCode.VideoFeedPaused));
        return;
      }

      this.reset(false);
      this.processFrame();
      resolve();
    });
  }

  /**
   * Halts the recognition loop. The recording is paused (not stopped), so we can resume the recording on retry.
   */
  public stop() {
    this.shouldStopScanning = true;
    this.recorder?.pause();
    if (this.onScanComplete) {
      this.onScanComplete(this.currentRecognizerState);
    }
  }

  /**
   * Ends a SemiAuto scan without a valid read.
   *
   * The Live loop times itself out: after `timeoutMs` the next frame closes
   * the scan and `start()` resolves with whatever the engine last said. A
   * SemiAuto scan has no clock of its own -- its equivalent of running out of
   * time is the idle countdown's automatic press coming back rejected. The
   * caller reports that here, and the scan completes exactly the way a Live
   * timeout does: same resolution of `start()`, same recorder pause, so the
   * downstream failure flow cannot tell the two apart.
   *
   * @param state The engine's verdict on the final frame; `start()` resolves
   * with it, and `Empty` maps to the timeout screen downstream.
   */
  public endScan(state: RecognizerState = RecognizerState.Empty): void {
    if (this.shouldStopScanning) {
      return;
    }

    this.currentRecognizerState = state;
    this.stop();
  }

  /**
   * Check mobile orientation type.
   * if landscape is not allowed from the setting,
   * this function will pause the process and ask to rotate the mobile phone.
   */
  protected checkOrientationType(mode: string): void {
    if (this.disableScreenLandscape) {
      if (
        (mode === OrientationType.LandscapePrimary ||
          mode === OrientationType.LandscapeSecondary) &&
        !this.shouldStopScanning
      ) {
        this.pause();
        if (this.onScreenLandscape) this.onScreenLandscape();
      } else {
        if (this.scanningPaused) {
          this.resume();
        }
      }
    }
  }

  /**
   * Processes every frame in loop.
   */
  async processFrame(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.recognizer) {
        return reject(new SdkError(ErrorCode.RecognizerMissing));
      }

      if (!this.videoFeed) {
        return reject(new SdkError(ErrorCode.CameraFeedMissing));
      }

      if (this.shouldStopScanning) {
        return resolve();
      }

      const complete = (delayMs: number = 1) => {
        if (!this.scanningPaused) {
          window.setTimeout(() => {
            this.processFrame()
              .then(() => resolve())
              .catch(error => reject(error));
          }, delayMs);
        } else {
          resolve();
        }
      };

      if (this.timeoutSchedule === 0) {
        this.timeoutSchedule = window.setTimeout(() => {
          this.timedOut = true;
        }, this.timeoutMs);
      }

      const imageData = Camera.getImageData(this.videoFeed);
      this.currentImage = new ImageData(
        new Uint8ClampedArray(imageData.imageData.data),
        imageData.imageData.width,
        imageData.imageData.height,
      );

      this.recognizer
        .processImage(imageData)
        .then((state: RecognizerState) => {
          if (
            state === RecognizerState.Valid ||
            state === RecognizerState.Timeout ||
            this.cancelled ||
            this.timedOut
          ) {
            window.clearTimeout(this.timeoutSchedule);

            this.currentRecognizerState = state;

            this.stop();
          }

          // Every frame would ask for the same files again: give the network a
          // moment rather than retrying at frame rate.
          if (state === RecognizerState.DataUnavailable && !this.shouldStopScanning) {
            this.onDataUnavailable?.();
            return complete(DATA_UNAVAILABLE_RETRY_MS);
          }

          complete();
        })
        .catch(error => {
          const safeLog = (msg: any) => {
            let logs = JSON.parse(localStorage.getItem('logs') || '[]');
            logs.push({ msg, time: Date.now() });
            localStorage.setItem('logs', JSON.stringify(logs));
          };
          safeLog(error);
          console.log('Error', error);
          complete();
        });
    });
  }

  /**
   * Builds the session recorder for the current settings.
   *
   * The recorder is deliberately cheap by default: a downscaled copy of the
   * feed at a few frames per second, rather than the camera's own resolution
   * and frame rate. See `SessionRecorder` for why.
   */
  private createRecorder(): SessionRecorder | null {
    if (!this.videoFeed || this.recorderSettings.recorderStrategy === RecorderStrategy.Disabled) {
      return null;
    }

    return new SessionRecorder(this.videoFeed, {
      strategy: this.recorderSettings.recorderStrategy,
      width: this.recorderSettings.recorderWidth,
      frameRate: this.recorderSettings.recorderFrameRate,
      videoBitsPerSecond: this.recorderSettings.videoBitsPerSecond,
    });
  }

  /**
   * Begins (or resumes) the session recording.
   *
   * `start()` already does this when the scan opens, so this is for resuming
   * after {@link pauseRecording} -- a capture the engine rejected, where the
   * user goes back to reframe and the session carries on.
   *
   * Safe to call repeatedly; the recorder ignores a start it is already
   * running.
   *
   * Builds a recorder when there is none, so this is also how a recording
   * begins again after {@link discardRecording} threw the last one away --
   * otherwise "start recording" would quietly record nothing.
   */
  public startRecording(): void {
    if (!this.recorder) {
      this.recorder = this.createRecorder();
    }

    this.recorder?.start();
  }

  /**
   * Halts the session recording, keeping everything captured so far.
   *
   * Deliberately a pause and not a finalisation: a rejected capture sends the
   * user back to reframe, and that continues the same session. `startRecording`
   * picks up where this left off, in the same file.
   */
  public pauseRecording(): void {
    this.recorder?.pause();
  }

  /**
   * Throws the session recording away without finalising it.
   *
   * Deliberately not a pause: {@link pauseRecording} keeps what has been
   * captured so the session can resume into the same file, which is right when
   * the footage so far is worth something. This is for when it is not -- a
   * camera that was open but never had a document in front of it, where those
   * seconds only pad the file with nothing.
   *
   * Nothing is built to replace it here; the next `startRecording()` does
   * that, so the new recording begins when the scan actually picks up rather
   * than while the user is looking at a screen. The scanner itself is
   * untouched -- same camera, same recognizer, same open scan.
   */
  public discardRecording(): void {
    this.recorder?.dispose();
    this.recorder = null;
  }

  /**
   * Finalizes the recording and saves it.
   * Called by the id-scan or face-scan when the scan has completed successfully.
   *
   * @returns Whether a recording was handed to the engine -- whose upload is
   *   then the scan's last. False with recording disabled or nothing recorded.
   */
  public async finishRecording(): Promise<boolean> {
    if (!this.recorder) {
      return false;
    }

    const recording = await this.recorder.stop();
    this.recorder = null;
    this.lastRecording = recording;

    if (!this.recognizer || recording.bytes === 0) {
      return false;
    }

    // The MIME type travels with the bytes: the negotiated codec differs by
    // browser (H.264/MP4 on Safari, VP8/WebM on Firefox), so the payload cannot
    // assume one.
    await this.recognizer.saveProcessData(await recording.blob.arrayBuffer(), recording.mimeType);
    return true;
  }

  /**
   * Whether this scanner still holds a camera. False once `closeCamera()` or
   * `delete()` has handed it back, at which point the scanner cannot be
   * restarted and a new one has to be built on a fresh feed.
   */
  public get hasCamera(): boolean {
    return this.videoFeed !== null;
  }

  /**
   * Hands the camera back to the device without tearing the scan down.
   *
   * Once the result is on screen the camera has nothing left to show, and
   * holding it keeps the recording light on and the hardware reserved while
   * the user reads their details. This stops the tracks and lets go of the
   * feed, but deliberately keeps everything the result screen still needs --
   * `currentImage` behind its download button, `lastRecording` behind the
   * video one, and the recognizer for the upload that follows.
   *
   * Safe to call twice, and safe to call before `delete()`.
   */
  public closeCamera(): void {
    if (!this.videoFeed) {
      return;
    }

    // Nothing should try to read a frame after the camera is gone.
    this.shouldStopScanning = true;

    const stream = this.videoFeed.srcObject as MediaStream | null;
    stream?.getTracks().forEach(track => track.stop());

    this.videoFeed.srcObject = null;
    this.videoFeed = null;
  }

  /**
   * Releases the video feed and stops the process.
   */
  public delete(): void {
    if (this.videoFeed) {
      // May already be released by closeCamera(), which leaves srcObject null.
      const stream = this.videoFeed.srcObject as MediaStream | null;
      stream?.getTracks().forEach(track => track.stop());
      this.videoFeed.srcObject = null;
      this.videoFeed = null;
    }

    // A scan still running ends with the scanner: its start() rejects, as a
    // Live scan's frame loop already made it do on the next frame. Semi-auto
    // has no loop, so its start() never settled -- and the scan waiting on it,
    // and any scan queued behind that, waited for good. (No-op once start()
    // has settled.)
    this.shouldStopScanning = true;
    this.failScan?.(new SdkError(ErrorCode.RecognizerMissing));
    this.failScan = null;

    this.recorder?.dispose();
    this.recorder = null;
    this.recognizer = null;
    this.currentImage = null;
  }
}
