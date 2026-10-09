import { Component, Method, Prop, h } from '@stencil/core';

@Component({
  tag: 'idv-video',
  styleUrl: 'idv-video.scss',
  shadow: true,
})
export class IDVerseVideo {
  @Prop() visible: boolean = false;

  videoRef: HTMLVideoElement;

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
        <video preload="false" muted playsinline ref={ref => (this.videoRef = ref)} />
      </div>
    );
  }
}
