import { Component, Host, Prop, h } from '@stencil/core';

@Component({
  tag: 'idv-button',
  styleUrl: 'idv-button.scss',
  shadow: true,
})
export class IDVerseButton {
  @Prop() label: string = '';
  @Prop() variant: string = 'primary';
  @Prop() disabled: boolean = false;
  @Prop() clickHandler: (ev: UIEvent) => void;

  render() {
    return (
      <Host>
        <button
          class={`idv-button ${this.variant}`}
          onClick={this.clickHandler}
          disabled={this.disabled}
          part="idv-button"
        >
          {this.label}
        </button>
      </Host>
    );
  }
}
