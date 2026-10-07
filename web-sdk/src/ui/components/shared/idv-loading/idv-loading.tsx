import { Component, Prop, getAssetPath, h } from '@stencil/core';

@Component({
  tag: 'idv-loading',
  styleUrl: 'idv-loading.scss',
  shadow: true,
})
export class IDVerseLoading {
  @Prop() visible: boolean = false;
  @Prop() big: boolean = false;
  @Prop() svg: boolean = false;
  @Prop() success: boolean = false;
  @Prop() scanning: boolean = false;
  @Prop() hideCrosshair: boolean = false;
  @Prop() forceShow: boolean = false;
  @Prop() fixed: boolean = true;
  @Prop() primary: boolean = false;

  render() {
    return (
      <div
        class={{
          'idv-loading': true,
          'fixed': this.fixed,
          'success': this.success,
          'scanning': this.scanning,
          'force-show': this.forceShow,
          'visible': this.visible,
        }}
      >
        {this.svg ? (
          <img src={getAssetPath('./assets/images/spinner.svg')} alt="" />
        ) : (
          <div
            class={{
              'visible': this.visible,
              'big': this.big,
              'primary': this.primary,
              'hide-crosshair': this.hideCrosshair,
            }}
          >
            <span></span>
          </div>
        )}
      </div>
    );
  }
}
