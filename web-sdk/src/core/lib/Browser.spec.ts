/**
 * The iPad check. iPadOS Safari (and Chrome) ask for desktop sites, so an
 * iPad's user agent is a Mac's -- found on a real iPad, where the SDK took it
 * for a desktop: the rear camera was mirrored like a webcam and the screens
 * were laid out as a desktop embed. Only the touch screen tells them apart.
 */
import { Browser } from './Browser';

const UA_IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Safari/605.1.15';
const UA_IPAD_MOBILE =
  'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1';
const UA_MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

function device(ua: string, touchPoints: number, width: number, height: number) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

describe('Browser.isIPad', () => {
  it('an iPad asking for desktop sites (the iPadOS default) is an iPad', () => {
    device(UA_IPAD_DESKTOP, 5, 1194, 748);
    expect(Browser.isIPad()).toBe(true);
  });

  it('an iPad with a mobile user agent is an iPad', () => {
    device(UA_IPAD_MOBILE, 5, 1024, 704);
    expect(Browser.isIPad()).toBe(true);
  });

  it('a Mac is not: same user agent, no touch screen', () => {
    device(UA_IPAD_DESKTOP, 0, 1440, 800);
    expect(Browser.isIPad()).toBe(false);
    device(UA_MAC_CHROME, 0, 1280, 800);
    expect(Browser.isIPad()).toBe(false);
  });

  it('phones and other tablets are not', () => {
    device(UA_IPHONE, 5, 393, 852);
    expect(Browser.isIPad()).toBe(false);
    device(UA_ANDROID_TABLET, 10, 1280, 800);
    expect(Browser.isIPad()).toBe(false);
  });
});

describe('Browser.isMobile', () => {
  it('counts an iPad asking for desktop sites as mobile, either way up', () => {
    device(UA_IPAD_DESKTOP, 5, 1194, 748);
    expect(Browser.isMobile()).toBe(true);
    device(UA_IPAD_DESKTOP, 5, 834, 1108);
    expect(Browser.isMobile()).toBe(true);
  });

  it('a Mac stays a desktop', () => {
    device(UA_MAC_CHROME, 0, 1280, 800);
    expect(Browser.isMobile()).toBe(false);
  });

  it('a phone stays mobile', () => {
    device(UA_IPHONE, 5, 393, 852);
    expect(Browser.isMobile()).toBe(true);
  });
});
