import { CameraResolution } from './Enums';
import { Browser } from './Browser';

/**
 * A coarse capability class for a device, decided BEFORE the camera is opened.
 * It drives how much camera resolution the device is asked to sustain -- the key
 * lever behind the iOS out-of-memory crash, where a continuous 4K capture
 * session's native buffers push a memory-tight phone's tab over its ceiling.
 */
export enum DeviceTier {
  /** Memory-tight (older phones): a light preview, higher-res only per capture. */
  Low = 'low',
  /** Capable but not top-end: a steady mid-resolution stream. */
  Mid = 'mid',
  /** High-end / desktop: full resolution, the unrestricted flow. */
  High = 'high',
}

/**
 * The resolution the preview stream runs at, and the resolution a single still
 * is grabbed at. When capture is higher than preview, the Scanner momentarily
 * raises the track for the grab and drops it back (see Scanner.dynamicCapture) --
 * a light continuous stream with a high-res still.
 */
export interface DeviceCaptureStrategy {
  previewResolution: CameraResolution;
  captureResolution: CameraResolution;
}

/**
 * Everything the profiler could read about the device. All fields are
 * best-effort: iOS Safari hides `deviceMemory` and masks the GPU, so a signal
 * being absent is normal, not an error.
 */
export interface DeviceSignals {
  platform: 'ios' | 'android' | 'desktop' | 'other';
  /** Marketing generation from {@link detectIphoneModel} (11, 12, …); absent off iPhone. */
  iPhoneGeneration?: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
  /** `navigator.deviceMemory` in GB (quantised; absent on iOS/Safari). */
  deviceMemoryGB?: number;
  /** Longest screen edge in physical pixels (`max(w,h) * devicePixelRatio`). */
  screenMaxPx?: number;
  /** Unmasked WebGL renderer, when the browser exposes it (opt-in `measure`). */
  gpu?: string;
  /** Milliseconds for a fixed compute workload; lower is faster (opt-in `measure`). */
  benchmarkMs?: number;
}

export interface DeviceProfile {
  tier: DeviceTier;
  strategy: DeviceCaptureStrategy;
  signals: DeviceSignals;
  /** Human-readable justification for the tier -- surfaced in logs/telemetry. */
  reason: string;
}

/**
 * Best-effort iPhone marketing generation from screen geometry.
 *
 * iOS Safari does not expose the model, but the physical screen size (logical
 * size × devicePixelRatio) is effectively a fingerprint. Returns the generation
 * (e.g. 11 for X/XS/XR/11, 12 for the 12 family), 11 as a safe fallback for an
 * unrecognised iPhone, or -1 when this is not an iPhone at all.
 */
export function detectIphoneModel(): number {
  if (typeof navigator === 'undefined' || !/iPhone/i.test(navigator.userAgent)) {
    return -1;
  }

  const dpr = window.devicePixelRatio || 1;
  const width = Math.min(window.screen.width, window.screen.height);
  const height = Math.max(window.screen.width, window.screen.height);
  const realWidth = width * dpr;
  const realHeight = height * dpr;

  const models = [
    // iPhone SE
    { w: 640, h: 1136, v: 5 },
    { w: 750, h: 1334, v: 5 },
    // NON-NOTCH iPhones (6/7/8 family)
    { w: 750, h: 1334, v: 6 },
    { w: 1080, h: 1920, v: 6 },
    // NOTCH devices (X → 11)
    { w: 1125, h: 2436, v: 11 }, // X / XS / 11 Pro
    { w: 828, h: 1792, v: 11 }, // XR / 11
    { w: 1242, h: 2688, v: 11 }, // XS Max / 11 Pro Max
    // 12 family
    { w: 1170, h: 2532, v: 12 }, // 12 / 12 Pro
    { w: 1284, h: 2778, v: 12 }, // 12 Pro Max
    // 13 family
    { w: 1080, h: 2340, v: 13 }, // 13 mini
    { w: 1170, h: 2532, v: 13 }, // 13 / 13 Pro
    { w: 1284, h: 2778, v: 13 }, // 13 Pro Max
    // 14 Pro / 15 / 16 (Dynamic Island)
    { w: 1179, h: 2556, v: 14 },
    { w: 1290, h: 2796, v: 14 },
    { w: 1179, h: 2556, v: 15 },
    { w: 1290, h: 2796, v: 15 },
    { w: 1179, h: 2556, v: 16 },
    { w: 1290, h: 2796, v: 16 },
    { w: 1320, h: 2868, v: 16 },
  ];

  const match = models.find(
    m => (m.w === realWidth && m.h === realHeight) || (m.w === realHeight && m.h === realWidth),
  );

  return match ? match.v : 11;
}

/** Preview/capture pairs per tier. Low is the only tier that bumps on capture. */
const TIER_STRATEGY: Record<DeviceTier, DeviceCaptureStrategy> = {
  [DeviceTier.High]: {
    previewResolution: CameraResolution.UHD, // 4K continuous
    captureResolution: CameraResolution.UHD,
  },
  [DeviceTier.Mid]: {
    previewResolution: CameraResolution.QHD, // 2K continuous
    captureResolution: CameraResolution.QHD,
  },
  [DeviceTier.Low]: {
    previewResolution: CameraResolution.FULL_HD, // 1080p preview
    captureResolution: CameraResolution.QHD, // bumped to 2K per still
  },
};

/**
 * Measures device capability and prescribes a camera resolution strategy, so a
 * scan opens the camera at a resolution the device can actually sustain.
 *
 * The decision is intentionally made from cheap, synchronous signals available
 * BEFORE any camera permission or stream: the goal is to never open a stream a
 * memory-tight device cannot afford in the first place. On iOS the screen-size
 * model class is the reliable signal (memory/GPU are hidden); elsewhere it is
 * `deviceMemory` then core count, with an optional micro-benchmark as a last
 * resort for devices that expose neither.
 */
export class DeviceProfiler {
  /**
   * Profiles the device and returns its tier + capture strategy.
   *
   * @param opts.measure When true, also gathers the GPU renderer and runs a
   * short compute benchmark (a few ms of main-thread work). These enrich the
   * signals and act as a fallback tiebreaker; the default (`false`) keeps the
   * call instant, which is what the scan-open path uses.
   */
  static profile(opts?: { measure?: boolean }): DeviceProfile {
    const signals = this.readSignals(!!opts?.measure);
    const { tier, reason } = this.classify(signals);
    return { tier, reason, strategy: TIER_STRATEGY[tier], signals };
  }

  /** One-line summary of a profile, for logs and the perf channel. */
  static describe(profile: DeviceProfile): string {
    const s = profile.signals;
    const parts = [
      `tier=${profile.tier}`,
      `platform=${s.platform}`,
      s.iPhoneGeneration ? `iPhoneGen=${s.iPhoneGeneration}` : '',
      s.cores != null ? `cores=${s.cores}` : '',
      s.deviceMemoryGB != null ? `mem=${s.deviceMemoryGB}GB` : '',
      s.screenMaxPx != null ? `screen=${s.screenMaxPx}px` : '',
      s.benchmarkMs != null ? `bench=${Math.round(s.benchmarkMs)}ms` : '',
      s.gpu ? `gpu=${s.gpu}` : '',
      `=> preview=${CameraResolution[profile.strategy.previewResolution]}`,
      `capture=${CameraResolution[profile.strategy.captureResolution]}`,
      `(${profile.reason})`,
    ];
    return parts.filter(Boolean).join(' ');
  }

  /**
   * Times a fixed compute workload. Lower is faster. Bounded work (~a few
   * million ops) so even a slow phone returns in tens of milliseconds. Public so
   * a host or the demo can read a raw compute figure on demand.
   */
  static benchmarkCompute(): number {
    const start = this.now();
    let acc = 0;
    for (let i = 1; i <= 2_000_000; i++) {
      acc += Math.sqrt(i) * 1.0000001;
    }
    // Consume `acc` so the loop cannot be optimised away.
    if (!isFinite(acc)) {
      // eslint-disable-next-line no-console
      console.log(acc);
    }
    return this.now() - start;
  }

  private static now(): number {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
  }

  private static readSignals(measure: boolean): DeviceSignals {
    const nav: any = typeof navigator !== 'undefined' ? navigator : {};

    let platform: DeviceSignals['platform'] = 'other';
    const isIPhone = typeof nav.userAgent === 'string' && /iPhone|iPod/i.test(nav.userAgent);
    if (isIPhone) {
      platform = 'ios';
    } else if (Browser.isAndroid()) {
      platform = 'android';
    } else {
      // iPad (reports as Mac), desktops and laptops -- resource-rich, not the
      // memory-tight case this exists for.
      const os = Browser.detectOS();
      platform =
        os === 'Mac OS' || os.startsWith('Windows') || os === 'Linux' || Browser.isIOS()
          ? 'desktop'
          : 'other';
    }

    const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined;
    const deviceMemoryGB = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined;

    let screenMaxPx: number | undefined;
    try {
      const dpr = window.devicePixelRatio || 1;
      screenMaxPx = Math.round(Math.max(window.screen.width, window.screen.height) * dpr);
    } catch {
      screenMaxPx = undefined;
    }

    const signals: DeviceSignals = {
      platform,
      cores,
      deviceMemoryGB,
      screenMaxPx,
    };

    if (isIPhone) {
      signals.iPhoneGeneration = detectIphoneModel();
    }

    if (measure) {
      signals.gpu = this.detectGpu();
      signals.benchmarkMs = this.benchmarkCompute();
    }

    return signals;
  }

  private static classify(s: DeviceSignals): { tier: DeviceTier; reason: string } {
    // iPhone: the screen-class generation is the reliable signal (memory/GPU are
    // hidden on iOS Safari). 12+ sustains 4K; the 11/X/XS class is capped at 2K
    // (the XS OOMs on continuous 4K); older is put on the 1080p+bump path.
    if (s.platform === 'ios' && s.iPhoneGeneration != null && s.iPhoneGeneration > 0) {
      const g = s.iPhoneGeneration;
      if (g >= 12) return { tier: DeviceTier.High, reason: `iPhone gen ${g} (>= 12)` };
      if (g >= 11) return { tier: DeviceTier.Mid, reason: `iPhone gen ${g} (11/X/XS class)` };
      return { tier: DeviceTier.Low, reason: `iPhone gen ${g} (< 11)` };
    }

    // Desktops/laptops (and iPads) are resource-rich.
    if (s.platform === 'desktop') {
      return { tier: DeviceTier.High, reason: 'desktop-class device' };
    }

    // Android / other mobile: RAM is the best proxy, then core count. Values of
    // deviceMemory are quantised (…2, 4, 8), so the bands are exact.
    if (s.deviceMemoryGB != null) {
      if (s.deviceMemoryGB >= 6)
        return { tier: DeviceTier.High, reason: `${s.deviceMemoryGB}GB RAM` };
      if (s.deviceMemoryGB >= 4)
        return { tier: DeviceTier.Mid, reason: `${s.deviceMemoryGB}GB RAM` };
      return { tier: DeviceTier.Low, reason: `${s.deviceMemoryGB}GB RAM` };
    }
    if (s.cores != null) {
      if (s.cores >= 8) return { tier: DeviceTier.High, reason: `${s.cores} CPU cores` };
      if (s.cores >= 6) return { tier: DeviceTier.Mid, reason: `${s.cores} CPU cores` };
      return { tier: DeviceTier.Low, reason: `${s.cores} CPU cores` };
    }
    if (s.benchmarkMs != null) {
      if (s.benchmarkMs <= 8)
        return { tier: DeviceTier.High, reason: `compute ${Math.round(s.benchmarkMs)}ms` };
      if (s.benchmarkMs <= 20)
        return { tier: DeviceTier.Mid, reason: `compute ${Math.round(s.benchmarkMs)}ms` };
      return { tier: DeviceTier.Low, reason: `compute ${Math.round(s.benchmarkMs)}ms` };
    }

    // Nothing to go on: the safe middle -- 2K is well within any modern phone
    // and never triggers the 4K OOM.
    return { tier: DeviceTier.Mid, reason: 'no capability signals; safe default' };
  }

  private static detectGpu(): string | undefined {
    try {
      const canvas = document.createElement('canvas');
      const gl = (canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
      if (!gl) return undefined;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext
        ? gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      // Release the throwaway context promptly.
      gl.getExtension('WEBGL_lose_context')?.loseContext?.();
      return renderer ? String(renderer) : undefined;
    } catch {
      return undefined;
    }
  }
}
