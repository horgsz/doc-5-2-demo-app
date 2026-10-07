import { Component, Prop, State, h } from '@stencil/core';
import { Translation } from '@utils/translation';
import lightTipsAnimation from '@animations/id-scan/lamp-light-tips.json';

@Component({
  tag: 'tips-tabs',
  styleUrl: 'tips-tabs.scss',
  shadow: true,
})
export class TipsTabs {
  @Prop() translation: Translation;
  @Prop() imageExample: string = '';

  @State() currentTab: string = 'your-capture';

  handleTabChange(event: InputEvent) {
    const e: any = event.target;
    this.currentTab = e.value;
  }

  render() {
    return (
      <div class="exception-tips-tabs">
        <ul class="radio-switch">
          <li>
            <input
              type="radio"
              name="radio-switch-name"
              id="your-capture"
              value="your-capture"
              onInput={event => this.handleTabChange(event)}
              checked={this.currentTab === 'your-capture'}
            />
            <label htmlFor="your-capture">
              {this.translation._t('id-scan-exception-tips-tabs-your-capture').toString()}
            </label>
          </li>
          <li>
            <input
              onInput={event => this.handleTabChange(event)}
              type="radio"
              name="radio-switch-name"
              id="capture-tip"
              value="capture-tip"
              checked={this.currentTab === 'capture-tip'}
            />
            <label htmlFor="capture-tip">
              {this.translation._t('id-scan-exception-tips-tabs-capture-tip').toString()}
            </label>
            <div aria-hidden="true" class="marker"></div>
          </li>
        </ul>
        <div class="tabs-content">
          {this.currentTab === 'your-capture' && (
            <div
              class="content"
              style={{ backgroundImage: 'url(' + this.imageExample + ')' }}
            ></div>
          )}
          {this.currentTab === 'capture-tip' && (
            <div class="content">
              <idv-animation name="light-tips" play={true} animationData={lightTipsAnimation} />
            </div>
          )}
        </div>
      </div>
    );
  }
}
