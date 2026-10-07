import { getAssetPath } from '@stencil/core';

export const idScanAudioFiles = [
  {
    name: 'SuccessSound',
    src: {
      mp3: getAssetPath('./assets/audio/shared/success-sound.mp3'),
      ogg: getAssetPath('./assets/audio/shared/success-sound.ogg'),
    },
  },
  {
    name: 'ErrorSound',
    src: {
      mp3: getAssetPath('./assets/audio/id-scan/error-sound.mp3'),
      ogg: getAssetPath('./assets/audio/id-scan/error-sound.ogg'),
    },
  },
];
