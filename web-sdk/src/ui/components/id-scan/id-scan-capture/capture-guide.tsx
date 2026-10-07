import { Component, Host, Prop, h } from '@stencil/core';
import { DocumentShape } from '@utils/interface';

/**
 * Alignment guide for Semi-auto capture mode.
 *
 * Drawn at the real proportions of whatever the detector saw -- an ID-1 card
 * or a passport data page -- so the user has something concrete to line the
 * document up against after a capture was rejected for framing.
 */
@Component({
  tag: 'idv-id-scan-capture-guide',
  styleUrl: 'capture-guide.scss',
  shadow: true,
})
export class IDVerseIDScanCaptureGuide {
  /** Whether the guide is on screen. */
  @Prop() visible: boolean = false;
  /** Which outline to draw. Unknown draws nothing. */
  @Prop() shape: DocumentShape = DocumentShape.Unknown;
  /**
   * The engine has just turned a frame down. Blinks the corner brackets
   * warning-coloured for as long as this is set -- the outline is where the
   * user is already looking, so it registers before the banner does -- then
   * they ease back to the ready colour on their own.
   */
  @Prop() warning: boolean = false;
  /**
   * The good-location probe says the ID is well placed.
   * Turns the corner brackets green; they rest white otherwise. Warning (a
   * rejected still) still wins over this.
   */
  @Prop() good: boolean = false;
  /**
   * The document is held portrait (taller than wide).
   * Inverts the outline to a vertical box, so a card or passport turned upright
   * still has something to line up against -- the orientation counterpart to
   * {@link shape} flipping between card and passport proportions.
   */
  @Prop() vertical: boolean = false;

  /**
   * Real-world proportions (landscape):
   *  - ID-1 card       85.60 x 53.98 mm -> 1.586
   *  - Passport TD3    125.0 x 88.00 mm -> 1.420
   * Inverted to < 1 when the document is held vertically.
   */
  private aspectRatio(): number | null {
    let ratio: number | null;
    switch (this.shape) {
      case DocumentShape.Card:
        ratio = 85.6 / 53.98;
        break;
      case DocumentShape.Passport:
        ratio = 125 / 88;
        break;
      default:
        ratio = null;
    }
    return ratio !== null && this.vertical ? 1 / ratio : ratio;
  }

  render() {
    const ratio = this.aspectRatio();

    if (ratio === null) {
      return <Host class="hidden"></Host>;
    }

    // 'good' turns the corners green; warning wins.
    // 'vertical' lets the stylesheet give the taller outline room to grow.
    const state =
      `${this.visible ? 'visible' : 'hidden'}` +
      `${this.warning ? ' warning' : this.good ? ' good' : ''}` +
      `${this.vertical ? ' vertical' : ''}`;

    return (
      <Host class={state}>
        <div class="guide-layer">
          {/*
            The ratio travels as a custom property rather than an inline
            aspect-ratio, so the stylesheet can invert it in landscape --
            an inline value would win over any media query.
          */}
          <div class="guide-frame" style={{ '--guide-aspect': String(ratio) }}>
            <span class="corner tl"></span>
            <span class="corner tr"></span>
            <span class="corner br"></span>
            <span class="corner bl"></span>
          </div>
        </div>
      </Host>
    );
  }
}
