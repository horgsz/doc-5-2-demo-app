import { Config } from '@stencil/core';
import { sass } from '@stencil/sass';
import alias from '@rollup/plugin-alias';
import path from 'path';
import { readFileSync } from 'fs';

// @ts-ignore
const validSSLKeys = process.env.STENCIL_DEV_SSL_CERT && process.env.STENCIL_DEV_SSL_KEY;

// The published package only ships the `dist` target. The dev server, though,
// needs a `www` root to serve src/index.html and its /build assets from --
// without one it just lists the project directory. Added for --dev/--serve
// only so `npm run build` output stays exactly as it was.
// @ts-ignore
const isDevServe = process.argv.includes('--dev') || process.argv.includes('--serve');

export const config: Config = {
  namespace: 'idv-sdk-web-ui',
  globalStyle: 'src/ui/global/_global.scss',
  transformAliasedImportPaths: true,
  extras: {
    enableImportInjection: true,
  },
  outputTargets: [
    {
      type: 'dist',
      esmLoaderPath: '../loader',
      empty: true,
      copy: [{ src: 'ui/assets', dest: 'assets' }],
    },
    ...(isDevServe
      ? [
          {
            type: 'www' as const,
            serviceWorker: null,
            // Mirrors the dist copy so getAssetPath('./assets/...') resolves --
            // this is what puts the SDK worker at /assets/IDVerseSDK.worker.min.js.
            copy: [{ src: 'ui/assets', dest: 'assets' }],
          },
        ]
      : []),
  ],
  sourceMap: false,
  testing: {
    browserHeadless: 'new',
  },
  devServer: {
    reloadStrategy: 'pageReload',
    port: 3000,
    https: validSSLKeys
      ? {
          // @ts-ignore
          cert: readFileSync(process.env.STENCIL_DEV_SSL_CERT || '', 'utf8'),
          // @ts-ignore
          key: readFileSync(process.env.STENCIL_DEV_SSL_KEY || '', 'utf8'),
        }
      : undefined,
  },
  plugins: [sass()],
  rollupPlugins: {
    before: [
      alias({
        entries: [
          {
            find: '@digicreds',
            replacement: path.resolve(__dirname, '../digital-credentials/dist/web/IDVerseSDK.js'),
          },
        ],
      }),
    ],
  },
};
