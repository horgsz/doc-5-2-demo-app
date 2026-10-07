import { Component, Prop, getAssetPath, h } from '@stencil/core';
import { IDVerseStatusButtons } from '@utils/interface';

@Component({
  tag: 'idv-modal',
  styleUrl: 'idv-modal.scss',
  shadow: true,
})
export class IDVerseModal {
  @Prop() heading: string = null;
  @Prop() visible: boolean = false;
  @Prop() warning: boolean = false;
  @Prop() small: boolean = false;
  @Prop() buttons: Array<IDVerseStatusButtons> = [];

  private previousActiveElement: HTMLElement | null = null;
  private wasVisible: boolean = false;

  componentDidRender() {
    if (this.visible && !this.wasVisible) {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        this.previousActiveElement = activeElement;
      }
    }

    if (!this.visible && this.wasVisible) {
      this.restoreFocusToParentPage();
    }

    this.wasVisible = this.visible;
  }

  disconnectedCallback() {
    this.restoreFocusToParentPage();
  }

  private restoreFocusToParentPage() {
    const target = this.previousActiveElement;
    if (target && document.contains(target)) {
      requestAnimationFrame(() => target.focus());
    }
    this.previousActiveElement = null;
  }

  render() {
    return (
      <div
        aria-hidden={String(!this.visible)}
        role="dialog"
        aria-modal="true"
        class={{
          'idv-modal': true,
          'visible': this.visible,
        }}
      >
        <div
          class={{
            'modal-content': true,
            'visible': this.visible,
            'small': this.small,
          }}
        >
          <div class="dialog">
            {this.warning && (
              <img
                class="warning"
                width="70"
                src={getAssetPath('./assets/images/warning.svg')}
                alt="Warning"
              />
            )}
            {this.heading && <h2 class="heading">{this.heading}</h2>}
            <slot />

            {this.buttons.length > 0 && (
              <div class="buttons">
                {this.buttons.map((button: IDVerseStatusButtons) => (
                  <idv-button class="button" {...button}></idv-button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}
