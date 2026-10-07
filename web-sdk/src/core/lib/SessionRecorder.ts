/**
 * Low-cost session recording.
 *
 * The session video is evidence: it shows an operator (or an auditor) that a
 * real person held a real document in front of a real camera. Nobody reads text
 * off it, so it does not need the camera's resolution or frame rate -- and
 * paying for those is what makes phones hot.
 *
 * The previous implementation handed the raw camera stream to `MediaRecorder`,
 * so the encoder chewed through every pixel of every frame the sensor produced:
 * 1920x1080 at 30fps is 62 megapixels per second, in software (VP8), for the
 * whole session, alongside the OCR engine competing for the same cores.
 *
 * This records a downscaled copy sampled at a few frames per second instead.
 * The pixel rate drops by two orders of magnitude, which is the entire cost of
 * video encoding -- bitrate only decides how big the file is, not how much work
 * the CPU does to produce it.
 *
 * Two strategies, picked by what the browser can actually do:
 *
 *  - `CanvasEncode` -- a small canvas is fed to `MediaRecorder` through
 *    `captureStream`, using the cheapest codec the browser offers. Produces a
 *    normal video file.
 *  - `Timelapse` -- no video encoder at all: JPEG stills muxed into Motion-JPEG
 *    AVI by hand. Needs nothing but a canvas, so it works where `MediaRecorder`
 *    is missing or refuses every codec, and it is the cheapest option available
 *    on a device that is struggling.
 */

/**
 * How the session is recorded.
 */
export enum RecorderStrategy {
  /** Pick the best available at runtime. */
  Auto = 'auto',
  /** Downscaled canvas fed to `MediaRecorder`. */
  CanvasEncode = 'canvas-encode',
  /** JPEG stills muxed into Motion-JPEG AVI. No video encoder. */
  Timelapse = 'timelapse',
  /** Record nothing. */
  Disabled = 'disabled',
}

/**
 * Tuning for {@link SessionRecorder}. Every field has a defensible default;
 * the defaults are what the SDK ships with.
 */
export interface SessionRecorderSettings {
  /** Which strategy to use. Defaults to {@link RecorderStrategy.Auto}. */
  strategy?: RecorderStrategy;
  /**
   * Long-edge width of the recorded copy, in pixels. Defaults to 640, which is
   * enough to see a hand, a face and a document at arm's length.
   *
   * This is the dominant cost: encoder work scales with the pixel count, so
   * doubling this roughly quadruples it.
   */
  width?: number;
  /** Frames sampled per second. Defaults to 6. */
  frameRate?: number;
  /**
   * Encoder bitrate for {@link RecorderStrategy.CanvasEncode}. Defaults to
   * 1Mbps: a ceiling rather than a target, since the encoder spends only what
   * the picture needs and a mostly-static scene stays well under it. At the
   * default size and frame rate this is more than the picture can use, so it
   * effectively removes the bitrate as a constraint on quality.
   *
   * This changes file size, not CPU -- see `width` and `frameRate` for that.
   */
  videoBitsPerSecond?: number;
  /** JPEG quality for {@link RecorderStrategy.Timelapse}. Defaults to 0.6. */
  quality?: number;
  /**
   * Hard stop, in milliseconds, so a session left open cannot grow without
   * bound. Defaults to 3 minutes.
   */
  maxDurationMs?: number;
}

/**
 * What the recorder produced.
 */
export interface SessionRecording {
  /** The encoded video. Empty if nothing was recorded. */
  blob: Blob;
  /** The real MIME type of `blob` -- not assumed, whatever was negotiated. */
  mimeType: string;
  /** Strategy that produced it. */
  strategy: RecorderStrategy;
  /** Byte length of `blob`. */
  bytes: number;
  /** Frames actually written. */
  frames: number;
  /** Wall-clock milliseconds spent recording, excluding paused time. */
  durationMs: number;
  /** Recorded frame size. */
  width: number;
  height: number;
  /**
   * Total milliseconds spent on the main thread drawing frames. The recorder's
   * own measurable cost; the encoder's cost lives on a different thread.
   */
  drawMs: number;
}

const DEFAULTS = {
  width: 640,
  frameRate: 6,
  videoBitsPerSecond: 1000000,
  quality: 0.6,
  maxDurationMs: 180000,
};

/**
 * Candidate MIME types, cheapest first.
 *
 * H.264 comes first because it is the one codec with a hardware encoder on
 * essentially every phone shipped this decade -- the encode happens on a fixed
 * function block instead of the CPU, which is the difference between a warm
 * phone and a hot one. VP8 is software on most builds but universally
 * available, so it backs H.264 up. VP9 is deliberately last of the real
 * choices: it is the most expensive to encode of the lot.
 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=h264',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
  'video/webm',
];

export class SessionRecorder {
  private settings: Required<SessionRecorderSettings>;
  private source: HTMLVideoElement;

  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;

  private recorder: MediaRecorder | null = null;
  private captured: MediaStream | null = null;
  private chunks: Blob[] = [];

  /** JPEG stills, for {@link RecorderStrategy.Timelapse}. */
  private stills: ArrayBuffer[] = [];
  /** Guards against a slow `toBlob` overlapping the next sample. */
  private encodingStill: boolean = false;

  private timer: any = null;
  private strategy: RecorderStrategy = RecorderStrategy.Disabled;
  private mimeType: string = '';
  private running: boolean = false;
  private width: number = 0;
  private height: number = 0;

  private frames: number = 0;
  private drawMs: number = 0;
  private activeMs: number = 0;
  private startedAt: number = 0;

  private onVisibility: (() => void) | null = null;

  constructor(source: HTMLVideoElement, settings: SessionRecorderSettings = {}) {
    this.source = source;
    this.settings = {
      strategy: settings.strategy ?? RecorderStrategy.Auto,
      width: settings.width ?? DEFAULTS.width,
      frameRate: settings.frameRate ?? DEFAULTS.frameRate,
      videoBitsPerSecond: settings.videoBitsPerSecond ?? DEFAULTS.videoBitsPerSecond,
      quality: settings.quality ?? DEFAULTS.quality,
      maxDurationMs: settings.maxDurationMs ?? DEFAULTS.maxDurationMs,
    };
  }

  /**
   * The MIME type `MediaRecorder` will accept, or an empty string if it will
   * not accept any -- which is the signal to fall back to the timelapse.
   *
   * Nothing here is inferred from the browser's user agent: support is asked
   * for directly, so a browser that gains or loses a codec is handled without a
   * code change.
   */
  public static negotiateMimeType(): string {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
      return '';
    }

    for (const candidate of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }

    return '';
  }

  /** Whether anything can be recorded at all. */
  public static isSupported(): boolean {
    return (
      typeof document !== 'undefined' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.toBlob === 'function'
    );
  }

  /** The strategy chosen for this recorder. Only meaningful after `start()`. */
  public get chosenStrategy(): RecorderStrategy {
    return this.strategy;
  }

  /**
   * Begins recording. Safe to call when already running.
   *
   * A failure to record is never a failure to scan: any problem downgrades to a
   * cheaper strategy, and in the worst case to recording nothing at all.
   */
  public start(): void {
    if (this.running) {
      return;
    }

    if (this.settings.strategy === RecorderStrategy.Disabled || !SessionRecorder.isSupported()) {
      this.strategy = RecorderStrategy.Disabled;
      return;
    }

    if (!this.canvas) {
      this.prepareCanvas();
    }

    if (!this.canvas || !this.context) {
      this.strategy = RecorderStrategy.Disabled;
      return;
    }

    if (this.strategy === RecorderStrategy.Disabled) {
      this.strategy = this.chooseStrategy();
    }

    if (this.strategy === RecorderStrategy.CanvasEncode && !this.recorder) {
      if (!this.startEncoder()) {
        // The encoder refused mid-setup. The timelapse needs no encoder, so it
        // can always take over.
        this.strategy = RecorderStrategy.Timelapse;
      }
    }

    if (this.strategy === RecorderStrategy.Disabled) {
      return;
    }

    if (this.recorder) {
      if (this.recorder.state === 'paused') {
        this.recorder.resume();
      } else if (this.recorder.state === 'inactive') {
        // A timeslice keeps chunks arriving during the session rather than
        // materialising the whole recording in one allocation at the end.
        this.recorder.start(2000);
      }
    }

    this.running = true;
    this.startedAt = now();
    this.startPump();
    this.watchVisibility();
  }

  /**
   * Stops sampling but keeps everything recorded so far, so `start()` can
   * resume into the same recording. Used when the scan pauses for a retry.
   */
  public pause(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.activeMs += now() - this.startedAt;
    this.stopPump();

    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.pause();
    }
  }

  /**
   * Finishes the recording and returns it.
   *
   * Resolves with an empty recording rather than rejecting when there is
   * nothing to hand back, so callers never need to special-case it.
   */
  public async stop(): Promise<SessionRecording> {
    if (this.running) {
      this.activeMs += now() - this.startedAt;
    }

    this.running = false;
    this.stopPump();
    this.unwatchVisibility();

    let blob: Blob;

    if (this.strategy === RecorderStrategy.CanvasEncode && this.recorder) {
      blob = await this.finishEncoder();
    } else if (this.strategy === RecorderStrategy.Timelapse) {
      blob = this.muxMotionJpeg();
    } else {
      blob = new Blob([], { type: '' });
    }

    this.release();
    this.chunks = [];
    this.stills = [];

    return {
      blob,
      mimeType: blob.type || this.mimeType,
      strategy: this.strategy,
      bytes: blob.size,
      frames: this.frames,
      durationMs: Math.round(this.activeMs),
      width: this.width,
      height: this.height,
      drawMs: Math.round(this.drawMs * 100) / 100,
    };
  }

  /** Frees the canvas, encoder and buffered frames. */
  public dispose(): void {
    this.stopPump();
    this.unwatchVisibility();

    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        // Already tearing down; nothing useful to do with the error.
      }
    }

    this.release();
    this.chunks = [];
    this.stills = [];
  }

  /**
   * Sizes the offscreen canvas to the settings' width, preserving the camera's
   * aspect ratio and keeping both edges even -- odd dimensions are rejected or
   * silently corrected by some H.264 encoders.
   */
  private prepareCanvas(): void {
    const sourceWidth = this.source.videoWidth || 1280;
    const sourceHeight = this.source.videoHeight || 720;
    const scale = Math.min(1, this.settings.width / sourceWidth);

    this.width = even(Math.round(sourceWidth * scale));
    this.height = even(Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;

    // `alpha: false` lets the compositor skip the alpha channel, and
    // `desynchronized` allows the draw to bypass a compositing round-trip.
    // Both are hints; browsers that ignore them behave exactly as before.
    const context = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
    }) as CanvasRenderingContext2D | null;

    if (!context) {
      return;
    }

    // Downscaling is the only drawing this class does, and the smoothing
    // quality is the one knob that changes its cost. Low is right: the output
    // is a thumbnail-sized evidence clip.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'low';

    this.canvas = canvas;
    this.context = context;
  }

  private chooseStrategy(): RecorderStrategy {
    if (this.settings.strategy !== RecorderStrategy.Auto) {
      return this.settings.strategy;
    }

    return SessionRecorder.negotiateMimeType()
      ? RecorderStrategy.CanvasEncode
      : RecorderStrategy.Timelapse;
  }

  /**
   * Wires the canvas to a `MediaRecorder`.
   *
   * @returns whether the encoder is ready.
   */
  private startEncoder(): boolean {
    if (!this.canvas || typeof this.canvas.captureStream !== 'function') {
      return false;
    }

    this.mimeType = SessionRecorder.negotiateMimeType();

    if (!this.mimeType) {
      return false;
    }

    try {
      this.captured = this.canvas.captureStream(this.settings.frameRate);

      this.recorder = new MediaRecorder(this.captured, {
        mimeType: this.mimeType,
        videoBitsPerSecond: this.settings.videoBitsPerSecond,
      });

      this.recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          this.chunks.push(event.data);
        }
      };

      return true;
    } catch (error) {
      console.warn('SessionRecorder: encoder unavailable, falling back', error);
      this.captured = null;
      this.recorder = null;
      return false;
    }
  }

  private finishEncoder(): Promise<Blob> {
    return new Promise(resolve => {
      const recorder = this.recorder;

      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(this.chunks, { type: this.mimeType }));
        return;
      }

      recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.mimeType }));

      try {
        recorder.stop();
      } catch (error) {
        console.warn('SessionRecorder: stop failed', error);
        resolve(new Blob(this.chunks, { type: this.mimeType }));
      }
    });
  }

  /**
   * Samples on a timer rather than `requestAnimationFrame`.
   *
   * rAF is tied to the display's refresh rate, so it would fire ~8x more often
   * than needed only to have most calls discarded, and it stops entirely when
   * the page is hidden. A timer asks for exactly the rate wanted.
   */
  private startPump(): void {
    this.stopPump();

    const interval = Math.max(1, Math.round(1000 / this.settings.frameRate));
    this.timer = setInterval(() => this.sample(), interval);
  }

  private stopPump(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private sample(): void {
    if (!this.running || !this.context || !this.canvas) {
      return;
    }

    if (this.activeMs + (now() - this.startedAt) >= this.settings.maxDurationMs) {
      this.pause();
      return;
    }

    // A hidden page has a suspended camera, so the frame would be a duplicate
    // of the last one; and `toBlob` on a hidden page is heavily throttled.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    // `readyState < 2` means no frame has been decoded yet, and drawing then
    // paints a blank rectangle into the evidence.
    if (this.source.readyState < 2) {
      return;
    }

    const before = now();
    this.context.drawImage(this.source, 0, 0, this.width, this.height);
    this.drawMs += now() - before;
    this.frames++;

    if (this.strategy === RecorderStrategy.Timelapse) {
      this.captureStill();
    }
  }

  /**
   * Encodes the current canvas as a JPEG for the timelapse.
   *
   * `toBlob` is asynchronous and hands the work to the browser's image encoder
   * off the main thread. If it has not finished by the next tick the frame is
   * dropped rather than queued -- a backlog would cost more than the frame is
   * worth.
   */
  private captureStill(): void {
    if (!this.canvas || this.encodingStill) {
      return;
    }

    this.encodingStill = true;

    this.canvas.toBlob(
      async blob => {
        this.encodingStill = false;

        if (!blob) {
          return;
        }

        try {
          this.stills.push(await blob.arrayBuffer());
        } catch {
          // A dropped still costs one frame of evidence, nothing more.
        }
      },
      'image/jpeg',
      this.settings.quality,
    );
  }

  /**
   * Packs the collected JPEGs into a Motion-JPEG AVI.
   *
   * AVI is the one container simple enough to write correctly by hand in a few
   * dozen lines -- it is a flat list of frames plus an index, with no timestamp
   * interleaving or codec-specific headers to get wrong. Every player and every
   * server-side transcoder reads MJPEG/AVI.
   */
  private muxMotionJpeg(): Blob {
    if (!this.stills.length) {
      return new Blob([], { type: '' });
    }

    const frames = this.stills;
    const count = frames.length;
    const payload = frames.reduce((total, frame) => total + frame.byteLength + pad(frame) + 8, 0);
    const largest = frames.reduce((max, frame) => Math.max(max, frame.byteLength), 0);

    const HDRL = 4 + 8 + 56 + 8 + 4 + 8 + 56 + 8 + 40;
    const idx1 = 8 + count * 16;
    const movi = 8 + 4 + payload;
    const total = 8 + 4 + 8 + HDRL + movi + idx1;

    const buffer = new ArrayBuffer(total);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const writer = new RiffWriter(view, bytes);

    const rate = this.settings.frameRate;
    const microsPerFrame = Math.round(1000000 / rate);

    writer.fourcc('RIFF');
    writer.u32(total - 8);
    writer.fourcc('AVI ');

    // -- hdrl: stream declarations ------------------------------------------
    writer.fourcc('LIST');
    writer.u32(HDRL);
    writer.fourcc('hdrl');

    writer.fourcc('avih');
    writer.u32(56);
    writer.u32(microsPerFrame);
    writer.u32(Math.round((largest * rate) / 1)); // dwMaxBytesPerSec
    writer.u32(0); // dwPaddingGranularity
    writer.u32(0x10); // AVIF_HASINDEX
    writer.u32(count); // dwTotalFrames
    writer.u32(0); // dwInitialFrames
    writer.u32(1); // dwStreams
    writer.u32(largest); // dwSuggestedBufferSize
    writer.u32(this.width);
    writer.u32(this.height);
    writer.zero(16); // dwReserved[4]

    writer.fourcc('LIST');
    writer.u32(4 + 8 + 56 + 8 + 40);
    writer.fourcc('strl');

    writer.fourcc('strh');
    writer.u32(56);
    writer.fourcc('vids');
    writer.fourcc('MJPG');
    writer.u32(0); // dwFlags
    writer.u16(0); // wPriority
    writer.u16(0); // wLanguage
    writer.u32(0); // dwInitialFrames
    writer.u32(1); // dwScale
    writer.u32(rate); // dwRate -> rate/scale = fps
    writer.u32(0); // dwStart
    writer.u32(count); // dwLength
    writer.u32(largest); // dwSuggestedBufferSize
    writer.u32(10000); // dwQuality
    writer.u32(0); // dwSampleSize
    writer.u16(0); // rcFrame.left
    writer.u16(0); // rcFrame.top
    writer.u16(this.width); // rcFrame.right
    writer.u16(this.height); // rcFrame.bottom

    writer.fourcc('strf');
    writer.u32(40);
    writer.u32(40); // biSize
    writer.i32(this.width);
    writer.i32(this.height);
    writer.u16(1); // biPlanes
    writer.u16(24); // biBitCount
    writer.fourcc('MJPG'); // biCompression
    writer.u32(this.width * this.height * 3); // biSizeImage
    writer.u32(0); // biXPelsPerMeter
    writer.u32(0); // biYPelsPerMeter
    writer.u32(0); // biClrUsed
    writer.u32(0); // biClrImportant

    // -- movi: the frames ----------------------------------------------------
    writer.fourcc('LIST');
    writer.u32(4 + payload);
    writer.fourcc('movi');

    const moviStart = writer.offset - 4; // index offsets are relative to 'movi'
    const index: Array<{ offset: number; size: number }> = [];

    for (const frame of frames) {
      const chunkStart = writer.offset;
      writer.fourcc('00dc');
      writer.u32(frame.byteLength);
      writer.raw(new Uint8Array(frame));
      writer.zero(pad(frame));
      index.push({ offset: chunkStart - moviStart, size: frame.byteLength });
    }

    // -- idx1: seek table ----------------------------------------------------
    writer.fourcc('idx1');
    writer.u32(count * 16);

    for (const entry of index) {
      writer.fourcc('00dc');
      writer.u32(0x10); // AVIIF_KEYFRAME -- every MJPEG frame is a keyframe
      writer.u32(entry.offset);
      writer.u32(entry.size);
    }

    this.mimeType = 'video/x-msvideo';

    return new Blob([buffer], { type: this.mimeType });
  }

  /**
   * Pauses sampling while the page is hidden.
   *
   * Backgrounding is common mid-scan -- a notification, a call -- and the
   * camera is suspended then anyway, so there is nothing to record and no
   * reason to keep waking the CPU.
   */
  private watchVisibility(): void {
    if (this.onVisibility || typeof document === 'undefined') {
      return;
    }

    this.onVisibility = () => {
      if (document.visibilityState === 'hidden' && this.running) {
        this.stopPump();
      } else if (document.visibilityState === 'visible' && this.running) {
        this.startPump();
      }
    };

    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private unwatchVisibility(): void {
    if (this.onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }

    this.onVisibility = null;
  }

  private release(): void {
    if (this.captured) {
      this.captured.getTracks().forEach(track => track.stop());
      this.captured = null;
    }

    this.recorder = null;
    this.canvas = null;
    this.context = null;
  }
}

/** Rounds up to an even number; H.264 dislikes odd dimensions. */
function even(value: number): number {
  const floored = Math.max(2, Math.round(value));
  return floored % 2 === 0 ? floored : floored + 1;
}

/** RIFF chunks are word-aligned, so odd-sized payloads carry a pad byte. */
function pad(frame: ArrayBuffer): number {
  return frame.byteLength % 2;
}

function now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * Sequential little-endian writer for the AVI muxer.
 */
class RiffWriter {
  public offset: number = 0;

  constructor(
    private view: DataView,
    private bytes: Uint8Array,
  ) {}

  fourcc(value: string): void {
    for (let i = 0; i < 4; i++) {
      this.view.setUint8(this.offset++, value.charCodeAt(i));
    }
  }

  u32(value: number): void {
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
  }

  i32(value: number): void {
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
  }

  u16(value: number): void {
    this.view.setUint16(this.offset, value & 0xffff, true);
    this.offset += 2;
  }

  raw(value: Uint8Array): void {
    this.bytes.set(value, this.offset);
    this.offset += value.byteLength;
  }

  zero(count: number): void {
    this.offset += count;
  }
}
