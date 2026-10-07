import { Component, Event, EventEmitter, Host, Prop, State, h } from '@stencil/core';
import { IDScanRecognizerResult } from '@utils/interface';

interface Row {
  label: string;
  value: string;
  /**
   * The Latin transliteration, when `value` is in another script and one was
   * recorded. Rendered under the value, never on its own.
   */
  transliteration?: string;
}

/** One saveable thing the scan produced. */
export interface CaptureAsset {
  id: string;
  label: string;
}

/**
 * Post-capture review screen for Semi-auto capture mode.
 *
 * Shows what the engine actually read off the document so the capture can be
 * checked before the flow completes. Only fields that came back with a value
 * are listed, so a sparse document does not render a wall of blanks.
 */
@Component({
  tag: 'idv-id-scan-capture-result',
  styleUrl: 'capture-result.scss',
  shadow: true,
})
export class IDVerseIDScanCaptureResult {
  /** Whether the screen is on show. */
  @Prop() visible: boolean = false;
  /** The result to display. */
  @Prop() result: IDScanRecognizerResult;
  /** Screen heading. */
  @Prop() heading: string = 'Captured';
  /** Label for the confirm button. */
  @Prop() doneLabel: string = 'Done';
  /** Label used when no field could be read. */
  @Prop() emptyLabel: string = 'No fields could be read from this capture.';
  /**
   * Label for the button that reveals the asset list. Hidden when empty, or
   * when the scan produced nothing to save.
   */
  @Prop() assetsLabel: string = '';
  /**
   * Everything this scan produced that can be saved -- the original frame and
   * the rectified crop for each side, and the session recording. The host
   * decides what exists; this only lists it.
   */
  @Prop() assets: CaptureAsset[] = [];

  /** Whether the asset list is expanded. Collapsed until asked for. */
  @State() assetsOpen: boolean = false;

  /** Emitted when the user confirms. */
  @Event() captureResultDismissed?: EventEmitter<void>;
  /** Emitted when the user asks to save one of the assets, by its id. */
  @Event() captureAssetDownloadRequested?: EventEmitter<string>;

  /**
   * Whether a value is written in Latin script.
   *
   * Documents in Arabic, Chinese, Cyrillic and so on are read in their native
   * script alongside a transliteration, and the native form is unreadable to
   * anyone checking an English review screen -- and often renders as boxes.
   * Anything with no letters at all (dates, numbers) counts as Latin, since
   * there is nothing script-specific about it.
   */
  private isLatin(value: string): boolean {
    for (const char of value) {
      // Only letters carry a script; punctuation and digits are shared.
      if (/\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Turns an engine field name ("date_of_birth") into something readable.
   */
  private readable(name: string): string {
    const words = (name || '').replace(/[_-]+/g, ' ').trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Field';
  }

  /**
   * The Latin transliteration of a field, when there is one to show.
   *
   * A document in Japanese or Arabic is read in its own script, with a Latin
   * transliteration recorded alongside under `transliterated[field].latin`.
   * The native form is what the card actually says, so it stays the value;
   * this is the reading shown beneath it for whoever cannot read the script.
   *
   * Returns '' for a value that is already Latin -- there is nothing to
   * transliterate, and repeating it under itself would be noise.
   */
  private transliterationOf(field: string, value: string): string {
    if (this.isLatin(value)) {
      return '';
    }

    const variants: any = (this.result?.details?.extractedInfo as any)?.viz?.transliterated?.[
      field
    ];

    if (!variants) {
      return '';
    }

    // "latin" is the engine's own name for it; anything else that happens to
    // be Latin will do just as well.
    const candidates = [variants.latin, ...Object.values(variants)];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim() && this.isLatin(candidate)) {
        // A transliteration identical to the value teaches nothing.
        if (candidate.trim() !== value.trim()) {
          return candidate.trim();
        }
      }
    }

    return '';
  }

  /**
   * Flattens what the visual zone actually read into label/value rows.
   *
   * Sourced from `extractedInfo.viz.primary` rather than the curated
   * documentInfo summary, so the screen reflects the fields on this document
   * instead of a fixed list that is half blank on most of them.
   */
  private rows(): Row[] {
    const primary: any = (this.result?.details?.extractedInfo as any)?.viz?.primary;

    if (!primary) {
      return [];
    }

    const rows: Row[] = [];

    for (const [field, raw] of Object.entries(primary)) {
      if (typeof raw !== 'string' || !raw.trim()) {
        continue;
      }

      // The value is what the engine read, in the script the card uses. A
      // field with no Latin transliteration still belongs on the screen --
      // dropping it hid fields the engine had successfully read.
      rows.push({
        label: this.readable(field),
        value: raw.trim(),
        transliteration: this.transliterationOf(field, raw) || undefined,
      });
    }

    return rows;
  }

  render() {
    const rows = this.rows();

    return (
      <Host class={this.visible ? 'visible' : 'hidden'}>
        <div class="capture-result" role="dialog" aria-modal="true">
          <h1 aria-live="assertive">{this.heading}</h1>

          <div class="fields">
            {rows.length === 0 ? (
              <p class="empty">{this.emptyLabel}</p>
            ) : (
              rows.map(row => (
                <div class="field-row">
                  <span class="field-label">{row.label}</span>
                  <span class="field-values">
                    <span class="field-value">{row.value}</span>
                    {row.transliteration && (
                      <span class="field-transliteration">{row.transliteration}</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>

          <div class="actions">
            <idv-button
              label={this.doneLabel}
              variant="primary"
              clickHandler={() => this.captureResultDismissed?.emit()}
            ></idv-button>
            {/*
              One entry point rather than a button per file: a two-sided scan
              produces five, and that many links under the details reads as
              clutter on a screen whose job is to show what was read.
            */}
            {this.assetsLabel && this.assets.length > 0 && (
              <button
                type="button"
                class="download-frame"
                aria-expanded={this.assetsOpen ? 'true' : 'false'}
                onClick={() => (this.assetsOpen = !this.assetsOpen)}
              >
                {this.assetsLabel}
              </button>
            )}
            {this.assetsOpen && (
              <ul class="asset-list">
                {this.assets.map(asset => (
                  <li>
                    <button
                      type="button"
                      class="asset-link"
                      onClick={() => this.captureAssetDownloadRequested?.emit(asset.id)}
                    >
                      {asset.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Host>
    );
  }
}
