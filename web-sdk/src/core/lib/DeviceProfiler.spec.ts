/**
 * Locks the device-tiering that decides camera resolution BEFORE the camera
 * opens. The tiers map to a capture strategy: High = 4K continuous, Mid = 2K
 * continuous, Low = 1080p preview bumped to 2K per still. iOS is classed by
 * screen-size generation (memory/GPU are hidden there); other platforms by
 * deviceMemory then core count.
 */
import { DeviceProfiler, DeviceTier, detectIphoneModel } from './DeviceProfiler';
import { CameraResolution } from './Enums';

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const UA_OTHER = 'Mozilla/5.0 (Unknown)';

function stub(opts: {
  ua: string;
  cores?: number;
  deviceMemory?: number;
  screenW?: number;
  screenH?: number;
  dpr?: number;
}) {
  Object.defineProperty(navigator, 'userAgent', { value: opts.ua, configurable: true });
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    value: opts.cores,
    configurable: true,
  });
  Object.defineProperty(navigator, 'deviceMemory', {
    value: opts.deviceMemory,
    configurable: true,
  });
  Object.defineProperty(window, 'devicePixelRatio', { value: opts.dpr ?? 1, configurable: true });
  Object.defineProperty(window, 'screen', {
    value: { width: opts.screenW ?? 0, height: opts.screenH ?? 0 },
    configurable: true,
  });
}

describe('detectIphoneModel', () => {
  it('is -1 for a non-iPhone', () => {
    stub({ ua: UA_ANDROID });
    expect(detectIphoneModel()).toBe(-1);
  });

  it('reads the generation from screen geometry (iPhone XS -> 11)', () => {
    stub({ ua: UA_IPHONE, screenW: 375, screenH: 812, dpr: 3 }); // 1125x2436
    expect(detectIphoneModel()).toBe(11);
  });

  it('falls back to 11 for an unrecognised iPhone', () => {
    stub({ ua: UA_IPHONE, screenW: 999, screenH: 1888, dpr: 3 });
    expect(detectIphoneModel()).toBe(11);
  });
});

describe('DeviceProfiler.profile -- iOS by screen-size generation', () => {
  it('iPhone 12 (gen 12) -> High / 1080p preview + 4K capture', () => {
    stub({ ua: UA_IPHONE, screenW: 390, screenH: 844, dpr: 3 }); // 1170x2532
    const p = DeviceProfiler.profile();
    expect(p.tier).toBe(DeviceTier.High);
    // iOS WebKit mis-renders a continuous 4K preview (shrunk, letterboxed feed)
    expect(p.strategy).toEqual({
      previewResolution: CameraResolution.FULL_HD,
      captureResolution: CameraResolution.UHD,
    });
  });

  it('iPhone 15 (1179x2556) -> High / 1080p preview + 4K capture', () => {
    stub({ ua: UA_IPHONE, screenW: 393, screenH: 852, dpr: 3 });
    const p = DeviceProfiler.profile();
    expect(p.tier).toBe(DeviceTier.High);
    expect(p.strategy.previewResolution).toBe(CameraResolution.FULL_HD);
    expect(p.strategy.captureResolution).toBe(CameraResolution.UHD);
  });

  it('iPhone XS (gen 11) -> Mid / 2K continuous', () => {
    stub({ ua: UA_IPHONE, screenW: 375, screenH: 812, dpr: 3 }); // 1125x2436
    const p = DeviceProfiler.profile();
    expect(p.tier).toBe(DeviceTier.Mid);
    expect(p.strategy).toEqual({
      previewResolution: CameraResolution.QHD,
      captureResolution: CameraResolution.QHD,
    });
  });

  it('iPhone 8 (gen 5/6, < 11) -> Low / 1080p preview + 2K capture', () => {
    stub({ ua: UA_IPHONE, screenW: 375, screenH: 667, dpr: 2 }); // 750x1334
    const p = DeviceProfiler.profile();
    expect(p.tier).toBe(DeviceTier.Low);
    expect(p.strategy).toEqual({
      previewResolution: CameraResolution.FULL_HD,
      captureResolution: CameraResolution.QHD,
    });
    expect(p.strategy.captureResolution).not.toBe(p.strategy.previewResolution);
  });
});

describe('DeviceProfiler.profile -- other platforms', () => {
  it('desktop -> High', () => {
    stub({ ua: UA_DESKTOP, cores: 8 });
    const p = DeviceProfiler.profile();
    expect(p.signals.platform).toBe('desktop');
    expect(p.tier).toBe(DeviceTier.High);
  });

  it('Android 8GB RAM -> High', () => {
    stub({ ua: UA_ANDROID, deviceMemory: 8, cores: 8 });
    expect(DeviceProfiler.profile().tier).toBe(DeviceTier.High);
  });

  it('Android 4GB RAM -> Mid', () => {
    stub({ ua: UA_ANDROID, deviceMemory: 4, cores: 8 });
    expect(DeviceProfiler.profile().tier).toBe(DeviceTier.Mid);
  });

  it('Android 2GB RAM -> Low', () => {
    stub({ ua: UA_ANDROID, deviceMemory: 2, cores: 8 });
    expect(DeviceProfiler.profile().tier).toBe(DeviceTier.Low);
  });

  it('Android with no deviceMemory falls back to core count (4 cores -> Low)', () => {
    stub({ ua: UA_ANDROID, cores: 4 });
    expect(DeviceProfiler.profile().tier).toBe(DeviceTier.Low);
  });

  it('unknown device with no signals -> Mid (safe default)', () => {
    stub({ ua: UA_OTHER });
    const p = DeviceProfiler.profile();
    expect(p.tier).toBe(DeviceTier.Mid);
  });
});

describe('DeviceProfiler.describe', () => {
  it('summarises tier and chosen resolutions', () => {
    stub({ ua: UA_IPHONE, screenW: 375, screenH: 812, dpr: 3 });
    const line = DeviceProfiler.describe(DeviceProfiler.profile());
    expect(line).toContain('tier=mid');
    expect(line).toContain('preview=QHD');
    expect(line).toContain('capture=QHD');
  });
});
