/**
 * Which camera pictures are mirrored. A front camera and a desktop webcam
 * face the user, so they show like a mirror; a rear camera must not, or the
 * card moves left when it is moved right. On a real iPad the rear camera was
 * mirrored: its user agent is a Mac's, so it was taken for a webcam.
 */
import { Camera } from './Camera';
import { CameraResolution, CameraType } from './Enums';

const UA_IPAD_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Safari/605.1.15';
const UA_MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const UA_ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

function device(ua: string, touchPoints: number, width: number, height: number) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: jest.fn().mockResolvedValue({ getVideoTracks: () => [] }) },
    configurable: true,
  });
}

/** The transform the live picture is given for this camera. */
async function shown(type: CameraType): Promise<string> {
  const video: any = { style: {} };
  await Camera.bindStreamToVideoFeed(
    { info: null, capabilities: {} as MediaTrackCapabilities },
    video as HTMLVideoElement,
    type,
    CameraResolution.FULL_HD,
  );
  return video.style.transform || 'none';
}

describe('Camera.bindStreamToVideoFeed -- mirroring', () => {
  it("an iPad's rear camera is not mirrored", async () => {
    device(UA_IPAD_DESKTOP, 5, 1194, 748);
    expect(await shown(CameraType.Back)).toBe('none');
  });

  it("an iPad's front camera is mirrored", async () => {
    device(UA_IPAD_DESKTOP, 5, 1194, 748);
    expect(await shown(CameraType.Front)).toBe('scaleX(-1)');
  });

  it("a desktop's webcam is mirrored", async () => {
    device(UA_MAC_CHROME, 0, 1280, 800);
    expect(await shown(CameraType.Back)).toBe('scaleX(-1)');
  });

  it("a phone's rear camera is not mirrored", async () => {
    device(UA_ANDROID_PHONE, 5, 412, 915);
    expect(await shown(CameraType.Back)).toBe('none');
  });
});
