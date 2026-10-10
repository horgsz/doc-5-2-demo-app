import { Component, Event, EventEmitter, Host, Method, Prop, State, Watch, h } from '@stencil/core';
import * as SDKCore from '@utils/interface';

import {
  createBlobUrlFromImageData,
  sleep,
  TIME_TO_KEEP_SUCCESS_CHECK_ANIMATION_ON_IN_MS,
} from '@utils/utils';
import { ModalHardErrors } from '../sdk-ui.error';
import { IDScanErrors } from './id-scan.errors';
import { IdScanIssueCustomEvent } from '../../../components';
import { idScanAudioFiles } from './id-scan.audio';
import { isBarcodeField, isUnclearDocument } from './id-scan-capture/capture-issues.shared';
import {
  SDKManager,
  DocumentIDScanResultWrapper,
  IDScanProcessStatus,
  SdkError,
  IDScanRecognizer,
  Scanner,
  IDScanDetectionStatus,
  Session,
  BackOfCardDocumentConditionItem,
} from '@utils/interface';
import { Translation } from '@utils/translation';

const PAUSE_TIMEOUT_MS = 60 * 1000;

/** Thrown inside startScanning() to stop a scan the host has torn down. */
const TORN_DOWN = new Error('id-scan: torn down');

/**
 * How long a feedback message stays up in Semi-auto capture mode. Live capture
 * keeps its message on screen because a new frame is always about to replace
 * it; a manual capture produces one message and nothing would ever clear it.
 */
const MANUAL_FEEDBACK_VISIBLE_MS = 2000;

/**
 * How long the shutter waits for the user before it starts counting itself
 * down, and how many seconds it counts. Someone who has not pressed by now is
 * either lining the document up carefully or waiting to be told what to do --
 * both are served by taking the shot for them, and the visible countdown gives
 * them a moment to press first if they would rather.
 */
const AUTO_CAPTURE_IDLE_MS = 15000;
const AUTO_CAPTURE_COUNTDOWN_SECONDS = 4;

/**
 * Whether the idle period ends in a countdown that presses the shutter. Off:
 * the shot is the user's to take.
 *
 * The idle clock itself keeps running either way, because it does a second job
 * -- a camera that has been open the whole period with nothing ever in front of
 * it still falls through to the paused screen. Only the automatic press goes.
 */
const AUTO_CAPTURE_COUNTDOWN_ENABLED: boolean = false;

/**
 * Whether the shutter carries a line of text above it. Off: the guide corners
 * and the feedback banner carry the instruction on their own.
 */
const CAPTURE_HINT_ENABLED: boolean = false;

/**
 * How long to let the phone settle after the shutter is pressed, before the
 * frame is taken.
 *
 * Pressing a handheld phone nudges it, and the frame at the instant of the
 * press carries that movement as motion blur -- the press itself was producing
 * the bad frame it was trying to capture. Waiting lets the device come to rest
 * on the framing the user had already lined up.
 *
 * Only a real press waits. The countdown firing and the silent probe involve
 * no touch, so there is nothing to settle and delaying them would just make
 * the flow slower.
 */
const CAPTURE_STEADY_MS = 250;

/**
 * How long to wait before looking again when the idle period expires while a
 * frame is still with the engine. Short, because by then the user has already
 * waited out the whole idle period.
 */
const AUTO_CAPTURE_RECHECK_MS = 1000;

/**
 * How long the field-review screen waits for an answer before continuing on
 * the user's behalf.
 *
 * Continuing is the right default: the engine has already accepted this
 * capture, so the worst case is a weaker read of a document that was good
 * enough. Waiting forever is worse -- the scan stays open with the camera
 * live, on a screen the user has plainly walked away from.
 */
const CAPTURE_ISSUES_TIMEOUT_MS = 15000;

/**
 * How long the alignment guide holds its warning colour after the engine
 * rejects a frame, before easing back to the ready colour.
 */
const CAPTURE_REJECTED_WARNING_MS = 2000;

/**
 * How many frames the engine may reject in a row before the scan stops asking
 * the user to try the same thing again.
 *
 * Five rejections says the document is not being read; the unreadable screen
 * explains what to fix and hands back a fresh five. Ten says it is not this
 * user's framing at all -- the document itself is very likely one the engine
 * does not support, which is a different screen with a different question.
 *
 * The count deliberately survives "try again" (see `retryingAfterFailure`),
 * or the second five would never be reached.
 */
const CAPTURE_REJECTIONS_UNREADABLE = 5;
const CAPTURE_REJECTIONS_UNSUPPORTED = 10;

/** Which side of the document an asset came from. */
type DocumentSide = 'front' | 'back';

/** One saveable thing this scan produced, as the review screen lists it. */
interface CaptureAsset {
  /** `original-front`, `crop-back`, `video`. */
  id: string;
  label: string;
}

/**
 * The alignment guide's detector probe: how long each interval lasts, and how
 * many times it looks before giving up.
 *
 * Long enough for the user to have raised the document, short enough that a
 * passport is not aimed at a card outline for long. Two looks, then a third
 * interval after which the frame is captured regardless -- 3s detect, 3s
 * detect, 3s then take it.
 */
const GUIDE_PROBE_DELAY_MS = 3000;
const GUIDE_PROBE_ATTEMPTS = 2;
/** How long the "turn the document over" animation stays up. */
const FLIP_ANIMATION_MS = 3000;

/**
 * One pass of the scan wave, bottom to top. Must match the
 * `captureWaveTravel` duration in capture-scan.scss.
 *
 * The engine usually answers mid-pass, which used to cut the wave off
 * wherever it happened to be. The accepted paths wait out the rest of the
 * pass so the light always leaves the top of the frame before anything
 * transitions over it.
 */
// Must match TRAVEL_MS in capture-scan.tsx: this is how the host waits out the
// current pass before settling, so the two share one period or the wait is
// wrong.
const CAPTURE_WAVE_CYCLE_MS = 1800;

/**
 * How long the result screen is up before the camera is released. Just enough
 * of a beat that stopping the tracks cannot land in the middle of the screen's
 * entrance.
 */
const RESULT_CAMERA_CLOSE_MS = 200;

@Component({
  tag: 'idv-id-scan',
  styleUrl: 'id-scan.scss',
  shadow: true,
})
export class IDVerseIDScan {
  /**
   * Scanner configuration.
   */
  @Prop() completeScreen: boolean = true;
  @Prop() suppressHardErrorModals: boolean = false;
  /**
   * Three states, not two:
   *
   *  - unset -- the engine decides from the document, asking for the back only
   *    when the profile says it carries one
   *  - true  -- always ask for the back
   *  - false -- never ask, front only
   *
   * `null` is treated as unset. It has to be normalised before the settings
   * cross into the engine: there the key is skipped only when it is
   * *undefined*, and a null would be read as `false` and silently force
   * front-only.
   */
  @Prop() scanBothSides: boolean | undefined | null;
  @Prop() backOfCardDocumentConditions: BackOfCardDocumentConditionItem[] | undefined;
  @Prop() enableDFA: boolean = false;
  @Prop() enableFaceMatch: boolean = false;
  @Prop() disableScreenLandscape: boolean | undefined = false;
  @Prop() translation: Translation;
  @Prop() session: Session;
  /**
   * When true the camera does not scan continuously. The user frames the
   * document and presses a capture button, and each press submits a single
   * frame and returns feedback for it.
   */
  @Prop() semiAutoCapture: boolean = true;
  /**
   * Camera capture resolution override. When set, it wins over the mode default
   * (semi-auto normally asks for UHD/4K). Lets a host cap the stream -- e.g. to
   * 1080p (FULL_HD) on memory-tight devices where a 4K stream beside the engine
   * overruns the browser tab's memory limit. Leave undefined for the default.
   */
  @Prop() cameraResolution?: SDKCore.CameraResolution;
  /**
   * After a capture the engine accepts, show the fields it read poorly or not
   * at all -- highlighted on the cropped document -- and let the user retake
   * rather than continue. Semi-auto capture only; ignored in live scanning.
   */
  @Prop() reviewFieldIssues: boolean = true;
  /**
   * Record the scan session (camera video). On by default; false disables the
   * recorder so nothing is captured to a video.
   */
  @Prop() enableRecording: boolean = true;
  /**
   * Show the read-back screen -- every field the engine got off the accepted
   * capture, with a Done button -- before the scan completes.
   *
   * Off by default: it is a diagnostic view of the SDK's own output, useful
   * while integrating and while debugging a profile, but it puts the user's
   * document contents on screen and adds a tap to a flow that is otherwise
   * finished. Integrators who want it turn it on deliberately. Semi-auto
   * capture only; ignored in live scanning.
   */
  @Prop() showResultScreen: boolean = false;

  /* When calling payload submit when scanning id, this additional/optional data will extend the original payload */
  @Prop() extendedPayloadForSubmit?: Record<string, any>;

  /**
   * ID Scan events.
   */
  @Event() tryAgain?: EventEmitter<null>;
  @Event() done?: EventEmitter<null>;
  @Event() successEvent?: EventEmitter<DocumentIDScanResultWrapper>;
  @Event() firstScan?: EventEmitter<null>;
  @Event() failEvent?: EventEmitter<IDScanProcessStatus>;
  @Event() fatalError?: EventEmitter<SdkError>;
  @Event() screenLandscape?: EventEmitter<null>;
  @Event() recordingDone?: EventEmitter<Blob>;

  @Event() recognizerCreated?: EventEmitter<IDScanRecognizer>;
  @Event() scannerCreated?: EventEmitter<Scanner>;

  /**
   * Real-time Feedback states.
   */
  @State() message: string = '';
  @State() issue: string = '';
  @State() uncertain: boolean = false;
  @State() showMessage: boolean = false;
  @State() further: boolean = false;
  @State() closer: boolean = false;
  @State() left: boolean = false;
  @State() right: boolean = false;
  @State() glare: boolean = false;
  @State() blur: boolean = false;
  @State() success: boolean = false;
  @State() failure: boolean = false;
  @State() paused: boolean = false;
  @State() showVideo: boolean = false;
  @State() scanning: boolean = false;
  @State() holdStill: boolean = false;
  @State() loadingBar: boolean = false;
  @State() loading: boolean = false;
  @State() feedbackPlaying: boolean = false;
  @State() isLandscape: boolean = false;
  /**
   * screen.orientation.angle, kept alongside isLandscape: the portrait lock
   * on the non-capture screens has to rotate with the device, and the angle
   * says which of the two landscapes the phone is in.
   */
  @State() screenAngle: number = 0;
  /**
   * Whether the capture screen is in its sideways-phone layout. Read from the
   * SAME media query the stylesheets use for their landscape blocks -- not
   * from `isLandscape`, which is the device's physical orientation and is
   * also true for a tall desktop window that never re-lays out. Anything that
   * must agree with the landscape layout (the feedback pill's placement and
   * hiding) keys off this.
   */
  @State() landscapeLayout: boolean = false;
  private layoutQuery?: MediaQueryList;
  /** Stops following the device's orientation (isLandscape, screenAngle). */
  private stopOrientationWatch?: () => void;
  private readLayout = (): void => {
    this.landscapeLayout = this.layoutQuery?.matches ?? false;
  };

  /**
   * Whether the feedback pill ("Scan front of ID", "Move ID closer", ...) is
   * on screen. It shows whatever the engine is currently saying, except while
   * the result or issues panels have taken over.
   *
   * Sideways phone only: the pill sits in the centre of the guide box (see
   * capture-feedback.scss), so it comes down (a) once the good-location probe
   * says the document is well placed -- the words would otherwise sit over a
   * correctly framed document -- and (b) while the flip-to-back animation
   * plays, which occupies that same centre and was being drawn under it.
   * Portrait keeps the pill at the top, clear of both, and never hides it for
   * these; `landscapeLayout` is false there.
   */
  private feedbackVisible(): boolean {
    return (
      this.showMessage &&
      !this.showCaptureResult &&
      !this.showCaptureIssues &&
      !(this.landscapeLayout && (this.goodLocation || this.flipDocument))
    );
  }

  /**
   * Class that pins a full-screen panel to the device's portrait axes while
   * the phone is held sideways. Only the capture screen re-lays out for
   * landscape; everything else stays a portrait screen, turned with the
   * device the way a native app with a locked orientation would be.
   *
   * Takes the screen's own visibility: the class turns the host into a
   * full-viewport box, and on a hidden screen that box is an invisible
   * click-blocker sitting over the shutter -- a hidden panel must stay the
   * zero-size host it normally is.
   *
   * Only a screen turned from its natural orientation (90 or 270 degrees) is
   * held sideways. A desktop monitor is landscape at 0 degrees, and locking
   * there turned the result, issues and success screens on their side.
   */
  private portraitLock(screenVisible: boolean): string {
    const turned = this.screenAngle === 90 || this.screenAngle === 270;
    if (!screenVisible || !this.isLandscape || !turned) {
      return '';
    }

    return this.screenAngle === 270 ? 'portrait-locked-right' : 'portrait-locked-left';
  }
  @State() noErrorFeedback: boolean = false;
  @State() openingCamera: boolean = false;
  @State() flipDocument: boolean = false;
  @State() scanningBack: boolean = false;
  @State() elementWasFound: boolean = false;
  @State() loadAudio: boolean = false;
  @State() playingAudio: boolean = false;
  @State() forceShowMessage: boolean = false;
  @State() showSuccessAnimation: boolean = false;
  @State() started: boolean = false;
  @State() completed: boolean = false;
  @State() instantTry: boolean = false;
  @State() imageExample: string = '';
  @State() latestStatus: IDScanDetectionStatus;
  @State() bothSide: boolean = false;
  @State() interError: { title: string; message: string } | null = null;

  @State() frame: string;

  /**
   * Semi-auto capture state.
   */
  /** Capture button is on screen and the user may press it. */
  @State() captureReady: boolean = false;
  /** A captured frame is currently with the engine. */
  @State() captureBusy: boolean = false;
  /** The feed is frozen on the captured frame and the scan effect is playing. */
  @State() captureScanning: boolean = false;
  /** The scan succeeded; the effect is settling into the result screen. */
  @State() captureSettling: boolean = false;
  /**
   * The shutter has been pressed and the phone is being given a moment to come
   * to rest; the frame has not been taken yet. Distinct from `captureBusy`,
   * which means the engine has the frame -- but the button reads both as busy,
   * so the press registers instantly and cannot be repeated.
   */
  @State() captureSteadying: boolean = false;
  /** The captured frame is held on the canvas overlay. */
  @State() captureFrozen: boolean = false;

  /**
   * Whether the live feed was uncovered at the last render. On the render
   * where it becomes uncovered -- a frozen capture, the flip animation, the
   * review / result / success screens or the intro going away --
   * componentDidRender has idv-video attach a new display element. See
   * idv-video.tsx: on iOS, an element that got the stream while covered can
   * stay drawn shrunk.
   */
  private liveFeedWasUncovered: boolean = false;

  private get liveFeedUncovered(): boolean {
    return (
      this.showVideo &&
      !this.openingCamera &&
      !this.captureFrozen &&
      !this.flipDocument &&
      !this.showCaptureIssues &&
      !this.showCaptureResult &&
      !this.showSuccessAnimation
    );
  }

  componentDidRender() {
    const uncovered = this.liveFeedUncovered;
    if (uncovered && !this.liveFeedWasUncovered) {
      void this.idvVideo?.refreshDisplay?.();
    }
    this.liveFeedWasUncovered = uncovered;
  }

  /** Overlay that holds the captured frame while the stream runs underneath. */
  private freezeCanvas: HTMLCanvasElement | null = null;
  /** At least one frame has been captured and rejected. */
  @State() captureAttempted: boolean = false;
  /**
   * The engine has just rejected a frame. Turns the alignment guide's corners
   * warning-coloured for a couple of seconds -- the outline is where the user
   * is already looking, so it says "not that one" faster than the banner can.
   */
  @State() captureRejected: boolean = false;
  /** Puts the guide's corners back to the ready colour. */
  private captureRejectedTimer: any = null;
  /**
   * Consecutive frames the engine has rejected, counted across "try again" so
   * the escalation to the unreadable and unsupported screens can span more
   * than one scan attempt. Cleared by an accepted capture and by a scan the
   * host starts fresh.
   */
  private captureRejections: number = 0;

  /**
   * The accepted camera frame for each side, kept because
   * `scanner.currentImage` only ever holds the most recent one.
   */
  private capturedFrames: { front?: ImageData; back?: ImageData } = {};

  /** The engine's rectified image for each side, read once the scan ends. */
  private capturedCrops: SDKCore.IDScanCrops = {};
  /**
   * The screen a rejection streak decided on, overriding the engine's own
   * verdict when `startScanning()` maps the failure. The engine has nothing
   * useful to say about frames it never accepted, so its result would map to
   * the generic timeout screen.
   */
  private forcedIssue: string | null = null;
  /**
   * This `startScanning()` came from a failure screen's "try again", not from
   * the host starting a new scan. The rejection streak survives the former and
   * is reset by the latter.
   */
  private retryingAfterFailure: boolean = false;
  /**
   * Shape of the document to guide the user towards.
   *
   * Starts as a card because that is what most documents are, so the user has
   * something to line up against the moment the camera opens. A detector probe
   * a few seconds later corrects it to a passport when that is what is in
   * frame. It is never cleared back to Unknown -- an outline that vanishes
   * mid-aim is worse than one that is briefly the wrong proportion.
   */
  @State() captureGuideShape: SDKCore.DocumentShape = SDKCore.DocumentShape.Card;
  /**
   * The good-location probe sees the document held
   * portrait (taller than wide). Flips the alignment guide to a vertical
   * outline, the same way {@link captureGuideShape} flips it between card and
   * passport proportions. Only the good-location probe sets this; the fallback
   * shape probe leaves it at its default (landscape).
   */
  @State() captureGuideVertical: boolean = false;
  /** Pending one-shot detector probe that sizes the guide. */
  private guideProbeTimer: any = null;
  /**
   * The good-location probe: once a second while the shutter is up, a small
   * frame goes to the detector and its verdict drives the capture chrome --
   * the guide corners turn green while the ID is well placed, the guide takes
   * the document's card / passport / upright proportions, the document counts
   * as seen for the idle countdown, and on a sideways phone the feedback pill
   * comes down once the ID is placed. ON by default; the prop is an opt-out
   * for hosts that want the plain outline. When on, the separate one-shot
   * guide-shape probe is skipped as redundant. Semi-auto capture only.
   */
  @Prop() enableGoodLocation: boolean = true;
  /**
   * True while the good-location probe says the ID is
   * well placed. Drives the guide corners green; back to white otherwise.
   */
  @State() goodLocation: boolean = false;
  /** 1s interval behind the good-location probe. */
  private locationProbeTimer: any = null;

  /** React to the host toggling the feature mid-session. */
  @Watch('enableGoodLocation')
  onEnableGoodLocationChange(on: boolean) {
    if (on) {
      this.startLocationProbe();
    } else {
      this.clearLocationProbe();
    }
  }
  /**
   * True while a probe-driven silent capture is being read by the engine.
   *
   * The engine reports on every frame it reads through the onDetection
   * callback, and for a rejected frame that report becomes feedback -- "adjust
   * your document and try again". For a frame the user submitted that is
   * exactly right. For the probe chain's own frame, submitted at nine seconds
   * with nothing in view, it is a message about a capture the user never asked
   * for and cannot account for. This suppresses that feedback for the duration
   * of the silent read.
   */
  private silentCapture: boolean = false;

  /**
   * A user press that arrived while the silent probe's frame was mid-read.
   * The probe does not present as busy, so the press has to be parked here
   * and replayed once the probe resolves instead of being dropped.
   */
  private pendingUserCapture: boolean = false;

  /**
   * Whether anything has seen a document in the frame for the side being
   * captured -- a guide probe hitting a shape, or the engine reporting
   * anything but an empty frame. The idle countdown is gated on this:
   * counting down over a scene with no document in it would only walk the
   * user into a guaranteed rejection and the timeout screen. Reset per side,
   * since the back of a card is a new picture.
   */
  private documentSeen: boolean = false;

  /**
   * When the scan effect's wave began its first pass, from `freezeFrame()`.
   * Zero when no effect is playing.
   */
  private captureScanStart: number = 0;
  /**
   * True between the engine accepting a front side and the flip transition
   * handing the shutter back for the back side.
   */
  private awaitingBackSide: boolean = false;

  /**
   * Whether the engine has accepted any frame in this scan -- a front side, or
   * a whole single-sided document.
   *
   * What it decides is whether the session recording holds anything: with a
   * capture in it the recording is evidence and is only ever paused, whereas
   * before the first one it is footage of a camera nobody aimed, and the
   * paused screen throws it away rather than resuming into it. A rejected
   * frame does not count -- nothing was captured -- but a capture the user
   * later retakes does, since they were plainly holding a document.
   */
  private hasAcceptedCapture: boolean = false;
  /** Review screen listing what the engine read off the accepted capture. */
  @State() showCaptureResult: boolean = false;
  @State() captureResult: SDKCore.IDScanRecognizerResult = null;
  /** Resolves once the user acknowledges the review screen. */
  private captureResultAck: (() => void) | null = null;
  /** Screen shown when the accepted capture read some fields poorly. */
  @State() showCaptureIssues: boolean = false;
  @State() captureIssues: SDKCore.IDScanFieldIssues = null;
  /**
   * Whether the review screen offers "Continue anyway" this time. Only the
   * second showing for a side does -- the first asks for a retake outright --
   * and a back side whose profile declares a PDF417 never does: the barcode
   * is the point of capturing that side.
   */
  @State() captureIssuesShowProceed: boolean = false;
  /**
   * How many times the review screen has been shown for the side currently
   * being captured. At two the screen has said all it can: the third weak
   * capture proceeds automatically with the stitched best of the attempts.
   * Reset when the flow moves to the other side.
   */
  private captureReviewShows: number = 0;
  /** Resolves with the user's choice: true to proceed, false to retake. */
  private captureIssuesDecision: ((proceed: boolean) => void) | null = null;
  /** Answers the review screen for a user who never does. */
  private captureIssuesTimer: any = null;
  /**
   * The user pressed Retake on the review screen.
   *
   * That comes back out of `scanner.capture()` as `Incomplete`, which is the
   * same shape as a rejection -- but the engine accepted this frame, the user
   * simply wanted a better one. Distinguishing them keeps a retake from
   * blinking the guide red and from counting towards the unreadable screen.
   */
  private captureRetakeRequested: boolean = false;
  /** Pending auto-hide for the Semi-auto mode feedback banner. */
  private feedbackHideTimer: any = null;
  /**
   * Seconds left on the auto-capture countdown, shown inside the shutter.
   * 0 means nothing is counting.
   */
  @State() captureCountdown: number = 0;
  /** Waiting out the idle period before the countdown starts. */
  private autoCaptureIdleTimer: any = null;
  /** Ticking the countdown down to the auto press. */
  private autoCaptureTickTimer: any = null;

  /**
   * Properties
   */
  private videoFeed: HTMLVideoElement;
  private recognizer: SDKCore.IDScanRecognizer;
  /** The recognizer was made with a scanBothSides since changed; replaced at the next scan. */
  private recognizerStale = false;
  private scanner: SDKCore.Scanner;
  private sdkManager: SDKCore.SDKManager;
  private audio: any;
  private idvVideo: any;
  private pauseTimeout: any = null;
  /** Settles once the last scan asked for has wound down completely -- its submit and clear(), its success screen. */
  private lastScanWoundDown: Promise<void> = Promise.resolve();
  /** The scan running now. A scan winds itself down only while it still is, never over a newer one. */
  private currentScan: object = null;
  /** Stops the running scan's wind-down waiting on its submit and success screen; teardown calls it. */
  private abandonScan: () => void = () => {};
  /** Counts teardowns: a scan asked for before one does not start after it. */
  private teardowns = 0;
  /** This scan's camera has played; a later `play` is the browser resuming it. */
  private feedStarted = false;
  /** Detections shown so far; a press compares it to see whether its frame got one. */
  private detections = 0;

  @Watch('translation')
  setInitialMessage(translation: Translation) {
    this.message = translation._t('id-scan-front-of-id') as string;
  }

  componentWillLoad() {
    this.setInitialMessage(this.translation);
  }

  async componentDidLoad() {
    // Tracked unconditionally: even when landscape is allowed for capture,
    // the review, result and exception screens are portrait-only -- they lock
    // to the device instead of re-laying out, and the lock needs the rotation
    // angle to know which way the device turned. Initialised from the current
    // orientation, not just changes -- a scan can begin with the phone already
    // sideways.
    const readOrientation = () => {
      const orientation = SDKCore.readScreenOrientation();
      this.isLandscape = orientation.type.includes('landscape');
      this.screenAngle = orientation.angle;

      // The engine judges framing differently sideways -- its portrait
      // distance floor reads a well-placed landscape card as "too far".
      // Fire-and-forget: feedback wording is not worth failing a rotation
      // over, and the recognizer may not exist yet (createRecognizer pushes
      // the current value once it does).
      this.recognizer?.setLandscape(this.isLandscape).catch(() => {});
    };
    readOrientation();
    // screen.orientation is missing before Safari 16.4; the helper falls back
    this.stopOrientationWatch = SDKCore.onScreenOrientationChange(readOrientation);

    // The layout's own notion of landscape (see landscapeLayout). Same guard
    // string as capture-guide.scss / capture-button.scss / capture-feedback.scss,
    // so the pill logic and the stylesheets flip together, never apart.
    this.layoutQuery = window.matchMedia('(orientation: landscape) and (max-height: 520px)');
    this.readLayout();
    this.layoutQuery.addEventListener('change', this.readLayout);

    window.onbeforeunload = () => {
      this.clear();
    };
  }

  // #region Create
  async createRecognizer(): Promise<void> {
    this.loadAudio = true;

    /**
     * Set up ID Scan Engine callbacks. (optional)
     */
    const callbacks: SDKCore.RecognizerCallbacks = {
      onIDScanDetection: this.onDetection.bind(this),
    };

    callbacks.onFirstScan = () => this.onFirstScan();

    const recognizerSettings: SDKCore.IDScanRecognizerSettings = {
      /**
       * Forces scanning back side of document is its required.
       *
       * Normalised so "not set" survives: the engine skips this key only when
       * it is undefined, so a null here would be read as false and force
       * front-only rather than letting the engine decide.
       */
      scanBothSides: this.scanBothSides ?? undefined,
      backOfCardDocumentConditions: this.backOfCardDocumentConditions,
      enableDFA: this.enableDFA,
      enableFaceMatch: this.enableFaceMatch,
      semiAutoCapture: this.semiAutoCapture,
      SDKVersion: '0.5.0',
    };

    return new Promise(async (resolve, reject) => {
      if (this.recognizer && this.recognizerStale) {
        // Built with a scanBothSides the host has since changed: replace it,
        // and the scanner with it -- a scanner keeps the recognizer it was made
        // with and would go on feeding that one. The old one is deleted first:
        // the worker holds one recognizer, and a delete sent after the new one
        // exists would take the new one.
        const stale = this.recognizer;
        this.recognizer = null;
        this.recognizerStale = false;
        if (this.scanner) {
          this.scanner.delete();
          this.scanner = null;
        }
        await stale.delete().catch(() => {});
      }

      if (this.recognizer) {
        // A reused recognizer may predate the current orientation -- a scan
        // started in portrait, the phone rotated, and a new scan began. The
        // fresh-creation path below pushes this too; the reuse path must not
        // skip it.
        this.recognizer.setLandscape(this.isLandscape).catch(() => {});
        return resolve();
      }

      try {
        this.recognizer = await SDKCore.createIDScanRecognizer(
          this.sdkManager,
          recognizerSettings,
          callbacks,
        );

        // The phone may already be sideways when the scan starts; the
        // orientation listener only fires on changes.
        this.recognizer.setLandscape(this.isLandscape).catch(() => {});

        // The engine warms itself in the background once authenticated (see
        // Recognizer::authenticate) -- nothing to trigger from here.

        this.recognizerCreated.emit(this.recognizer);

        resolve();
      } catch (error: any) {
        reject(error);
        this.handleFatalError(error);

        if (this.suppressHardErrorModals) {
          return;
        }

        this.interError = IDScanErrors.RecognizerFailure;
      }
    });
  }

  /**
   * Creates SDK Scanner instance.
   */
  async createScanner(): Promise<void> {
    this.interError = null;

    // Resolution strategy. An explicit cameraResolution prop is an override --
    // honoured exactly, as a plain continuous stream. Otherwise semi-auto picks
    // per measured device capability BEFORE the camera opens, so a memory-tight
    // phone never opens a 4K stream it cannot afford (see DeviceProfiler): a
    // capable device gets 4K, mid gets 2K, and a low-end one runs a 1080p
    // preview and bumps to 2K only for each still. Live mode streams at Auto.
    let previewResolution: SDKCore.CameraResolution;
    let captureResolution: SDKCore.CameraResolution | undefined;

    if (this.cameraResolution !== undefined) {
      previewResolution = this.cameraResolution;
    } else if (this.semiAutoCapture) {
      const profile = SDKCore.DeviceProfiler.profile();
      previewResolution = profile.strategy.previewResolution;
      captureResolution = profile.strategy.captureResolution;
      try {
        const perf = new BroadcastChannel('idv-perf');
        perf.postMessage(`[perf] device: ${SDKCore.DeviceProfiler.describe(profile)}`);
        perf.close();
      } catch (e) {
        /* no perf channel; the strategy still applies */
      }
    } else {
      previewResolution = SDKCore.CameraResolution.Auto;
    }

    const scannerSettings: SDKCore.ScannerSettings = {
      cameraFeed: this.videoFeed,
      cameraType: SDKCore.CameraType.Back,
      cameraResolution: previewResolution,
      // Set only when the strategy wants a higher-res still than the preview;
      // Scanner bumps the track per capture and drops it back. No-op otherwise.
      captureResolution,
      disableScreenLandscape: this.disableScreenLandscape,
      captureMode: this.semiAutoCapture ? SDKCore.CaptureMode.SemiAuto : SDKCore.CaptureMode.Live,
      // Recording defaults to Auto; Disabled builds no recorder at all.
      recorderStrategy: this.enableRecording
        ? SDKCore.RecorderStrategy.Auto
        : SDKCore.RecorderStrategy.Disabled,
    };

    if (this.screenLandscape) {
      scannerSettings.onScreenLandscape = () => this.screenLandscape.emit();
    }

    return new Promise(async (resolve, reject) => {
      if (this.scanner?.hasCamera) {
        return resolve();
      }

      // A scanner whose camera was handed back when the result screen came up
      // cannot be restarted -- start() would reject with VideoFeedMissing. A
      // retry gets a fresh one on the feed startScanning() just re-acquired.
      if (this.scanner) {
        this.scanner.delete();
        this.scanner = null;
      }

      try {
        this.scanner = await SDKCore.createScanner(this.recognizer, scannerSettings);

        // A capture the engine accepts can still have read badly. Hold the
        // scan open long enough to show the user which fields, and let them
        // decide whether to keep it -- the camera never closes in between.
        // Without the gate a valid capture finishes the scan as it always did.
        if (this.semiAutoCapture && this.reviewFieldIssues) {
          this.scanner.onCaptureAccepted = () => this.reviewCaptureIssues();
        }
        // Live only: a press is answered in handleCapture().
        this.scanner.onDataUnavailable = () => this.showConnectionProblem();

        this.scannerCreated.emit(this.scanner);

        resolve();
      } catch (error: any) {
        reject(error);
        this.cameraFailure(error);
      }
    });
  }

  /**
   * A camera that failed -- to open, or mid-scan: the fatal error, and the
   * modal that says what is wrong with it.
   */
  private cameraFailure(error: SdkError): void {
    this.handleFatalError(error);

    if (this.suppressHardErrorModals) {
      return;
    }

    switch (error.code) {
      case SDKCore.ErrorCode.CameraNotAllowed:
        this.interError = ModalHardErrors.CameraNotAllowed;
        break;
      case SDKCore.ErrorCode.CameraNotFound:
        this.interError = ModalHardErrors.CameraNotFound;
        break;
      case SDKCore.ErrorCode.CameraNotAvailable:
        this.interError = ModalHardErrors.CameraNotAvailable;
        break;
      default:
        this.interError = ModalHardErrors.CameraBusy;
        break;
    }
  }

  // #region Start
  /**
   * Starts the scanning process.
   */
  @Method()
  async startScanning(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // One scan at a time, in the order asked for. A host that starts the
      // next scan on `done` -- the demo does -- used to run it alongside this
      // one's wind-down: the teardown below hid its video, the submit's
      // clear() deleted its recognizer, the success screen's timer reset it.
      // Each scan now waits for the one before it to wind down completely.
      const previous = this.lastScanWoundDown;
      const teardowns = this.teardowns;
      let windDown!: () => void;
      this.lastScanWoundDown = new Promise<void>(r => (windDown = r));
      await previous;

      // Asked for before a teardown, it does not start after it: the camera
      // would come on for a host that had just torn the SDK down.
      if (this.teardowns !== teardowns) {
        windDown();
        resolve();
        return;
      }

      const scan = {};
      this.currentScan = scan;
      const current = () => this.currentScan === scan;
      const abandoned = new Promise<void>(r => (this.abandonScan = r));
      let completion: Promise<void> = Promise.resolve();
      let successGone: Promise<void> = Promise.resolve();

      try {
        this.videoFeed = await this.idvVideo.getVideoRef();

        await this.createRecognizer();
        // Torn down meanwhile (destroy(), close()): the camera stays shut.
        if (this.teardowns !== teardowns) {
          throw TORN_DOWN;
        }
        await this.createScanner();
        if (this.teardowns !== teardowns) {
          throw TORN_DOWN;
        }

        clearTimeout(this.pauseTimeout);

        this.videoFeed.onplay = () => this.onStart();
        // Only still up when the last scan was torn down before its own timer
        // took it down.
        this.success = false;
        this.showSuccessAnimation = false;
        this.started = true;
        this.completed = false;
        this.feedStarted = false;
        this.openingCamera = true;
        this.showVideo = true;
        this.elementWasFound = false;
        this.scanning = false;
        this.holdStill = false;
        this.issue = '';
        this.captureReady = false;
        this.captureBusy = false;
        this.captureSteadying = false;
        this.captureScanning = false;
        this.captureSettling = false;
        this.captureFrozen = false;
        this.captureAttempted = false;
        this.awaitingBackSide = false;
        this.hasAcceptedCapture = false;
        this.documentSeen = false;
        this.captureGuideShape = SDKCore.DocumentShape.Card;
        this.showCaptureIssues = false;
        this.captureIssues = null;
        this.captureReviewShows = 0;
        this.clearAutoCapture();
        this.clearGuideProbe();
        this.clearCaptureRejected();

        // A scan the host started is a clean slate; one reached through a
        // failure screen's "try again" is the same user still working on the
        // same document, and its rejections keep counting towards the next
        // escalation.
        if (!this.retryingAfterFailure) {
          this.captureRejections = 0;
          this.forcedIssue = null;
        }
        this.retryingAfterFailure = false;

        // Live: the idle pause goes ahead of the scanner's own timeout. Both
        // are a minute, and with nothing in view the pause screen ("Continue")
        // is the one meant to show; armed first, it fires first.
        if (!this.semiAutoCapture) {
          this.setPauseTimeout();
        }

        const scanState: SDKCore.RecognizerState = await this.scanner.start().catch(e => {
          // The camera went away mid-scan (Scanner: track ended). Told the way
          // a camera that would not open is -- that error, that modal -- not
          // left as a shutter over a dead picture.
          if (e?.code === SDKCore.ErrorCode.CameraNotAvailable && this.teardowns === teardowns) {
            this.cameraFailure(e);
          }
          throw e;
        });

        // Torn down partway (destroy(), close()): stop at the next step. Each
        // await below can come back after the host has ended the scan, and
        // carrying on put up the result and success screens, submitted, and
        // then failed into "Something went wrong" on the deleted recognizer.
        const stillRunning = () => {
          if (this.teardowns !== teardowns) {
            throw TORN_DOWN;
          }
        };

        const scanResult: SDKCore.IDScanRecognizerResult = await this.recognizer.getResults();
        stillRunning();

        if (scanResult.status === SDKCore.IDScanProcessStatus.Valid) {
          this.scanningBack = false;
          // A read that landed cancels any escalation the streak had queued up
          // -- nothing downstream will consume it now, and leaving it set
          // would name the screen for an unrelated failure later.
          this.forcedIssue = null;

          try {
            // No recording (disabled, or nothing captured) means no last upload
            // to wait for at the end.
            const recordingSaved = await this.scanner.finishRecording();
            stillRunning();

            // Semi-auto capture: settle the scan effect and hand the camera
            // back, and -- when the result screen is enabled -- show what was
            // read and wait for the user to confirm before running the success
            // transition. Uploads are kicked off after this, so nothing is
            // lost by pausing here.
            if (this.semiAutoCapture) {
              await this.reviewCapture(scanResult);
              stillRunning();
            }

            await this.successTransition(false);
            stillRunning();

            // Wait for uploads to complete before getting payload
            this.sdkManager.onUploadsComplete = () => {
              // Torn down while the uploads finished: nothing is submitted.
              if (this.teardowns !== teardowns) {
                return;
              }

              completion = (async () => {
                try {
                  const documentId = await this.handleComplete();
                  this.successEvent.emit(new DocumentIDScanResultWrapper(documentId, scanResult));
                  // Torn down and followed by another scan meanwhile: that one
                  // is not this one's to clear.
                  if (current()) {
                    this.clear();
                  }
                } catch (err) {
                  if (!current()) {
                    this.fatalError.emit(err);
                    return;
                  }

                  this.handleFatalError(err);

                  if (this.suppressHardErrorModals) {
                    return;
                  }

                  this.interError = ModalHardErrors.Unexpected;
                }
              })();
            };

            // Complete the upload process
            await this.sdkManager.checkUploadStatus(recordingSaved);
            stillRunning();
          } catch (e) {
            // Torn down: the outer catch ends it quietly.
            if (this.teardowns !== teardowns) {
              throw e;
            }

            this.handleFatalError(e);

            // The scan still ends -- done, teardown, the promise settles -- with
            // or without the modal. Returning here for suppressHardErrorModals
            // left the host's startIDScan() pending for good, with no done.
            if (!this.suppressHardErrorModals) {
              this.interError = ModalHardErrors.Unexpected;
            }
          }
        } else {
          this.failEvent.emit(scanResult.status);

          if (this.forcedIssue) {
            // A rejection streak already decided which screen this is. The
            // engine only ever saw frames it turned down, so its own verdict
            // would flatten to the generic timeout and lose that distinction.
            this.issue = this.forcedIssue;
            this.forcedIssue = null;
          } else if (scanState === SDKCore.RecognizerState.Empty) {
            this.issue = 'TIMEOUT';
          } else if (scanResult.status === SDKCore.IDScanProcessStatus.Unreadable) {
            this.issue = 'UNREADABLE';
          } else if (scanResult.status === SDKCore.IDScanProcessStatus.Unsupported) {
            this.issue = 'UNSUPPORTED';
          } else {
            this.issue = 'TIMEOUT';
          }

          this.videoFeed.pause();
        }

        this.instantTry = false;
        this.completed = true;

        successGone = this.exitingSuccessTransition(current);

        this.done.emit();
        if (scanResult.status === SDKCore.IDScanProcessStatus.Valid) {
          await sleep(2800);
        }
      } catch (e) {
        if (this.teardowns !== teardowns) {
          // Torn down mid-scan -- destroy(), close(): the host ended it, so
          // there is nothing to tell. A Live scan used to put up "unexpected
          // error" here; a Semi-auto one never got here at all. Anything that
          // came up after the teardown -- a camera, a recognizer -- goes too.
          this.clear();
        } else {
          if (!this.suppressHardErrorModals && !this.interError) {
            console.error('id-scan: startScanning: error', e);
            this.interError = ModalHardErrors.Unexpected;
          }
          reject(e);
        }
      }
      this.showVideo = false;
      this.loading = false;
      this.showMessage = false;
      this.forceShowMessage = false;
      this.scanning = false;
      this.holdStill = false;
      this.openingCamera = false;
      this.captureReady = false;
      this.captureBusy = false;
      this.captureSteadying = false;
      this.captureScanning = false;
      this.captureSettling = false;
      this.captureFrozen = false;
      this.captureAttempted = false;
      this.captureGuideShape = SDKCore.DocumentShape.Card;
      this.showCaptureIssues = false;
      this.captureIssues = null;
      this.clearAutoCapture();
      this.clearGuideProbe();
      this.clearCaptureRejected();
      this.clearCaptureIssuesTimeout();
      // The idle pause belongs to a running scan. Left armed, it fired over the
      // failure screen and resumed a scanner whose video had been paused.
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
      this.resetErrorFeedback();
      resolve();

      // Wound down once its submit (with its clear()) and its success screen
      // are over too -- or straight away once torn down: a scan started after
      // close() must not wait on a worker that is gone.
      await Promise.race([Promise.allSettled([completion, successGone]), abandoned]);
      windDown();
    });
  }

  /**
   * Toggles between scanning front only and front & back scan.
   *
   * Pass `undefined` or `null` to hand the decision back to the engine, which
   * asks for the back only when the document profile says it has one.
   */
  @Method()
  async setScanBothSides(scanBoth?: boolean | null): Promise<void> {
    this.scanBothSides = scanBoth;

    // The setting is fixed into a recognizer when it is made, so the next scan
    // needs a new one (createRecognizer swaps it). The current one stays: a
    // scan in progress still reads its results from it -- dropping it here
    // crashed that scan's capture ("Cannot read properties of null").
    if (this.recognizer) {
      this.recognizerStale = true;
    }
  }

  @Method()
  async getSdkManager(): Promise<SDKManager> {
    return Promise.resolve(this.sdkManager);
  }

  @Method()
  async setSdkManager(sdkManager: SDKManager): Promise<void> {
    this.sdkManager = sdkManager;
  }

  @Method()
  async isCompleted(): Promise<boolean> {
    return this.completed;
  }

  /**
   * Work around transition to make video smooth on iOS.
   */
  onVideoLoad(callback: { (): void } = () => null) {
    this.videoFeed.style.opacity = '0';
    this.videoFeed.style.transition = 'width 50ms';
    this.videoFeed.style.width = '100%';
    setTimeout(() => {
      this.videoFeed.style.transition = 'opacity 1s';
      this.videoFeed.style.opacity = '1';
      this.reportVideoGeometry();
      callback();
    }, 500);
  }

  /**
   * One line of preview layout geometry on the Debug UI channel, taken once
   * the feed has settled -- alongside the device/review/capture lines, and
   * like them only visible with the demo's Debug UI on.
   *
   * Kept because preview sizing can only be diagnosed on the device that
   * shows it: WebKit sizes a <video> flex item differently from Chromium, and
   * an in-app WebView (Slack, etc.) differently again, so a phone can show a
   * letterboxed or square feed that no desktop emulation reproduces. This
   * reports which box is actually off -- the viewport, the fixed .idv-video
   * host, or the <video> itself -- plus the stream's intrinsic size, the
   * computed fit, and the browser context.
   */
  private reportVideoGeometry() {
    try {
      const v = this.videoFeed;
      const t0 = performance.now();
      const r = (el: Element | null) => {
        if (!el) return '-';
        const b = el.getBoundingClientRect();
        return `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.left)},${Math.round(b.top)}`;
      };
      const o = (screen as any).orientation;
      // Safari proper carries "Safari/"; an in-app WebView (Slack etc.) does not.
      const ctx = /Safari\//.test(navigator.userAgent) ? 'safari' : 'webview';
      const post = (msg: string) => {
        const perf = new BroadcastChannel('idv-perf');
        perf.postMessage(msg);
        perf.close();
      };
      // The boxes that matter, stamped with the time since the feed was shown.
      const line = (tag: string) => {
        const cs = getComputedStyle(v);
        return (
          `[perf] video: ${tag} t=${((performance.now() - t0) / 1000).toFixed(1)}s` +
          ` host=${r(v.parentElement)} video=${r(v)} intrinsic=${v.videoWidth}x${v.videoHeight}` +
          ` css=${cs.width}/${cs.height} fit=${cs.objectFit} pos=${cs.position}`
        );
      };

      // Context once, then the feed's own sizing events as they land -- a late
      // `resize` (the stream switching to its final resolution) is what makes a
      // shrink-wrapped preview snap to full screen, so its timing is the clue.
      post(
        `[perf] video: ctx inner=${window.innerWidth}x${window.innerHeight}` +
          ` screen=${screen.width}x${screen.height} dpr=${window.devicePixelRatio}` +
          ` orient=${o?.type ?? '?'}/${o?.angle ?? '?'} ctx=${ctx}`,
      );
      post(line('shown'));
      for (const ev of ['loadedmetadata', 'resize', 'playing'] as const) {
        v.addEventListener(ev, () => post(line(`event:${ev}`)));
      }
      // And a fixed cadence, so a phase with no events still shows its shape.
      for (const ms of [2000, 4000, 7000, 10000]) {
        setTimeout(() => post(line(`t+${ms / 1000}s`)), ms);
      }
    } catch (_) {
      /* diagnostics only */
    }
  }

  /**
   * Whenever the process is started.
   */
  onStart() {
    this.openingCamera = false;

    // The video plays again whenever the browser resumes it -- back from
    // another app or tab -- and every play lands here. Only the scan's first
    // sets the capture screen up. Redoing it later, mid-scan, put "Scan front
    // of ID" up while the back was being asked for, and the shutter back over
    // whatever was showing.
    if (this.feedStarted) {
      return;
    }
    this.feedStarted = true;

    if (this.semiAutoCapture) {
      // No frames are being processed until the user presses capture, so the
      // scanning affordances stay off and the shutter comes up instead. The
      // inactivity pause timeout is skipped too: in Semi-auto mode "no engine
      // activity" is the normal resting state, not a stall.
      this.onVideoLoad(() => {
        this.captureReady = true;
        // Which side is being asked for, in the banner above the frame. The
        // flip already puts "back of ID" up the same way; the front had been
        // going without, so the only statement of which side to present was
        // the line above the shutter -- which is now gone.
        this.message = this.translation._t('id-scan-front-of-id').toString();
        this.showMessage = true;
        // Both clocks start when the user can actually see the feed, not when
        // the camera was asked for.
        this.startAutoCapture();
        this.scheduleGuideProbe();
        // Begin the 1s good-location probe.
        this.startLocationProbe();
      });
      return;
    }

    // The idle-pause clock is not started here: startScanning() arms it before
    // the scanner starts its own 60 s clock. Armed on this `play`, it ran
    // behind the scanner's and lost the race -- an idle minute ended in
    // "Capture failed!" instead of the pause screen.
    this.onVideoLoad(() => {
      this.loading = true;
      this.showMessage = true;
    });
  }

  // #region Semi-auto capture
  /**
   * Submits the current frame to the engine and reflects the outcome.
   *
   * Feedback for the frame arrives through the usual onDetection callback, so
   * the existing feedback UI keeps working unchanged; this only owns the
   * button's own busy/ready state.
   *
   * @param silent submit without the capture flash. The probe chain uses this:
   * once the detector has failed twice it sends a frame anyway, purely so the
   * engine can say what is wrong. Nobody asked for that frame, so it makes no
   * flash whether the engine rejects it (the user reframes) or accepts it (the
   * success screen simply appears). Only a press the user made -- the shutter,
   * or the idle countdown they watched run down -- flashes.
   *
   * @param lastAttempt this press is the idle countdown's automatic one, the
   * scan's final chance. A rejection does not hand the shutter back for
   * another round -- it ends the scan the way a Live scan ends when its clock
   * runs out: `scanner.endScan()` resolves `start()`, and the existing
   * failure flow takes over (timeout screen, `failEvent`, `done`, try-again).
   */
  /**
   * A press of the shutter by the user.
   *
   * Marks the button busy immediately -- the press must feel instant, and a
   * second press during the hold has to be refused -- then lets the phone
   * settle before handing the frame to the engine. See CAPTURE_STEADY_MS.
   *
   * The feed is deliberately left running through the hold: freezing happens
   * inside handleCapture(), so what gets frozen is the settled frame rather
   * than the shaky one from the moment of the press.
   */
  private handleUserCapture = async (): Promise<void> => {
    if (this.captureSteadying) {
      return;
    }

    this.captureSteadying = true;

    try {
      await sleep(CAPTURE_STEADY_MS);
    } finally {
      this.captureSteadying = false;
    }

    // The scan can end during the hold -- a timeout, the user backing out, the
    // camera closing. Any of those tears the shutter down, and the frame is no
    // longer wanted.
    if (!this.scanner || !this.captureReady) {
      return;
    }

    await this.handleCapture();
  };

  async handleCapture(silent: boolean = false, lastAttempt: boolean = false): Promise<void> {
    if (!this.scanner || this.captureBusy) {
      // The button does not look busy during the silent probe's read, so a
      // real press can land mid-read. Hold it and honour it once the probe
      // resolves, rather than dropping it on the floor.
      if (!silent && this.silentCapture) {
        this.pendingUserCapture = true;
      }
      return;
    }

    this.captureBusy = true;
    // Whether this came from the user or from the countdown firing, the frame
    // is going in now and nothing further should be scheduled against it.
    //
    // The silent probe is the exception: it must be invisible to the idle
    // countdown, which is running from camera-open and is meant to land at
    // ten seconds. Clearing it here (and re-arming it on rejection below)
    // would reset that clock to zero on the ~9s probe, pushing the countdown
    // out to ~19s. So leave the idle timer untouched for a silent capture.
    if (!silent) {
      this.clearAutoCapture();
    }
    // The recording is evidence of the user framing the document, and that ends
    // the instant they commit to a frame. Everything after this point is the
    // engine working and a frozen preview, which is worth nothing on video.
    this.scanner.pauseRecording();

    // A silent probe capture leaves the screen exactly as it was -- the guide,
    // whatever prompt is showing, all of it -- so it does not touch the
    // feedback banner at all. A real capture clears the previous message,
    // since onDetection republishes it for this frame.
    if (!silent) {
      // Drop any pending auto-hide too, so it cannot fire partway through the
      // next message's two seconds.
      this.clearSemiAutoFeedbackHide();
      this.showMessage = false;
      // And the last message's 1.5 s hold, which is there to stop a live
      // stream's frames talking over each other. A press made inside it had
      // its own message dropped -- with the banner already taken down above,
      // the user was told nothing.
      this.feedbackPlaying = false;
    }

    // Freeze on the captured frame while the engine reads it. Pausing the feed
    // is instant and costs nothing -- the alternative, snapshotting a UHD frame
    // to an image, would stall the main thread at exactly the wrong moment.
    if (!silent) {
      this.freezeFrame();
    }

    let accepted = false;
    // The countdown's press came back rejected and the scan was ended as a
    // timeout. The failure flow owns the screen from that moment, so the
    // cleanup below must not touch anything.
    let timedOut = false;
    // Guards the feedback banner across the engine read. onDetection fires
    // during capture(), before it resolves, so the flag has to be up now and
    // is cleared once the read is done.
    this.silentCapture = silent;
    const detectionsBefore = this.detections;

    try {
      const state = await this.scanner.capture();

      if (state === SDKCore.RecognizerState.Valid) {
        // A silent submission the engine accepted still must not flash -- but
        // the live feed has to be held so it does not show through while the
        // success screen comes up. The still, without the scan effect. The
        // success path already copes with there being no effect to settle.
        if (silent) {
          this.freezeStill();
        }
        // start() is resolving; hide the shutter and let the success path run.
        // The feed stays frozen on the accepted frame, and the scan effect
        // keeps playing until reviewCapture() settles it into the result
        // screen -- recording finalisation happens in between, and the effect
        // covers that wait too.
        this.stashCapturedFrame();
        accepted = true;
        this.captureReady = false;
        this.captureRejections = 0;
        this.hasAcceptedCapture = true;
        return;
      }

      // The engine reports the front side of a two-sided document as
      // Incomplete, not Valid -- the scan is not finished, but this frame was
      // not rejected either. onFirstScanSemiAuto() owns the screen from here,
      // so the frame stays frozen and nothing is re-armed behind it.
      if (this.awaitingBackSide) {
        this.stashCapturedFrame();
        accepted = true;
        this.captureReady = false;
        this.captureRejections = 0;
        this.hasAcceptedCapture = true;
        return;
      }

      // The engine could not download a file this read needed, so nothing was
      // read: not a rejection. No corner flash, nothing towards the give-up
      // screens, and the countdown's last attempt does not end the scan over a
      // connection problem. Say so; the shutter is live again below.
      if (state === SDKCore.RecognizerState.DataUnavailable) {
        if (!silent) {
          this.showConnectionProblem();
        }
        return;
      }

      // The scan's final chance was this frame and the engine rejected it.
      // This is SemiAuto's version of the Live clock running out, so it ends
      // the same way: endScan() resolves scanner.start() with this frame's
      // state, startScanning()'s failure branch maps it to the timeout /
      // unreadable / unsupported screen, pauses the feed, and emits failEvent
      // and done. The frame stays frozen underneath -- the failure screen is
      // about to cover it, and resuming the feed first would flash live video
      // in between, exactly as on the success path.
      if (lastAttempt) {
        timedOut = true;
        this.captureReady = false;
        this.captureRejections += 1;
        // A rejection is a rejection whoever pressed the button, so it counts
        // -- and where the streak has run its course it says more than "the
        // clock ran out". Null where it has not, which leaves the ordinary
        // timeout mapping in place.
        this.forcedIssue = this.rejectionEscalation();
        this.scanner.endScan(state);
        return;
      }

      // Only a frame the user chose to submit counts as an attempt. The silent
      // probe's rejected frame must not flip this, or captureHint() starts
      // reading "Adjust your ID and capture again" over the untouched screen a
      // second before the countdown -- exactly the text change being chased.
      //
      // The rejection streak is counted on the same terms and for the same
      // reason: a frame nobody asked for must not push the user towards the
      // unreadable screen.
      if (!silent) {
        this.captureAttempted = true;
      }

      // A retake from the review screen arrives here looking exactly like a
      // rejection, but the engine was happy with that frame -- so it neither
      // blinks the guide nor counts against the user.
      if (!silent && !this.captureRetakeRequested) {
        this.captureRejections += 1;
        this.flagCaptureRejected();

        // Enough rejections in a row that repeating the same advice has
        // stopped being useful. Ends the scan the way the countdown's last
        // attempt does -- endScan() resolves start(), the frame stays frozen
        // under the screen that comes up -- but names its own screen.
        const escalation = this.rejectionEscalation();

        if (escalation) {
          timedOut = true;
          this.forcedIssue = escalation;
          this.captureReady = false;
          this.scanner.endScan(state);
          return;
        }

        // The press cleared the banner for this frame's detection to fill
        // (contract: one per rejected press). 6.0 sends none for a frame with
        // no document in it, which left the screen without a word: say what
        // an Empty detection would.
        if (this.detections === detectionsBefore) {
          this.onDetection(SDKCore.IDScanDetectionStatus.Empty);
        }
      }

      // The frame was rejected. Ask the engine what it saw so the guide can be
      // drawn at the right proportions; it stays Unknown, and so hidden, if
      // nothing was detected at all.
      await this.resolveCaptureGuide();
    } catch (e) {
      console.error('id-scan: handleCapture: error', e);
      if (!silent) {
        this.captureAttempted = true;
      }
    } finally {
      this.captureBusy = false;
      this.silentCapture = false;
      // Read above and good for this capture only; a two-sided front side
      // takes the awaitingBackSide branch without ever looking at it, so
      // clearing here is what keeps it from leaking into a later rejection.
      this.captureRetakeRequested = false;
      // Rejected only: drop the effect and hand the live view back so the user
      // can reframe. An accepted capture must stay frozen on its frame -- the
      // effect keeps playing until reviewCapture() settles into the result
      // screen, and resuming the feed here would flash live video in between.
      // A timed-out scan stays frozen too: the failure screen is coming up
      // over this frame.
      if (!accepted && !timedOut && this.captureScanning) {
        this.unfreezeFrame();
      }

      // Rejected: the shutter is live again, so give the user another full
      // idle period before taking the next frame for them -- and the session
      // carries on, so the recording resumes into the same file rather than
      // ending at a capture that was never accepted.
      //
      // Not for a silent probe: its idle timer was never cleared above, so it
      // is still running from camera-open. Re-arming here would reset it and
      // the countdown would slip past ten seconds.
      //
      // Not after a timeout either: the scan is over. endScan() paused the
      // recorder the way Live's timeout does, and the try-again flow starts a
      // fresh scan with fresh clocks.
      if (!accepted && !timedOut && !silent) {
        this.startAutoCapture();
      }
      if (!accepted && !timedOut) {
        this.scanner?.startRecording();
      }

      // A user press that landed while the silent probe held the engine.
      // Replay it now that the read is over -- unless the probe's own frame
      // was accepted, in which case the success path owns the screen and the
      // press has nothing left to act on.
      if (silent && this.pendingUserCapture) {
        this.pendingUserCapture = false;
        if (!accepted) {
          setTimeout(() => this.handleCapture(), 0);
        }
      }
    }
  }

  /** A side's accepted still, as stashed once it was accepted (the asset list). */
  private downloadCapturedFrame(side: DocumentSide = 'front'): Promise<void> {
    return this.downloadFrame(this.capturedFrames[side], side);
  }

  /**
   * The review screen's "Download original frame": the still being reviewed.
   * The review runs before an accepted still is stashed under its side, so the
   * stash would offer nothing on a first capture -- and the front on a back.
   */
  private downloadReviewedFrame(): Promise<void> {
    const side: DocumentSide = this.scanningBack ? 'back' : 'front';
    return this.downloadFrame(this.scanner?.currentImage ?? this.capturedFrames[side], side);
  }

  /**
   * Saves a frame that was actually submitted to the engine.
   *
   * This is the untouched camera frame, not the cropped document -- it is what
   * a failing capture needs to be reproduced offline. Encoding happens here
   * rather than at capture time so a UHD frame is only paid for if asked for.
   */
  private async downloadFrame(frame: ImageData | null | undefined, side: DocumentSide): Promise<void> {
    if (!frame) {
      console.warn(`id-scan: no captured ${side} frame to download`);
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      canvas.getContext('2d')?.putImageData(frame, 0, 0);

      const blob: Blob | null = await new Promise(resolve =>
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.95),
      );

      if (!blob) {
        console.warn('id-scan: could not encode captured frame');
        return;
      }

      this.saveBlob(blob, `idv-${side}-original-${frame.width}x${frame.height}-${Date.now()}.jpg`);
    } catch (e) {
      console.error('id-scan: downloadFrame: error', e);
    }
  }

  /**
   * Keeps the frame that was just accepted, under the side it belongs to.
   *
   * `scanner.currentImage` is only ever the most recent frame, so after a
   * front-then-back scan it holds the back and the front is unrecoverable.
   * Copied rather than referenced, because the scanner overwrites it in place
   * on the next capture.
   */
  private stashCapturedFrame(): void {
    const frame = this.scanner?.currentImage;
    if (!frame) {
      return;
    }

    this.capturedFrames[this.scanningBack ? 'back' : 'front'] = new ImageData(
      new Uint8ClampedArray(frame.data),
      frame.width,
      frame.height,
    );
  }

  /**
   * The rectified document images, which live in the engine rather than here.
   */
  private async loadCrops(): Promise<void> {
    try {
      this.capturedCrops = (await this.recognizer?.getCrops()) ?? {};
    } catch (e) {
      console.error('id-scan: loadCrops: error', e);
      this.capturedCrops = {};
    }
  }

  /**
   * Everything this scan produced that can be saved, in capture order.
   *
   * Built fresh each render so a side that never captured simply has no
   * entries, rather than a dead link.
   */
  private captureAssets(): CaptureAsset[] {
    const assets: CaptureAsset[] = [];
    const t = (key: string) => this.translation._t(key).toString();

    for (const side of ['front', 'back'] as DocumentSide[]) {
      if (this.capturedFrames[side]) {
        assets.push({ id: `original-${side}`, label: t(`id-scan-asset-original-${side}`) });
      }
      if (this.capturedCrops[side]) {
        assets.push({ id: `crop-${side}`, label: t(`id-scan-asset-crop-${side}`) });
      }
    }

    if (this.captureResult) {
      assets.push({ id: 'result-json', label: t('id-scan-asset-result') });
    }

    if (this.scanner?.lastRecording && this.scanner.lastRecording.bytes > 0) {
      assets.push({ id: 'video', label: t('id-scan-asset-video') });
    }

    return assets;
  }

  /** Routes an asset id from the review screen to whatever produces it. */
  private downloadAsset(id: string): void {
    if (id === 'video') {
      this.downloadSessionVideo();
      return;
    }

    if (id === 'result-json') {
      this.downloadResultJson();
      return;
    }

    const [kind, side] = id.split('-') as ['original' | 'crop', DocumentSide];

    if (kind === 'original') {
      this.downloadCapturedFrame(side);
      return;
    }

    this.downloadCrop(side);
  }

  /**
   * Saves what the engine read, as JSON.
   *
   * The whole result rather than the rows on screen: the review screen lists
   * only fields that came back with a value, and a field that read as empty is
   * usually the thing worth looking at afterwards.
   */
  private downloadResultJson(): void {
    if (!this.captureResult) {
      console.warn('id-scan: no result to download');
      return;
    }

    try {
      const json = JSON.stringify(this.captureResult, null, 2);
      this.saveBlob(
        new Blob([json], { type: 'application/json' }),
        `idv-result-${Date.now()}.json`,
      );
    } catch (e) {
      console.error('id-scan: downloadResultJson: error', e);
    }
  }

  /** Saves the engine's rectified image for one side. */
  private downloadCrop(side: DocumentSide): void {
    const base64 = this.capturedCrops[side];

    if (!base64) {
      console.warn(`id-scan: no ${side} crop to download`);
      return;
    }

    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      this.saveBlob(
        new Blob([bytes], { type: 'image/jpeg' }),
        `idv-${side}-crop-${Date.now()}.jpg`,
      );
    } catch (e) {
      console.error('id-scan: downloadCrop: error', e);
    }
  }

  /** The one place that actually puts a file in front of the user. */
  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    // Must be in the document for the click to count as user-initiated in
    // some browsers; the shadow root is not a document position.
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Give the browser a moment to start the transfer before the blob goes.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /**
   * Saves the session recording -- the video of the capture itself.
   *
   * Only available once the scan has finished, because that is when the
   * encoder is flushed and the file exists; before then there is a recording
   * in progress and no bytes to hand over.
   *
   * The extension comes from the recorder's negotiated MIME type rather than
   * being assumed: this is .mp4 on Safari, .webm on Firefox, and .avi when it
   * fell back to the Motion-JPEG timelapse.
   */
  private downloadSessionVideo(): void {
    const recording = this.scanner?.lastRecording;

    if (!recording || recording.bytes === 0) {
      console.warn('id-scan: no session recording to download');
      return;
    }

    const extensions: { [key: string]: string } = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/x-msvideo': 'avi',
    };
    const base = (recording.mimeType || '').split(';')[0];
    const extension = extensions[base] || 'bin';

    try {
      this.saveBlob(
        recording.blob,
        `idv-session-${recording.width}x${recording.height}-` +
          `${recording.frames}f-${Date.now()}.${extension}`,
      );
    } catch (e) {
      console.error('id-scan: downloadSessionVideo: error', e);
    }
  }

  /**
   * Asks the engine which fields the accepted capture struggled with and, if
   * there are any, shows them for the user to judge.
   *
   * @returns true to keep the capture, false to go back and take another.
   */
  private async reviewCaptureIssues(): Promise<boolean> {
    let issues: SDKCore.IDScanFieldIssues = null;

    try {
      issues = await this.recognizer?.getFieldIssues();
    } catch (e) {
      // Never block a capture the engine was happy with over a failed report.
      console.error('id-scan: reviewCaptureIssues: error', e);
    }

    // The review's verdict, on the perf channel the Debug UI mirrors -- so an
    // on-device session shows what the engine decided even when no screen
    // follows. "none" is an accepted capture with nothing worth reviewing.
    try {
      const perf = new BroadcastChannel('idv-perf');
      const what = issues?.fields?.length
        ? issues.fields
            .map(f => `${f.name}:${f.quality ?? (f.missing ? 'missing' : 'unclear')}`)
            .join(', ')
        : 'none';
      perf.postMessage(`[perf] review: ${what}${issues?.side ? ` (side=${issues.side})` : ''}`);
      perf.close();
    } catch (e) {
      /* no channel, no line */
    }

    if (!issues) {
      return true;
    }

    // A capture in the collapsed "Your ID is not clear." state -- more weak
    // text fields than the list would even show -- is never accepted on the
    // user's behalf: not by the showings cap below and not by the screen's
    // timeout. Continuing would submit a capture the screen itself calls
    // unusable, so the only ways forward are the user's own buttons.
    //
    // The FRONT, that is. The back is different: it exists to supplement a
    // front the user already captured, and a back that reads badly five times
    // in a row is not going to read on the sixth -- trapping the user in a
    // retake loop loses the whole scan over the lesser side. So the back gets
    // a hard cap: after four showings (five failed attempts), it is accepted
    // as-is and the scan moves on, unclear or not.
    const unclearDocument = isUnclearDocument(issues);
    if (issues.side === 'back' && this.captureReviewShows >= 4) {
      return true;
    }

    // A back side whose profile declares a PDF417 that did not decode. The
    // barcode is the reason this side is captured, so the user is asked to
    // retake it -- twice -- rather than being offered a "Continue anyway" they
    // might take on the first look. After those two asks, the showings cap
    // below carries them through automatically: a barcode that will not read
    // after two more tries is not going to, and looping forever is worse.
    const barcodeMissing =
      issues.side === 'back' &&
      !!issues.expectsPDF417 &&
      (issues.fields ?? []).some(f => isBarcodeField(f) && f.missing);

    // Two showings per side is the cap. The user has already retaken twice;
    // asking a third time just loops them, so the capture proceeds on its own
    // -- carrying the stitched best fields of all the attempts. Only the
    // unclear-document state is exempt: it is never auto-accepted. A
    // barcode-missing back IS auto-accepted here, by design -- it just gets no
    // "Continue anyway" button in the meantime (below).
    if (this.captureReviewShows >= 2 && !unclearDocument) {
      return true;
    }
    this.captureReviewShows += 1;

    // "Continue anyway" appears from the second showing on -- the first is a
    // straight ask for a retake -- but never for a barcode-missing back: those
    // two showings are retake-only, and the auto-continue above is the only
    // way past them.
    this.captureIssuesShowProceed = this.captureReviewShows >= 2 && !barcodeMissing;

    // The review screen shows the engine's own rectified crop (from `issues`),
    // the exact image the field rectangles are fractions of. We used to re-cut
    // a sharper crop from the raw frame through the document quad, but that
    // warp drifted from the engine's crop and the highlights missed.

    // Settle the scan effect first, exactly as the result screen does, so the
    // white bloom is solid before this panel fades in over it.
    const teardowns = this.teardowns;
    const settled = await this.settleScanEffect();

    // Torn down meanwhile: clear() found no answer to give yet, so the panel
    // would come up now over a closed scan and wait for good. Proceed, as
    // clear() answers a panel that is up.
    if (this.teardowns !== teardowns) {
      return true;
    }

    this.captureIssues = issues;
    this.showCaptureIssues = true;

    // Retake and Continue anyway are live from the moment the panel shows, not
    // once its entrance below has finished: a tap in that first ~half second
    // used to find no handler and do nothing, leaving the user on the panel.
    // The answer is still only acted on after the entrance.
    const decision = new Promise<boolean>(resolve => {
      this.captureIssuesDecision = choice => {
        this.clearCaptureIssuesTimeout();
        this.captureIssuesDecision = null;
        resolve(choice);
      };
    });

    // Nothing on this screen belongs in the session recording: the camera is
    // pointed wherever the user set it down while they read. The recording is
    // a pause rather than a finalisation, so whichever button they press
    // picks it up again in the same file.
    this.scanner?.pauseRecording();

    // Armed from the moment the screen is up, not from when the promise below
    // exists -- the entrance choreography sits in between. The idle clock only
    // runs once the user actually has a "Continue anyway" button to take, i.e.
    // from the second showing on; firing it answers the screen with "proceed",
    // and there is nothing to auto-take while the only offered action is Retake.
    // See shouldArmIssuesTimeout for exactly which showings arm it. Otherwise it
    // is cleared, which also kills any stale timeout from an earlier showing.
    if (this.shouldArmIssuesTimeout(unclearDocument)) {
      this.armCaptureIssuesTimeout();
    } else {
      this.clearCaptureIssuesTimeout();
    }

    // Only drop the effect once this panel is opaque -- dropping it in the
    // same frame the entrance starts flashes the frozen capture in between.
    if (settled) {
      await this.dropScanEffect();
    }

    const proceed = await decision;

    // Both answers put the user back in front of a live camera -- retaking, or
    // carrying on to the back side -- so the recording resumes for either. On
    // the very last capture the scan stops moments later and pauses it again,
    // which costs nothing.
    this.scanner?.startRecording();

    if (!proceed) {
      // Tells handleCapture() that the Incomplete it is about to see is this,
      // not a frame the engine turned down.
      this.captureRetakeRequested = true;

      // Back to the live view for another attempt. The scan effect is already
      // gone, so drop the frozen frame with the panel and the shutter returns.
      this.showCaptureIssues = false;
      this.captureIssues = null;
      this.captureAttempted = true;
      this.captureFrozen = false;
      this.captureReady = true;
      // The press took the banner down, and nothing put it back: the user
      // returned to a camera with no word of which side to show. Back with
      // the shutter, as onStart() puts it up when the camera opens.
      this.message = this.translation
        ._t(this.scanningBack ? 'id-scan-back-of-id' : 'id-scan-front-of-id')
        .toString();
      this.showMessage = true;
      await this.resolveCaptureGuide();
    }

    // On proceed the panel deliberately stays up: the result screen fades in
    // over it, and clearing it here would flash the frozen capture in between.
    // reviewCapture() drops it once the result is opaque.
    return proceed;
  }

  /**
   * Waits for the wave to finish the pass it is in the middle of.
   *
   * The wave loops every CAPTURE_WAVE_CYCLE_MS from the moment the frame
   * froze, so where it is now is just the elapsed time modulo the cycle. Waits
   * out whatever is left, so the light always leaves the top of the frame
   * before the next screen comes over it.
   *
   * Only accepted captures wait: a rejected frame needs the live view back at
   * once so the user can reframe, and a scan that has already been stood down
   * has nothing to wait for.
   */
  private async awaitWaveCycle(): Promise<void> {
    if (!this.captureScanning || !this.captureScanStart) {
      return;
    }

    // Motion-sensitive users get no wave at all (the layer is display:none in
    // the reduced-motion block), so there is nothing to wait for -- waiting
    // would just be a stall on a still overlay.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const phase = (performance.now() - this.captureScanStart) % CAPTURE_WAVE_CYCLE_MS;
    const remaining = CAPTURE_WAVE_CYCLE_MS - phase;

    // A pass that just ended leaves a full cycle "remaining"; that is a fresh
    // wave, not an unfinished one, so let it go.
    if (remaining <= 0 || remaining >= CAPTURE_WAVE_CYCLE_MS) {
      return;
    }

    await sleep(remaining);
  }

  /**
   * Runs the scan effect out to its solid white bloom.
   *
   * The bloom is what the next full-screen panel fades in over -- without it
   * the panel's transparent first frames show the frozen capture underneath.
   *
   * @returns whether there was an effect to settle, so the caller knows if it
   * needs to drop the layer afterwards.
   */
  private async settleScanEffect(): Promise<boolean> {
    if (!this.captureScanning) {
      return false;
    }

    // Let the wave finish its run to the top first. The engine typically
    // answers mid-pass, and settling on top of that snuffed the light out
    // halfway up the frame.
    await this.awaitWaveCycle();

    this.captureSettling = true;
    await sleep(440); // the bloom is 420ms; let it reach solid white
    return true;
  }

  /**
   * Removes the settled scan effect, once whatever fades in over it is opaque.
   */
  private async dropScanEffect(): Promise<void> {
    await sleep(450);
    this.captureScanning = false;
    this.captureSettling = false;
  }

  /**
   * Closes out an accepted capture: settles the scan effect, hands the camera
   * back, and -- when the result screen is enabled -- shows what was read and
   * waits for the user to acknowledge it.
   *
   * With the result screen off this still runs: the effect has to be settled
   * and the camera released either way, and the success screen that follows
   * takes the place of the result panel as the thing that comes up over the
   * bloom.
   */
  private async reviewCapture(result: SDKCore.IDScanRecognizerResult): Promise<void> {
    const teardowns = this.teardowns;
    this.captureReady = false;

    // Settle the scan effect: waves fade and the white bloom rises to full.
    const settled = await this.settleScanEffect();

    if (!this.showResultScreen) {
      // The issues panel has to go first: it sits above the success screen
      // that follows, so leaving it up for the next screen to fade over --
      // which is what the result screen does -- would bury that screen
      // underneath it instead.
      if (this.showCaptureIssues) {
        this.showCaptureIssues = false;
        this.captureIssues = null;
        await sleep(450);
      }

      // The bloom and the frozen frame both stay up: with no result panel they
      // are what covers the released camera until the success screen arrives,
      // and startScanning()'s own teardown clears them. Dropping them here
      // would show half a second of dead video in between.
      setTimeout(() => this.scanner?.closeCamera(), RESULT_CAMERA_CLOSE_MS);
      return;
    }

    // The rectified images live in the engine and are read once, here, rather
    // than per click: the scan is over, so they are final.
    await this.loadCrops();

    // Torn down meanwhile: clear() found no Done to answer yet, so the screen
    // would come up now over a closed scan and wait for good.
    if (this.teardowns !== teardowns) {
      return;
    }

    // The (white) result screen fades in OVER the white bloom, so its
    // transparent first frames show white underneath, not the frozen frame.
    this.captureResult = result;
    this.showCaptureResult = true;

    // Done is live from the moment the panel shows, not once its entrance below
    // has finished: a tap in that first ~half second used to find no handler
    // and do nothing, and a clear() then left this awaiting forever. The panel
    // still only goes once the entrance is over.
    const acknowledged = new Promise<void>(resolve => {
      this.captureResultAck = () => {
        this.captureResultAck = null;
        resolve();
      };
    });

    // The result panel is opaque and full-screen, so the frozen capture behind
    // it has nothing left to do -- drop it now rather than carrying it through
    // this screen and the success transition. The frames themselves are
    // untouched: the asset list reads its own copies, not this canvas.
    this.captureFrozen = false;

    // The result is up and the camera has nothing left to show, so hand it
    // back: the recording light goes out and the hardware is free while the
    // user reads their details.
    //
    // Detached rather than awaited, so the entrance choreography below keeps
    // its timings -- the effect still drops 450ms after the result screen
    // starts fading in, not 650ms. Nothing of the feed is seen going dark:
    // the result panel above is opaque and full-screen.
    setTimeout(() => this.scanner?.closeCamera(), RESULT_CAMERA_CLOSE_MS);

    // Only once the entrance has finished and the result is opaque can the
    // effect be dropped -- doing it in the same frame the entrance starts was
    // a visible glitch: the bloom vanished while the result was still
    // transparent, flashing the frozen frame in between.
    if (settled) {
      await this.dropScanEffect();
    }

    // The issues panel, if the user came through one, is underneath the result
    // screen and safe to drop now that the result has finished fading in.
    if (this.showCaptureIssues) {
      await sleep(450);
      this.showCaptureIssues = false;
      this.captureIssues = null;
    }

    await acknowledged;
    this.showCaptureResult = false;
  }

  /**
   * Hint shown above the shutter, reflecting where the user is in the flow.
   */
  private captureHint(): string {
    // A silent probe read is nobody's capture: flipping the hint to
    // "Checking your capture…" for the second the engine holds the frame
    // makes the text glitch and snap back on an untouched screen.
    if (this.captureBusy && !this.silentCapture) {
      return this.translation._t('id-scan-capture-processing') as string;
    }

    if (this.captureAttempted) {
      return this.translation._t('id-scan-capture-retry') as string;
    }

    return this.translation._t(
      this.scanningBack ? 'id-scan-capture-hint-back' : 'id-scan-capture-hint-front',
    ) as string;
  }

  // #region On Detection
  /**
   * Handles detection status.
   *
   * @param status ID Scan detection status.
   */
  onDetection(status: SDKCore.IDScanDetectionStatus) {
    // Anything but an empty frame is evidence a document is present, and the
    // idle countdown is gated on that. Recorded before the silent-capture
    // guard on purpose: the flag renders nothing, and the silent probe's read
    // is precisely how an ill-framed document gets seen at all.
    if (status !== SDKCore.IDScanDetectionStatus.Empty) {
      this.documentSeen = true;
    }

    // A probe-driven capture reads a frame the user did not ask for. If the
    // engine accepts it the success path takes over regardless; if it rejects
    // it, the rejection is the chain's business, not something to narrate to
    // the user with a "adjust your document" banner over an empty frame.
    if (this.silentCapture) {
      return;
    }
    this.detections += 1;

    if (status !== SDKCore.IDScanDetectionStatus.Empty) {
      this.elementWasFound = true;

      if (status !== SDKCore.IDScanDetectionStatus.TooManyIssues) {
        this.latestStatus = status;
      }
    }

    if (status !== SDKCore.IDScanDetectionStatus.Incomplete && this.scanning) {
      this.scanning = false;
    }

    const scanMessage = this.translation._t(
      this.scanningBack ? 'id-scan-back-of-id' : 'id-scan-front-of-id',
    ) as string;

    switch (status) {
      case SDKCore.IDScanDetectionStatus.Empty:
        {
          this.resetErrorFeedback();
          this.forceShowMessage = true;
          this.holdStill = false;
          this.loading = false;
          this.scanning = false;
          this.message = scanMessage;
          this.showFeedback(scanMessage, null, true);
        }
        break;
      case SDKCore.IDScanDetectionStatus.TooManyIssues:
        this.handleTooManyIssues();
        break;
      case SDKCore.IDScanDetectionStatus.Unrecognizable:
        // The document was well framed but the engine could not read it. This
        // is the one case that earns "Adjust the ID and try again" -- shown as
        // a real complaint (uncertain) so it takes over the top pill, rather
        // than the idle "Front/Back of ID" caption. A framing problem never
        // reaches here; it carries its own move-closer/off-centre message.
        //
        // Semi-auto only: it answers a deliberate press. In Live the stream
        // keeps trying on its own, so the same status must not surface this
        // message -- the scan just carries on. The engine emits Unrecognizable
        // in both modes, so the guard lives here.
        this.scanning = true;
        if (this.semiAutoCapture) {
          this.showFeedback(this.translation._t('id-scan-capture-retry').toString(), null, false);
        }
        break;
      case SDKCore.IDScanDetectionStatus.Incomplete:
        this.scanning = true;
        if (this.uncertain) {
          this.loading = true;
          this.forceShowMessage = true;
          this.showFeedback(scanMessage, null, true);
        }
        break;
      // Both of these narrate a stream being worked on, which is a Live idea.
      // The engine emits them in either mode, so the guard has to be here: in
      // Semi-auto the banner states which side is wanted and must keep saying
      // so, while the shutter and the scan effect show that a frame is being
      // processed. Without this, pressing capture over an empty frame flips
      // "Scan front of ID" to "Capturing document...".
      case SDKCore.IDScanDetectionStatus.Capturing:
        {
          this.resetErrorFeedback();
          this.scanning = true;
          this.holdStill = true;
          this.loading = true;
          this.forceShowMessage = true;
          this.uncertain = false;
          if (!this.semiAutoCapture) {
            this.message = this.translation._t('id-scan-capturing').toString();
          }
        }
        break;
      case SDKCore.IDScanDetectionStatus.Extracting:
        {
          this.resetErrorFeedback();
          this.scanning = true;
          this.holdStill = true;
          this.loading = true;
          this.forceShowMessage = true;
          this.uncertain = false;
          if (!this.semiAutoCapture) {
            this.message = this.translation._t('id-scan-extracting').toString();
          }
        }
        break;
      case SDKCore.IDScanDetectionStatus.DocumentFarLeft:
        this.showFeedback(
          this.translation._t('id-scan-move-in-frame').toString(),
          () => (this.left = true),
        );
        break;
      case SDKCore.IDScanDetectionStatus.DocumentFarRight:
        this.showFeedback(
          this.translation._t('id-scan-move-in-frame').toString(),
          () => (this.right = true),
        );
        break;
      case SDKCore.IDScanDetectionStatus.DocumentTooFar:
        this.showFeedback(
          this.translation._t('id-scan-move-closer').toString(),
          () => (this.closer = true),
        );
        break;
      case SDKCore.IDScanDetectionStatus.DocumentTooNear:
        this.showFeedback(
          this.translation._t('id-scan-move-farther').toString(),
          () => (this.further = true),
        );
        break;
      case SDKCore.IDScanDetectionStatus.DocumentHasGlare:
      case SDKCore.IDScanDetectionStatus.DocumentIsBlurry:
        this.holdStill = false;
        if (this.semiAutoCapture) {
          // A press that was too glared or blurred to read. Semi-auto does not
          // coach (no glare/blur animation): one plain line, like the
          // unreadable press above. Only the 6.0 engine reports these on a
          // press; 5.2 never does.
          this.showFeedback(this.translation._t('id-scan-capture-unclear').toString(), null, false);
        } else if (status === SDKCore.IDScanDetectionStatus.DocumentHasGlare) {
          this.showFeedback(
            this.translation._t('id-scan-reduce-glare').toString(),
            () => (this.glare = true),
          );
        } else {
          this.showFeedback(
            this.translation._t('id-scan-fix-blur').toString(),
            () => (this.blur = true),
          );
        }
        break;
    }
  }

  /**
   * Shows the loading bar animation.
   */
  successTransition(backSide: boolean) {
    return new Promise(async (resolve: any) => {
      this.resetErrorFeedback();
      this.forceShowMessage = true;
      this.showMessage = true;

      this.showSuccessAnimation = true;

      if (backSide) {
        this.playSound('SuccessSound', true);
        await sleep(3000);
        this.showSuccessAnimation = false;
      } else {
        const SLIGHT_FORCED_DELAY_WHEN_CAPTURE_IS_SO_FAST_IN_MS = 500;
        this.success = true;
        this.playSound('SuccessSound', true);
        await sleep(SLIGHT_FORCED_DELAY_WHEN_CAPTURE_IS_SO_FAST_IN_MS);
      }

      this.message = this.translation
        ._t(backSide ? 'id-scan-back-of-id' : 'id-scan-front-of-id')
        .toString();

      this.loadingBar = false;
      this.holdStill = false;
      this.loading = false;
      this.forceShowMessage = false;

      resolve();
    });
  }

  /**
   * Takes the success screen down after its hold; settles once it has.
   *
   * @param isCurrent Whether the scan it belongs to is still the running one;
   *   a scan started since (after a teardown) has its own screen.
   */
  exitingSuccessTransition(isCurrent: () => boolean = () => true): Promise<void> {
    if (!this.success) {
      return Promise.resolve();
    }

    return new Promise(resolve =>
      setTimeout(() => {
        if (isCurrent()) {
          this.success = false;
          this.showSuccessAnimation = false;
          this.started = false;
        }
        resolve();
      }, TIME_TO_KEEP_SUCCESS_CHECK_ANIMATION_ON_IN_MS),
    );
  }

  // #region On First Scan
  /**
   * Handles on first scan.
   */
  async onFirstScan() {
    // Set before the first await: handleCapture() is still unwinding from the
    // capture that triggered this, and has to know the frame was accepted as a
    // front side rather than rejected.
    this.awaitingBackSide = true;

    if (this.semiAutoCapture) {
      await this.onFirstScanSemiAuto();
      return;
    }

    this.scanner.pause();
    this.resetErrorFeedback();
    await this.successTransition(true);
    this.feedbackPlaying = false;
    this.loading = false;
    this.showMessage = false;
    this.scanningBack = true;
    this.flipDocument = true;
    this.scanning = false;
    this.holdStill = false;

    await sleep(3000);

    this.flipDocument = false;
    this.loading = true;

    this.showFeedback(
      this.translation._t('id-scan-back-of-id').toString(),
      async () => {
        await sleep(500);

        this.setPauseTimeout();
        this.scanner.resume();
      },
      true,
    );

    this.firstScan.emit();
  }

  /**
   * The front side was accepted and the back is needed -- semi-auto version.
   *
   * The live path cannot be reused: it drives the continuous frame loop through
   * `scanner.pause()` / `scanner.resume()`, and calling resume() here would
   * start that loop in a mode that is meant to submit one frame per press.
   *
   * The scan itself is still open -- the engine returned `Incomplete` for the
   * front side, so `scanner.start()` has not resolved. All that is needed is to
   * show the flip animation and hand the shutter back for the second side.
   */
  private async onFirstScanSemiAuto(): Promise<void> {
    // Nothing should fire at the document while it is being turned over.
    this.clearAutoCapture();
    this.clearGuideProbe();
    this.resetErrorFeedback();
    this.captureReady = false;
    this.showMessage = false;
    this.feedbackPlaying = false;
    this.scanning = false;
    this.holdStill = false;

    // Field issues on the front side are settled before the back is asked for.
    // The engine reports the front as Incomplete rather than Valid, so the
    // usual onCaptureAccepted route never fires for it -- but the issues have
    // been computed, and a user who needs to retake their front should be told
    // now, not after they have turned the card over.
    if (this.reviewFieldIssues) {
      const proceed = await this.reviewCaptureIssues();

      if (!proceed) {
        await this.retakeFrontSide();
        return;
      }

      // On proceed the panel is deliberately left up for the next screen to
      // fade over. On the accepted path that screen is the result; here it is
      // the flip animation, which does not cover the whole screen, so the panel
      // is dropped explicitly.
      this.showCaptureIssues = false;
      this.captureIssues = null;
    }

    // No success animation here. In Semi-auto the success screen belongs to
    // the end of the scan, after the user has pressed Done on the result --
    // playing it for the front side as well would show it twice for one
    // two-sided document. The flip animation that follows is itself the
    // confirmation that the front side landed.
    //
    // The state successTransition() used to settle on the way past still has
    // to be settled, so the back side starts from the same screen as before.
    // The banner is deliberately not part of this -- see below.
    this.loadingBar = false;
    this.holdStill = false;
    this.loading = false;
    this.forceShowMessage = false;

    // The front side was accepted, so the wave gets to finish its pass before
    // the flip takes the screen. (If the issues panel ran above it has already
    // settled and dropped the effect, and this returns at once.)
    await this.awaitWaveCycle();

    // The feed froze on the captured front side; the flip animation needs the
    // live view behind it.
    this.unfreezeFrame();
    this.scanningBack = true;

    // "Scan back of ID" goes up with the flip, not before it. Setting it above
    // put the words on screen while the wave was still finishing -- up to a
    // full wave cycle of being told to turn the card over before anything
    // showed the user to turn it over.
    this.message = this.translation._t('id-scan-back-of-id').toString();
    this.showMessage = true;
    this.flipDocument = true;

    await sleep(FLIP_ANIMATION_MS);

    this.flipDocument = false;

    // Re-arm for the back side. The guide starts at card proportions again and
    // the probe re-runs, since the back of a card is a different picture --
    // and the countdown gate re-arms with it: the front being seen says
    // nothing about whether the user has flipped the card yet.
    //
    // The review-showings cap counts per side, and this is where the side
    // changes: the back gets its own two showings.
    this.captureReviewShows = 0;
    this.captureAttempted = false;
    this.captureGuideShape = SDKCore.DocumentShape.Card;
    this.captureReady = true;
    this.awaitingBackSide = false;
    this.documentSeen = false;

    // Same session, so the recording continues into the same file.
    this.scanner?.startRecording();
    this.startAutoCapture();
    this.scheduleGuideProbe();

    this.firstScan.emit();
  }

  /**
   * Sends the user back to capture their front side again.
   *
   * The engine has already armed itself for the back side, so it has to be
   * wound back first -- otherwise the next frame is matched against the back of
   * the card and rejected however well it is presented.
   */
  private async retakeFrontSide(): Promise<void> {
    try {
      await this.recognizer?.retakeFrontSide();
    } catch (e) {
      console.error('id-scan: retakeFrontSide: error', e);
    }

    this.awaitingBackSide = false;
    this.scanningBack = false;
    this.flipDocument = false;
    // reviewCaptureIssues() flags a Retake for the capture it answers, and
    // handleCapture() consumes the flag. The front of a two-sided document is
    // reviewed after its capture has finished, so here nothing did: the next
    // press's rejection went uncounted, with no blink and no banner.
    this.captureRetakeRequested = false;

    // reviewCaptureIssues() has already dropped the frozen frame and put the
    // shutter back; only the things it does not know about are left. The
    // countdown gate re-arms too: the retake starts from a fresh look at the
    // frame.
    this.captureGuideShape = SDKCore.DocumentShape.Card;
    this.documentSeen = false;
    this.scanner?.startRecording();
    this.startAutoCapture();
    this.scheduleGuideProbe();
  }

  /**
   * Handles creating pause timeout.
   */
  setPauseTimeout() {
    if (this.pauseTimeout) clearTimeout(this.pauseTimeout);

    this.pauseTimeout = setTimeout(() => {
      if (!this.elementWasFound) {
        this.handlePause();
      }
    }, PAUSE_TIMEOUT_MS);
  }

  // #region Show feedback
  /**
   * Display the feedback based on the detection status.
   *
   * @param message Feedback message.
   * @param callback on complete callback.
   */
  async showFeedback(
    message: string,
    callback?: { (): void } | undefined,
    notError: boolean = false,
  ) {
    if (this.feedbackPlaying) {
      return;
    }

    if ((notError && this.uncertain) || (!notError && !this.uncertain)) {
      this.showMessage = false;

      this.holdStill = false;
      await sleep(100);
    }

    this.resetErrorFeedback();
    this.feedbackPlaying = true;
    this.message = message;
    this.uncertain = !notError;
    this.showMessage = true;
    this.loading = notError;
    if (callback) callback();

    // Semi-auto capture stays quiet: the user is deliberately taking a shot, not
    // being coached through a live stream, so no error tone.
    if (this.uncertain && !this.semiAutoCapture) this.playSound('ErrorSound');

    setTimeout(() => (this.feedbackPlaying = false), 1500);

    this.scheduleSemiAutoFeedbackHide();
  }

  /**
   * The engine could not download what a read needed (6.0's on-demand data).
   * Live reports it frame after frame, so it is said once while it shows.
   */
  showConnectionProblem() {
    const message = this.translation._t('id-scan-capture-connection').toString();
    if (this.showMessage && this.message === message) {
      return;
    }
    this.showFeedback(message, null, false);
  }

  /**
   * Holds the captured frame on screen and starts the scan effect.
   *
   * The frame is copied onto a canvas overlay and the live stream keeps
   * running underneath. Pausing the video element instead seems cheaper, but
   * resuming a live stream blanks the element until the next camera frame
   * arrives -- a black flash on every rejected capture.
   */
  /**
   * Holds the current frame as a still over the live feed.
   *
   * This is the quiet half of freezing: it stops the video showing through
   * without the capture flash. A silent probe capture that the engine accepts
   * needs this so live video does not leak while the success screen comes up,
   * but it must not announce itself.
   */
  private freezeStill(): void {
    const video = this.videoFeed;
    const canvas = this.freezeCanvas;

    if (video && canvas && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      // The same way round as the live picture. A webcam's is mirrored
      // (Camera.ts), and a still drawn unmirrored flipped the picture
      // left-to-right at every capture.
      canvas.style.transform = video.style.transform;
      this.captureFrozen = true;
    }
  }

  private freezeFrame(): void {
    this.freezeStill();
    // The scan effect -- the flash the user reads as "captured".
    //
    // The wave layer is display:none until now, so its CSS animation starts
    // from the top of its cycle on this render. Stamping here is what lets
    // awaitWaveCycle() work out how far through a pass the wave is.
    this.captureScanStart = performance.now();
    this.captureScanning = true;
  }

  /**
   * Ends the scan effect and reveals the live feed again. The feed never
   * stopped, so this is just dropping the overlay -- nothing to resume.
   */
  private unfreezeFrame(): void {
    this.captureScanning = false;
    this.captureFrozen = false;
  }

  /**
   * Updates the guide from whatever the last capture saw.
   *
   * Only ever narrows to a shape the detector actually reported: a frame with
   * nothing in it leaves the outline where it was, because taking it away
   * while the user is aiming is worse than showing the previous proportion.
   */
  private async resolveCaptureGuide(): Promise<void> {
    if (!this.recognizer) {
      return;
    }

    try {
      const shape = await this.recognizer.getDocumentShape();

      if (shape !== SDKCore.DocumentShape.Unknown) {
        this.captureGuideShape = shape;
        this.documentSeen = true;
      }
    } catch (e) {
      console.warn('id-scan: could not read document shape', e);
    }
  }

  /**
   * Runs the detector probe chain that sizes the alignment guide.
   *
   * Every few seconds one frame goes through the object detector alone -- no
   * OCR, no feedback, nothing recorded against the scan -- purely to find out
   * whether the user is holding a card or a passport. The first probe waits
   * rather than firing the instant the camera opens, which would almost always
   * see an empty scene.
   *
   * A probe that sees the document sizes the guide and the chain stops there;
   * the shutter is then left to the user, with the usual idle countdown behind
   * it. A probe that sees nothing is retried, and once the retries are spent
   * the frame is captured anyway: the detector is the lightweight check, and
   * the full engine may well read a document it could not see -- and if it
   * cannot either, it produces real feedback saying why, which is more use to
   * the user than a guide box that never changed.
   *
   * @param attempt which probe this is, counting from 1
   */
  private scheduleGuideProbe(attempt: number = 1): void {
    if (!this.semiAutoCapture) {
      return;
    }

    // When the good-location probe is on, it already
    // sizes the guide from its own 1s detector call, so this separate
    // shape-probe (two calls at GUIDE_PROBE_DELAY_MS) is redundant -- skip it.
    if (this.enableGoodLocation) {
      return;
    }

    this.clearGuideProbe();

    this.guideProbeTimer = setTimeout(async () => {
      this.guideProbeTimer = null;

      // A capture may have started in the meantime, in which case the guide is
      // off screen and the engine is busy with something that matters more.
      if (!this.scanner || this.captureBusy || !this.captureReady) {
        return;
      }

      let shape = SDKCore.DocumentShape.Unknown;

      try {
        shape = await this.scanner.detectShape();
      } catch (e) {
        console.warn('id-scan: guide probe failed', e);
      }

      if (shape !== SDKCore.DocumentShape.Unknown) {
        // Found it: size the guide and leave the user to it. This is also the
        // evidence the idle countdown is gated on.
        this.captureGuideShape = shape;
        this.documentSeen = true;
        return;
      }

      if (attempt < GUIDE_PROBE_ATTEMPTS) {
        this.scheduleGuideProbe(attempt + 1);
        return;
      }

      // Nothing seen across every probe. Wait one more interval, then take the
      // frame regardless so the engine can say what is actually wrong.
      //
      // Silently: this frame is the chain's own doing, not the user's, and
      // flashing the shutter for it makes the screen twitch a few seconds after
      // the camera opens with nothing to explain it.
      this.guideProbeTimer = setTimeout(() => {
        this.guideProbeTimer = null;

        if (this.canAutoCapture()) {
          this.handleCapture(true);
        }
      }, GUIDE_PROBE_DELAY_MS);
    }, GUIDE_PROBE_DELAY_MS);
  }

  private clearGuideProbe(): void {
    if (this.guideProbeTimer) {
      clearTimeout(this.guideProbeTimer);
      this.guideProbeTimer = null;
    }
  }

  /**
   * The good-location probe. Every second, send a small
   * (640) frame to the engine's detect() and colour the guide corners green
   * when it says the ID is well placed. Only probes while the guide is on
   * screen; anything else (paused, capturing, review, result) is white by
   * definition. The interval self-guards, so it survives pause/resume without
   * needing to be restarted -- it is cleared only on teardown.
   */
  private startLocationProbe(): void {
    if (!this.semiAutoCapture || !this.enableGoodLocation) {
      return;
    }

    this.clearLocationProbe();

    this.locationProbeTimer = setInterval(async () => {
      const guideVisible =
        this.captureReady &&
        !this.captureScanning &&
        !this.showCaptureResult &&
        !this.showCaptureIssues &&
        !this.showSuccessAnimation &&
        !this.captureBusy;

      if (!this.scanner || !guideVisible) {
        if (this.goodLocation) this.goodLocation = false;
        return;
      }

      try {
        const r = await this.scanner.detectLocation();
        this.goodLocation = !!r.good;
        // Size the guide from the same probe: the detector's document class
        // stands in for the separate guide-shape probe (disabled below when this
        // feature is on). Also marks the document as seen, which the idle
        // auto-capture countdown is gated on.
        if (r.shape === SDKCore.DocumentShape.Card || r.shape === SDKCore.DocumentShape.Passport) {
          this.captureGuideShape = r.shape as SDKCore.DocumentShape;
          // Orient the guide to how the document is actually held. Only tracked
          // while a document is in frame, so it never lingers on a stale flip.
          this.captureGuideVertical = !!r.vertical;
          this.documentSeen = true;
        }
      } catch {
        this.goodLocation = false;
      }
    }, 1000);
  }

  private clearLocationProbe(): void {
    if (this.locationProbeTimer) {
      clearInterval(this.locationProbeTimer);
      this.locationProbeTimer = null;
    }
    this.goodLocation = false;
    // Back to the default (landscape) orientation whenever the probe stops, so a
    // new scan/side never opens on a stale vertical flip; the probe re-sets it
    // within a second once a document is in frame.
    this.captureGuideVertical = false;
  }

  /**
   * Takes the Semi-auto mode feedback banner back down after a couple of seconds.
   * Restarted on each new message, so the timer always measures from the
   * message the user is actually looking at.
   */
  private scheduleSemiAutoFeedbackHide(): void {
    if (!this.semiAutoCapture) {
      return;
    }

    this.clearSemiAutoFeedbackHide();

    this.feedbackHideTimer = setTimeout(() => {
      this.feedbackHideTimer = null;
      this.showMessage = false;
    }, MANUAL_FEEDBACK_VISIBLE_MS);
  }

  private clearSemiAutoFeedbackHide(): void {
    if (this.feedbackHideTimer) {
      clearTimeout(this.feedbackHideTimer);
      this.feedbackHideTimer = null;
    }
  }

  /**
   * Arms the auto-capture: wait out the idle period, then count down inside
   * the shutter and press it.
   *
   * Called whenever the shutter becomes pressable again, so a user who keeps
   * retaking gets a fresh idle period each time rather than being rushed.
   *
   * @param delay how long to wait. Defaults to the full idle period; the
   * re-check below passes something shorter.
   */
  private startAutoCapture(delay: number = AUTO_CAPTURE_IDLE_MS): void {
    if (!this.semiAutoCapture) {
      return;
    }

    this.clearAutoCapture();

    this.autoCaptureIdleTimer = setTimeout(() => {
      this.autoCaptureIdleTimer = null;

      // A frame is with the engine -- almost certainly the silent probe's,
      // which deliberately leaves this clock running so the countdown stays
      // keyed to camera-open. Its verdict may be the very evidence the gate
      // below is waiting for, so look again shortly rather than judging the
      // scene empty over a frame nobody has judged yet. Re-arming here is
      // also what keeps the auto-capture alive at all: a silent capture never
      // restarts this timer on its way out.
      if (this.captureBusy) {
        this.startAutoCapture(AUTO_CAPTURE_RECHECK_MS);
        return;
      }

      // Another screen owns the shutter -- a review panel, the result, the
      // flip, teardown. Nothing to count down and nothing to pause.
      if (!this.canAutoCapture()) {
        return;
      }

      // The countdown is gated on a document having been seen -- by the guide
      // probes, or by the engine reading any frame. Counting down over an
      // empty scene would only march the user into a rejection and the
      // timeout screen, so the gate holds. What is left is a camera that has
      // been open for the full idle period with nothing ever in front of it,
      // which is what the paused screen is for: it stops the scan quietly and
      // asks the user to position their ID, and "try again" re-arms both
      // clocks from the top.
      if (!this.documentSeen) {
        this.handlePause();
        return;
      }

      // A document is there and the user simply has not pressed. With the
      // countdown off that is not a problem to solve -- they are lining the
      // shot up, and the shutter stays theirs.
      if (!AUTO_CAPTURE_COUNTDOWN_ENABLED) {
        return;
      }

      this.beginCountdown();
    }, delay);
  }

  /**
   * Runs the visible 4-3-2-1 inside the shutter and presses it.
   */
  private beginCountdown(): void {
    this.captureCountdown = AUTO_CAPTURE_COUNTDOWN_SECONDS;

    this.autoCaptureTickTimer = setInterval(() => {
      // Something took the shutter off screen mid-count -- a review screen,
      // the flip prompt, teardown. Stand down rather than fire into it.
      if (!this.canAutoCapture()) {
        this.clearAutoCapture();
        return;
      }

      // The press happens after 1 lands and its second elapses, so the user
      // sees every number including 1 rather than 1 flashing past.
      //
      // This press is the scan's last chance: the user watched the countdown
      // run out without framing a document. If the engine rejects the frame
      // the scan times out, exactly as a Live scan does when its clock runs
      // out, instead of looping through another idle period forever.
      if (this.captureCountdown <= 1) {
        this.clearAutoCapture();
        this.handleCapture(false, true);
        return;
      }

      this.captureCountdown = this.captureCountdown - 1;
    }, 1000);
  }

  /**
   * Marks the guide as having just had a frame turned down, and schedules it
   * back to the ready colour.
   *
   * Restarted on each rejection so the warning always measures from the
   * rejection the user is actually looking at, rather than expiring early
   * because an earlier one is still counting.
   */
  private flagCaptureRejected(): void {
    this.clearCaptureRejected();
    this.captureRejected = true;

    this.captureRejectedTimer = setTimeout(() => {
      this.captureRejectedTimer = null;
      this.captureRejected = false;
    }, CAPTURE_REJECTED_WARNING_MS);
  }

  private clearCaptureRejected(): void {
    if (this.captureRejectedTimer) {
      clearTimeout(this.captureRejectedTimer);
      this.captureRejectedTimer = null;
    }

    this.captureRejected = false;
  }

  /**
   * Which failure screen, if any, the rejection streak has now earned.
   *
   * Deliberately exact on the lower threshold: the unreadable screen is shown
   * once, on the fifth rejection, and the five after it are the second chance
   * it granted rather than five more chances to show it again.
   *
   * @returns the issue name, or null while the user still has attempts left.
   */
  private rejectionEscalation(): string | null {
    if (this.captureRejections >= CAPTURE_REJECTIONS_UNSUPPORTED) {
      return 'UNSUPPORTED';
    }

    if (this.captureRejections === CAPTURE_REJECTIONS_UNREADABLE) {
      return 'UNREADABLE';
    }

    return null;
  }

  /**
   * Whether the field-review idle clock should run for the showing on screen.
   *
   * It fires "Continue anyway" on the user's behalf, so it may only run when
   * the user has that button -- which is exactly captureIssuesShowProceed, true
   * from the second showing on and false for a barcode-missing back (retake-only
   * for its two showings). The first showing therefore never auto-continues: it
   * offers only Retake, and an idle user must stay there until they act. The
   * unclear-document screen is never auto-accepted at all, so it is excluded
   * even though it does show a proceed button from the second showing.
   */
  private shouldArmIssuesTimeout(unclearDocument: boolean): boolean {
    return this.captureIssuesShowProceed && !unclearDocument;
  }

  /**
   * Starts the field-review screen's clock. Firing it answers the screen for
   * the user; it is armed the moment the screen goes up, when the decision
   * it answers already exists.
   */
  private armCaptureIssuesTimeout(): void {
    this.clearCaptureIssuesTimeout();

    this.captureIssuesTimer = setTimeout(() => {
      this.captureIssuesTimer = null;
      this.captureIssuesDecision?.(true);
    }, CAPTURE_ISSUES_TIMEOUT_MS);
  }

  private clearCaptureIssuesTimeout(): void {
    if (this.captureIssuesTimer) {
      clearTimeout(this.captureIssuesTimer);
      this.captureIssuesTimer = null;
    }
  }

  /**
   * Whether pressing the shutter on the user's behalf still makes sense --
   * the same conditions that decide whether it is on screen at all.
   */
  private canAutoCapture(): boolean {
    return (
      this.captureReady &&
      !this.captureBusy &&
      !this.flipDocument &&
      !this.showCaptureIssues &&
      !this.showCaptureResult &&
      !this.showSuccessAnimation
    );
  }

  /**
   * Stands the auto-capture down and clears the number off the shutter.
   */
  private clearAutoCapture(): void {
    if (this.autoCaptureIdleTimer) {
      clearTimeout(this.autoCaptureIdleTimer);
      this.autoCaptureIdleTimer = null;
    }

    if (this.autoCaptureTickTimer) {
      clearInterval(this.autoCaptureTickTimer);
      this.autoCaptureTickTimer = null;
    }

    this.captureCountdown = 0;
  }

  /**
   * Handles playing sound.
   * @param name name of the sound
   * @returns
   */
  playSound(name: string, force: boolean = false) {
    if (!this.audio) {
      return;
    }

    if (this.playingAudio && !force) {
      return;
    }

    this.playingAudio = true;

    this.audio.play(name);

    setTimeout(() => (this.playingAudio = false), 8000);
  }

  /**
   * Pauses the process.
   * This will be triggered when nothing is detected or device is in sleep mode.
   */
  handlePause() {
    this.issue = 'PAUSE';

    if (this.semiAutoCapture) {
      // Nothing is being processed in Semi-auto to begin with -- no frame loop
      // to stand down. What has to stop is the shutter and the two clocks
      // behind it, and the recording, which from here is only filming a camera
      // nobody is aiming. The scan itself stays open: scanner.start() is still
      // pending, so "try again" resumes rather than restarts.
      this.clearAutoCapture();
      this.clearGuideProbe();
      this.clearCaptureRejected();
      this.captureReady = false;
      this.showMessage = false;

      if (this.hasAcceptedCapture) {
        // A capture is already in the recording -- the front side of a card
        // the user has yet to turn over, most likely. That footage is worth
        // keeping, so this only pauses and Continue resumes into the same
        // file.
        this.scanner?.pauseRecording();
      } else {
        // Nothing has been captured, which is how this screen was reached at
        // all: the camera has been open the whole idle period with nothing in
        // front of it. Those seconds are footage of an empty room, so drop
        // them rather than pausing into them -- handleResume() starts a fresh
        // recording when the user presses Continue.
        this.scanner?.discardRecording();
      }

      return;
    }

    this.scanner.pause();
  }

  /**
   * Resumes the process.
   */
  handleResume() {
    this.issue = '';

    if (this.semiAutoCapture) {
      // scanner.resume() must not be called here: it starts the Live frame
      // loop, and this mode submits one frame per press. Putting the shutter
      // and its clocks back is the whole of resuming.
      this.captureAttempted = false;
      this.documentSeen = false;
      this.captureGuideShape = SDKCore.DocumentShape.Card;
      this.captureReady = true;
      // handlePause() hid the "Front/Back of ID" banner along with the shutter;
      // bring it back with them, the same way onStart() shows it on camera open.
      // The caller (handleTryAgain) has already set this.message to the right
      // side, but the banner is gated on showMessage, which nothing else here
      // restored -- so Continue used to return a shutter with no label above it.
      this.showMessage = true;
      // Resumes into the existing file where there was a capture worth
      // keeping, and begins a fresh recording where handlePause() dropped it.
      this.scanner?.startRecording();
      this.startAutoCapture();
      this.scheduleGuideProbe();
      return;
    }

    // Another idle minute pauses again -- re-armed ahead of the scanner's
    // clock, which resume() restarts. Left unarmed, the second idle minute
    // ended in "Capture failed!".
    this.setPauseTimeout();
    this.scanner.resume();
  }

  /**
   * Gives another try.
   */
  handleTryAgain() {
    // One tap, one event for the host, whichever way the scan carries on.
    this.tryAgain.emit();
    this.resetErrorFeedback();
    this.message = this.translation
      ._t(this.scanningBack ? 'id-scan-back-of-id' : 'id-scan-front-of-id')
      .toString();
    if (this.issue === 'PAUSE' || this.instantTry) {
      this.handleResume();
    } else {
      // The rejection streak carries across this restart -- that is what makes
      // the unreadable screen's second five attempts a second chance rather
      // than a reset. Only a scan the host starts fresh clears it.
      this.retryingAfterFailure = true;
      this.openingCamera = true;
      this.issue = '';
      this.showMessage = false;
      this.scanning = false;
      this.holdStill = false;
      this.forceShowMessage = false;
      this.startScanning();
    }
  }

  // #region On Unsupported
  /**
   * Gives another try.
   */
  handleUnsupportedID(supported: boolean) {
    if (supported) {
      // TODO: Use API instead of Engine5w to process the unsupported ID.
    }

    this.issue = '';
    this.message = this.translation._t('id-scan-front-of-id').toString();
    this.forceShowMessage = false;
    this.showMessage = false;
    this.scanning = false;
    this.holdStill = false;
    this.started = false;
    // This screen is the end of the escalation, not a step in it. Whatever
    // starts next is a new document as far as the streak is concerned.
    this.captureRejections = 0;
    this.forcedIssue = null;
    this.resetErrorFeedback();
  }

  /**
   * Error handling when too many issues were found.
   */
  async handleTooManyIssues() {
    this.scanner.pause();

    try {
      this.imageExample = await createBlobUrlFromImageData(this.scanner.currentImage);
    } catch (error) {
      console.warn(error);
    }

    switch (this.latestStatus) {
      case SDKCore.IDScanDetectionStatus.DocumentFarLeft:
      case SDKCore.IDScanDetectionStatus.DocumentFarRight:
        this.issue = 'CENTER';
        break;
      case SDKCore.IDScanDetectionStatus.DocumentTooFar:
        this.issue = 'FURTHER';
        break;
      case SDKCore.IDScanDetectionStatus.DocumentTooNear:
        this.issue = 'CLOSE';
        break;
      case SDKCore.IDScanDetectionStatus.DocumentHasGlare:
        this.issue = 'GLARE';
        break;
      case SDKCore.IDScanDetectionStatus.DocumentIsBlurry:
        this.issue = 'BLUR';
        break;
      default:
        this.issue = 'PAUSE';
        break;
    }

    this.instantTry = true;
  }

  /**
   * Handle complete.
   */
  async handleComplete(): Promise<string> {
    try {
      const payload = await this.recognizer.getPayload();
      const response = await this.session.submit(payload, this.extendedPayloadForSubmit);
      const data = await response.json();
      return data.document_id;
    } catch (error) {
      console.error('id-scan: handleComplete: error', error);
      throw error;
    }
  }

  handleFatalError(error: SdkError) {
    this.fatalError.emit(error);

    this.issue = '';
    this.success = false;
    this.showSuccessAnimation = false;
    this.started = false;
    this.showVideo = false;
    this.loading = false;
    this.showMessage = false;
    this.forceShowMessage = false;
    this.scanning = false;
    this.holdStill = false;
    this.openingCamera = false;
    this.resetErrorFeedback();
    this.clear();
  }

  /**
   * Reset feedback states.
   */
  resetErrorFeedback() {
    this.further = false;
    this.closer = false;
    this.left = false;
    this.right = false;
    this.glare = false;
    this.blur = false;
    this.uncertain = false;
  }

  // #region Clear
  /**
   * Clears instances.
   */
  async clear() {
    // Release anything still waiting on a review screen, otherwise tearing
    // down mid-review would leave startScanning() awaiting forever.
    if (this.captureResultAck) {
      this.captureResultAck();
    }

    // Proceed, not retake: a torn-down scan has no camera left to retake with.
    if (this.captureIssuesDecision) {
      this.captureIssuesDecision(true);
    }

    this.showCaptureIssues = false;
    this.captureIssues = null;

    this.clearSemiAutoFeedbackHide();
    this.clearAutoCapture();
    this.clearGuideProbe();
    this.clearLocationProbe(); // stop the good-location probe
    this.clearCaptureRejected();
    this.clearCaptureIssuesTimeout();

    this.captureRejections = 0;
    this.forcedIssue = null;
    this.retryingAfterFailure = false;
    // Belong to the scan that produced them. Held until here rather than
    // dropped at the result screen, because that screen is still offering them.
    this.capturedFrames = {};
    this.capturedCrops = {};

    // The camera first: releasing it is local, while deleting the recognizer is
    // a round trip to the worker -- which destroy() terminates straight after
    // asking for this, so that reply never comes. Waiting on it first left the
    // camera on (and its light lit) after the host had torn the SDK down.
    if (this.scanner) {
      this.scanner.delete();
      this.scanner = null;
    }

    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }

    this.recognizerStale = false;
    if (this.recognizer) {
      const recognizer = this.recognizer;
      this.recognizer = null;
      await recognizer.delete();
    }
  }

  /**
   * Clears instances.
   */
  @Method()
  async delete() {
    this.teardowns++;
    this.abandonScan();
    this.clear();
  }

  /**
   * Clears everything.
   */
  disconnectedCallback() {
    this.layoutQuery?.removeEventListener('change', this.readLayout);
    this.stopOrientationWatch?.();
    this.message = this.translation._t('id-scan-front-of-id').toString();
    this.showMessage = false;
    this.resetErrorFeedback();
    this.clearLocationProbe(); // stop the good-location interval
    if (this.started) {
      this.clear();
    }
  }

  // #region Render
  render() {
    // The top pill just shows whatever the engine is currently saying. "Adjust
    // the ID and try again" is one of those messages now -- the engine raises
    // it (as the Unrecognizable status) only when a press was well framed but
    // could not be read, which is exactly when it should appear. Framing
    // problems carry their own move-closer/off-centre text; a good capture
    // carries none and the pill stays quiet.
    const feedbackMessage = this.message;
    const feedbackVisible = this.feedbackVisible();

    /** Error modal buttons. */
    const errorButtons = [
      {
        label: this.translation._t('id-scan-close').toString(),
        variant: 'primary outline',
        onClick: () => (this.interError = null),
      },
      {
        label: this.translation._t('id-scan-try-again').toString(),
        variant: 'primary',
        onClick: () => {
          this.tryAgain.emit();
          this.interError = null;
        },
      },
    ];

    return (
      <Host>
        {this.started && !this.semiAutoCapture && (
          <idv-id-scan-message
            visible={this.showMessage}
            staticProgressBar={this.loadingBar}
            message={this.message}
            scanning={this.holdStill}
            uncertain={this.uncertain && !this.holdStill}
            forceShow={this.forceShowMessage}
          />
        )}
        {/* Live capture only: the tinted full-screen nudge animations belong to
            a stream being corrected in real time. Semi-auto capture says the same
            thing once, in the banner. */}
        {!this.semiAutoCapture && [
          <idv-id-scan-animation visible={this.closer} name="closer" />,
          <idv-id-scan-Animation visible={this.further} name="further" />,
          <idv-id-scan-animation visible={this.left} name="left" />,
          <idv-id-scan-animation visible={this.right} name="right" />,
          <idv-id-scan-animation visible={this.glare} name="glare" />,
          <idv-id-scan-animation visible={this.blur} name="blur" />,
        ]}
        <idv-loading
          visible={!this.semiAutoCapture && (this.scanning || this.success) && !this.uncertain}
          success={this.holdStill}
          forceShow={this.forceShowMessage}
        />
        <idv-id-scan-intro
          visible={this.openingCamera}
          description={this.translation
            ._t(this.scanningBack ? 'id-scan-instruction-back' : 'id-scan-instruction-front')
            .toString()}
        />
        <idv-id-scan-flip-document
          visible={this.flipDocument}
          description={this.translation._t('id-scan-flip-and-scan').toString()}
        />
        <idv-video ref={ref => (this.idvVideo = ref)} visible={this.showVideo} />
        {this.semiAutoCapture && (
          <div class={`capture-freeze${this.captureFrozen ? ' visible' : ''}`}>
            <canvas ref={ref => (this.freezeCanvas = ref)}></canvas>
          </div>
        )}
        {this.semiAutoCapture && (
          <idv-id-scan-capture-button
            visible={
              this.captureReady &&
              !this.flipDocument &&
              !this.showCaptureIssues &&
              !this.showSuccessAnimation
            }
            busy={(this.captureBusy && !this.silentCapture) || this.captureSteadying}
            countdown={this.captureCountdown}
            hint={CAPTURE_HINT_ENABLED ? this.captureHint() : ''}
            label={this.translation._t('id-scan-capture-button').toString()}
            onCaptureRequested={() => this.handleUserCapture()}
          />
        )}
        {this.semiAutoCapture && (
          <idv-id-scan-capture-scan
            visible={this.captureScanning}
            settling={this.captureSettling}
          />
        )}
        {this.semiAutoCapture && (
          <idv-id-scan-capture-guide
            visible={
              this.captureReady &&
              !this.captureScanning &&
              !this.showCaptureResult &&
              !this.showCaptureIssues &&
              !this.showSuccessAnimation
            }
            shape={this.captureGuideShape}
            vertical={this.captureGuideVertical} // portrait when held upright
            warning={this.captureRejected}
            good={this.goodLocation} // green when well placed
          />
        )}
        {this.semiAutoCapture && (
          <idv-id-scan-capture-feedback visible={feedbackVisible} message={feedbackMessage} />
        )}
        {this.semiAutoCapture && (
          <idv-id-scan-capture-issues
            class={this.portraitLock(this.showCaptureIssues)}
            visible={this.showCaptureIssues}
            issues={this.captureIssues}
            heading={this.translation._t('id-scan-capture-issues-heading').toString()}
            description={this.translation._t('id-scan-capture-issues-description').toString()}
            summaryOne={this.translation._t('id-scan-capture-issues-summary-one').toString()}
            summaryMany={this.translation._t('id-scan-capture-issues-summary-many').toString()}
            recaptureLabel={this.translation._t('id-scan-capture-issues-recapture').toString()}
            proceedLabel={this.translation._t('id-scan-capture-issues-proceed').toString()}
            missingLabel={this.translation._t('id-scan-capture-issues-missing').toString()}
            unclearLabel={this.translation._t('id-scan-capture-issues-unclear').toString()}
            unclearDocumentLabel={this.translation
              ._t('id-scan-capture-issues-unclear-document')
              .toString()}
            showProceed={this.captureIssuesShowProceed}
            faceCoveredLabel={this.translation._t('id-scan-capture-issues-face-covered').toString()}
            faceGlareLabel={this.translation._t('id-scan-capture-issues-face-glare').toString()}
            faceBlurLabel={this.translation._t('id-scan-capture-issues-face-blur').toString()}
            downloadLabel={this.translation._t('id-scan-capture-download-frame').toString()}
            onCaptureRecaptureRequested={() => this.captureIssuesDecision?.(false)}
            onCaptureIssuesAccepted={() => this.captureIssuesDecision?.(true)}
            onCaptureFrameDownloadRequested={() => this.downloadReviewedFrame()}
          />
        )}
        {this.semiAutoCapture && this.showResultScreen && (
          <idv-id-scan-capture-result
            class={this.portraitLock(this.showCaptureResult)}
            visible={this.showCaptureResult}
            result={this.captureResult}
            heading={this.translation._t('id-scan-capture-result-heading').toString()}
            doneLabel={this.translation._t('id-scan-capture-result-done').toString()}
            emptyLabel={this.translation._t('id-scan-capture-result-empty').toString()}
            assetsLabel={this.translation._t('id-scan-capture-assets').toString()}
            assets={this.captureAssets()}
            onCaptureResultDismissed={() => this.captureResultAck?.()}
            onCaptureAssetDownloadRequested={e => this.downloadAsset(e.detail)}
          />
        )}
        <idv-id-scan-status
          class={this.portraitLock(this.showSuccessAnimation && this.completeScreen)}
          visible={this.showSuccessAnimation && this.completeScreen}
          status="success"
          heading={this.translation._t('id-scan-success').toString()}
        />
        <id-scan-issue
          class={this.portraitLock(this.issue !== '')}
          visible={this.issue !== ''}
          onTryAgain={(event: IdScanIssueCustomEvent<void>) => {
            // The screen's own event is this component's cue, not the host's:
            // handleTryAgain() raises the one the host hears.
            event.stopPropagation();
            this.handleTryAgain();
          }}
          onValidDocumentConfirmed={(event: IdScanIssueCustomEvent<boolean>) =>
            this.handleUnsupportedID(event.detail)
          }
          name={this.issue}
          imageExample={this.imageExample}
        ></id-scan-issue>
        {this.disableScreenLandscape && <idv-landscape visible={this.isLandscape} />}
        {this.interError && (
          <idv-modal
            visible
            warning
            heading={this.translation._t(this.interError.title)?.toString()}
            buttons={errorButtons}
          >
            {this.translation._t(this.interError.message)?.toString()}
          </idv-modal>
        )}
        <idv-audio-player
          files={idScanAudioFiles}
          ref={(ref: any) => (this.audio = ref)}
          load={this.loadAudio}
        />
      </Host>
    );
  }
}
