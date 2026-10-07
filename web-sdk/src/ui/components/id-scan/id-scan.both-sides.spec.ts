/**
 * setScanBothSides() while a scan is running.
 *
 * Found by the simulator: the host changing scanBothSides mid-scan nulled the
 * recognizer the running scan still used, and its capture then crashed with
 * "Cannot read properties of null (reading 'getResults')". The new setting
 * belongs to the next scan's recognizer.
 */
jest.mock('../../../utils/utils', () => ({
  ...jest.requireActual('../../../utils/utils'),
  sleep: () => Promise.resolve(),
}));
jest.mock('./id-scan.audio', () => ({ idScanAudioFiles: {} }));

const log: string[] = [];
let made = 0;
jest.mock('../../../utils/interface', () => {
  const actual = jest.requireActual('../../../utils/interface');
  return {
    ...actual,
    createIDScanRecognizer: jest.fn(async (_mgr: any, settings: any) => {
      const id = ++made;
      log.push(`create #${id} scanBothSides=${settings.scanBothSides}`);
      return {
        id,
        settings,
        setLandscape: jest.fn(() => Promise.resolve()),
        delete: jest.fn(async () => {
          log.push(`delete #${id}`);
        }),
      };
    }),
  };
});

import { IDVerseIDScan } from './id-scan';

function component(): any {
  const c: any = new IDVerseIDScan();
  c.translation = { _t: (k: string) => k };
  c.recognizerCreated = { emit: jest.fn() };
  return c;
}

describe('setScanBothSides() mid-scan', () => {
  beforeEach(() => {
    log.length = 0;
    made = 0;
  });

  it('leaves the running scan its recognizer', async () => {
    const c = component();
    await c.createRecognizer();
    const running = c.recognizer;

    await c.setScanBothSides(false);

    expect(c.recognizer).toBe(running);
  });

  it('the next scan gets a recognizer with the new setting; the old one is deleted first', async () => {
    const c = component();
    await c.createRecognizer();
    const scannerDelete = jest.fn();
    c.scanner = { delete: scannerDelete, hasCamera: true };

    await c.setScanBothSides(false);
    await c.createRecognizer(); // the next startScanning

    expect(log).toEqual(['create #1 scanBothSides=undefined', 'delete #1', 'create #2 scanBothSides=false']);
    expect(c.recognizer.id).toBe(2);
    // the old scanner was bound to recognizer #1
    expect(scannerDelete).toHaveBeenCalled();
    expect(c.scanner).toBeNull();
  });

  it('without a change, the recognizer is reused as before', async () => {
    const c = component();
    await c.createRecognizer();
    await c.createRecognizer();
    expect(log).toEqual(['create #1 scanBothSides=undefined']);
  });
});
