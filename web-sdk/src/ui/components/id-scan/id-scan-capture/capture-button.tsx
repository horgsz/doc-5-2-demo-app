import { Component, Event, EventEmitter, Host, Prop, h } from '@stencil/core';

/**
 * Shutter button for Semi-auto capture mode.
 *
 * Sits over the camera feed and submits one frame per press. While a frame is
 * being processed the button shows a busy ring and stops emitting, so a user
 * tapping repeatedly cannot queue up captures.
 */
@Component({
  tag: 'idv-id-scan-capture-button',
  styleUrl: 'capture-button.scss',
  shadow: true,
})
export class IDVerseIDScanCaptureButton {
  /** Whether the button is on screen. */
  @Prop() visible: boolean = false;
  /** A frame is being processed; the button is busy and cannot be pressed. */
  @Prop() busy: boolean = false;
  /** Disables the button without the busy treatment. */
  @Prop() disabled: boolean = false;
  /** Hint shown above the button. */
  @Prop() hint: string = '';
  /** Accessible label. */
  @Prop() label: string = 'Capture';
  /**
   * Seconds left before the capture fires on its own. Shown in the middle of
   * the button; 0 or less means no countdown is running.
   */
  @Prop() countdown: number = 0;

  /** Emitted on each accepted press. */
  @Event() captureRequested?: EventEmitter<void>;

  private onClick = () => {
    if (this.busy || this.disabled) {
      return;
    }

    this.captureRequested?.emit();
  };

  render() {
    const inactive = this.busy || this.disabled;
    // A countdown only means anything while the button can still be pressed.
    const counting = this.countdown > 0 && !inactive;

    return (
      <Host class={this.visible ? 'visible' : 'hidden'}>
        <div class="capture-bar">
          {this.hint && <p class="capture-hint">{this.hint}</p>}
          <button
            type="button"
            class={`capture-button${this.busy ? ' busy' : ''}${counting ? ' counting' : ''}`}
            onClick={this.onClick}
            disabled={inactive}
            aria-label={this.label}
            aria-busy={this.busy ? 'true' : 'false'}
            part="capture-button"
          >
            <span class="capture-ring"></span>
            <span class="capture-core"></span>
            {counting && (
              // Keyed on the value so each tick remounts and replays the
              // pulse; without it the number swaps silently.
              <span class="capture-countdown" key={this.countdown} aria-hidden="true">
                {this.countdown}
              </span>
            )}
          </button>
        </div>
      </Host>
    );
  }
}
