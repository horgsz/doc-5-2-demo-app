import { Component, Host, Prop, h } from '@stencil/core';

import CardFlip from '@animations/id-scan/Flip.json';

@Component({
  tag: 'idv-id-scan-flip-document',
  styleUrl: 'flip-id.scss',
  shadow: true,
})
export class IdScanFlipID {
  @Prop() visible: boolean = false;
  @Prop() description: string = '';

  render() {
    return (
      <Host
        class={{
          visible: this.visible,
        }}
      >
        <div class="idv-flip-document">
          {this.visible && (
            <idv-animation name="card-flip" play={this.visible} animationData={CardFlip}>
              <h1 aria-live="assertive">{this.description}</h1>
            </idv-animation>
          )}
        </div>
      </Host>
    );
  }
}
