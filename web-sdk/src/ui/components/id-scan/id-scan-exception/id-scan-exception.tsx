import { Component, Event, Prop, getAssetPath, h } from '@stencil/core';
import { EventEmitter } from '@stencil/core';
import { Translation } from '@utils/translation';

@Component({
  tag: 'id-scan-exception',
  styleUrl: 'id-scan-exception.scss',
  shadow: true,
})
export class IDScanException {
  @Prop() name: string = 'PAUSE';
  @Prop() imageExample: string = '';
  @Prop() visible: boolean = false;
  @Prop() animation: any;
  @Prop() buttons: Array<{ text: string; variant: string; btnClick: { (): void } }> = [];
  @Prop() buttonText: string = null;
  @Prop() buttonVariant: string = null;
  @Prop() issue: { title: string; description: string; type: string; animation?: any };
  @Prop() translation: Translation;
  @Event() btnClick: EventEmitter<void>;

  render() {
    // Derived, never assigned back to the prop. Writing `this.buttons` here
    // turned a per-render fallback into state that outlived the screen that
    // set it: this element is reused across issues, and a parent that only
    // passes `buttons` for one of them (the Yes/No unsupported screen) leaves
    // the old array in place for every screen after it.
    const buttons = this.buttons.length
      ? this.buttons
      : this.buttonText
        ? [
            {
              text: this.buttonText,
              variant: this.buttonVariant,
              btnClick: () => this.btnClick.emit(),
            },
          ]
        : [];

    return (
      <div
        class={{
          'id-scan-exception': true,
          'visible': this.visible,
        }}
      >
        {this.name === 'PAUSE' && this.issue && (
          <div class="exception-pause">
            <div class="exception-pause-animation">
              <idv-animation
                name="exception-animation"
                play={this.visible}
                animationData={this.issue.animation}
              />
              <img class="icon" src={getAssetPath('./assets/images/frontIDCard.svg')} alt="" />
            </div>
            <h1 data-testid="capture_status_title" aria-live="assertive">
              {this.issue.title}
            </h1>
            <p data-testid="capture_status_description" aria-live="assertive">
              {this.issue.description}
            </p>
          </div>
        )}

        {this.name === 'FAILURE' && this.issue && (
          <div class="exception-no-id">
            <div class="exception-no-id-animation">
              <idv-animation
                name="no-id-animation"
                play={this.visible}
                animationData={this.animation}
              />
            </div>
            <h1 data-testid="capture_status_title" aria-live="assertive">
              {this.issue.title}
            </h1>
            <p data-testid="capture_status_description" aria-live="assertive">
              {this.issue.description}
            </p>
          </div>
        )}

        {this.name === 'ISSUE' && this.issue && (
          <div class="exception-tips">
            <tips-tabs imageExample={this.imageExample} translation={this.translation} />
            <h1 data-testid="capture_status_title" aria-live="assertive">
              {this.issue.title}
            </h1>
            <p data-testid="capture_status_description" aria-live="assertive">
              {this.issue.description}
            </p>
          </div>
        )}

        {buttons.length > 0 && (
          <footer>
            {buttons.map(button => (
              <button
                class={button.variant}
                onClick={() => button.btnClick()}
                data-testid="capture_status_try_again_button"
              >
                {button.text}
              </button>
            ))}
          </footer>
        )}
      </div>
    );
  }
}
