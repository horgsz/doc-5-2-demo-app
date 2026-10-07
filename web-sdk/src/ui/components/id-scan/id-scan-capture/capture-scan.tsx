import { Component, Element, Host, Prop, Watch, h } from '@stencil/core';

/**
 * Processing effect for Semi-auto capture mode.
 *
 * The camera feed underneath is paused at the captured frame, and this layer
 * plays over it: a shutter flash, then a line of light travelling up the
 * frozen image. Purely decorative -- it never intercepts input.
 *
 * This replaced a rippling "water surface" wave (three SVG paths morphed
 * every frame). The wave is kept verbatim under backups/wave-animation/ at
 * the repo root; the travel period, easing and edge fades below are the
 * wave's, so the sweep's pace is unchanged -- only its shape is.
 */
@Component({
  tag: 'idv-id-scan-capture-scan',
  styleUrl: 'capture-scan.scss',
  shadow: true,
})
export class IDVerseIDScanCaptureScan {
  /** Whether the effect is playing. */
  @Prop() visible: boolean = false;
  /**
   * The scan succeeded and the result screen is about to take over: the line
   * fades out and a white bloom rises, so the (white) result screen can fade
   * in over it as one continuous motion instead of a hard cut.
   */
  @Prop() settling: boolean = false;

  @Element() private el!: HTMLElement;

  /**
   * The travel is driven by hand from requestAnimationFrame rather than a CSS
   * animation. A declarative animation on iOS Safari did not start reliably
   * for an element that mounted inside a display:none subtree -- the first
   * showing of the effect played a frozen frame while later showings happened
   * to work. A rAF loop that writes the transform each frame has no timeline
   * to inherit: shown means animating, on every engine, every time.
   */
  private lineFrame: number = 0;
  private lineStart: number = 0;

  @Watch('visible')
  onVisibleChange(shown: boolean, wasShown: boolean) {
    if (shown && !wasShown) {
      this.startLine();
    } else if (!shown) {
      this.stopLine();
    }
  }

  connectedCallback() {
    if (this.visible) {
      this.startLine();
    }
  }

  disconnectedCallback() {
    this.stopLine();
  }

  private startLine(): void {
    this.stopLine();

    // Motion-sensitive users get a still overlay; the stylesheet hides the
    // line for them, so there is nothing to drive.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    this.lineStart = performance.now();
    const tick = (now: number) => {
      const elapsedMs = now - this.lineStart;

      const line = this.el.shadowRoot?.querySelector('.line') as HTMLElement | null;

      // Once the result screen begins its takeover, hand the fade to the CSS
      // settling rule and stop touching the line -- otherwise this loop keeps
      // reasserting full opacity over it.
      if (line && !this.settling) {
        // Travel: the line rises from below the frame (200% of its own height)
        // to above it (-40%) over one period. Kept in step with
        // CAPTURE_WAVE_CYCLE_MS in id-scan.tsx, which waits out a pass before
        // settling -- both are this period.
        const TRAVEL_MS = 1800;
        const phase = (elapsedMs % TRAVEL_MS) / TRAVEL_MS;

        // Fast up, easing out near the top: the curve the sweep has always run
        // on. Linear here was the regression that made it feel slow.
        const eased = this.travelEase(phase);
        const ty = 200 + eased * (-40 - 200);

        // Fade in over the first 6%, hold, fade out over the last 6%, so the
        // line never pops in or out mid-frame.
        let opacity = 1;
        if (phase < 0.06) opacity = phase / 0.06;
        else if (phase > 0.94) opacity = (1 - phase) / 0.06;

        line.style.transform = `translateY(${ty.toFixed(2)}%)`;
        line.style.opacity = opacity.toFixed(3);
      }

      this.lineFrame = requestAnimationFrame(tick);
    };

    this.lineFrame = requestAnimationFrame(tick);
  }

  private stopLine(): void {
    if (this.lineFrame) {
      cancelAnimationFrame(this.lineFrame);
      this.lineFrame = 0;
    }
  }

  /**
   * cubic-bezier(0.45, 0, 0.28, 1) as a function of time fraction -> progress
   * fraction: the line climbs fast early and eases out near the top, which is
   * what gives the sweep its snap. Newton's method to invert x(s)=t, then y(s).
   */
  private travelEase(t: number): number {
    const x1 = 0.45,
      y1 = 0,
      x2 = 0.28,
      y2 = 1;
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    let s = t;
    for (let i = 0; i < 8; i++) {
      const x = ((ax * s + bx) * s + cx) * s - t;
      const dx = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(x) < 1e-4 || dx === 0) break;
      s -= x / dx;
    }
    return ((ay * s + by) * s + cy) * s;
  }

  render() {
    return (
      <Host
        class={`${this.visible ? 'visible' : 'hidden'}${this.settling ? ' settling' : ''}`}
        aria-hidden="true"
      >
        <div class="scan-layer">
          <span class="flash"></span>
          <span class="vignette"></span>

          {/*
            The travelling light: a bright edge along the top of this block
            with a glow trailing down from it (see .line in the stylesheet).
            The rAF loop in startLine() positions it every frame.
          */}
          <div class="line"></div>

          <span class="grid"></span>
        </div>
      </Host>
    );
  }
}
