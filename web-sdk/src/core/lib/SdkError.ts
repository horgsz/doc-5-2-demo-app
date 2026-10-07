/**
 * SDK Error codes.
 */
export enum ErrorCode {
  None = '',
  WorkerLoadFailure = 'WorkerLoadFailure',
  WorkerInitFailure = 'WorkerInitFailure',
  WorkerUnknownAction = 'WorkerUnknownAction',
  InvalidSessionCredentials = 'InvalidSessionCredentials',
  SdkManagerFailure = 'SdkManagerFailure',
  SdkManagerMissing = 'SdkManagerMissing',
  WasmModuleMissing = 'WasmModuleMissing',
  RecognizerFailure = 'RecognizerFailure',
  RecognizerMissing = 'RecognizerMissing',
  GetPayloadFailure = 'GetPayloadFailure',
  InvokeFunctionFailure = 'InvokeFunctionFailure',
  ProcessImageFailure = 'ProcessImageFailure',
  AnalysisFailure = 'AnalysisFailure',
  ProcessImageParams = 'ProcessImageParams',
  GetResultFailure = 'GetResultFailure',
  MediaDevicesFailure = 'MediaDevicesFailure',
  CameraFeedMissing = 'CameraFeedMissing',
  CameraNotAllowed = 'CameraNotAllowed',
  CameraNotFound = 'CameraNotFound',
  CameraNotAvailable = 'CameraNotAvailable',
  CameraBusy = 'CameraBusy',
  UnknownCallback = 'UnknownCallback',
  VideoFeedPaused = 'VideoFeedPaused',
  VideoFeedPlayFailure = 'VideoFeedPlayFailure',
  VideoFeedMissing = 'VideoFeedMissing',
  RecordNotSupported = 'RecordNotSupported',
  RecordFailure = 'RecordFailure',
  NotRecordingState = 'NotRecordingState',
  InvalidCredentials = 'InvalidCredentials',
  SessionExpired = 'SessionExpired',
  PayloadCorrupted = 'PayloadCorrupted',
  PayloadVerificationFailed = 'PayloadVerificationFailed',
  NetworkError = 'NetworkError',
  InternalError = 'InternalError',
  DigitalCredentialsCancelled = 'DigitalCredentialsCancelled',
  UnknownInvokeFunctionResponse = 'UnknownInvokeFunctionResponse',
  InvalidResponse = 'InvalidResponse',
}

/**
 * SDK Error messages.
 */
export const errorMessages: any = {
  WorkerLoadFailure: 'Failed to load wasm module.',
  WorkerInitFailure: 'Failed initiate worker file.',
  WorkerUnknownAction: 'Unknown worker action.',
  InvalidSessionCredentials: 'Invalid session credentials.',
  SdkManagerFailure: 'Failed to create sdk manager.',
  SdkManagerMissing: 'Missing sdk manager instance.',
  WasmModuleMissing: 'Missing wasm module.',
  RecognizerFailure: 'Failed to create and authenticate the recognizer.',
  RecognizerMissing: 'Missing recognizer instance.',
  AnalyzerFailure: 'Failed to create the verifier.',
  AnalyzerMissing: 'Missing verifier instance.',
  GetPayloadFailure: 'Failed to get the payload.',
  InvokeFunctionFailure: 'Invalid function.',
  ProcessImageFailure: 'Failed to process the image.',
  AnalysisFailure: 'Failed to process the verification.',
  ProcessImageParams: 'Process image parameters are missing.',
  GetResultFailure: 'Failed to get scan results.',
  MediaDevicesFailure: 'Your browser does not support mediaDevices feature.',
  CameraFeedMissing: 'Camera feed video element is missing',
  CameraNotAllowed: 'Camera is not allowed.',
  CameraNotFound: 'Camera is not found.',
  CameraNotAvailable: 'Camera is not available.',
  CameraBusy: 'Camera is busy.',
  UnknownCallback: 'Unknown callback type.',
  VideoFeedPaused: 'The video feed has been paused.',
  VideoFeedPlayFailure: 'Failed to play the video feed.',
  VideoFeedMissing: 'Video element is missing',
  RecordNotSupported: 'RecordRTC is not supported by your browser.',
  RecordFailure: 'Failed to start RecordRTC.',
  NotRecordingState: 'RecordRTC is not in recording state.',
  InvalidCredentials: 'Invalid credentials.',
  SessionExpired: 'Your session is expired.',
  PayloadVerificationFailed: 'Failed to verify the credentials.',
  NetworkError: 'Network error.',
  InternalError: 'Something went wrong, please try again later.',
  DigitalCredentialsCancelled:
    'Digital credentials session expired, was cancelled or rejected by the user.',
};

export class SdkError {
  readonly code: string;
  readonly message: string;
  readonly stack?: any;

  constructor(code: string, message?: string | null, stack?: any) {
    this.code = code;
    this.message = message || errorMessages[code] || '';
    this.stack = stack;
  }
}
