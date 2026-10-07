import { Component, Prop, h } from '@stencil/core';
import { IDVerseStatusButtons } from '@utils/interface';

import TickAnimation from '@animations/id-scan/Tick.json';
import FailAnimation from '@animations/id-scan/Fail.json';

@Component({
  tag: 'idv-id-scan-status',
  styleUrl: 'status.scss',
  shadow: true,
})
export class IdScanFeedBackStatus {
  @Prop() name: string = '';
  @Prop() visible: boolean = false;
  @Prop() status: string = '';
  @Prop() heading: string = '';
  @Prop() description: string = null;
  @Prop() buttons: Array<IDVerseStatusButtons> = [];

  render() {
    let animation: any = TickAnimation;
    if (this.status === 'failure') {
      animation = FailAnimation;
    }
    return (
      <div
        class={{
          'fb-status': true,
          'visible': this.visible,
          'success': this.status === 'success',
          'failure': this.status === 'failure',
        }}
      >
        {this.visible && (
          <idv-animation
            name="idv-status-animation"
            play
            loop={false}
            delay={400}
            animationData={animation}
          ></idv-animation>
        )}

        <h1 aria-live="assertive">{this.heading}</h1>

        {this.description && <p aria-live="assertive">{this.description}</p>}

        {this.buttons.length > 0 && (
          <div class="buttons">
            {this.buttons.map((button: IDVerseStatusButtons) => (
              <idv-button class="button" {...button}></idv-button>
            ))}
          </div>
        )}
      </div>
    );
  }
}
