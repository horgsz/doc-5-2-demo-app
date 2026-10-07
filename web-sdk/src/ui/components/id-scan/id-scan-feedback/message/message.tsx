import { Component, Prop, h } from '@stencil/core';

@Component({
  tag: 'idv-id-scan-message',
  styleUrl: 'message.scss',
  shadow: true,
})
export class IdScanFeedBackMessage {
  @Prop() message: string = '';
  @Prop() uncertain: boolean = false;
  @Prop() visible: boolean = false;
  @Prop() progressBar: number = 0;
  @Prop() staticProgressBar: boolean = false;
  @Prop() forceShow: boolean = false;
  @Prop() scanning: boolean = false;

  render() {
    return (
      <footer aria-hidden={String(!this.visible)} class={this.visible ? 'visible' : 'hidden'}>
        <div
          class={{
            'force-show': this.forceShow,
            'feedback-message': true,
            'uncertain': this.uncertain,
            'scanning': this.scanning,
          }}
          aria-live={this.visible ? 'assertive' : 'off'}
        >
          {this.message}
          {!this.uncertain && (
            <div
              style={{ width: this.scanning ? '100%' : '0%' }}
              class={{
                'progress-bar': true,
                'static-progress-bar': this.staticProgressBar,
              }}
            ></div>
          )}
        </div>
      </footer>
    );
  }
}
