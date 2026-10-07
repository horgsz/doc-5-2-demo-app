/**
 * Orientation where screen.orientation does not exist (Safari before 16.4).
 *
 * Found by the simulator: with no screen.orientation the scan threw twice --
 * on the listener and on reading .type -- and never got past its intro.
 */
import { onScreenOrientationChange, readScreenOrientation } from './Orientation';

// the spec environment has a window but no screen
if (typeof (global as any).screen === 'undefined') (global as any).screen = {};

function setScreenOrientation(value: any) {
  Object.defineProperty((global as any).screen, 'orientation', { value, configurable: true });
}
function setWindowOrientation(value: any) {
  Object.defineProperty(window, 'orientation', { value, configurable: true });
}

describe('readScreenOrientation()', () => {
  afterEach(() => {
    setScreenOrientation(undefined);
    setWindowOrientation(undefined);
  });

  it('uses screen.orientation where there is one', () => {
    setScreenOrientation({ type: 'landscape-secondary', angle: 270, addEventListener: jest.fn() });
    expect(readScreenOrientation()).toEqual({ type: 'landscape-secondary', angle: 270 });
  });

  it('falls back to window.orientation without it (old Safari)', () => {
    setScreenOrientation(undefined);
    setWindowOrientation(0);
    expect(readScreenOrientation()).toEqual({ type: 'portrait-primary', angle: 0 });
    setWindowOrientation(90);
    expect(readScreenOrientation()).toEqual({ type: 'landscape-primary', angle: 90 });
    setWindowOrientation(-90);
    expect(readScreenOrientation()).toEqual({ type: 'landscape-secondary', angle: 270 });
  });

  it('falls back to the media query when neither exists -- a desktop, landscape at its natural 0 degrees', () => {
    setScreenOrientation(undefined);
    setWindowOrientation(undefined);
    const mm = window.matchMedia;
    (window as any).matchMedia = jest.fn(() => ({ matches: true }));
    expect(readScreenOrientation()).toEqual({ type: 'landscape-primary', angle: 0 });
    (window as any).matchMedia = mm;
  });
});

describe('onScreenOrientationChange()', () => {
  afterEach(() => setScreenOrientation(undefined));

  it('listens on screen.orientation where there is one', () => {
    const so = { type: 'portrait-primary', angle: 0, addEventListener: jest.fn(), removeEventListener: jest.fn() };
    setScreenOrientation(so);
    const stop = onScreenOrientationChange(() => {});
    expect(so.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    stop();
    expect(so.removeEventListener).toHaveBeenCalled();
  });

  it('listens for orientationchange without it', () => {
    setScreenOrientation(undefined);
    const listener = jest.fn();
    const stop = onScreenOrientationChange(listener);
    window.dispatchEvent(new Event('orientationchange'));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    window.dispatchEvent(new Event('orientationchange'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
