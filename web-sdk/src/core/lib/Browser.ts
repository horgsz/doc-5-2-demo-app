import { getWasmMode } from './Helper';

/**
 * A simple browser helper.
 */
export class Browser {
  /**
   * Whether the device is a phone or a tablet.
   */
  static isMobile(): boolean {
    if (typeof navigator === `undefined`) return false;
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      Browser.isIPad() ||
      (window.innerWidth <= 800 && window.innerHeight <= 600)
    );
  }

  /**
   * Whether the device is an iPad. Since iPadOS 13 its browsers ask for
   * desktop sites, so the user agent says "Macintosh" -- the touch screen is
   * what gives it away (a Mac reports no touch points).
   */
  static isIPad(): boolean {
    if (typeof navigator === `undefined`) return false;
    return (
      /iPad/i.test(navigator.userAgent) ||
      (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    );
  }

  /**
   * Checks if the device is an iOS 17+, which requires a custom workaround.
   */
  static isIOS17(): boolean {
    return Browser.isIOS() && /OS 17/i.test(navigator.userAgent);
  }

  /**
   * Whether the device is an iOS device.
   */
  static isIOS(): boolean {
    return Browser.detectOS() === 'iOS';
  }

  /**
   * Whether the device is an Android device.
   */
  static isAndroid(): boolean {
    return Browser.detectOS() === 'Android';
  }

  /**
   * Get browser information.
   * @returns browser info object.
   */
  static async getBrowserInfo() {
    const userAgent = window.navigator.userAgent;

    const os = Browser.detectOS();
    const browser = Browser.detectBrowser();

    return {
      os,
      browser,
      user_agent: userAgent,
      wasm_mode: await getWasmMode(),
    };
  }

  /**
   * Detects operating system.
   * @returns OS string.
   */
  static detectOS(): string {
    const userAgent = String(window.navigator.userAgent).toLocaleLowerCase();
    if (/windows nt 10\.0/i.test(userAgent)) return 'Windows 10';
    if (/windows nt 6\.2/i.test(userAgent)) return 'Windows 8';
    if (/windows nt 6\.1/i.test(userAgent)) return 'Windows 7';
    if (/windows nt 6\.0/i.test(userAgent)) return 'Windows Vista';
    if (/windows nt 5\.1/i.test(userAgent)) return 'Windows XP';
    if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
    if (/macintosh|mac os x/i.test(userAgent)) return 'Mac OS';
    if (/android/i.test(userAgent)) return 'Android';
    if (/linux/i.test(userAgent)) return 'Linux';

    return 'Unknown OS';
  }

  /**
   * Detects browser.
   * @returns OS string.
   */
  static detectBrowser(): string {
    const userAgent = window.navigator.userAgent;

    if (/chrome|crios/i.test(userAgent)) return 'Chrome';
    if (/firefox|fxios/i.test(userAgent)) return 'Firefox';
    if (/safari/i.test(userAgent) && !/chrome|crios/i.test(userAgent)) return 'Safari';
    if (/msie|trident/i.test(userAgent)) return 'Internet Explorer';
    if (/edg/i.test(userAgent)) return 'Edge';
    if (/opera|opr/i.test(userAgent)) return 'Opera';

    return 'Unknown Browser';
  }
}
