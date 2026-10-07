/**
 * The review screen's per-field status wording. The portrait (201) names the
 * classifier's fault when it has one (covered / glare / blurry); with no
 * verdict it falls through to the plain missing label rather than guessing a
 * cause. Text fields keep the missing / unclear pair.
 */
import { newSpecPage } from '@stencil/core/testing';
import { IDVerseIDScanCaptureIssues } from './capture-issues';

const PORTRAIT = 201;

async function labelFor(field: any): Promise<string> {
  const page = await newSpecPage({
    components: [IDVerseIDScanCaptureIssues],
    html: `<idv-id-scan-capture-issues></idv-id-scan-capture-issues>`,
  });
  page.rootInstance.visible = true;
  page.rootInstance.issues = { documentId: 1, crop: '', fields: [field] };
  await page.waitForChanges();
  const state = page.root.shadowRoot.querySelector('.field-list .field-state');
  // strip the leading severity icon (× / !) the component prepends
  return (state?.textContent || '').replace(/^[×!]\s*/, '').trim();
}

describe('capture-issues -- field status wording', () => {
  it('portrait: classifier verdicts map to their own labels', async () => {
    expect(
      await labelFor({
        fieldType: PORTRAIT,
        name: 'face_photo',
        missing: true,
        quality: 'covered',
      }),
    ).toBe('face covered');
    expect(
      await labelFor({ fieldType: PORTRAIT, name: 'face_photo', missing: false, quality: 'glare' }),
    ).toBe('face has glare');
    expect(
      await labelFor({
        fieldType: PORTRAIT,
        name: 'face_photo',
        missing: false,
        quality: 'blurry',
      }),
    ).toBe('face is unclear');
  });

  it('portrait with no verdict falls through to the missing label, not a guessed "covered"', async () => {
    const label = await labelFor({ fieldType: PORTRAIT, name: 'face_photo', missing: true });
    expect(label).toBe('not found');
    expect(label).not.toBe('face covered');
  });

  it('a text field keeps the missing / unclear wording', async () => {
    expect(await labelFor({ fieldType: 8, name: 'last_name', missing: true })).toBe('not found');
    expect(await labelFor({ fieldType: 8, name: 'last_name', missing: false })).toBe('unclear');
  });
});
