import { Component, Prop, getAssetPath, h } from '@stencil/core';

import Intro from '@animations/id-scan/GetReady.json';

@Component({
  tag: 'idv-id-scan-intro',
  styleUrl: 'id-scan-intro.scss',
  shadow: true,
})
export class IDScanIntro {
  @Prop() name: string = '';
  @Prop() visible: boolean = false;
  @Prop() description: string = '';

  render() {
    return (
      <div
        aria-hidden={String(!this.visible)}
        class={{
          'id-scan-intro': true,
          'visible': this.visible,
        }}
      >
        <div class={this.name}>
          <div class="intro-animation">
            <idv-animation name="intro-animation" play={this.visible} animationData={Intro} />
            <img class="icon" src={getAssetPath('./assets/images/frontIDCard.svg')} alt="" />
          </div>
          <h1 aria-live="assertive">{this.description}</h1>
        </div>
      </div>
    );
  }
}
