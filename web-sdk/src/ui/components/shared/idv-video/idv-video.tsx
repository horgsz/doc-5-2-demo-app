import { Component, Method, Prop, Watch, h } from '@stencil/core';

/**
 * The camera preview.
 *
 * Two <video> elements play the same MediaStream:
 *
 * - The "sink" (`getVideoRef()`): the element the SDK binds the camera to,
 *   reads frames from, styles and pauses. It is kept in layout but hidden.
 * - The "display": what the user sees. A new one is created for each stream,
 *   and only once the preview is actually rendered.
 *
 * Why: iOS WebKit (seen on iPhone 15, iOS Safari 27.2) can get a <video>
 * element's video layer stuck drawing a camera stream shrunk in the middle of
 * the screen -- the portrait frame fitted at its unrotated landscape size,
 * then rotated -- while its box, object-fit and videoWidth/videoHeight are all
 * correct. Once stuck, that element stays stuck: re-attaching the stream does
 * not fix it, and it carries over to the back of the card and to retakes.
 * The SDK attaches the stream before it shows the preview, which is the
 * pattern that triggers it (reproduced without the SDK: attach while
 * display:none, then show). On the same page, the same stream on a new
 * element attached while visible was drawn correctly every time.
 *
 * The display element is native video compositing, as before -- no per-frame
 * script and no canvas -- so it costs no more than the old preview.
 */
@Component({
  tag: 'idv-video',
  styleUrl: 'idv-video.scss',
  shadow: true,
})
export class IDVerseVideo {
  @Prop() visible: boolean = false;

  videoRef: HTMLVideoElement;
  private hostRef: HTMLDivElement;
  private display: HTMLVideoElement | null = null;
  private styleObserver: MutationObserver | null = null;

  private setVideoRef = (ref: HTMLVideoElement) => {
    if (ref && ref !== this.videoRef) {
      // A stream started (or restarted) playing on the sink.
      ref.addEventListener('playing', () => this.syncDisplay());
      // The SDK pauses the sink to freeze the preview (e.g. on a failure
      // screen); the display follows.
      ref.addEventListener('pause', () => this.display?.pause());
      // Stream removed (closeCamera) or replaced: the next one gets a new
      // display element.
      ref.addEventListener('emptied', () => this.removeDisplay());
      this.styleObserver?.disconnect();
      this.styleObserver = new MutationObserver(() => this.syncStyle());
      this.styleObserver.observe(ref, { attributes: true, attributeFilter: ['style'] });
    }
    this.videoRef = ref;
  };

  @Watch('visible')
  onVisibleChange(visible: boolean) {
    // Showing is handled after the render that un-hides the host
    // (componentDidRender), so the display is never attached while hidden.
    if (!visible) {
      this.removeDisplay();
    }
  }

  componentDidRender() {
    this.syncDisplay();
  }

  disconnectedCallback() {
    this.removeDisplay();
    this.styleObserver?.disconnect();
  }

  @Method()
  async getVideoRef() {
    return this.videoRef;
  }

  /**
   * Makes sure a display element is showing the sink's current stream, if the
   * preview is visible and the sink is playing one.
   */
  private syncDisplay() {
    const sink = this.videoRef;
    const stream = sink?.srcObject as MediaStream | null;
    if (!this.visible || !this.hostRef || !stream || sink.paused) {
      return;
    }

    if (this.display && this.display.srcObject === stream) {
      if (this.display.paused) {
        void this.display.play().catch(() => undefined);
      }
      return;
    }

    this.removeDisplay();
    const display = document.createElement('video');
    display.className = 'idv-video-display';
    display.muted = true;
    display.playsInline = true;
    display.setAttribute('playsinline', '');
    display.setAttribute('aria-hidden', 'true');
    this.display = display;
    this.syncStyle();
    this.hostRef.appendChild(display);
    display.srcObject = stream;
    void display.play().catch(() => undefined);
  }

  private removeDisplay() {
    if (!this.display) {
      return;
    }
    this.display.srcObject = null;
    this.display.remove();
    this.display = null;
  }

  /**
   * The SDK styles the sink inline -- the opacity fade-in (id-scan) and the
   * webcam mirror transform (Camera.ts) -- so those are copied to the display.
   */
  private syncStyle() {
    const sink = this.videoRef;
    const display = this.display;
    if (!sink || !display) {
      return;
    }
    display.style.opacity = sink.style.opacity;
    display.style.transition = sink.style.transition;
    display.style.transform = sink.style.transform;
  }

  render() {
    return (
      <div
        class={{
          'idv-video': true,
          'visible': this.visible,
        }}
        ref={ref => (this.hostRef = ref)}
      >
        <video class="idv-video-sink" preload="false" muted playsinline ref={this.setVideoRef} />
      </div>
    );
  }
}
