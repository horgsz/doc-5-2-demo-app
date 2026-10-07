import { Component, Event, EventEmitter, Host, Prop, h } from '@stencil/core';
import { IDScanFieldIssue, IDScanFieldIssues } from '@utils/interface';
import { isBarcodeField, isUnclearDocument } from './capture-issues.shared';

/**
 * Weak-read review screen for Semi-auto capture mode.
 *
 * The engine accepted the capture but could not read every field off it. This
 * shows the cropped document with the problem fields picked out on it, so the
 * user can see for themselves whether it is worth another go.
 */
@Component({
  tag: 'idv-id-scan-capture-issues',
  styleUrl: 'capture-issues.scss',
  shadow: true,
})
export class IDVerseIDScanCaptureIssues {
  /** Whether the screen is on show. */
  @Prop() visible: boolean = false;
  /** The fields to highlight, and the crop to highlight them on. */
  @Prop() issues: IDScanFieldIssues;
  /** Screen heading. */
  @Prop() heading: string = 'Check these details';
  /**
   * Line under the heading, used when the count-aware summaries below are
   * empty. Kept so an integrator that only sets this still gets a sentence.
   */
  @Prop() description: string =
    'Some details did not come out clearly. Retake for a better read, or continue with what was captured.';
  /** Summary when exactly one field needs another look. */
  @Prop() summaryOne: string = 'We read most of your card. One thing needs another look.';
  /**
   * Summary for two or more. `{count}` is replaced with the number of fields
   * listed -- spelled out up to nine, since a numeral mid-sentence reads as a
   * value off the card rather than a quantity.
   */
  @Prop() summaryMany: string = 'We read most of your card. {count} things need another look.';
  /** Label for the retake button. */
  @Prop() recaptureLabel: string = 'Retake';
  /** Label for the continue button. */
  @Prop() proceedLabel: string = 'Continue';
  /** Word shown on a field that produced nothing at all. */
  @Prop() missingLabel: string = 'not found';
  /** Word shown on a field the engine read but does not trust. */
  @Prop() unclearLabel: string = 'unclear';
  /**
   * The one-line verdict shown in place of the field list when more than
   * MAX_LISTED_FIELDS text fields came out weak.
   */
  @Prop() unclearDocumentLabel: string = 'Your ID is not clear.';
  /**
   * Whether "Continue anyway" is offered at all. The host turns it off on the
   * first showing for a side, and always for a back side whose profile
   * declares a PDF417.
   */
  @Prop() showProceed: boolean = true;
  /** Shown on the portrait when the classifier found it obscured. */
  @Prop() faceCoveredLabel: string = 'face covered';
  /** Shown on the portrait when the classifier found glare on it. */
  @Prop() faceGlareLabel: string = 'face has glare';
  /** Shown on the portrait when the classifier found it blurred. */
  @Prop() faceBlurLabel: string = 'face is unclear';
  /** Label for the frame download. Hidden when empty. */
  @Prop() downloadLabel: string = '';

  /** Emitted when the user wants another attempt. */
  @Event() captureRecaptureRequested?: EventEmitter<void>;
  /** Emitted when the user accepts the capture as-is. */
  @Event() captureIssuesAccepted?: EventEmitter<void>;
  /** Emitted when the user asks for the original captured frame. */
  @Event() captureFrameDownloadRequested?: EventEmitter<void>;

  /**
   * Turns an engine field name ("date_of_birth") into something readable.
   */
  private readable(name: string): string {
    const words = (name || '').replace(/[_-]+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Field';
  }

  /**
   * Whether this field gets the warning colour rather than the brand one.
   *
   * A field that produced nothing at all, and any portrait the classifier
   * faulted -- covered, glared or blurred alike. A portrait is either usable
   * or it is not; there is no "read it anyway" for a face, which is what the
   * softer colour would imply. That leaves the brand colour for text the
   * engine did read but does not fully trust.
   */
  private isSevere(field: IDScanFieldIssue): boolean {
    return field.missing || !!field.quality;
  }

  /**
   * What is wrong with this field, in the user's words.
   *
   * The portrait carries a classifier verdict and names the actual problem --
   * "not found" would be wrong for a photo that is plainly there but blurred
   * or glared. Text fields keep the two-state wording.
   */
  private stateLabel(field: IDScanFieldIssue): string {
    // The engine reports a barcode that did not decode as missing, which is
    // right for how much weight it carries -- but "not found" overstates it to
    // the user, who can see the barcode printed on the card in front of them.
    // It did not read, which is what the text fields call unclear.
    if (isBarcodeField(field)) {
      return this.unclearLabel;
    }

    // A lookup rather than a switch on purpose: this project compiles without
    // strictNullChecks, so a switch over every member of the quality union
    // reads as exhaustive and the fallback below becomes "unreachable code".
    const byQuality: { [key: string]: string } = {
      covered: this.faceCoveredLabel,
      glare: this.faceGlareLabel,
      blurry: this.faceBlurLabel,
    };

    // The portrait names the actual fault when the classifier can (covered /
    // glare / blurry). When it cannot -- no face found and no verdict it will
    // stand behind -- it falls through to the plain missing label rather than
    // guessing "covered": claiming a specific cause we could not determine
    // reads worse than an honest "not found".
    if (field.quality && byQuality[field.quality]) {
      return byQuality[field.quality];
    }

    return field.missing ? this.missingLabel : this.unclearLabel;
  }

  /**
   * The line under the heading, counting what is actually listed.
   *
   * Falls back to the plain description when the summaries are blank, so a
   * host that has translated only the old key still gets a sentence rather
   * than an empty gap.
   */
  private summary(count: number): string {
    if (count === 1 && this.summaryOne) {
      return this.summaryOne;
    }

    if (count > 1 && this.summaryMany) {
      const words = ['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
      const spelled = count < words.length ? words[count] : String(count);
      return this.summaryMany.replace('{count}', spelled);
    }

    return this.description;
  }

  render() {
    const fields = this.issues?.fields ?? [];
    // The engine's own rectified crop -- the exact image the field rectangles
    // are fractions of, so every highlight lands where it should. (A crop
    // rebuilt on this side from the document quad drifts from it, which is why
    // the highlights used to miss.)
    const crop = this.issues?.crop ? `data:image/jpeg;base64,${this.issues.crop}` : '';

    // Text fields only -- the portrait and the barcode are side-wide verdicts
    // and do not push the screen into its collapsed form. Same predicate the
    // host uses to disable auto-accept.
    const collapsed = isUnclearDocument(this.issues);

    return (
      <Host class={this.visible ? 'visible' : 'hidden'}>
        <div class="capture-issues" role="dialog" aria-modal="true">
          <h1 aria-live="assertive">{this.heading}</h1>
          <p class="description">{this.summary(fields.length)}</p>

          <div class="preview">
            {crop && (
              <div class="crop">
                <img src={crop} alt="" />
                {/*
                  A field can be worth naming without being placeable: a
                  barcode missing from a back side that never matched a profile
                  is known to be required but has nowhere on the crop to point.
                  Those still get their line in the list below -- they just do
                  not get a box drawn at a guessed position.
                */}
                {!collapsed &&
                  fields
                    .filter(field => field.rect)
                    .map((field, index) => (
                      <span
                        class={`highlight${this.isSevere(field) ? ' severe' : ''}`}
                        style={{
                          left: `${field.rect.x * 100}%`,
                          top: `${field.rect.y * 100}%`,
                          width: `${field.rect.w * 100}%`,
                          height: `${field.rect.h * 100}%`,
                          // Staggered so the eye is walked from one problem field
                          // to the next instead of everything pulsing at once.
                          animationDelay: `${index * 180}ms`,
                        }}
                      ></span>
                    ))}
              </div>
            )}
          </div>

          {/*
            The collapsed form keeps the summary up top and says its one line
            where the field list would have been -- under the crop, in the
            reader's path from image to buttons.
          */}
          {collapsed && <p class="unclear-document">{this.unclearDocumentLabel}</p>}

          {/* Not rendered empty when collapsed: even an empty list carries its
              top margin, which would push the verdict line off the crop. */}
          {!collapsed && (
            <ul class="field-list">
              {fields.map(field => {
                const severe = this.isSevere(field);

                return (
                  <li>
                    {/*
                    The dot repeats the pill's severity at the start of the
                    row, so the list can be scanned down its left edge without
                    reading across to the status.
                  */}
                    <span class={`field-dot${severe ? ' severe' : ''}`} aria-hidden="true"></span>
                    <span class="field-name">{this.readable(field.name)}</span>
                    <span class={`field-state${severe ? ' severe' : ''}`}>
                      {/*
                      A shape as well as a colour: severity that is carried by
                      red-vs-amber alone does not survive a colour-blind
                      reader, and these two hues are the hard pair.
                    */}
                      <span class="field-state-icon" aria-hidden="true">
                        {severe ? '×' : '!'}
                      </span>
                      {this.stateLabel(field)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <div class="actions">
            <idv-button
              class="retake"
              label={this.recaptureLabel}
              variant="primary"
              clickHandler={() => this.captureRecaptureRequested?.emit()}
            ></idv-button>
            {this.showProceed && (
              <idv-button
                class="proceed"
                label={this.proceedLabel}
                variant="primary"
                clickHandler={() => this.captureIssuesAccepted?.emit()}
              ></idv-button>
            )}
            {this.downloadLabel && (
              <button
                type="button"
                class="download-frame"
                onClick={() => this.captureFrameDownloadRequested?.emit()}
              >
                {this.downloadLabel}
              </button>
            )}
          </div>
        </div>
      </Host>
    );
  }
}
