/**
 * The alignment guide draws the document's real proportions via a --guide-aspect
 * CSS variable. Landscape shapes give a ratio > 1; a document held vertically
 * inverts it to < 1 so the outline turns portrait, and the host gains a
 * `vertical` class so the stylesheet can give the taller box room.
 */
import { newSpecPage } from '@stencil/core/testing';
import { IDVerseIDScanCaptureGuide } from './capture-guide';
import { DocumentShape } from '@utils/interface';

async function render(shape: DocumentShape, vertical: boolean) {
  const page = await newSpecPage({
    components: [IDVerseIDScanCaptureGuide],
    html: `<idv-id-scan-capture-guide></idv-id-scan-capture-guide>`,
  });
  page.rootInstance.visible = true;
  page.rootInstance.shape = shape;
  page.rootInstance.vertical = vertical;
  await page.waitForChanges();
  return page;
}

function aspect(page: any): number | null {
  const frame = page.root.shadowRoot.querySelector('.guide-frame');
  if (!frame) return null;
  const v = frame.style.getPropertyValue('--guide-aspect');
  return v ? parseFloat(v) : null;
}

describe('capture-guide -- vertical orientation', () => {
  it('draws a landscape card outline by default (ratio > 1)', async () => {
    const page = await render(DocumentShape.Card, false);
    expect(aspect(page)).toBeCloseTo(85.6 / 53.98, 3);
    expect(page.root.classList.contains('vertical')).toBe(false);
  });

  it('inverts the card outline to portrait when held vertically (ratio < 1)', async () => {
    const page = await render(DocumentShape.Card, true);
    expect(aspect(page)).toBeCloseTo(53.98 / 85.6, 3); // 1 / 1.586
    expect(page.root.classList.contains('vertical')).toBe(true);
  });

  it('inverts the passport outline too', async () => {
    const page = await render(DocumentShape.Passport, true);
    expect(aspect(page)).toBeCloseTo(88 / 125, 3); // 1 / 1.420
    expect(page.root.classList.contains('vertical')).toBe(true);
  });

  it('draws nothing for an unknown shape regardless of orientation', async () => {
    const page = await render(DocumentShape.Unknown, true);
    expect(page.root.shadowRoot.querySelector('.guide-frame')).toBeNull();
  });
});
