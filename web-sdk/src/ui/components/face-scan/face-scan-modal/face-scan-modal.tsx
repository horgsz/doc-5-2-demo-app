import {
  Component,
  Event,
  EventEmitter,
  Method,
  Prop,
  State,
  h,
  getAssetPath,
} from '@stencil/core';
import TickAnim from '@animations/face-scan/SuccessTick.json';
import LoadingAnim from '@animations/face-scan/Loading.json';
import { AnimationItem } from 'lottie-web';

@Component({
  tag: 'idv-face-scan-modal',
  styleUrl: 'face-scan-modal.scss',
})
export class IdvFaceScanModal {
  @Prop() visible: boolean = false;
  @Prop() skipIntro: boolean = false;
  @Prop() state: string = 'BASIC';
  @Prop() tryAgainText: string = 'Try Again';
  @Prop() animation: any;
  @Prop() startAt: number = 0;
  @Prop() transparentBackdrop: boolean = false;

  @Event() closed: EventEmitter<void> | undefined;
  @Event() tryAgain: EventEmitter<void> | undefined;

  @State() instruction: {
    name: string;
    animation: any;
    text: string;
    startAt?: number;
    warning?: boolean;
    success?: boolean;
    complete?: boolean;
  } | null = null;
  @State() error: {
    title: string;
    description: string;
    onTryAgain?: () => void;
  } | null = null;
  @State() exiting: boolean = false;

  private animationInstance: any;
  private shouldSwitchAnimation: boolean = false;
  private shouldPlayTickAnimation: boolean = false;
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

  @Method()
  async guide(
    name: string,
    text: string,
    animation: any,
    startAt: number = 0,
    warning: boolean = false,
    success: boolean = false,
  ) {
    this.instruction = {
      name: name,
      text: text,
      animation: animation,
      startAt: startAt,
      warning: warning,
      success: success,
      complete: false,
    };

    if (this.exiting) this.exiting = false;
  }

  @Method()
  async loading(): Promise<void> {
    return new Promise(async resolve => {
      this.instruction = {
        name: 'loading',
        text: '',
        animation: LoadingAnim,
        startAt: 0,
        warning: false,
        success: false,
        complete: false,
      };

      const anim = (await this.animationInstance.getAnimation()) as AnimationItem;

      if (anim) {
        anim.addEventListener('enterFrame', event => {
          var currentFrame = event.currentTime;
          if (currentFrame >= 49 && !this.shouldSwitchAnimation && this.shouldPlayTickAnimation) {
            this.shouldSwitchAnimation = true;
            anim.pause();
          }
        });
      }

      resolve();
    });
  }

  @Method()
  async complete(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      this.shouldPlayTickAnimation = true;
      if (!this.shouldSwitchAnimation) {
        setTimeout(async () => {
          this.complete().then(resolve).catch(reject);
        }, 0.01);
        return;
      }

      this.instruction = {
        name: 'none',
        text: '',
        animation: TickAnim,
        startAt: 0,
        warning: false,
        success: false,
        complete: true,
      };

      await this.exit();

      resolve();
    });
  }

  async exit() {
    return new Promise((resolve: any) => {
      setTimeout(() => {
        this.exiting = true;
        resolve();
      }, 2000);
    });
  }

  @Method()
  async resetGuide() {
    this.instruction = null;
  }

  @Method()
  async showError(title: string, description: any) {
    this.instruction = null;
    this.error = {
      title: title,
      description: description,
    };
  }

  @Method()
  async resetError() {
    this.error = null;
  }

  @Method()
  async reset() {
    this.error = null;
    this.instruction = null;
    this.exiting = false;
  }

  render() {
    return (
      <div
        aria-hidden={String(!this.visible)}
        role="dialog"
        aria-modal="true"
        class={{
          'idv-fs-modal': true,
          'visible': this.visible,
          'exiting': this.exiting,
          'scanning': this.state === 'SCANNING',
          'error': this.state === 'ERROR',
          'transparent-backdrop': this.transparentBackdrop,
        }}
      >
        <div
          class={{
            'idv-fs-container':
              this.instruction != null || this.error !== null || this.state === 'BASIC',
            'idv-fs-has-warning': this.instruction && this.instruction.warning,
            'idv-fs-has-success': this.instruction && this.instruction.success,
            'idv-fs-with-intro': !this.skipIntro,
            'idv-fs-without-intro': this.skipIntro,
            'idv-fs-has-complete': this.instruction && this.instruction.complete,
          }}
        >
          {this.state !== 'SCANNING' && (
            <button onClick={() => this.closed.emit()} class="idv-grey-btn idv-fs-close">
              <img src={getAssetPath('./assets/images/close.svg')} alt="Close IDVerse modal" />
            </button>
          )}
          <div class="idv-fs-modal-content">
            {this.state === 'SCANNING' && this.instruction !== null && (
              <div
                class={{
                  'idv-fs-instruction': true,
                }}
              >
                <div class="idv-fs-complete"></div>
                <div
                  class={`idv-fs-instruction-animation idv-instruction-${this.instruction.name}`}
                >
                  <idv-animation
                    name="instruction-animation"
                    play
                    animationData={this.instruction.animation}
                    startAt={this.instruction.startAt || 0}
                    loop={!this.instruction.complete}
                    ref={ref => (this.animationInstance = ref)}
                  />
                </div>
                {this.instruction.text && <p>{this.instruction.text}</p>}
              </div>
            )}

            {this.state === 'ERROR' && this.error !== null && (
              <div class="idv-fs-error">
                <div class="idv-fs-error-content">
                  <idv-warning-outline-icon />
                  <h4>{this.error.title}</h4>
                  <p>{this.error.description}</p>

                  <button
                    class="idv-grey-btn"
                    onClick={() => {
                      this.resetError();
                      this.tryAgain.emit();
                    }}
                  >
                    {this.tryAgainText} <idv-try-again-icon />
                  </button>
                </div>
              </div>
            )}
            <slot />
          </div>
        </div>
      </div>
    );
  }
}
