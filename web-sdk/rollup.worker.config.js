const babel = require('@rollup/plugin-babel');
const terser = require('@rollup/plugin-terser');
const typescript = require('rollup-plugin-typescript2');
const nodeResolvePlugin = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');

const sdkName = 'IDVerseSDK';
const banner = `/*! ****************************************************************************
Copyright © IDVerse Ltd. All rights reserved.

THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABILITY OR NON-INFRINGEMENT.
*****************************************************************************/`;

module.exports = {
  input: 'src/worker.ts',
  output: {
    format: 'iife',
    file: `src/ui/assets/${sdkName}.worker.min.js`,
    banner,
  },
  plugins: [
    nodeResolvePlugin(),
    typescript({ tsconfigOverride: { compilerOptions: { declaration: false } } }),
    babel({ babelHelpers: 'bundled' }),
    commonjs({
      requireReturnsDefault: 'namespace',
    }),
    terser({
      compress: {
        pure_getters: true,
        unsafe: true,
        unsafe_comps: true,
        warnings: false,
      },
    }),
  ],
};
