import { Component, EventEmitter, Host, Method, Prop, State, h } from '@stencil/core';
import * as SDKCore from '@utils/interface';

import AimCamera from '@animations/face-scan/AimFace.json';
import Success from '@animations/face-scan/Success.json';
import TwoFaces from '@animations/face-scan/TwoFaces.json';
import Warning from '@animations/face-scan/Warning.json';

import { Event } from '@stencil/core';
import {
  SDKManager,
  FaceScanResultWrapper,
  FaceScanProcessStatus,
  SdkError,
  Scanner,
  FaceScanRecognizer,
  Session,
} from '@utils/interface';
import { Translation } from '@utils/translation';
import { faceScanAudioFiles } from './face-scan.audio';

@Component({
  tag: 'idv-face-scan',
  styleUrl: 'face-scan.scss',
  shadow: true,
})
export class IDVerseFaceScan {
  /**
   * Face Scan Properties.
   */
  @Prop() darkMode: boolean = false;
  @Prop() disableScreenLandscape: boolean | undefined = false;
  @Prop() translation: Translation;
  @Prop() session: Session;
  @Prop() enableDFA?: boolean = false;
  @Prop() enableFaceMatch?: boolean = false;
  @Prop() faceScanIntroScreenLogoPath?: string;
  @Prop() transparentBackdrop: boolean = false;

  /* When calling payload submit when scanning face, this additional/optional data will extend the original payload */
  @Prop() extendedPayloadForSubmit?: Record<string, any>;

  /**
   * Face Scan events.
   */
  @Event() tryAgain?: EventEmitter<null>;
  @Event() done?: EventEmitter<null>;
  @Event() payload?: EventEmitter<Blob>;
  @Event() readyEvent?: EventEmitter<null>;
  @Event() successEvent?: EventEmitter<FaceScanResultWrapper>;
  @Event() failEvent?: EventEmitter<FaceScanProcessStatus>;
  @Event() fatalError?: EventEmitter<SdkError>;
  @Event() screenLandscape?: EventEmitter<null>;

  @Event() recognizerCreated?: EventEmitter<FaceScanRecognizer>;
  @Event() scannerCreated?: EventEmitter<Scanner>;
  @Event() modalClosed?: EventEmitter<boolean>;

  /**
   * Face Scan states.
   */
  @State() state: string = 'BASIC';
  @State() skipIntro: boolean = false;
  @State() visibility: boolean = false;
  @State() loadAudio: boolean = false;
  @State() playingAudio: boolean = false;

  private videoFeed: HTMLVideoElement;
  private idvVideo: any;
  private modal: any;
  private recognizer: FaceScanRecognizer;
  private scanner: Scanner;
  private sdkManager: SDKManager;
  private audio: any;
  private completed: boolean;

  // #region Create
  async createRecognizer(): Promise<void> {
    this.loadAudio = true;

    /**
     * Set up ID Scan Engine callbacks. (optional)
     */
    const callbacks: SDKCore.RecognizerCallbacks = {
      onFaceScanDetection: (status: SDKCore.FaceScanDetectionStatus) => {
        this.onDetection(status);
      },
    };

    const recognizerSettings: SDKCore.FaceScanRecognizerSettings = {
      enableDFA: this.enableDFA,
      enableFaceMatch: this.enableFaceMatch,
      SDKVersion: '0.5.0',
    };

    return new Promise(async (resolve, reject) => {
      if (this.recognizer) {
        return resolve();
      }

      try {
        this.recognizer = await SDKCore.createFaceScanRecognizer(
          this.sdkManager,
          recognizerSettings,
          callbacks,
        );

        this.recognizerCreated.emit(this.recognizer);

        resolve();
      } catch (error: any) {
        reject(error);
        this.fatalError.emit(error);
      }
    });
  }

  /**
   * Creates SDK Scanner instance.
   */
  async createScanner(): Promise<void> {
    const scannerSettings: SDKCore.ScannerSettings = {
      cameraFeed: this.videoFeed,
      cameraType: SDKCore.CameraType.Front,
      cameraResolution: SDKCore.CameraResolution.VGA,
      disableScreenLandscape: this.disableScreenLandscape,
      startAfter: 1000,
      enableApiVerification: true,
      isFaceScan: true,
    };

    if (this.screenLandscape) {
      scannerSettings.onScreenLandscape = () => this.screenLandscape.emit();
    }

    return new Promise(async (resolve, reject) => {
      if (this.scanner) {
        return resolve();
      }

      if (!this.recognizer) {
        return reject(new Error('Recognizer is missing, cannot create scanner'));
      }

      try {
        this.scanner = await SDKCore.Scanner.create(this.recognizer, scannerSettings);

        this.scannerCreated.emit(this.scanner);

        resolve();
      } catch (error: any) {
        reject(error);
        this.fatalError.emit(error);
      }
    });
  }

  // #region On Detection
  /**
   * Handles detection status.
   *
   * @param status ID Scan detection status.
   */
  onDetection(status: SDKCore.FaceScanDetectionStatus): void {
    switch (status) {
      case SDKCore.FaceScanDetectionStatus.Empty:
        this.modal.guide(
          'empty',
          this.translation._t('face-scan-aim-at-face').toString(),
          AimCamera,
          250,
        );
        break;
      case SDKCore.FaceScanDetectionStatus.BadLight:
        this.modal.guide(
          'bad-light',
          this.translation._t('face-scan-bad-light').toString(),
          Warning,
          0,
          true,
        );
        break;
      case SDKCore.FaceScanDetectionStatus.MultipleFaces:
        this.modal.guide(
          'multiple-faces',
          this.translation._t('face-scan-multiple-faces').toString(),
          TwoFaces,
          0,
          true,
        );
        break;
      case SDKCore.FaceScanDetectionStatus.Valid:
        this.modal.guide(
          'valid',
          this.translation._t('face-scan-face-detected').toString(),
          Success,
          0,
          false,
          true,
        );
        break;
      default:
        break;
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

  /**
   * Returns the recognizer instance.
   */
  @Method()
  async setVisibility(visibility: boolean): Promise<void> {
    this.visibility = visibility;

    if (visibility && this.modal) {
      this.modal.reset();
    }
  }

  // #region Start
  /**
   * Starts the scanning process.
   */
  @Method()
  async startScanning(skipIntro: boolean = true): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        this.videoFeed = await this.idvVideo.getVideoRef();

        this.completed = false;
        this.skipIntro = skipIntro;

        if (skipIntro) {
          this.state = 'SCANNING';
        }

        await this.createRecognizer();
        await this.createScanner();

        this.state = 'SCANNING';
        this.modal.guide(
          'empty',
          this.translation._t('face-scan-aim-at-face').toString(),
          AimCamera,
          250,
        );

        if (!this.visibility) {
          this.visibility = true;
        }

        const scanState: SDKCore.RecognizerState = await this.scanner.start();
        await this.modal.loading();
        const scanResult: SDKCore.FaceScanRecognizerResult = await this.recognizer.getResults();

        if (scanState === SDKCore.RecognizerState.Valid) {
          const recordingSaved = await this.scanner.finishRecording();
          this.sdkManager.onUploadsComplete = async () => {
            try {
              await this.handleComplete(scanResult);
              this.completed = true;
              resolve();
            } catch (e) {
              console.error(e);
              await this.modal.showError(
                this.translation._t('modal-hard-error-unexpected-title') as string,
                this.translation._t('modal-hard-error-unexpected-description') as string,
              );
              reject(e);
            }
          };

          // Complete the upload process (nothing to wait for without a recording)
          await this.sdkManager.checkUploadStatus(recordingSaved);
        } else {
          this.state = 'ERROR';

          await this.modal.showError(
            this.translation._t('face-scan-not-detected').toString(),
            this.translation._t('face-scan-visible-face').toString(),
          );

          this.failEvent.emit(SDKCore.FaceScanProcessStatus.Empty);

          await this.clear();

          return reject();
        }
      } catch (e) {
        await this.modal.showError(
          this.translation._t('modal-hard-error-unexpected-title') as string,
          this.translation._t('modal-hard-error-unexpected-description') as string,
        );
        reject(e);
      }
    });
  }

  @Method()
  async isCompleted(): Promise<boolean> {
    return this.completed;
  }

  /**
   * Handle complete.
   * @param scanState Scan state.
   * @param scanResult Scan result.
   * @returns
   */
  async handleComplete(scanResult: SDKCore.FaceScanRecognizerResult): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (scanResult.status === SDKCore.FaceScanProcessStatus.Pass) {
        try {
          const payload = await this.recognizer.getPayload();

          const response = await this.session.submit(payload, this.extendedPayloadForSubmit);
          const data = await response.json();

          await this.modal.complete();

          // Notify success.
          this.successEvent.emit(new FaceScanResultWrapper(data.liveness_id, scanResult));

          this.reset();
          resolve();
        } catch (e) {
          console.error(e);

          await this.modal.showError(
            this.translation._t('modal-hard-error-unexpected-title') as string,
            this.translation._t('modal-hard-error-unexpected-description') as string,
          );

          return reject(e);
        }
      } else {
        this.state = 'ERROR';
        await this.modal.showError(
          this.translation._t('face-scan-failed').toString(),
          this.translation._t('face-scan-visible-face').toString(),
        );
        this.failEvent.emit(scanResult.status);
        await this.clear();
        reject(new Error('No valid scanResult.status'));
      }
    });
  }

  /**
   * Handles playing sound.
   * @param name name of the sound
   */
  playSound(name: string, force: boolean = false): void {
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
   * Handles trying again.
   */
  async handleTryAgain(): Promise<void> {
    this.state = 'SCANNING';
    this.tryAgain.emit();
    await this.clear();
    await this.startScanning(false);
  }

  /**
   * Resets the process.
   */
  async reset(emitModalClosed = false) {
    this.visibility = false;
    this.state = 'BASIC';
    await this.clear();
    if (emitModalClosed) {
      this.modalClosed.emit(true);
    }
  }

  // #region Clear
  /**
   * Clears instances.
   */
  async clear() {
    if (this.scanner) {
      await this.scanner.delete();
      this.scanner = null;
    }

    if (this.recognizer) {
      await this.recognizer.delete();
      this.recognizer = null;
    }
  }

  /**
   * Clears instances.
   */
  @Method()
  async delete() {
    await this.clear();
  }

  render() {
    return (
      <Host>
        <div
          class={{
            'idv-dark-mode': this.darkMode,
          }}
        >
          <idv-video ref={ref => (this.idvVideo = ref)} visible={false} />
          <idv-face-scan-modal
            ref={ref => {
              if (!this.modal) this.modal = ref;
            }}
            state={this.state}
            visible={this.visibility}
            skipIntro={this.skipIntro}
            transparentBackdrop={this.transparentBackdrop}
            onClosed={async () => await this.reset(true)}
            onTryAgain={async () => await this.handleTryAgain()}
          >
            <idv-face-scan-intro
              visible={this.state == 'BASIC'}
              heading={this.translation._t('face-scan-ready').toString()}
              description={this.translation._t('face-scan-aim-instructions').toString()}
              selfieText={this.translation._t('face-scan-take-selfie').toString()}
              startCaptureText={this.translation._t('face-scan-start-capture').toString()}
              faceScanIntroScreenLogoPath={this.faceScanIntroScreenLogoPath}
              onCaptureStarted={() => this.startScanning(false)}
            />
            <idv-audio-player
              files={faceScanAudioFiles}
              ref={(ref: any) => (this.audio = ref)}
              load={this.loadAudio}
            />
          </idv-face-scan-modal>
        </div>
      </Host>
    );
  }
}
