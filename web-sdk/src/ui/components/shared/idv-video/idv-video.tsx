import { Component, Method, Prop, Watch, h } from '@stencil/core';

@Component({
  tag: 'idv-video',
  styleUrl: 'idv-video.scss',
  shadow: true,
})
export class IDVerseVideo {
  @Prop() visible: boolean = false;

  videoRef: HTMLVideoElement;

  /**
   * iOS WebKit (seen on iPhone 15, iOS Safari) can draw the camera feed shrunk
   * in the middle of the screen -- the portrait frame contain-fitted at its
   * unrotated landscape size, then rotated -- even though the <video> box is
   * full-screen with `object-fit: cover`. It only redraws the video layer when
   * the element's box changes, and the box here is pinned full-screen (see
   * idv-video.scss), so it never recovers on its own.
   *
   * Shrinking the box by 1px makes WebKit redo the layer at the right size. The
   * change must be held for a few hundred ms: WebKit applies video layer
   * geometry asynchronously and drops a change undone within a frame or two
   * (100 ms was not enough on device; 600 ms was).
   */
  private static readonly RELAYOUT_HOLD_MS = 700;
  private relayoutTimer: ReturnType<typeof setTimeout> | undefined;

  private relayout = (reason: string) => {
    const v = this.videoRef;
    if (!v || !v.videoWidth || this.relayoutTimer) return;
    v.style.height = 'calc(100% - 1px)';
    this.relayoutTimer = setTimeout(() => {
      this.relayoutTimer = undefined;
      v.style.height = '';
      try {
        const perf = new BroadcastChannel('idv-perf');
        perf.postMessage(`[perf] video: relayout (${reason}) intrinsic=${v.videoWidth}x${v.videoHeight}`);
        perf.close();
      } catch (e) {
        /* diagnostics only */
      }
    }, IDVerseVideo.RELAYOUT_HOLD_MS);
  };

  private setVideoRef = (ref: HTMLVideoElement) => {
    if (ref && ref !== this.videoRef) {
      for (const ev of ['loadedmetadata', 'resize', 'playing']) {
        ref.addEventListener(ev, () => {
          this.relayout(ev);
          // Again once the stream has settled; a nudge during the first frames
          // can land before WebKit has set the layer up.
          setTimeout(() => this.relayout(`${ev}+1s`), 1000);
        });
      }
    }
    this.videoRef = ref;
  };

  @Watch('visible')
  onVisibleChange(visible: boolean) {
    // The SDK fades the feed in after showing it; nudge once it is on screen.
    if (visible) setTimeout(() => this.relayout('visible'), 800);
  }

  @Method()
  async getVideoRef() {
    return this.videoRef;
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
      </div>
    );
  }
}
