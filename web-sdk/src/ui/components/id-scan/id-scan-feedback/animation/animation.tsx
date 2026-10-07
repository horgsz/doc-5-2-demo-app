import { Component, Prop, h } from '@stencil/core';

import MoveFrame from '@animations/id-scan/MoveinFrame.json';
import Glare from '@animations/id-scan/Glare.json';
import Closer from '@animations/id-scan/Closer.json';
import Further from '@animations/id-scan/Further.json';
import Blur from '@animations/id-scan/Blur.json';

@Component({
  tag: 'idv-id-scan-animation',
  styleUrl: 'animation.scss',
  shadow: true,
})
export class IdScanFeedBackAnimation {
  @Prop() name: string = '';
  @Prop() visible: boolean = false;

  render() {
    const names = {
      left: MoveFrame,
      right: MoveFrame,
      further: Further,
      closer: Closer,
      glare: Glare,
      blur: Blur,
    };
    const animation = names[this.name] || Glare;
    return (
      <div
        class={{
          'fb-animation': true,
          'visible': this.visible,
        }}
      >
        <div class={this.name}>
          <idv-animation
            name={this.name}
            class={this.name}
            play={this.visible}
            animationData={animation}
          ></idv-animation>
        </div>
      </div>
    );
  }
}
