/**
 * Host methods on <idv-sdk-web>.
 *
 * Found by the simulator: close() during a scan terminated the worker but left
 * the scan running -- the camera stayed on and the next press spun forever.
 */
import { IDVSDKWeb } from './sdk-ui';

describe('close() -- ends a running scan', () => {
  it('releases the scans before the workers go', async () => {
    const ui: any = new IDVSDKWeb();
    const order: string[] = [];
    ui.idScan = { delete: jest.fn(() => order.push('id-scan')) };
    ui.faceScan = { delete: jest.fn(() => order.push('face-scan')) };
    ui.session = { complete: jest.fn(() => Promise.resolve()) };
    ui.idScanSDKManager = { delete: jest.fn(() => order.push('id-scan worker')) };
    ui.faceScanSDKManager = { delete: jest.fn(() => order.push('face-scan worker')) };

    await ui.close();

    expect(order).toEqual(['id-scan', 'face-scan', 'id-scan worker', 'face-scan worker']);
    expect(ui.session.complete).toHaveBeenCalled();
  });

  it('is fine with no scan started', async () => {
    const ui: any = new IDVSDKWeb();
    ui.session = { complete: jest.fn(() => Promise.resolve()) };
    await expect(ui.close()).resolves.toBeUndefined();
  });
});

/**
 * An iPad is in the desktop-embed range both ways up (800px+ wide, 521px+
 * tall), and there the screens were anchored to the page: on a real iPad they
 * scrolled with it, so the camera stopped short of the screen's edge and the
 * shutter rode up over the guide box. The root's `idv-ipad` class switches
 * those rules back to viewport-fixed (sdk-ui.scss), on an iPad only.
 */
describe('render() -- the iPad keeps phone-style, viewport-fixed screens', () => {
  function hostClass(ua: string, touchPoints: number) {
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
    const vnode: any = (new IDVSDKWeb() as any).render();
    return vnode.$attrs$.class;
  }

  it('an iPad gets the class', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Safari/605.1.15';
    expect(hostClass(ua, 5)).toBe('idv-ipad');
  });

  it('a Mac and a phone do not', () => {
    const mac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(hostClass(mac, 0)).toBe('');
    expect(hostClass(iphone, 5)).toBe('');
  });
});
