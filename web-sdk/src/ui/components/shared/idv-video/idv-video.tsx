import { Component, Method, Prop, Watch, h } from '@stencil/core';

/**
 * The camera preview.
 *
 * The <video> element is the stream's sink -- the SDK attaches the camera to
 * it, reads frames from it, records it -- but it is not what the user sees.
 * The picture on screen is a <canvas> that this component paints from the
 * video, frame by frame, with its own cover crop.
 *
 * Why not show the <video>: iOS WebKit (seen on iPhone 15, iOS Safari 27.2)
 * can composite a camera stream wrong -- the portrait frame contain-fitted at
 * its unrotated landscape size and rotated, a small box mid-screen that never
 * recovers -- while the element's box, `object-fit` and `videoWidth` are all
 * correct. It is a race inside WebKit's video layer, reproduced without the
 * SDK: a plain stream opens small and usually corrects itself, a stream
 * attached while the element is not rendered stays small, and the SDK's busy
 * camera open lost it most of the time. Nothing the page can observe or
 * style reliably fixes it. Painting the frames ourselves takes the video
 * layer out of the picture on every browser.
 *
 * The <video> keeps its box (visibility: hidden, not display: none) and stays
 * the place the SDK styles the feed: its inline opacity / transition (the
 * fade-in in id-scan) and transform (webcam mirroring, Camera.ts) are copied
 * onto the canvas.
 */
@Component({
  tag: 'idv-video',
  styleUrl: 'idv-video.scss',
  shadow: true,
})
export class IDVerseVideo {
  @Prop() visible: boolean = false;

  videoRef: HTMLVideoElement;
  private canvasRef: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;

  private frameHandle = 0;
  private frameKind: 'vfc' | 'raf' | null = null;
  private styleObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private stats = { frames: 0, drawMs: 0, since: 0, reports: 0 };

  private setVideoRef = (ref: HTMLVideoElement) => {
    if (ref && ref !== this.videoRef) {
      ref.addEventListener('playing', () => this.startPainting());
      // A new or removed stream: drop the last picture so the next scan does
      // not open on a stale frame from the previous one.
      ref.addEventListener('emptied', () => this.clearCanvas());
      this.styleObserver?.disconnect();
      this.styleObserver = new MutationObserver(() => this.syncStyle());
      this.styleObserver.observe(ref, { attributes: true, attributeFilter: ['style'] });
    }
    this.videoRef = ref;
  };

  private setCanvasRef = (ref: HTMLCanvasElement) => {
    if (ref && ref !== this.canvasRef) {
      this.ctx = ref.getContext('2d', { alpha: false });
      this.resizeObserver?.disconnect();
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.sizeCanvas());
        this.resizeObserver.observe(ref);
      }
    }
    this.canvasRef = ref;
  };

  @Watch('visible')
  onVisibleChange(visible: boolean) {
    if (visible) this.startPainting();
    else this.stopPainting();
  }

  componentDidLoad() {
    this.syncStyle();
    this.sizeCanvas();
    if (this.visible) this.startPainting();
  }

  disconnectedCallback() {
    this.stopPainting();
    this.styleObserver?.disconnect();
    this.resizeObserver?.disconnect();
  }

  @Method()
  async getVideoRef() {
    return this.videoRef;
  }

  private syncStyle() {
    const v = this.videoRef;
    const c = this.canvasRef;
    if (!v || !c) return;
    c.style.opacity = v.style.opacity;
    c.style.transition = v.style.transition;
    c.style.transform = v.style.transform;
  }

  /** Backing store at device pixels for the canvas's current box. */
  private sizeCanvas() {
    const c = this.canvasRef;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) {
      c.width = w;
      c.height = h;
      this.paint();
    }
  }

  private clearCanvas() {
    if (this.ctx && this.canvasRef) {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, this.canvasRef.width, this.canvasRef.height);
    }
  }

  /** Draws the current video frame, cropped to cover the canvas. */
  private paint() {
    const v = this.videoRef;
    const c = this.canvasRef;
    const ctx = this.ctx;
    if (!v || !c || !ctx || !v.videoWidth || !v.videoHeight || !c.width || !c.height) return;
    const t0 = performance.now();
    const scale = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
    const sw = c.width / scale;
    const sh = c.height / scale;
    ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    this.report(performance.now() - t0);
  }

  private startPainting() {
    const v = this.videoRef;
    if (!v || !this.visible || this.frameKind) return;
    this.syncStyle();
    this.sizeCanvas();
    this.stats = { frames: 0, drawMs: 0, since: performance.now(), reports: 0 };
    // One paint per camera frame where the browser can say when one arrives;
    // otherwise once per display frame.
    if ('requestVideoFrameCallback' in v) {
      this.frameKind = 'vfc';
      const onFrame = () => {
        if (this.frameKind !== 'vfc') return;
        this.paint();
        this.frameHandle = (v as any).requestVideoFrameCallback(onFrame);
      };
      this.frameHandle = (v as any).requestVideoFrameCallback(onFrame);
    } else {
      this.frameKind = 'raf';
      const onFrame = () => {
        if (this.frameKind !== 'raf') return;
        if (!v.paused && !v.ended) this.paint();
        this.frameHandle = requestAnimationFrame(onFrame);
      };
      this.frameHandle = requestAnimationFrame(onFrame);
    }
  }

  private stopPainting() {
    const v = this.videoRef as any;
    if (this.frameKind === 'vfc' && v?.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.frameHandle);
    if (this.frameKind === 'raf') cancelAnimationFrame(this.frameHandle);
    this.frameKind = null;
  }

  /**
   * A few lines on the Debug UI channel: paint rate and main-thread cost, so
   * the price of painting the preview is visible on the device that pays it.
   */
  private report(drawMs: number) {
    const s = this.stats;
    s.frames++;
    s.drawMs += drawMs;
    const elapsed = performance.now() - s.since;
    if (elapsed < 3000 || s.reports >= 3) return;
    try {
      const c = this.canvasRef;
      const v = this.videoRef;
      const perf = new BroadcastChannel('idv-perf');
      perf.postMessage(
        `[perf] preview: ${this.frameKind} ${((s.frames * 1000) / elapsed).toFixed(1)} fps, ` +
          `draw ${(s.drawMs / s.frames).toFixed(2)} ms avg, ${v.videoWidth}x${v.videoHeight} -> ${c.width}x${c.height}`,
      );
      perf.close();
    } catch (e) {
      /* diagnostics only */
    }
    s.reports++;
    s.frames = 0;
    s.drawMs = 0;
    s.since = performance.now();
  }

  render() {
    return (
      <div
        class={{
          'idv-video': true,
          'visible': this.visible,
        }}
      >
        <video preload="false" muted playsinline ref={this.setVideoRef} />
        <canvas class="idv-video-preview" ref={this.setCanvasRef} />
      </div>
    );
  }
}
