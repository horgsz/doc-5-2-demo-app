/**
 * Unit tests for the ID-scan capture state machine.
 *
 * These guard the semi-auto capture *feature logic* -- the front -> flip ->
 * back -> retake side/message transitions and the framing-feedback mapping --
 * which is where UI regressions have bitten (e.g. the flip animation showing
 * "scan front of ID" and the shutter re-appearing mid-flip). They exercise the
 * component's methods directly with light mocks, so they run fast and pin the
 * behaviour without needing a camera, worker or full render.
 *
 * To extend: add a case to an existing describe, or a new describe for another
 * method. Keep asserting on the @State the user actually sees (message,
 * captureReady, scanningBack, showMessage, flipDocument, awaitingBackSide).
 */
import * as SDKCore from '@utils/interface';

// sleep() is used for the flip animation delay; resolve it immediately so the
// tests do not wait real seconds. Everything else in the util barrel is real.
// Path is relative (not the @utils alias) because a jest.mock string is not
// alias-transformed the way an import is; it still resolves to src/utils/utils,
// the same module the component imports.
jest.mock('../../../utils/utils', () => ({
  ...jest.requireActual('../../../utils/utils'),
  sleep: () => Promise.resolve(),
}));

// The audio module calls getAssetPath() at import time (throws under jsdom) and
// is unrelated to the capture logic under test; stub it out.
jest.mock('./id-scan.audio', () => ({ idScanAudioFiles: {} }));

import { IDVerseIDScan } from './id-scan';

const S = SDKCore.IDScanDetectionStatus;

/** A component instance with just enough mocked around it to drive its logic. */
function makeComponent(overrides: Partial<any> = {}): any {
  const c: any = new IDVerseIDScan();

  // translation._t(key) -> the key itself, so assertions can check the key.
  c.translation = { _t: (key: string) => key };

  // Collaborators the methods call into.
  c.scanner = { startRecording: jest.fn(), pauseRecording: jest.fn() };
  c.recognizer = { retakeFrontSide: jest.fn().mockResolvedValue(undefined) };
  c.firstScan = { emit: jest.fn() };

  // Helpers with side effects (timers, DOM, animation) stubbed so the tests
  // observe *that* they run, not their internals.
  c.startAutoCapture = jest.fn();
  c.clearAutoCapture = jest.fn();
  c.scheduleGuideProbe = jest.fn();
  c.clearGuideProbe = jest.fn();
  // A real 1s interval that nothing in a test stops; run alone (in-band), the
  // spec never exited.
  c.startLocationProbe = jest.fn();
  c.resetErrorFeedback = jest.fn();
  c.showFeedback = jest.fn();
  c.handleTooManyIssues = jest.fn();
  c.unfreezeFrame = jest.fn();
  c.awaitWaveCycle = jest.fn().mockResolvedValue(undefined);
  c.reviewCaptureIssues = jest.fn().mockResolvedValue(true);
  c.setPauseTimeout = jest.fn();
  // onVideoLoad normally waits 500ms and animates opacity; run the callback now.
  c.onVideoLoad = (cb: () => void) => cb();

  // Sensible defaults; individual tests flip what they care about.
  c.semiAutoCapture = true;
  c.reviewFieldIssues = false;
  c.scanning = false;
  c.silentCapture = false;
  c.scanningBack = false;

  Object.assign(c, overrides);
  return c;
}

describe('feedbackVisible() -- sideways phone hides the pill once well placed', () => {
  // The pill normally shows whatever the engine is saying. In the sideways
  // layout it sits in the centre of the guide box, so it must come down as soon
  // as the good-location probe reports the document well placed. Portrait never
  // hides it for that reason -- these pin the asymmetry.
  function showing(overrides: Partial<any> = {}): boolean {
    const c = makeComponent({
      showMessage: true,
      showCaptureResult: false,
      showCaptureIssues: false,
      landscapeLayout: false,
      goodLocation: false,
      ...overrides,
    });
    return c.feedbackVisible();
  }

  it('portrait: stays up even when the document is well placed', () => {
    expect(showing({ landscapeLayout: false, goodLocation: true })).toBe(true);
  });

  it('landscape, not yet well placed: stays up', () => {
    expect(showing({ landscapeLayout: true, goodLocation: false })).toBe(true);
  });

  it('landscape, well placed: comes down', () => {
    expect(showing({ landscapeLayout: true, goodLocation: true })).toBe(false);
  });

  it('landscape: comes back up if the document drifts out of place', () => {
    const c = makeComponent({ showMessage: true, landscapeLayout: true, goodLocation: true });
    expect(c.feedbackVisible()).toBe(false);
    c.goodLocation = false;
    expect(c.feedbackVisible()).toBe(true);
  });

  // The flip-to-back animation plays in the centre of the screen -- the same
  // spot the sideways pill sits in -- so the pill yields to it there. Portrait
  // keeps the pill at the top, clear of the animation, and leaves it up.
  it('landscape: comes down while the flip-to-back animation plays', () => {
    expect(showing({ landscapeLayout: true, flipDocument: true })).toBe(false);
  });

  it('landscape: returns once the flip animation ends', () => {
    const c = makeComponent({ showMessage: true, landscapeLayout: true, flipDocument: true });
    expect(c.feedbackVisible()).toBe(false);
    c.flipDocument = false;
    expect(c.feedbackVisible()).toBe(true);
  });

  it('portrait: stays up during the flip animation (unchanged)', () => {
    expect(showing({ landscapeLayout: false, flipDocument: true })).toBe(true);
  });

  it('the result and issues panels still win, in either layout', () => {
    expect(showing({ showCaptureResult: true })).toBe(false);
    expect(showing({ showCaptureIssues: true })).toBe(false);
    expect(showing({ landscapeLayout: true, showCaptureResult: true })).toBe(false);
  });

  it('nothing to say means nothing shown, regardless of placement', () => {
    expect(showing({ showMessage: false, landscapeLayout: true, goodLocation: false })).toBe(false);
  });

  it('readLayout() mirrors the landscape media query, and is off without one', () => {
    const c = makeComponent();
    c.layoutQuery = undefined;
    c.readLayout();
    expect(c.landscapeLayout).toBe(false);

    c.layoutQuery = { matches: true };
    c.readLayout();
    expect(c.landscapeLayout).toBe(true);

    c.layoutQuery = { matches: false };
    c.readLayout();
    expect(c.landscapeLayout).toBe(false);
  });
});

describe('good-location probe -- on by default', () => {
  // It is part of the capture experience (green corners, guide proportions,
  // landscape pill), not an experiment: a host that never sets the prop must
  // get it. makeComponent() does not touch it, so this reads the initializer.
  it('enableGoodLocation defaults to true', () => {
    expect(makeComponent().enableGoodLocation).toBe(true);
  });

  it('a host can still opt out', () => {
    expect(makeComponent({ enableGoodLocation: false }).enableGoodLocation).toBe(false);
  });
});

describe('onStart() -- camera opened', () => {
  it('semi-auto: shows the shutter and the "front of ID" prompt, arms capture', () => {
    const c = makeComponent();
    c.onStart();

    expect(c.openingCamera).toBe(false);
    expect(c.captureReady).toBe(true);
    expect(c.message).toBe('id-scan-front-of-id');
    expect(c.showMessage).toBe(true);
    expect(c.startAutoCapture).toHaveBeenCalled();
    expect(c.scheduleGuideProbe).toHaveBeenCalled();
  });

  it('live mode: does not arm the shutter, shows the loading state', () => {
    const c = makeComponent({ semiAutoCapture: false });
    c.onStart();

    expect(c.captureReady).toBeFalsy();
    expect(c.loading).toBe(true);
    expect(c.startAutoCapture).not.toHaveBeenCalled();
    // The idle pause is armed by startScanning(), ahead of the scanner's own
    // clock; arming it again here put it behind (live/pause).
    expect(c.setPauseTimeout).not.toHaveBeenCalled();
  });

  it('a later play -- the browser resuming the video, back from another app -- leaves the screen as it was', () => {
    // Found by the simulator: backgrounded mid-back-side, the page came back
    // asking for the FRONT while the engine still wanted the back.
    const c = makeComponent();
    c.onStart();

    // Flipped: the back is asked for, the review is up, shutter down.
    c.scanningBack = true;
    c.message = 'id-scan-back-of-id';
    c.captureReady = false;
    c.startAutoCapture.mockClear();

    c.onStart();

    expect(c.message).toBe('id-scan-back-of-id');
    expect(c.captureReady).toBe(false);
    expect(c.startAutoCapture).not.toHaveBeenCalled();
  });
});

describe('onFirstScanSemiAuto() -- front accepted, flip to back', () => {
  it('switches the prompt to "back of ID" and re-arms the shutter for the back', async () => {
    const c = makeComponent();
    await c.onFirstScanSemiAuto();

    expect(c.scanningBack).toBe(true);
    expect(c.message).toBe('id-scan-back-of-id');
    expect(c.showMessage).toBe(true);
    expect(c.captureReady).toBe(true);
    expect(c.awaitingBackSide).toBe(false);
    // the flip animation has ended by the time this resolves
    expect(c.flipDocument).toBe(false);
    // per-side review cap and attempt flag reset for the back
    expect(c.captureReviewShows).toBe(0);
    expect(c.captureAttempted).toBe(false);
    expect(c.firstScan.emit).toHaveBeenCalled();
  });

  it('quiets the document while turning over: clears auto-capture and the probe first', async () => {
    const c = makeComponent();
    await c.onFirstScanSemiAuto();

    expect(c.clearAutoCapture).toHaveBeenCalled();
    expect(c.clearGuideProbe).toHaveBeenCalled();
    // re-armed for the back side afterwards
    expect(c.startAutoCapture).toHaveBeenCalled();
    expect(c.scheduleGuideProbe).toHaveBeenCalled();
    expect(c.scanner.startRecording).toHaveBeenCalled();
  });

  it('review rejected: retakes the front instead of advancing to the back', async () => {
    const c = makeComponent({ reviewFieldIssues: true });
    c.reviewCaptureIssues = jest.fn().mockResolvedValue(false);
    await c.onFirstScanSemiAuto();

    // stayed on the front
    expect(c.scanningBack).toBe(false);
    expect(c.awaitingBackSide).toBe(false);
    expect(c.recognizer.retakeFrontSide).toHaveBeenCalled();
    expect(c.firstScan.emit).not.toHaveBeenCalled();
  });
});

describe('retakeFrontSide() -- back to front', () => {
  it('resets side + flip state and re-arms for the front', async () => {
    const c = makeComponent({ scanningBack: true, awaitingBackSide: true, flipDocument: true });
    await c.retakeFrontSide();

    expect(c.scanningBack).toBe(false);
    expect(c.awaitingBackSide).toBe(false);
    expect(c.flipDocument).toBe(false);
    expect(c.captureGuideShape).toBe(SDKCore.DocumentShape.Card);
    expect(c.documentSeen).toBe(false);
    expect(c.recognizer.retakeFrontSide).toHaveBeenCalled();
    expect(c.startAutoCapture).toHaveBeenCalled();
    expect(c.scheduleGuideProbe).toHaveBeenCalled();
  });

  it('the next rejected press is still a rejection: counted, guide blinks', async () => {
    // Found by the simulator (M2): Retake on the front's review flagged the
    // retake for a capture that had already finished, and the next press with
    // nothing in view was swallowed -- no blink, no banner.
    const c = makeComponent({ awaitingBackSide: true });
    c.captureRetakeRequested = true; // what the front review's Retake sets
    await c.retakeFrontSide();

    c.scanner.capture = jest.fn().mockResolvedValue(SDKCore.RecognizerState.Incomplete);
    c.flagCaptureRejected = jest.fn();
    c.resolveCaptureGuide = jest.fn().mockResolvedValue(undefined);
    c.freezeFrame = jest.fn();
    c.captureRejections = 0;
    await c.handleCapture();

    expect(c.flagCaptureRejected).toHaveBeenCalled();
    expect(c.captureRejections).toBe(1);
  });
});

describe('onDetection() -- framing feedback', () => {
  it('empty frame on the front shows the "front of ID" prompt', () => {
    const c = makeComponent();
    c.onDetection(S.Empty);

    expect(c.message).toBe('id-scan-front-of-id');
    expect(c.showFeedback).toHaveBeenCalledWith('id-scan-front-of-id', null, true);
  });

  it('empty frame on the BACK shows the "back of ID" prompt (not front)', () => {
    const c = makeComponent({ scanningBack: true });
    c.onDetection(S.Empty);

    expect(c.message).toBe('id-scan-back-of-id');
    expect(c.showFeedback).toHaveBeenCalledWith('id-scan-back-of-id', null, true);
  });

  it('well-framed but unreadable earns the "adjust and try again" complaint', () => {
    const c = makeComponent();
    c.onDetection(S.Unrecognizable);

    expect(c.scanning).toBe(true);
    expect(c.showFeedback).toHaveBeenCalledWith('id-scan-capture-retry', null, false);
  });

  it('a silent probe read never narrates anything to the user', () => {
    const c = makeComponent({ silentCapture: true, message: 'unchanged' });
    c.onDetection(S.Empty);

    // the silent-capture guard returns before any banner/message work
    expect(c.message).toBe('unchanged');
    expect(c.showFeedback).not.toHaveBeenCalled();
    expect(c.resetErrorFeedback).not.toHaveBeenCalled();
  });

  it('any non-empty frame counts as "document seen" for the idle countdown', () => {
    const c = makeComponent();
    c.onDetection(S.Incomplete);
    expect(c.documentSeen).toBe(true);
  });
});

describe('shouldArmIssuesTimeout() -- idle auto-continue only with "Continue anyway"', () => {
  // captureIssuesShowProceed is the exact flag that renders the "Continue
  // anyway" button (false on the first showing, true from the second). The idle
  // clock auto-answers "proceed", so it must track that button 1:1.
  it('does NOT arm on the first showing (no proceed button)', () => {
    const c = makeComponent({ captureIssuesShowProceed: false });
    expect(c.shouldArmIssuesTimeout(false)).toBe(false);
  });

  it('arms from the second showing on (proceed button offered)', () => {
    const c = makeComponent({ captureIssuesShowProceed: true });
    expect(c.shouldArmIssuesTimeout(false)).toBe(true);
  });

  it('never arms for an unclear document, even when proceed is offered', () => {
    const c = makeComponent({ captureIssuesShowProceed: true });
    expect(c.shouldArmIssuesTimeout(true)).toBe(false);
  });
});

describe('pause -> Continue restores the "front of ID" banner', () => {
  // The idle timeout drops to the paused screen (handlePause), which hides the
  // banner (showMessage=false). Pressing Continue (handleTryAgain -> PAUSE ->
  // handleResume) must bring it back the same way onStart does -- setting the
  // message alone is not enough, the banner is gated on showMessage.
  function pausedComponent(overrides: Partial<any> = {}) {
    const c = makeComponent({
      semiAutoCapture: true,
      clearCaptureRejected: jest.fn(),
      ...overrides,
    });
    c.scanner.discardRecording = jest.fn();
    c.scanner.startRecording = jest.fn();
    // Camera started: the banner is up, as onStart leaves it.
    c.showMessage = true;
    c.message = 'id-scan-front-of-id';
    return c;
  }

  it('shows the front banner again after Continue from the pause screen', () => {
    const c = pausedComponent();

    // Idle timeout, nothing ever framed -> paused screen.
    c.handlePause();
    expect(c.issue).toBe('PAUSE');
    expect(c.showMessage).toBe(false); // pause hides the banner

    // User presses Continue.
    c.handleTryAgain();

    expect(c.message).toBe('id-scan-front-of-id');
    expect(c.showMessage).toBe(true); // banner is back (regression guard)
  });

  it('shows the BACK banner after Continue when paused mid back-side', () => {
    const c = pausedComponent({ scanningBack: true });
    c.message = 'id-scan-back-of-id';

    c.handlePause();
    c.handleTryAgain();

    expect(c.message).toBe('id-scan-back-of-id');
    expect(c.showMessage).toBe(true);
  });
});

describe('Unrecognizable ("adjust and try again") -- Semi-auto only', () => {
  // The engine emits Unrecognizable in both modes; the "adjust the ID and try
  // again" message answers a deliberate press, so it belongs to Semi-auto. In
  // Live the stream keeps trying on its own and must not surface it.
  const RETRY = 'id-scan-capture-retry';
  const retryShown = (c: any) =>
    (c.showFeedback as jest.Mock).mock.calls.some((args: any[]) => args[0] === RETRY);

  it('Semi-auto: shows the retry message', () => {
    const c = makeComponent({ semiAutoCapture: true });
    c.onDetection(S.Unrecognizable);
    expect(retryShown(c)).toBe(true);
  });

  it('Live: does NOT show the retry message', () => {
    const c = makeComponent({ semiAutoCapture: false });
    c.onDetection(S.Unrecognizable);
    expect(retryShown(c)).toBe(false);
  });
});

describe('reviewCapture() -- Done on the result screen', () => {
  // Found by the simulator: Done tapped while the result screen was still
  // coming in (its first ~450 ms) did nothing, so the scan never finished.
  const ticks = async (n = 5) => {
    for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0));
  };

  /** A component paused in the result screen's entrance until `finish()`. */
  function inEntrance() {
    let finish!: () => void;
    const c = makeComponent({ showResultScreen: true });
    c.scanner.closeCamera = jest.fn();
    c.settleScanEffect = jest.fn().mockResolvedValue(true);
    c.loadCrops = jest.fn().mockResolvedValue(undefined);
    c.dropScanEffect = jest.fn(() => new Promise<void>(r => (finish = r)));
    let reviewed = false;
    c.reviewCapture({}).then(() => (reviewed = true));
    return { c, finish: () => finish(), reviewed: () => reviewed };
  }

  it('a Done tapped during the entrance closes the result', async () => {
    const r = inEntrance();
    await ticks();
    expect(r.c.showCaptureResult).toBe(true);

    r.c.captureResultAck?.(); // what the Done button calls
    r.finish();
    await ticks();

    expect(r.reviewed()).toBe(true);
    expect(r.c.showCaptureResult).toBe(false);
  });

  it('a teardown during the entrance releases the wait', async () => {
    const r = inEntrance();
    await ticks();
    r.c.captureResultAck?.(); // what clear() calls
    r.finish();
    await ticks();
    expect(r.reviewed()).toBe(true);
  });

  it('the result stays up until Done, and Done after the entrance still works', async () => {
    const r = inEntrance();
    await ticks();
    r.finish();
    await ticks();
    expect(r.reviewed()).toBe(false);
    expect(r.c.showCaptureResult).toBe(true);

    r.c.captureResultAck?.();
    await ticks();
    expect(r.reviewed()).toBe(true);
    expect(r.c.showCaptureResult).toBe(false);
  });
});

describe('clear() -- teardown releases the camera first', () => {
  // Found by the simulator: after the host's destroy() the camera stayed on.
  // destroy() terminates the worker straight away, so the recognizer delete
  // clear() waited on before stopping the camera never answered.
  it('stops the camera even when the worker never answers the recognizer delete', async () => {
    const c = makeComponent();
    const stopCamera = jest.fn();
    c.scanner = { delete: stopCamera };
    c.recognizer = { delete: jest.fn(() => new Promise(() => {})) }; // the worker is gone
    c.pauseTimeout = setTimeout(() => {}, 60000);

    c.clear();
    await new Promise(r => setTimeout(r, 0));

    expect(stopCamera).toHaveBeenCalled();
    expect(c.scanner).toBeNull();
    expect(c.pauseTimeout).toBeNull();
  });
});

describe('handleTryAgain() -- one tryAgain per tap', () => {
  // Found by the simulator: a failure screen's "Try again" reached the host as
  // two tryAgain events (the screen's own, bubbling out, plus this one).
  it('failure screen: one event, then a restart', () => {
    const c = makeComponent({ issue: 'UNREADABLE', instantTry: false });
    c.tryAgain = { emit: jest.fn() };
    c.startScanning = jest.fn().mockResolvedValue(undefined);

    c.handleTryAgain();

    expect(c.tryAgain.emit).toHaveBeenCalledTimes(1);
    expect(c.startScanning).toHaveBeenCalled();
  });

  it('pause screen: one event, then resume', () => {
    const c = makeComponent({ issue: 'PAUSE' });
    c.tryAgain = { emit: jest.fn() };
    c.handleResume = jest.fn();

    c.handleTryAgain();

    expect(c.tryAgain.emit).toHaveBeenCalledTimes(1);
    expect(c.handleResume).toHaveBeenCalled();
  });
});

describe('review "Download original frame"', () => {
  // Found by the simulator: on a one-sided card the button downloaded nothing
  // -- the review runs before the still is stashed under its side.
  const still = { width: 4, height: 2, data: new Uint8ClampedArray(32) };

  it('downloads the still under review, though it is not stashed yet', async () => {
    const c = makeComponent();
    c.scanner = { currentImage: still };
    c.capturedFrames = {};
    c.downloadFrame = jest.fn().mockResolvedValue(undefined);

    await c.downloadReviewedFrame();

    expect(c.downloadFrame).toHaveBeenCalledWith(still, 'front');
  });

  it('on the back, downloads the back still, not the stashed front', async () => {
    const c = makeComponent({ scanningBack: true });
    c.scanner = { currentImage: still };
    c.capturedFrames = { front: { width: 1, height: 1, data: new Uint8ClampedArray(4) } };
    c.downloadFrame = jest.fn().mockResolvedValue(undefined);

    await c.downloadReviewedFrame();

    expect(c.downloadFrame).toHaveBeenCalledWith(still, 'back');
  });
});

describe('reviewCaptureIssues() -- answering while the panel comes in', () => {
  // Found by the simulator: Retake tapped in the review panel's first ~450 ms
  // (its entrance) found no handler, and the user stayed on the panel.
  const ticks = async (n = 5) => {
    for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0));
  };

  /** A review showing paused in its entrance until `finish()`; `shows` = earlier showings. */
  function inEntrance(shows = 0) {
    let finish!: () => void;
    const c = makeComponent({ captureReviewShows: shows });
    delete c.reviewCaptureIssues; // the real one, not makeComponent's stub
    c.recognizer = {
      getFieldIssues: jest.fn().mockResolvedValue({
        side: 'front',
        fields: [{ fieldType: 5, name: 'birth_date', missing: true, confidence: 0 }],
      }),
    };
    c.scanner = { pauseRecording: jest.fn(), startRecording: jest.fn() };
    c.settleScanEffect = jest.fn().mockResolvedValue(true);
    c.dropScanEffect = jest.fn(() => new Promise<void>(r => (finish = r)));
    c.resolveCaptureGuide = jest.fn().mockResolvedValue(undefined);
    let answer: boolean | undefined;
    c.reviewCaptureIssues().then((v: boolean) => (answer = v));
    return { c, finish: () => finish(), answer: () => answer };
  }

  it('Retake tapped during the entrance goes back to the camera', async () => {
    const r = inEntrance();
    await ticks();
    expect(r.c.showCaptureIssues).toBe(true);

    r.c.captureIssuesDecision?.(false); // what Retake calls
    r.finish();
    await ticks();

    expect(r.answer()).toBe(false);
    expect(r.c.showCaptureIssues).toBe(false);
    expect(r.c.captureReady).toBe(true);
  });

  it('Retake puts the side caption back over the camera (it went with the press)', async () => {
    // Found by the simulator (M12): after a Retake the camera came back with
    // no banner at all.
    const r = inEntrance();
    await ticks();
    r.c.showMessage = false; // the press took it down
    r.c.captureIssuesDecision?.(false);
    r.finish();
    await ticks();

    expect(r.c.message).toBe('id-scan-front-of-id');
    expect(r.c.showMessage).toBe(true);
  });

  it('Continue anyway tapped during the entrance proceeds', async () => {
    const r = inEntrance(1); // second showing: Continue anyway is offered
    await ticks();
    expect(r.c.captureIssuesShowProceed).toBe(true);

    r.c.captureIssuesDecision?.(true); // what Continue anyway calls
    r.finish();
    await ticks();

    expect(r.answer()).toBe(true);
  });

  it('waits for an answer once the entrance is over', async () => {
    const r = inEntrance();
    await ticks();
    r.finish();
    await ticks();
    expect(r.answer()).toBeUndefined();

    r.c.captureIssuesDecision?.(false);
    await ticks();
    expect(r.answer()).toBe(false);
  });
});

describe('handleCapture() -- a rejected press always says something', () => {
  // Found by the simulator: 6.0 sends no detection for a frame with no
  // document in it, the press had cleared the banner, and the screen was left
  // without a word.
  const rejected = (during?: (c: any) => void, overrides: Partial<any> = {}) => {
    const c = makeComponent(overrides);
    c.scanner.capture = jest.fn(async () => {
      during?.(c);
      return SDKCore.RecognizerState.Empty;
    });
    c.flagCaptureRejected = jest.fn();
    c.resolveCaptureGuide = jest.fn().mockResolvedValue(undefined);
    c.freezeFrame = jest.fn();
    return c;
  };

  it('no detection for the frame: the side caption, as an Empty detection shows it', async () => {
    const c = rejected();
    await c.handleCapture();
    expect(c.showFeedback).toHaveBeenCalledWith('id-scan-front-of-id', null, true);
  });

  it('on the back, the back caption', async () => {
    const c = rejected(undefined, { scanningBack: true });
    await c.handleCapture();
    expect(c.showFeedback).toHaveBeenCalledWith('id-scan-back-of-id', null, true);
  });

  it('the engine said why: its message stands', async () => {
    const c = rejected(x => x.onDetection(SDKCore.IDScanDetectionStatus.DocumentTooFar));
    await c.handleCapture();
    expect(c.showFeedback).toHaveBeenCalledTimes(1);
    expect(c.showFeedback).not.toHaveBeenCalledWith('id-scan-front-of-id', null, true);
  });

  it("a press inside the last message's 1.5 s hold still gets its own message", async () => {
    // Found by the simulator (M11): two quick presses on a card held too far
    // -- the second said nothing at all.
    const c = rejected(x => x.onDetection(SDKCore.IDScanDetectionStatus.DocumentTooFar));
    delete c.showFeedback; // the real one, with its hold
    c.scheduleSemiAutoFeedbackHide = jest.fn();
    c.feedbackPlaying = true; // the previous press's message is still in its hold
    c.message = 'id-scan-move-closer';

    await c.handleCapture();
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));

    expect(c.showMessage).toBe(true);
    expect(c.message).toBe('id-scan-move-closer');
  });
});

describe('handleCapture() -- the engine could not download what the read needed', () => {
  // 6.0's on-demand engine downloads document and language files during a
  // read; when it cannot, processImage answers DataUnavailable. Nothing was
  // read, so the press is not a rejection.
  const unavailable = (overrides: Partial<any> = {}) => {
    const c = makeComponent(overrides);
    c.scanner.capture = jest.fn().mockResolvedValue(SDKCore.RecognizerState.DataUnavailable);
    c.scanner.endScan = jest.fn();
    c.flagCaptureRejected = jest.fn();
    c.resolveCaptureGuide = jest.fn().mockResolvedValue(undefined);
    c.freezeFrame = jest.fn();
    return c;
  };

  it('says to check the connection, and nothing else', async () => {
    const c = unavailable();
    await c.handleCapture();
    expect(c.showFeedback).toHaveBeenCalledWith('id-scan-capture-connection', null, false);
    expect(c.showFeedback).toHaveBeenCalledTimes(1);
  });

  it('is not a rejection: no flash, no count, the shutter re-arms', async () => {
    const c = unavailable();
    c.captureRejections = 2;
    await c.handleCapture();
    expect(c.flagCaptureRejected).not.toHaveBeenCalled();
    expect(c.captureRejections).toBe(2);
    expect(c.startAutoCapture).toHaveBeenCalled();
  });

  it('one short of the give-up screen, it does not bring it up', async () => {
    const c = unavailable();
    c.captureRejections = 4; // a fifth rejection would end on "We couldn't capture your ID"
    await c.handleCapture();
    expect(c.scanner.endScan).not.toHaveBeenCalled();
  });

  it("the countdown's last attempt does not end the scan over it", async () => {
    const c = unavailable();
    await c.handleCapture(false, true);
    expect(c.scanner.endScan).not.toHaveBeenCalled();
  });

  it('a silent probe stays silent', async () => {
    const c = unavailable();
    await c.handleCapture(true);
    expect(c.showFeedback).not.toHaveBeenCalled();
  });
});

describe('showConnectionProblem() -- Live reports it every frame', () => {
  it('is said once while it shows', () => {
    const c = makeComponent();
    c.showConnectionProblem();
    c.showMessage = true;
    c.message = 'id-scan-capture-connection';
    c.showConnectionProblem();
    expect(c.showFeedback).toHaveBeenCalledTimes(1);
  });
});

describe('freezeStill() -- the still is the picture the user was looking at', () => {
  // Found by the simulator: on a desktop webcam the live picture is mirrored,
  // the frozen still was not, and the picture flipped at every capture.
  const freeze = (transform: string) => {
    const canvas: any = { style: {}, getContext: () => ({ drawImage: jest.fn() }) };
    const c = makeComponent({
      videoFeed: { videoWidth: 1920, videoHeight: 1080, style: { transform } },
      freezeCanvas: canvas,
    });
    c.freezeStill();
    expect(c.captureFrozen).toBe(true);
    return canvas.style.transform;
  };

  it('mirrored like a mirrored live picture (webcam, front camera)', () => {
    expect(freeze('scaleX(-1)')).toBe('scaleX(-1)');
  });

  it('as is for a back camera', () => {
    expect(freeze('')).toBe('');
  });
});

describe('portraitLock() -- only a phone held sideways', () => {
  // Found by the simulator: on a desktop monitor (landscape, 0 degrees) the
  // result, issues and success screens were turned on their side.
  const lock = (isLandscape: boolean, screenAngle: number, visible = true) =>
    makeComponent({ isLandscape, screenAngle }).portraitLock(visible);

  it('a desktop monitor -- landscape at its natural 0 degrees -- is not locked', () => {
    expect(lock(true, 0)).toBe('');
  });

  it('a phone turned sideways is', () => {
    expect(lock(true, 90)).toBe('portrait-locked-left');
    expect(lock(true, 270)).toBe('portrait-locked-right');
  });

  it('nothing in portrait, nothing for a hidden screen', () => {
    expect(lock(false, 0)).toBe('');
    expect(lock(true, 90, false)).toBe('');
  });
});
