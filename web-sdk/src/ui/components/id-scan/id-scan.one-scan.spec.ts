/**
 * One scan at a time.
 *
 * Found by the simulator (lifecycle/restart-on-done): a host that starts the
 * next scan on `done` -- the demo does -- ran it alongside the last one's
 * wind-down. The submit, still in flight at `done`, then cleared the new scan
 * (deleted the recognizer it was using), and the success screen's timer reset
 * it back to the intro.
 *
 * Also here: with suppressHardErrorModals, a failure after a valid read left
 * startScanning() pending for good, with no `done`.
 */
jest.mock('../../../utils/utils', () => ({
  ...jest.requireActual('../../../utils/utils'),
  sleep: () => Promise.resolve(),
}));
jest.mock('./id-scan.audio', () => ({ idScanAudioFiles: {} }));

import * as SDKCore from '@utils/interface';
import { ModalHardErrors } from '../sdk-ui.error';
import { IDVerseIDScan } from './id-scan';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: any) => void };

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets everything already queued run. */
const flush = () => new Promise(r => setTimeout(r, 0));

/**
 * A component whose startScanning() runs end to end on fakes. Every scan reads
 * a valid document straight away; its submit and its success screen stay up
 * until the test lets them go.
 */
function makeComponent() {
  const c: any = new IDVerseIDScan();
  const log: string[] = [];
  const submits: Deferred<string>[] = [];
  const successScreens: Deferred<void>[] = [];
  let recognizers = 0;

  c.translation = { _t: (key: string) => key };
  c.semiAutoCapture = false;
  c.done = { emit: jest.fn(() => log.push('done')) };
  c.successEvent = { emit: jest.fn(() => log.push('scanSuccess')) };
  c.failEvent = { emit: jest.fn() };
  c.fatalError = { emit: jest.fn(() => log.push('fatalError')) };
  c.idvVideo = {
    getVideoRef: jest.fn(async () => {
      log.push('scan starts');
      return { pause: jest.fn() };
    }),
  };
  // As the real one: the recognizer is kept across scans until clear().
  c.createRecognizer = jest.fn(async () => {
    if (c.recognizer) {
      return;
    }
    const id = ++recognizers;
    c.recognizer = {
      id,
      getResults: jest.fn(async () => ({ status: SDKCore.IDScanProcessStatus.Valid })),
      delete: jest.fn(async () => {
        log.push(`recognizer #${id} deleted`);
      }),
    };
  });
  c.createScanner = jest.fn(async () => {
    c.scanner = {
      start: jest.fn(async () => SDKCore.RecognizerState.Valid),
      finishRecording: jest.fn(async () => true),
      delete: jest.fn(),
    };
  });
  c.sdkManager = {
    checkUploadStatus: jest.fn(async () => c.sdkManager.onUploadsComplete?.()),
  };
  c.handleComplete = jest.fn(() => {
    const submit = deferred<string>();
    submits.push(submit);
    return submit.promise;
  });
  c.exitingSuccessTransition = jest.fn(() => {
    const screen = deferred();
    successScreens.push(screen);
    return screen.promise;
  });

  return { c, log, submits, successScreens };
}

const starts = (log: string[]) => log.filter(entry => entry === 'scan starts').length;

describe('startScanning() -- one scan at a time', () => {
  it('a scan the host starts on `done` waits for the last one to wind down', async () => {
    const { c, log, submits, successScreens } = makeComponent();
    let next: Promise<void>;
    c.done.emit = jest.fn(() => {
      log.push('done');
      next ??= c.startScanning(); // the demo restarts on done
    });

    await c.startScanning();
    await flush();
    // Its submit is still in flight: the next scan has not started.
    expect(log).toEqual(['scan starts', 'done']);

    submits[0].resolve('doc-1');
    await flush();
    // Submitted and cleared; the success screen is still up.
    expect(log).toEqual(['scan starts', 'done', 'scanSuccess', 'recognizer #1 deleted']);

    successScreens[0].resolve();
    await flush();
    expect(log.slice(0, 5)).toEqual([
      'scan starts',
      'done',
      'scanSuccess',
      'recognizer #1 deleted',
      'scan starts',
    ]);
    // The new scan runs on a recognizer of its own, still alive.
    expect(c.recognizer.id).toBe(2);
    await next;
  });

  it('after a teardown, the next scan does not wait on the old submit -- and the old one leaves it alone', async () => {
    const { c, log, submits } = makeComponent();

    await c.startScanning();
    // close(): the worker goes, and with it any reply the submit was waiting on.
    await c.delete();

    // The next scan stays mid-capture, so what it shows can be checked.
    c.createScanner = jest.fn(async () => {
      c.scanner = { start: jest.fn(() => new Promise(() => {})), delete: jest.fn() };
    });
    c.startScanning();
    await flush();
    expect(starts(log)).toBe(2);
    // The success screen the torn-down scan left up does not cover it.
    expect([c.started, c.success, c.showSuccessAnimation]).toEqual([true, false, false]);

    // The old submit comes back late after all.
    submits[0].resolve('doc-1');
    await flush();
    expect(c.recognizer?.id).toBe(2);
    expect(log).not.toContain('recognizer #2 deleted');
  });

  it('a scan asked for before a teardown does not start after it', async () => {
    const { c, log } = makeComponent();
    let queued: Promise<void>;
    c.done.emit = jest.fn(() => {
      log.push('done');
      queued ??= c.startScanning();
    });

    await c.startScanning();
    await c.delete(); // the host tears down while the next scan waits
    await queued;

    expect(starts(log)).toBe(1);
  });

  it('two scans asked for at once run one after the other', async () => {
    const { c, log, submits, successScreens } = makeComponent();

    const first = c.startScanning();
    c.startScanning();
    await first;
    await flush();
    expect(starts(log)).toBe(1);

    submits[0].resolve('doc-1');
    successScreens[0].resolve();
    await flush();
    expect(starts(log)).toBe(2);
  });
});

describe('startScanning() -- a failure after a valid read still ends the scan', () => {
  const failingUploads = (c: any) => {
    c.sdkManager.checkUploadStatus = jest.fn(async () => {
      throw new Error('Failed to complete.');
    });
  };
  const events = (log: string[]) => log.filter(entry => entry === 'fatalError' || entry === 'done');

  it('with suppressHardErrorModals: no modal, but done, and the promise settles', async () => {
    const { c, log } = makeComponent();
    c.suppressHardErrorModals = true;
    failingUploads(c);

    let settled = false;
    c.startScanning().then(() => (settled = true));
    await flush();

    expect(settled).toBe(true);
    expect(events(log)).toEqual(['fatalError', 'done']);
    expect(c.interError).toBeFalsy();
  });

  it('without it: the modal, done, and the promise settles', async () => {
    const { c, log } = makeComponent();
    failingUploads(c);

    await c.startScanning();

    expect(events(log)).toEqual(['fatalError', 'done']);
    expect(c.interError).toBe(ModalHardErrors.Unexpected);
  });
});

describe('startScanning() -- torn down mid-way (destroy(), close())', () => {
  // Found while fixing the above: a Semi-auto scan whose scanner was deleted
  // never settled -- with one scan at a time, nothing could start after it --
  // and a Live one put up "unexpected error" after the host had closed the SDK.

  /** Scanners that run until deleted -- then start() rejects, as Scanner.delete() does. */
  const runUntilDeleted = (c: any) => {
    c.createScanner = jest.fn(async () => {
      let fail!: (error: any) => void;
      const running = new Promise<any>((_, rej) => (fail = rej));
      c.scanner = {
        start: jest.fn(() => running),
        delete: jest.fn(() => fail(new SDKCore.SdkError(SDKCore.ErrorCode.RecognizerMissing))),
      };
    });
  };

  it('mid-capture: ends quietly -- no modal, no events -- and the promise settles', async () => {
    const { c, log } = makeComponent();
    runUntilDeleted(c);
    let outcome = 'pending';
    c.startScanning().then(
      () => (outcome = 'resolved'),
      () => (outcome = 'rejected'),
    );
    await flush();

    await c.delete();
    await flush();

    expect(outcome).toBe('resolved');
    expect(c.interError).toBeFalsy();
    expect(log.filter(entry => ['fatalError', 'done', 'scanSuccess'].includes(entry))).toEqual([]);
  });

  it('while the recognizer was being made: the camera never opens', async () => {
    const { c } = makeComponent();
    const made = deferred();
    c.createRecognizer = jest.fn(() => made.promise);
    const scan = c.startScanning();
    await flush();

    await c.delete();
    made.resolve();
    await scan;

    expect(c.createScanner).not.toHaveBeenCalled();
  });

  it('on the result screen: no success screen, no submit, no done -- and the promise settles', async () => {
    // Found by the simulator (M16): close() on the result screen played the
    // success screen, submitted, then failed into "Something went wrong".
    const { c, log } = makeComponent();
    c.semiAutoCapture = true;
    const resultScreen = deferred();
    c.reviewCapture = jest.fn(() => resultScreen.promise);
    c.successTransition = jest.fn(async () => log.push('success screen'));
    let outcome = 'pending';
    c.startScanning().then(
      () => (outcome = 'resolved'),
      () => (outcome = 'rejected'),
    );
    await flush();
    expect(c.reviewCapture).toHaveBeenCalled();

    await c.delete();
    resultScreen.resolve(); // clear() acknowledges the screen
    await flush();

    expect(outcome).toBe('resolved');
    expect(c.successTransition).not.toHaveBeenCalled();
    expect(c.handleComplete).not.toHaveBeenCalled();
    expect(log.filter(e => ['done', 'scanSuccess', 'fatalError'].includes(e))).toEqual([]);
    expect(c.interError).toBeFalsy();
  });

  it('while the uploads finish: nothing is submitted', async () => {
    const { c, log } = makeComponent();
    const uploads = deferred();
    c.sdkManager.checkUploadStatus = jest.fn(async () => {
      await uploads.promise;
      c.sdkManager.onUploadsComplete?.();
    });
    let outcome = 'pending';
    c.startScanning().then(
      () => (outcome = 'resolved'),
      () => (outcome = 'rejected'),
    );
    await flush();

    await c.delete();
    uploads.resolve();
    await flush();

    expect(outcome).toBe('resolved');
    expect(c.handleComplete).not.toHaveBeenCalled();
    expect(log.filter(e => ['done', 'scanSuccess', 'fatalError'].includes(e))).toEqual([]);
  });

  it('while the camera was opening: it is shut again, and no scan runs on it', async () => {
    const { c } = makeComponent();
    const open = deferred();
    const camera = { start: jest.fn(), delete: jest.fn() };
    c.createScanner = jest.fn(async () => {
      await open.promise;
      c.scanner = camera;
    });
    const scan = c.startScanning();
    await flush();

    await c.delete();
    open.resolve();
    await scan;

    expect(camera.start).not.toHaveBeenCalled();
    expect(camera.delete).toHaveBeenCalled();
  });
});

describe('review screens -- a teardown before they are up', () => {
  // clear() answers a review screen that is waiting for the user. Torn down
  // while the screen was still settling, there was nothing to answer yet: the
  // screen then came up over the closed scan and waited for good.

  it('the result screen does not come up', async () => {
    const c: any = new IDVerseIDScan();
    c.translation = { _t: (k: string) => k };
    c.showResultScreen = true;
    c.settleScanEffect = jest.fn().mockResolvedValue(false);
    const crops = deferred();
    c.loadCrops = jest.fn(() => crops.promise);

    const review = c.reviewCapture({ status: SDKCore.IDScanProcessStatus.Valid });
    await flush();
    await c.delete();
    crops.resolve();
    await review;

    expect(c.showCaptureResult).toBe(false);
  });

  it('the field review does not come up, and the capture carries on to its end', async () => {
    const c: any = new IDVerseIDScan();
    c.translation = { _t: (k: string) => k };
    c.recognizer = {
      getFieldIssues: jest.fn().mockResolvedValue({ side: 'front', fields: [{ fieldType: 5, name: 'birth_date', missing: true }] }),
      delete: jest.fn(async () => {}),
    };
    const settle = deferred<boolean>();
    c.settleScanEffect = jest.fn(() => settle.promise);

    const review = c.reviewCaptureIssues();
    await flush();
    await c.delete();
    settle.resolve(true);

    await expect(review).resolves.toBe(true);
    expect(c.showCaptureIssues).toBe(false);
  });
});

describe('startScanning() -- the camera lost mid-scan', () => {
  // Found by the simulator: the track ended and nothing happened -- the
  // shutter stayed up over the last frame it had.
  const cameraGoes = (c: any) => {
    c.createScanner = jest.fn(async () => {
      c.scanner = {
        start: jest.fn(async () => {
          throw new SDKCore.SdkError(SDKCore.ErrorCode.CameraNotAvailable);
        }),
        delete: jest.fn(),
      };
    });
  };

  it('is told the way a camera that would not open is: that error, that modal', async () => {
    const { c, log } = makeComponent();
    cameraGoes(c);

    await expect(c.startScanning()).rejects.toMatchObject({ code: SDKCore.ErrorCode.CameraNotAvailable });

    expect(log).toContain('fatalError');
    expect(c.interError).toBe(ModalHardErrors.CameraNotAvailable);
  });

  it('with suppressHardErrorModals: the error, no modal', async () => {
    const { c, log } = makeComponent();
    c.suppressHardErrorModals = true;
    cameraGoes(c);

    await expect(c.startScanning()).rejects.toMatchObject({ code: SDKCore.ErrorCode.CameraNotAvailable });

    expect(log).toContain('fatalError');
    expect(c.interError).toBeFalsy();
  });
});

describe('Live capture -- the idle pause', () => {
  // Found by the simulator (live/pause): with nothing in view for a minute,
  // Live showed "Capture failed!" instead of "ID capture paused" -- the pause
  // was armed on the video's `play`, behind the scanner's own 60 s timeout,
  // and the timeout won. And after Continue it was never armed again (M8).

  it('is armed before the scanner starts its own clock', async () => {
    const { c, log } = makeComponent();
    c.semiAutoCapture = false;
    c.setPauseTimeout = jest.fn(() => log.push('pause armed'));
    const create = c.createScanner;
    c.createScanner = jest.fn(async () => {
      await create();
      const start = c.scanner.start;
      c.scanner.start = jest.fn(() => {
        log.push('scanner started');
        return start();
      });
    });

    await c.startScanning();

    expect(log.indexOf('pause armed')).toBeGreaterThan(-1);
    expect(log.indexOf('pause armed')).toBeLessThan(log.indexOf('scanner started'));
  });

  it('Continue arms it again before the scanner resumes', () => {
    const c: any = new IDVerseIDScan();
    const order: string[] = [];
    c.semiAutoCapture = false;
    c.setPauseTimeout = jest.fn(() => order.push('pause armed'));
    c.scanner = { resume: jest.fn(() => order.push('scanner resumed')) };

    c.handleResume();

    expect(order).toEqual(['pause armed', 'scanner resumed']);
  });

  it('is cleared when the scan ends', async () => {
    const { c } = makeComponent();
    c.semiAutoCapture = false;

    await c.startScanning();

    expect(c.pauseTimeout).toBeNull();
  });
});

describe('exitingSuccessTransition() -- the success screen timer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const showingSuccess = () => {
    const c: any = new IDVerseIDScan();
    c.success = true;
    c.showSuccessAnimation = true;
    c.started = true;
    return c;
  };

  it('takes the screen down after its hold', async () => {
    const c = showingSuccess();
    const gone = c.exitingSuccessTransition();
    jest.advanceTimersByTime(4000);
    await gone;
    expect([c.success, c.showSuccessAnimation, c.started]).toEqual([false, false, false]);
  });

  it('leaves a scan started since alone', async () => {
    const c = showingSuccess();
    const gone = c.exitingSuccessTransition(() => false);
    jest.advanceTimersByTime(4000);
    await gone;
    expect(c.started).toBe(true);
  });
});
