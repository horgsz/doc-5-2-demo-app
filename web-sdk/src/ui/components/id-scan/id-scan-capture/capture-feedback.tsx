import { Component, Host, Prop, h } from '@stencil/core';

/**
 * Feedback banner for Semi-auto capture mode.
 *
 * Carries the same messages the live footer shows ("Move ID closer", "Reduce
 * glare", ...), but sits at the top of the screen so it cannot collide with
 * the shutter and its hint at the bottom.
 */
@Component({
  tag: 'idv-id-scan-capture-feedback',
  styleUrl: 'capture-feedback.scss',
  shadow: true,
})
export class IDVerseIDScanCaptureFeedback {
  /** Whether the banner is on screen. */
  @Prop() visible: boolean = false;
  /** The message to show. */
  @Prop() message: string = '';

  render() {
    return (
      <Host class={this.visible && this.message ? 'visible' : 'hidden'}>
        <div class="feedback-bar">
          <p class="feedback-message" role="status" aria-live="polite">
            {this.message}
          </p>
        </div>
      </Host>
    );
  }
}
