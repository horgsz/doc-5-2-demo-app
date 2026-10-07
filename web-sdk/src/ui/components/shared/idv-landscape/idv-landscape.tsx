import { Component, Host, Prop, h } from '@stencil/core';

import Portrait from '@animations/id-scan/Portrait.json';

@Component({
  tag: 'idv-landscape',
  styleUrl: 'idv-landscape.scss',
  shadow: true,
})
export class IDVerseLandscape {
  @Prop() visible: boolean = false;

  render() {
    return (
      <Host
        class={{
          visible: this.visible,
        }}
      >
        <div class="idv-landscape">
          <idv-animation
            classes="landscape"
            name="landscape"
            play
            animationData={Portrait}
          ></idv-animation>

          <p>Please rotate your device to portrait</p>
        </div>
      </Host>
    );
  }
}
