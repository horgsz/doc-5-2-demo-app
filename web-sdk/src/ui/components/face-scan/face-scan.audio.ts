import { getAssetPath } from '@stencil/core';

export const faceScanAudioFiles = [
  {
    name: 'SuccessSound',
    src: {
      mp3: getAssetPath('./assets/audio/shared/success-sound.mp3'),
      ogg: getAssetPath('./assets/audio/shared/success-sound.ogg'),
    },
  },
];
