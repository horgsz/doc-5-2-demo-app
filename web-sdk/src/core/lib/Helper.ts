import * as WasmFeatureDetect from 'wasm-feature-detect';
import { WasmMode } from './Interfaces';

/**
 * Generates random UUID.
 */
export function generateUUID() {
  var d = new Date().getTime();
  var d2 = (typeof performance !== 'undefined' && performance.now && performance.now() * 1000) || 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16;
    if (d > 0) {
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else {
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    }
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Finds the best supported build for WASM.
 */
export async function getWasmMode(): Promise<WasmMode> {
  // TODO: add support for threads.
  const hasSIMD = await WasmFeatureDetect.simd();
  // const hasThreads = await WasmFeatureDetect.threads();
  const hasBulkMemory = await WasmFeatureDetect.bulkMemory();
  const hasSaturatedFloatToInt = await WasmFeatureDetect.saturatedFloatToInt();
  const hasSignExtension = await WasmFeatureDetect.signExtensions();

  if (hasBulkMemory && hasSaturatedFloatToInt && hasSignExtension) {
    // if (hasThreads) {
    //     return WasmMode.SimdThreads;
    // }

    if (hasSIMD) {
      return WasmMode.Simd;
    }
  }

  return WasmMode.Basic;
}
