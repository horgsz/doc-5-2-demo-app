import {
  Component,
  Event,
  EventEmitter,
  Host,
  Method,
  Prop,
  Watch,
  getAssetPath,
  h,
} from '@stencil/core';
import * as SDKCore from '@utils/interface';
import {
  IdvDigitalCredentialsCustomEvent,
  IdvFaceScanCustomEvent,
  IdvIdScanCustomEvent,
} from '../../components';
import {
  DigitalCredentialsResult,
  DigitalCredentialsResultEvent,
  DigitalCredentialsStatus,
} from './digital-credentials/digital-credentials';
import {
  Session,
  SessionResponse,
  Recognizer,
  Scanner,
  SdkError,
  IDScanRecognizerResult,
  IDScanProcessStatus,
  SDKManager,
  SdkType,
  FaceScanRecognizerResult,
  FaceScanProcessStatus,
  BackOfCardDocumentConditionItem,
} from '@utils/interface';
import { Translation } from '@utils/translation';

@Component({
  tag: 'idv-sdk-web',
  assetsDirs: ['../assets'],
  styleUrl: 'sdk-ui.scss',
  shadow: true,
})
export class IDVSDKWeb {
  /* Session API URL. */
  @Prop() sessionUrl: string = '';
  /* Session API token. */
  @Prop() sessionToken: string = '';
  /* Product type. */
  @Prop() recognizers?: SdkType[] = [SdkType.IDScan];
  /**
   * Allows scanning front & back sides.
   *
   * Three states: unset lets the engine decide from the document profile,
   * `true` always asks for the back, `false` never does. Deliberately without
   * a default -- `false` here would mean every host that never set it got
   * front-only, which is not the same as letting the engine choose.
   */
  @Prop() scanBothSides?: boolean | null;
  /* Allows scanning back side if condition is met. */
  @Prop() backOfCardDocumentConditions: BackOfCardDocumentConditionItem[] | undefined;
  @Prop() enableDFA?: boolean = false;
  @Prop() enableFaceMatch?: boolean = false;
  /**
   * Replaces continuous live scanning with a capture button: the user frames
   * the document and presses capture, and each press submits one frame and
   * returns feedback for it.
   */
  @Prop() semiAutoCapture?: boolean = true;
  /**
   * Camera capture resolution override (Auto/VGA/HD/FULL_HD/UHD). When set, caps
   * the stream regardless of mode -- e.g. FULL_HD (1080p) on memory-tight
   * devices where a 4K stream beside the engine overruns the tab's memory limit.
   */
  @Prop() cameraResolution?: SDKCore.CameraResolution;
  /**
   * Record the scan session (the camera video). On by default. Set false to
   * turn recording off entirely -- no recorder is created.
   */
  @Prop() enableRecording?: boolean = true;
  /**
   * After a capture the engine accepts, show the fields it read poorly or not
   * at all -- highlighted on the cropped document -- and let the user retake
   * rather than continue. Semi-auto capture only; ignored in live scanning.
   */
  @Prop() reviewFieldIssues?: boolean = true;
  /**
   * The good-location probe: a once-a-second detector check while the shutter
   * is up. The guide corners go green while the ID is well placed, the guide
   * takes the document's proportions, and on a sideways phone the prompt
   * comes down once the ID is placed. On by default; set false to opt out.
   * Semi-auto capture only.
   */
  @Prop() enableGoodLocation?: boolean = true;
  /**
   * Show the read-back screen -- every field the engine got off the accepted
   * capture, with a Done button -- before the scan completes.
   *
   * Off by default: it is a diagnostic view of the SDK's own output, useful
   * while integrating and while debugging a document profile, but it puts the
   * user's document contents on screen and adds a tap to a flow that is
   * otherwise finished. Semi-auto capture only; ignored in live scanning.
   */
  @Prop() showResultScreen?: boolean = false;
  /* Translation text contents. */
  @Prop() translations?: { [key: string]: string } = null;

  /* Allow to skip face scan intro. */
  @Prop() skipFaceScanIntro?: boolean = false;

  /* When true, the full-screen face scan modal backdrop is transparent so the host page remains visible behind the scanning UI. */
  @Prop() transparentFaceScanBackdrop?: boolean = false;

  /* Unrecoverable error UI modals are turned on/off. */
  @Prop() suppressHardErrorModalsForIdScan?: boolean = false;

  /* Logo path to show in face access intro screen, relative to host app. */
  @Prop() faceScanIntroScreenLogoPath?: string;

  /* When calling payload submit when scanning id, this additional/optional data will extend the original payload */
  @Prop() idScanExtendedPayloadForSubmit?: Record<string, any>;

  /* When calling payload submit when scanning face, this additional/optional data will extend the original payload */
  @Prop() faceScanExtendedPayloadForSubmit?: Record<string, any>;

  /* When the sdk is loaded and ready. */
  @Event() ready?: EventEmitter<SdkType>;
  /* When the component has authenticated */
  @Event() authenticated?: EventEmitter<boolean>;
  /* When the process is completed. */
  @Event() done?: EventEmitter<SdkType>;
  /* When the the verification payload is ready.  */
  @Event() payload?: EventEmitter<Blob>;
  /* Error handler. */
  @Event() fatalError?: EventEmitter<SdkError>;
  /* Success event. */
  @Event() scanSuccess?: EventEmitter<{
    id: String;
    digitalCredentialId: String;
    sdkType: SdkType;
    result: IDScanRecognizerResult | FaceScanRecognizerResult | DigitalCredentialsResult;
  }>;
  /* Failure event. */
  @Event() scanFail?: EventEmitter<{
    sdkType: SdkType;
    result: IDScanProcessStatus | FaceScanProcessStatus | DigitalCredentialsStatus;
  }>;
  /* First scan event. */
  @Event() firstScan?: EventEmitter<null>;
  /* Whenever landscape screen detected. */
  @Event() screenLandscape?: EventEmitter<null>;
  /* Whenever try button on error was pressed. */
  @Event() tryAgain?: EventEmitter<null>;
  /* Whenever recording is done. */
  @Event() recordingDone?: EventEmitter<Blob>;
  /* Whenever face scan modal is closed. */
  @Event() faceScanClosed?: EventEmitter<boolean>;

  /* Instances */
  private session: Session;
  private recognizerList: Map<string, Recognizer> = new Map();
  private scannerList: Map<string, Scanner> = new Map();

  private translation: Translation;
  private permission: SessionResponse;

  /* ID Scan instance. */
  private idScan: HTMLIdvIdScanElement;
  private idScanSDKManager: SDKManager;
  /* Face Scan instance. */
  private faceScan: HTMLIdvFaceScanElement;
  private faceScanSDKManager: SDKManager;
  /* Digital Credentials instance. */
  private digitalCredentials: HTMLIdvDigitalCredentialsElement;

  private idScanLinks: string[] = [];
  private faceScanLinks: string[] = [];
  private static readonly workerPath: string = './assets/IDVerseSDK.worker.min.js';

  private p27850: Function | undefined;

  @Watch('translations')
  updateTranslations(translations?: { [key: string]: string }) {
    this.translation = new Translation(translations);
  }

  async connectedCallback() {
    if (!SDKCore.isBrowserSupported()) {
      throw new Error('Your browser is not supported.');
    }

    window.onbeforeunload = () => {
      this.destroy();
    };

    this.updateTranslations(this.translations);

    this.session = new Session(this.sessionUrl, this.sessionToken);

    try {
      // Authenticate.
      this.permission = await this.session.getPermission();
      for (let i = 0; i < this.permission.assets_upload_links.length; i++) {
        const link = this.permission.assets_upload_links[i];
        if (i === 0) {
          this.faceScanLinks.push(link);
        } else {
          this.idScanLinks.push(link);
        }
      }

      await this.loadP27850();
      this.authenticated.emit(true);
    } catch (error: any) {
      if (error.code) {
        this.fatalError.emit(error);
        this.authenticated.emit(false);
      } else {
        this.fatalError.emit(new SDKCore.SdkError(SDKCore.ErrorCode.InternalError));
        this.authenticated.emit(false);
      }
    }
  }

  /**
   * Authenticates and loads the SDK.
   */
  async createSDKManager(sdkType: SdkType): Promise<SDKManager> {
    try {
      let links = this.idScanLinks;
      if (sdkType === SdkType.FaceScan) {
        links = this.faceScanLinks;
      }
      // Load the SDK.
      const sdkManager = await SDKCore.load(
        {
          permission: {
            ...this.permission,
            assets_upload_links: links,
          },
          sdkType,
          session: this.session,
        },
        getAssetPath(IDVSDKWeb.workerPath),
        this.p27850,
      );

      return sdkManager;
    } catch (e) {
      this.fatalError.emit(e as SdkError);
      throw e;
    }
  }

  /**
   * Load id scanning method.
   */
  @Method()
  async loadIDScan(): Promise<void> {
    if (!this.idScan) {
      throw 'ID scan component is missing.';
    }

    const sdkType = SdkType.IDScan;
    if (this.idScanSDKManager) {
      this.ready.emit(sdkType);
      return;
    }

    this.idScanSDKManager = await this.createSDKManager(sdkType);
    await this.idScan.setSdkManager(this.idScanSDKManager);
    this.ready.emit(sdkType);
  }

  /**
   * Start id scanning method.
   */
  @Method()
  async startIDScan(): Promise<void> {
    if (!this.idScan) {
      throw 'ID scan component is missing.';
    }

    await this.loadIDScan();
    return this.idScan.startScanning();
  }

  /**
   * Load face scanning method.
   */
  @Method()
  async loadFaceScan(): Promise<void> {
    if (!this.faceScan) {
      throw 'Face scan component is missing';
    }

    const sdkType = SdkType.FaceScan;
    if (this.faceScanSDKManager) {
      this.ready.emit(sdkType);
      return;
    }

    this.faceScanSDKManager = await this.createSDKManager(sdkType);
    await this.faceScan.setSdkManager(this.faceScanSDKManager);
    this.ready.emit(sdkType);
  }

  /**
   * Start face scanning method.
   */
  @Method()
  async startFaceScan(): Promise<void> {
    if (!this.faceScan) {
      throw 'Face scan component is missing.';
    }

    await this.loadFaceScan();
    if (this.skipFaceScanIntro) {
      return this.faceScan.startScanning(true);
    }

    return this.faceScan.setVisibility(true);
  }

  /**
   * Load device info module.
   */
  @Method()
  async loadP27850(): Promise<void> {
    this.p27850 = await SDKCore.loadP27850({
      permission: this.permission,
      sdkType: SdkType.DeviceInfo,
      session: this.session,
    });
  }

  /**
   * Load digital credentials method.
   */
  @Method()
  async loadDigitalCredentials(): Promise<void> {
    if (!this.digitalCredentials) {
      throw 'Digital credentials component is missing.';
    }

    let sdk = await SDKCore.loadDigitalCredentials({
      permission: this.permission,
      sdkType: SdkType.DigitalCredentials,
      session: this.session,
    });

    await this.digitalCredentials.setSdk(sdk);
  }

  /**
   * Start digital credentials method.
   * @param issuer The issuer, e.g. "ca-mdl"
   * @param redirect_url optional,
   *    url where we want the user to be redirected once they complete the in-app process
   */
  @Method()
  async startDigitalCredentials(issuer: string, redirectUrl?: string): Promise<void> {
    if (!this.digitalCredentials) {
      throw 'Digital credentials component is missing.';
    }

    const sdk = await this.digitalCredentials.getSdk();
    if (!sdk) {
      await this.loadDigitalCredentials();
    }

    await this.digitalCredentials.runFlow(issuer, redirectUrl);
  }

  /**
   * Returns the recognizer instance.
   */
  @Method()
  async getRecognizer(sdkType: any): Promise<Recognizer> {
    return this.recognizerList[sdkType];
  }

  /**
   * Returns the scanner instance.
   */
  @Method()
  async getScanner(sdkType: any): Promise<Scanner> {
    return this.scannerList[sdkType as SdkType];
  }

  /**
   * Toggles between scanning front only and front & back scan.
   *
   * Pass `undefined` or `null` to hand the decision back to the engine, which
   * asks for the back only when the document profile says it has one.
   */
  @Method()
  async setScanBothSides(scanBoth?: boolean | null): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        if (this.idScan) {
          await this.idScan.setScanBothSides(scanBoth);
          return resolve();
        }

        reject('ID Scan recognizer is missing.');
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Toggles DFA engine.
   */
  @Method()
  async setEnableDFA(enable: boolean): Promise<void> {
    if (this.idScan) {
      this.idScan.enableDFA = enable;
    }

    if (this.faceScan) {
      this.faceScan.enableDFA = enable;
    }
  }

  /**
   * Toggles FaceMatch engine.
   */
  @Method()
  async setEnableFaceMatch(enable: boolean): Promise<void> {
    if (this.faceScan) {
      this.faceScan.enableFaceMatch = enable;
    }

    if (this.idScan) {
      this.idScan.enableFaceMatch = enable;
    }

    if (this.digitalCredentials) {
      this.digitalCredentials.enableFaceMatch = enable;
    }
  }

  async handleComplete() {
    // Currently allow either or id scan and digital credentials for completion:
    let missingId: boolean;
    if (
      this.recognizers.includes(SdkType.IDScan) ||
      this.recognizers.includes(SdkType.DigitalCredentials)
    ) {
      if (this.recognizers.includes(SdkType.IDScan) && (await this.idScan.isCompleted())) {
        missingId = false;
      } else if (
        this.recognizers.includes(SdkType.DigitalCredentials) &&
        (await this.digitalCredentials.isCompleted())
      ) {
        missingId = false;
      }
    } else {
      missingId = false;
    }

    let missingFace: boolean;
    if (this.recognizers.includes(SdkType.FaceScan)) {
      missingFace = !(await this.faceScan.isCompleted());
    } else {
      missingFace = false;
    }

    if (!missingId && !missingFace) {
      this.session.complete();
    }
  }

  @Method()
  async close(): Promise<void> {
    // A scan still running cannot go on once its worker is gone: end it as
    // destroy() does, so its camera is released and nothing is left waiting
    // on the worker (it used to leave the camera on and a press spinning).
    this.idScan?.delete();
    this.faceScan?.delete();

    this.session.complete();
    if (this.idScanSDKManager) {
      this.idScanSDKManager.delete();
      this.idScanSDKManager = null;
    }

    if (this.faceScanSDKManager) {
      this.faceScanSDKManager.delete();
      this.faceScanSDKManager = null;
    }
  }

  /**
   * Clears memory.
   */
  @Method()
  async destroy(): Promise<void> {
    if (this.idScan) {
      this.idScan.delete();
    }

    if (this.faceScan) {
      this.faceScan.delete();
    }

    if (this.idScanSDKManager) {
      this.idScanSDKManager.delete();
      this.idScanSDKManager = null;
    }

    if (this.faceScanSDKManager) {
      this.faceScanSDKManager.delete();
      this.faceScanSDKManager = null;
    }

    if (this.digitalCredentials) {
      this.digitalCredentials.delete();
    }

    // Free recognizers memory.
    for (const [key, value] of Object.entries(this.recognizerList)) {
      value.delete();
      this.recognizerList[key] = null;
    }

    // Free scanners memory.
    for (const [key, value] of Object.entries(this.scannerList)) {
      value.delete();
      this.scannerList[key] = null;
    }
  }

  /**
   * Destructor.
   */
  disconnectedCallback() {
    this.destroy();
  }

  render() {
    return (
      <Host class={{ 'idv-ipad': SDKCore.Browser.isIPad() }}>
        {this.recognizers.map(r => {
          switch (r) {
            case SDKCore.SdkType.IDScan:
              return (
                <idv-id-scan
                  ref={ref => (this.idScan = ref)}
                  suppressHardErrorModals={this.suppressHardErrorModalsForIdScan}
                  translation={this.translation}
                  session={this.session}
                  backOfCardDocumentConditions={this.backOfCardDocumentConditions}
                  scanBothSides={this.scanBothSides}
                  enableDFA={this.enableDFA}
                  enableFaceMatch={this.enableFaceMatch}
                  semiAutoCapture={this.semiAutoCapture}
                  cameraResolution={this.cameraResolution}
                  enableRecording={this.enableRecording}
                  reviewFieldIssues={this.reviewFieldIssues}
                  enableGoodLocation={this.enableGoodLocation}
                  showResultScreen={this.showResultScreen}
                  extendedPayloadForSubmit={this.idScanExtendedPayloadForSubmit}
                  onRecognizerCreated={(
                    recognizer: IdvIdScanCustomEvent<SDKCore.IDScanRecognizer>,
                  ) => {
                    this.recognizerList.set(
                      SDKCore.SdkType.IDScan,
                      recognizer.detail as Recognizer,
                    );
                  }}
                  onScannerCreated={(scanner: IdvIdScanCustomEvent<SDKCore.Scanner>) => {
                    this.scannerList.set(SDKCore.SdkType.FaceScan, scanner.detail as Scanner);
                  }}
                  onSuccessEvent={(
                    e: IdvIdScanCustomEvent<SDKCore.DocumentIDScanResultWrapper>,
                  ) => {
                    this.scanSuccess.emit({
                      sdkType: SdkType.IDScan,
                      result: e.detail.id_scan_recognizer_result,
                      id: e.detail.document_id,
                      digitalCredentialId: null,
                    });
                  }}
                  onFailEvent={(e: IdvIdScanCustomEvent<SDKCore.IDScanProcessStatus>) => {
                    this.scanFail.emit({
                      sdkType: SdkType.IDScan,
                      result: e.detail,
                    });
                  }}
                ></idv-id-scan>
              );
            case SDKCore.SdkType.FaceScan:
              return (
                <idv-face-scan
                  ref={ref => (this.faceScan = ref)}
                  translation={this.translation}
                  enableDFA={this.enableDFA}
                  enableFaceMatch={this.enableFaceMatch}
                  session={this.session}
                  faceScanIntroScreenLogoPath={this.faceScanIntroScreenLogoPath}
                  transparentBackdrop={this.transparentFaceScanBackdrop}
                  extendedPayloadForSubmit={this.faceScanExtendedPayloadForSubmit}
                  onRecognizerCreated={(
                    recognizer: IdvFaceScanCustomEvent<SDKCore.FaceScanRecognizer>,
                  ) => {
                    this.recognizerList.set(
                      SDKCore.SdkType.FaceScan,
                      recognizer.detail as Recognizer,
                    );
                  }}
                  onScannerCreated={(scanner: IdvFaceScanCustomEvent<SDKCore.Scanner>) => {
                    this.scannerList.set(SDKCore.SdkType.FaceScan, scanner.detail as Scanner);
                  }}
                  onSuccessEvent={(e: IdvFaceScanCustomEvent<SDKCore.FaceScanResultWrapper>) => {
                    this.scanSuccess.emit({
                      sdkType: SdkType.FaceScan,
                      result: e.detail.face_scan_recognizer_result,
                      id: e.detail.liveness_id,
                      digitalCredentialId: null,
                    });
                  }}
                  onFailEvent={(e: IdvFaceScanCustomEvent<SDKCore.FaceScanProcessStatus>) => {
                    this.scanFail.emit({
                      sdkType: SdkType.FaceScan,
                      result: e.detail,
                    });
                  }}
                  onModalClosed={(e: IdvFaceScanCustomEvent<boolean>) => {
                    this.faceScanClosed.emit(e.detail);
                  }}
                ></idv-face-scan>
              );
            case SDKCore.SdkType.DigitalCredentials:
              return (
                <idv-digital-credentials
                  ref={ref => (this.digitalCredentials = ref)}
                  translation={this.translation}
                  session={this.session}
                  enableFaceMatch={this.enableFaceMatch}
                  onSuccessEvent={(
                    e: IdvDigitalCredentialsCustomEvent<DigitalCredentialsResultEvent>,
                  ) => {
                    this.scanSuccess.emit({
                      sdkType: SdkType.DigitalCredentials,
                      result: e.detail.result,
                      id: e.detail.documentId,
                      digitalCredentialId: e.detail.digitalCredentialId,
                    });
                  }}
                  onFailEvent={(e: IdvDigitalCredentialsCustomEvent<DigitalCredentialsStatus>) => {
                    this.scanFail.emit({
                      sdkType: SdkType.DigitalCredentials,
                      result: e.detail,
                    });
                  }}
                ></idv-digital-credentials>
              );
          }
        })}
      </Host>
    );
  }
}
