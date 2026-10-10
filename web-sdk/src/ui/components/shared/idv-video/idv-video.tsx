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
 * It happens to an element that is given the stream while it is not on
 * screen: the SDK opens the camera before it shows the preview (reproduced
 * without the SDK: attach while display:none, then show), and keeps the feed
 * running under the frozen capture and the review screen. On the same page,
 * the same stream on a new element attached while the preview was showing
 * was drawn correctly every time. So a new display element is attached when
 * the stream starts with the preview showing, when the preview is shown, and
 * whenever the SDK reveals the live feed again (refreshDisplay()).
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
   * Attaches a new display element. Call once the live feed is uncovered
   * again (after the screen has updated), e.g. when a frozen capture is
   * dropped for a retake; the current one stays until the new one has a frame.
   */
  @Method()
  async refreshDisplay() {
    this.syncDisplay(true);
  }

  /**
   * Makes sure a display element is showing the sink's current stream, if the
   * preview is visible and the sink is playing one. With `replace`, a new
   * element is swapped in even if the current one already shows the stream;
   * the old one stays on screen until the new one has a frame, so there is no
   * black flash.
   */
  private syncDisplay(replace: boolean = false) {
    const sink = this.videoRef;
    const stream = sink?.srcObject as MediaStream | null;
    if (!this.visible || !this.hostRef || !stream || sink.paused) {
      return;
    }

    const current = this.display;
    if (current && current.srcObject === stream && !replace) {
      if (current.paused) {
        void current.play().catch(() => undefined);
      }
      return;
    }

    const display = document.createElement('video');
    display.className = 'idv-video-display';
    display.muted = true;
    display.playsInline = true;
    display.setAttribute('playsinline', '');
    display.setAttribute('aria-hidden', 'true');
    this.display = display;
    this.syncStyle();
    // After the current one in the DOM, so it paints on top once it has a frame.
    this.hostRef.appendChild(display);

    if (current) {
      const retire = () => {
        current.srcObject = null;
        current.remove();
      };
      display.addEventListener('playing', retire, { once: true });
      // Removed or replaced again before it ever played.
      display.addEventListener('emptied', retire, { once: true });
    }

    display.srcObject = stream;
    void display.play().catch(() => undefined);
  }

  private removeDisplay() {
    this.display = null;
    // Including any older one still waiting to be retired.
    this.hostRef?.querySelectorAll('video.idv-video-display').forEach(el => {
      (el as HTMLVideoElement).srcObject = null;
      el.remove();
    });
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
