export enum DigitalCredentialsNextStepAction {
  DeepLink = 0,
  WebLink = 1,
  Message = 2,
}

export enum DcErrorKind {
  ConnectionError = 0,
  DataError = 1,
  InvalidInput = 2,
}

export interface DcError {
  kind: DcErrorKind;
  context?: string;
  display(): string;
}

export interface DigitalCredentialsNextStep {
  action: DigitalCredentialsNextStepAction;
  context: string;
}

export interface DigitalCredentialsStartOutput {
  document_id: string;
  digital_credential_id: string;
  next_step: DigitalCredentialsNextStep;
}

export enum DigitalCredentialsWaitForCompletionOutputKind {
  Complete = 0,
  NewStep = 1,
  InProgress = 2,
  VerificationFailed = 3,
  Aborted = 4,
}

export interface DigitalCredentialsWaitForCompletionOutput {
  kind: DigitalCredentialsWaitForCompletionOutputKind;
  payload?: string;
  next_step?: DigitalCredentialsNextStep;
}

export interface WaitForCompletionAbortController {
  abort(): Promise<void>;
}

export interface DigitalCredentials {
  start(
    issuer: string,
    redirect_url: string | undefined,
    enable_facematch: boolean,
  ): Promise<DigitalCredentialsStartOutput>;

  wait_for_completion(
    digital_credential_id: string,
    current_step: DigitalCredentialsNextStep,
    abort_controller: WaitForCompletionAbortController,
  ): Promise<DigitalCredentialsWaitForCompletionOutput>;

  new_wait_for_completion_abort_controller(): WaitForCompletionAbortController;
}
