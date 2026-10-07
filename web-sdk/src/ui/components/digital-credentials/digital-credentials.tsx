import { Component, Event, EventEmitter, Host, Method, Prop, State, h } from '@stencil/core';
import type {
  DigitalCredentials,
  DigitalCredentialsNextStep,
  WaitForCompletionAbortController,
} from '../../../IDVerseSDK/digital-credentials/DigitalCredentials';
import {
  DigitalCredentialsNextStepAction,
  DcErrorKind,
  DigitalCredentialsWaitForCompletionOutputKind,
} from '../../../IDVerseSDK/digital-credentials/DigitalCredentials';
import {
  Session,
  SdkError,
  ErrorCode,
  DocumentInfo,
  DateValidation,
  onScreenOrientationChange,
  readScreenOrientation,
} from '@utils/interface';
import { Translation } from '@utils/translation';
import { sleep, TIME_TO_KEEP_SUCCESS_CHECK_ANIMATION_ON_IN_MS } from '@utils/utils';
import { idScanAudioFiles } from '../id-scan/id-scan.audio';
import { ModalHardErrors } from '../sdk-ui.error';

export interface DigitalCredentialsDetails {
  documentAnalysis?: any;
  documentInfo: DocumentInfo;
  imageValidation?: any;
  dateValidation?: DateValidation;
  digital_credentials: any;
  comparedResultsVizVsMachineReadable?: any;
  extractedInfo?: any;
}

export interface DigitalCredentialsResult {
  status: Number;
  details: DigitalCredentialsDetails;
}

export interface DigitalCredentialsResultEvent {
  result: DigitalCredentialsResult;
  digitalCredentialId: string;
  documentId: string;
}

export enum DigitalCredentialsStatus {
  Failed,
  Cancelled,
}

@Component({
  tag: 'idv-digital-credentials',
  styleUrl: 'digital-credentials.scss',
  shadow: true,
})
export class IDVerseDigitalCredentials {
  /**
   * Flow configuration.
   */
  @Prop() completeScreen: boolean = true;
  @Prop() disableScreenLandscape: boolean | undefined = false;
  @Prop() translation: Translation;
  @Prop() session: Session;
  @Prop() enableFaceMatch?: boolean = false;

  /**
   * Digital credential events.
   */
  @Event() tryAgain?: EventEmitter<null>;
  @Event() successEvent?: EventEmitter<DigitalCredentialsResultEvent>;
  @Event() failEvent?: EventEmitter<DigitalCredentialsStatus>;
  @Event() fatalError?: EventEmitter<SdkError>;
  @Event() screenLandscape?: EventEmitter<null>;

  /**
   * Real-time states.
   */
  @State() nextStep: DigitalCredentialsNextStep | null = null;
  @State() documentId: string | null = null;
  @State() digitalCredentialId: string | null = null;
  @State() started: boolean = false;
  @State() failure: boolean = false;
  @State() loading: boolean = false;
  @State() completed: boolean = false;
  @State() isLandscape: boolean = false;
  @State() playingAudio: boolean = false;
  @State() loadAudio: boolean = false;
  @State() forceShowMessage: boolean = false;
  @State() showSuccessAnimation: boolean = false;
  @State() interError: { title: string; message: string } | null = null;
  @State() issuer: string | null = null;
  @State() redirectUrl: string | null = null;
  @State() abort_controller: WaitForCompletionAbortController | null = null;

  /**
   * Properties
   */
  private sdk: DigitalCredentials | undefined;
  private audio: any;

  componentWillLoad() {}

  async componentDidLoad() {
    if (this.disableScreenLandscape) {
      // screen.orientation is missing before Safari 16.4; the helper falls back
      onScreenOrientationChange(() => {
        this.isLandscape = readScreenOrientation().type.includes('landscape');
      });
    }

    window.onbeforeunload = () => {
      this.clear();
    };
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

  @Method()
  async getSdk(): Promise<any | undefined> {
    return Promise.resolve(this.sdk);
  }

  @Method()
  async setSdk(sdk: any) {
    this.sdk = sdk;
    this.loadAudio = true;
  }

  @Method()
  async isCompleted(): Promise<boolean> {
    return this.completed;
  }

  @Method()
  /**
   * Run the digital credentials flow
   * @param issuer The issuer, e.g. "ca-mdl"
   * @param redirectUrl optional,
   *    url where we want the user to be redirected once they complete the in-app process
   */
  async runFlow(issuer: string, redirectUrl?: string): Promise<void> {
    this.issuer = issuer;
    this.redirectUrl = redirectUrl;
    this.loading = true;
    this.started = true;
    try {
      const output = await this.sdk.start(issuer, redirectUrl || '', this.enableFaceMatch);
      this.documentId = output.document_id;
      this.digitalCredentialId = output.digital_credential_id;
      this.nextStep = output.next_step;
      switch (this.nextStep.action) {
        case DigitalCredentialsNextStepAction.WebLink:
          // Will set back to true once user clicks the redirect link:
          this.loading = false;
          break;
        case DigitalCredentialsNextStepAction.DeepLink:
          // Will set back to true once user clicks the redirect link:
          this.loading = false;
          break;
        case DigitalCredentialsNextStepAction.Message:
          this.loading = true;
          break;
        default:
          throw `Unexpected action: ${this.nextStep.action}`;
      }
      await this.waitForCompletion();
    } catch (error) {
      this.handleFatalError(error);
    }
  }

  async waitForCompletion(): Promise<void> {
    try {
      if (this.abort_controller) {
        await this.abort_controller.abort();
      }

      this.abort_controller = this.sdk.new_wait_for_completion_abort_controller();

      loop: while (true) {
        const output = await this.sdk.wait_for_completion(
          this.digitalCredentialId,
          this.nextStep,
          this.abort_controller,
        );
        switch (output.kind) {
          case DigitalCredentialsWaitForCompletionOutputKind.NewStep:
            // Want to recall wait_for_completion after updating step,
            // next step may change rendering
            this.nextStep = output.next_step;
            break;

          case DigitalCredentialsWaitForCompletionOutputKind.Complete:
            let results = JSON.parse(output.payload);
            this.successEvent.emit({
              result: {
                status: results.status,
                details: results.details,
              },
              digitalCredentialId: results.digitalCredentialId,
              documentId: results.documentId,
            });
            this.loading = false;
            this.completed = true;
            this.showSuccessAnimation = true;
            this.playSound('SuccessSound', true);

            await sleep(TIME_TO_KEEP_SUCCESS_CHECK_ANIMATION_ON_IN_MS);
            await this.clear();
            break loop;
          case DigitalCredentialsWaitForCompletionOutputKind.InProgress:
            this.loading = true;
            break;

          case DigitalCredentialsWaitForCompletionOutputKind.VerificationFailed:
            this.failEvent.emit(DigitalCredentialsStatus.Failed);
            this.interError = ModalHardErrors.ExternalVerificationFailed;
            this.loading = false;
            break loop;

          case DigitalCredentialsWaitForCompletionOutputKind.Aborted:
            this.failEvent.emit(DigitalCredentialsStatus.Cancelled);
            await this.clear();
            break loop;

          default:
            throw `Unknown DigitalCredentialsWaitForCompletionOutputKind: ${output.kind}`;
        }
      }
    } catch (error) {
      this.handleFatalError(error);
    }
    this.loading = false;
  }

  handleFatalError(error: any) {
    if (error instanceof SdkError) {
      this.fatalError.emit(error);
      this.interError = ModalHardErrors.Unexpected;
    } else if (error.kind) {
      switch (error.kind) {
        case DcErrorKind.InvalidInput:
          this.fatalError.emit(new SdkError(ErrorCode.InternalError, error.display()));
          this.interError = ModalHardErrors.Unexpected;
          break;
        case DcErrorKind.ConnectionError:
          this.fatalError.emit(new SdkError(ErrorCode.NetworkError, error.display()));
          this.interError = ModalHardErrors.Unexpected;
          break;
        case DcErrorKind.DataError:
          this.fatalError.emit(new SdkError(ErrorCode.InternalError, error.display()));
          this.interError = ModalHardErrors.Unexpected;
          break;
      }
    } else {
      this.fatalError.emit(new SdkError(ErrorCode.InternalError, error));
      this.interError = ModalHardErrors.Unexpected;
    }
  }

  // #region Clear
  /**
   * Clears instances.
   */
  async clear() {
    this.clearState();

    if (this.sdk) {
      this.sdk = null;
    }
  }

  async clearState() {
    if (this.abort_controller) {
      await this.abort_controller.abort();
    }
    this.abort_controller = null;

    this.nextStep = null;
    this.documentId = null;
    this.digitalCredentialId = null;
    this.started = false;
    this.loading = false;
    this.showSuccessAnimation = false;
    this.completed = false;
    this.issuer = null;
    this.redirectUrl = null;
    this.interError = null;
  }

  async restartFlow() {
    let issuer = this.issuer;
    let redirectUrl = this.redirectUrl;
    await this.clearState();
    await this.runFlow(issuer, redirectUrl);
  }

  /**
   * Clears instances.
   */
  @Method()
  async delete() {
    await this.clear();
  }

  disconnectedCallback() {
    this.clear();
  }

  // #region Render
  render() {
    const stepButtons = [
      {
        label: this.translation._t('digital-credentials-cancel').toString(),
        variant: 'primary outline',
        onClick: () => {
          this.clear();
        },
      },
    ];

    if (
      this.nextStep &&
      this.sdk &&
      [
        DigitalCredentialsNextStepAction.WebLink,
        DigitalCredentialsNextStepAction.DeepLink,
      ].includes(this.nextStep.action)
    ) {
      const url = this.nextStep.context;
      stepButtons.push({
        label: this.translation._t('digital-credentials-redirect-button').toString(),
        variant: 'primary',
        onClick: () => {
          window.open(url, '_blank');
          this.loading = true;
        },
      });
    }

    /** Error modal buttons. */
    const errorButtons = [
      {
        label: this.translation._t('digital-credentials-cancel').toString(),
        variant: 'primary outline',
        onClick: () => {
          this.clear();
        },
      },
      {
        label: this.translation._t('digital-credentials-try-again').toString(),
        variant: 'primary',
        onClick: () => {
          this.tryAgain.emit();
          this.interError = null;
          this.restartFlow();
        },
      },
    ];

    let modalBody = '';
    if (this.nextStep) {
      switch (this.nextStep.action) {
        case DigitalCredentialsNextStepAction.WebLink:
          modalBody = this.translation
            ._t('digital-credentials-redirect-body')
            ?.toString() as string;
          break;
        case DigitalCredentialsNextStepAction.DeepLink:
          modalBody = this.translation
            ._t('digital-credentials-redirect-body')
            ?.toString() as string;
          break;
        case DigitalCredentialsNextStepAction.Message:
          modalBody = this.nextStep.context;
          break;
      }
    }

    return (
      <Host>
        {this.disableScreenLandscape && <idv-landscape visible={this.isLandscape} />}
        <idv-id-scan-status
          visible={this.showSuccessAnimation && this.completeScreen}
          status="success"
          heading={this.translation._t('id-scan-success').toString()}
        />
        {!this.interError && this.started && this.sdk && !this.completed && (
          <idv-modal
            visible
            heading={this.translation._t('digital-credentials-redirect-header')?.toString()}
            buttons={stepButtons}
          >
            {modalBody}
            <idv-loading
              visible={this.loading}
              forceShow={this.forceShowMessage}
              primary={true}
              fixed={false}
            />
          </idv-modal>
        )}
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
