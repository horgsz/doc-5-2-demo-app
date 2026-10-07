// NOTE: When adding new translation keys here, please ping the IDVP devs so the
// corresponding keys can be added/mapped in `mobile-flow` (see
// `apps/mobile-flow/bins/mobile-flow/src/utils/i18n/sdk_translation_keys.rs`
// and the `sdk-*` entries in `apps/mobile-flow/bins/mobile-flow/i18n/*.ftl`).
export const englishTranslations: { [key: string]: string | string[] } = {
  // ID Scan
  'id-scan-instruction-front': 'Get ready to scan the front of your ID.',
  'id-scan-instruction-back': 'Get ready to scan the back of Your ID.',
  'id-scan-front-of-id': 'Scan front of ID',
  'id-scan-back-of-id': 'Scan back of ID',
  'id-scan-move-in-frame': 'Move ID in frame',
  'id-scan-move-closer': 'Move ID closer',
  'id-scan-move-farther': 'Move ID further away',
  'id-scan-reduce-glare': 'Reduce glare',
  'id-scan-fix-blur': 'Fix camera blur',
  'id-scan-close': 'Close',
  'id-scan-try-again': 'Try again',
  // Semi-auto capture mode
  'id-scan-capture-hint-front': 'Position your ID and tap to capture',
  'id-scan-capture-hint-back': 'Position the back of your ID, then tap to capture',
  'id-scan-capture-processing': 'Checking your capture…',
  'id-scan-capture-retry': 'Adjust the ID and try again.',
  // A press the engine rejected for glare or blur (6.0 reports these on a press).
  'id-scan-capture-unclear': 'Image is not clear, try again.',
  // The engine could not download the data a read needed (6.0's on-demand files).
  'id-scan-capture-connection': 'Check your internet connection and try again.',
  'id-scan-capture-button': 'Capture',
  'id-scan-capture-result-heading': 'Captured details',
  'id-scan-capture-result-done': 'Done',
  'id-scan-capture-result-empty': 'No fields could be read from this capture.',
  'id-scan-capture-issues-heading': 'Check these details',
  'id-scan-capture-issues-description':
    'Some details did not come out clearly. Retake for a better read, or continue with what was captured.',
  'id-scan-capture-issues-summary-one': 'We read most of your card. One thing needs another look.',
  'id-scan-capture-issues-summary-many':
    'We read most of your card. {count} things need another look.',
  'id-scan-capture-issues-recapture': 'Retake',
  'id-scan-capture-issues-proceed': 'Continue anyway',
  // Sentence case: these are now shown in a pill rather than run on after the
  // field name, so they read as a status rather than a fragment.
  'id-scan-capture-issues-missing': 'Not found',
  'id-scan-capture-issues-unclear': 'Partly clear',
  // The classifier reports only that the portrait is obscured, not by what --
  // a thumb is the usual cause and the wording the design calls for, but it is
  // a guess at the cause, not something the engine detected.
  // Shown alone under the heading when so many fields came out weak that
  // listing them stops being useful -- the crop stays, the list goes.
  'id-scan-capture-issues-unclear-document': 'Your ID is not clear.',
  'id-scan-capture-issues-face-covered': 'Covered by thumb',
  'id-scan-capture-issues-face-glare': 'Glare on photo',
  'id-scan-capture-issues-face-blur': 'Photo unclear',
  'id-scan-capture-assets': 'Assets',
  'id-scan-asset-original-front': 'Original image — front',
  'id-scan-asset-original-back': 'Original image — back',
  'id-scan-asset-crop-front': 'Cropped document — front',
  'id-scan-asset-crop-back': 'Cropped document — back',
  'id-scan-asset-result': 'Result JSON',
  'id-scan-asset-video': 'Session recording',
  'id-scan-capture-download-frame': 'Download original frame',
  'id-scan-capture-download-video': 'Download session video',
  'id-scan-success': 'Capture successful!',
  'id-scan-too-much-glare': 'ID had too much glare',
  'id-scan-glare-advice':
    'Minimize glare by finding a better angle, then go ahead and try scanning your ID again.',
  'id-scan-too-blurry': 'The camera was too blurry',
  'id-scan-blur-advice':
    'Minimize blur by finding a better angle, then go ahead and try scanning your ID again.',
  'id-scan-too-close': 'ID was too close',
  'id-scan-close-advice':
    'Minimize the distance by finding a better angle, then go ahead and try scanning your ID again.',
  'id-scan-too-far': 'ID was too far away',
  'id-scan-out-of-frame': 'ID wasn’t in frame',
  'id-scan-retry': 'Try scanning your ID again.',
  'id-scan-failed': 'Capture failed!',
  'id-scan-failure-message': 'Failed to capture your ID document, please try again.',
  'id-scan-validity-question': 'Is your ID a valid document?',
  'id-scan-validity-advice': 'Make sure you are using a supported ID document.',
  'id-scan-not-captured': 'We couldn’t capture your ID',
  'id-scan-visibility-advice':
    'Make sure your ID document is completely visible, clear and well lit including the edges.',
  'id-scan-paused': 'ID capture paused',
  'id-scan-position-id': 'Please make sure you position your ID in front of the camera.',
  // The paused screen's button. Not "Try again": nothing failed and nothing is
  // retried -- the scan is still open and this picks it back up.
  'id-scan-paused-continue': 'Continue',
  'id-scan-flip-and-scan': 'Flip and scan the back of your ID',
  'id-scan-exception-tips-tabs-your-capture': 'Your Capture',
  'id-scan-exception-tips-tabs-capture-tip': 'Capture Tip',
  'id-scan-capturing': 'Capturing document...',
  'id-scan-extracting': 'Extracting data...',

  // Face Scan
  'face-scan-aim-at-face': 'Aim at face',
  'face-scan-face-detected': 'Face detected',
  'face-scan-multiple-faces': 'Two faces detected',
  'face-scan-bad-light': 'Bad light',
  'face-scan-not-detected': 'Face not detected',
  'face-scan-visible-face': 'Please make sure your face is visible to the camera.',
  'face-scan-failed': 'Face scan failed',
  'face-scan-ready': 'Get ready to verify your face',
  'face-scan-aim-instructions':
    'Aim your face at the camera to experience the next generation of DeepFake defender, MIM Prevention, and PAD/Spoof Models',
  'face-scan-take-selfie': 'Take a selfie',
  'face-scan-start-capture': 'Start capture',

  // Digital Credentials
  'digital-credentials-redirect-header': 'Share your mDL information',
  'digital-credentials-redirect-body':
    'Share your mDL information with our partner, then come back here.',
  'digital-credentials-redirect-button': 'Share',
  'digital-credentials-cancel': 'Cancel',
  'digital-credentials-try-again': 'Try again',

  // General Responses
  'response-yes': 'Yes',
  'response-no': 'No',

  // Recognizer and Error Handling
  'recognizer-failure': 'Recognizer failure',
  'recognizer-failure-message': 'Failed to create ID Scan Recognizer.',
  'document-capture-failed': 'Failed to capture',
  'document-capture-advice':
    'Please make sure your document is readable. You may need to close or try again.',

  // Modal Hard Errors
  'modal-hard-error-unexpected-title': 'Something went wrong',
  'modal-hard-error-unexpected-description':
    'This may be due to a temporary system or network issue. Please try again.',

  'modal-hard-error-camera-not-found-title': 'Camera not found',
  'modal-hard-error-camera-not-found-description':
    'Please make sure your webcam is set and running.',

  'modal-hard-error-camera-not-allowed-title': 'Permission issue',
  'modal-hard-error-camera-not-allowed-description':
    'Please make sure your camera access permission is allowed.',

  'modal-hard-error-camera-not-available-title': 'Camera is not available',
  'modal-hard-error-camera-not-available-description': 'Please make sure your webcam is available.',

  'modal-hard-error-camera-busy-title': 'Camera is busy',
  'modal-hard-error-camera-busy-description':
    'Failed to access your camera. Probably your camera is in use.',

  'modal-external-verification-failed-title': 'External verification failed',
  'modal-external-verification-failed-description':
    'The external verification process did not complete successfully.',
  'modal-digital-credentials-cancelled-title': 'Digital credentials verification rejected',
  'modal-digital-credentials-cancelled-description':
    'The digital credentials verification was cancelled or rejected.',
};
