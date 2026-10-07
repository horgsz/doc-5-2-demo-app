import { Component, Event, EventEmitter, Prop, h, getAssetPath } from '@stencil/core';
import { isExternalUrl } from '@utils/utils';

function getLogoPath(logoPath: string): string {
  if (logoPath && !isExternalUrl(logoPath)) {
    return logoPath;
  }

  return getAssetPath('./assets/images/logo.svg');
}

@Component({
  tag: 'idv-face-scan-intro',
  styleUrl: 'face-scan-intro.scss',
})
export class IdvFaceScanIntro {
  @Prop() heading: string = '';
  @Prop() description: string = '';
  @Prop() selfieText: string = '';
  @Prop() startCaptureText: string = '';
  @Prop() hasLogo: boolean = true;
  @Prop() visible: boolean = false;
  @Prop() faceScanIntroScreenLogoPath?: string;

  @Event() captureStarted: EventEmitter<void>;

  render() {
    return (
      <div
        aria-hidden={String(!this.visible)}
        class={{
          'idv-face-scan-intro': true,
          'visible': this.visible,
        }}
      >
        <div class="idv-face-scan-intro-content">
          {this.hasLogo && (
            <img
              class="idv-face-scan-intro-logo"
              src={getLogoPath(this.faceScanIntroScreenLogoPath)}
              alt=""
            />
          )}

          <h2>{this.heading}</h2>
          <p>{this.description}</p>

          <div class="idv-face-scan-intro-take-selfie">
            <span>
              <img src={getAssetPath('./assets/images/take-selfie.svg')} alt=""></img>
            </span>
            <label>{this.selfieText}</label>
          </div>
        </div>

        <footer>
          <idv-button
            onClick={() => this.captureStarted.emit()}
            label={this.startCaptureText}
          ></idv-button>
        </footer>
      </div>
    );
  }
}
