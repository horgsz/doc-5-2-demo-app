import { CameraResolution, CameraType } from './Enums';
import { ImageSettings } from './Interfaces';
import { Browser } from './Browser';
import { detectIphoneModel } from './DeviceProfiler';

/**
 * Rear camera keywords.
 */
const backCameraKeywords =
  'rear,back,rück,arrière,trasera,trás,posteriore,задней,الخلفية,후,arka,achterzijde,traseira,หลัง,baksidan,bagside,sau,bak,tylny,takakamera,belakang,אחורית,πίσω,spate,hátsó,zadní,darrere,posterior,zadná,задня,stražnja,belakang,बैक,后面,後面,背面,后置,後置,背置';
// @ts-ignore
const iOSBackWideCameraKeywords =
  'back dual wide camera,背面デュアル広角カメラ,後置雙廣角鏡頭相機,後置雙廣角相機,后置双广角镜头,후면 듀얼 와이드 카메라,กล้องคู่ด้านหลังมุมกว้าง,बैक ड्युअल वाइड कैमरा,كاميرا خلفية مزدوجة عريضة,מצלמה כפולה רחבה אחורית,задняя двойная широкоугольная камера,задня здвоєна ширококутна камера,задна двойна широкоъгълна камера,артқы қос кең бұрышты камера,πίσω διπλή ευρεία κάμερα,zadní duální širokoúhlý fotoaparát,zadná duálna širokouhlá kamera,tylny dwuobiektywowy aparat szerokokątny,stražnja dvostruka široka kamer,rückseitige dual-weitwinkelkamera,laajakulmainen kaksoistakakamera,kamera lebar belakang ganda,hátsó, kettős, széles látószögű kamera,fotocamera doppia con grandangolo (posteriore),dwikamera lebar belakang,dubbel vidvinkelkamera på baksidan,double caméra grand angle arrière,double appareil photo grand angle arrière,dobbelt vidvinkelkamera bak,çift geniş kamera arka yüzü,camera kép rộng mặt sau,câmera dupla grande-angular traseira,cameră dublă cu obiectiv superangular spate,càmera dual posterior amb gran angular,cámara trasera dual con gran angular,câmara grande angular dupla traseira,cámara amplia posterior doble';

/**
 * A helper object to interact with cameras.
 */
export class Camera {
  /**
   * Creates media stream and binds it to the video feed.
   *
   * @returns MediaStream instance.
   */
  public static async bindStreamToVideoFeed(
    camera: { info: MediaDeviceInfo | null; capabilities: MediaTrackCapabilities },
    videoFeed: HTMLVideoElement,
    cameraType: CameraType,
    cameraResolution: CameraResolution,
  ): Promise<MediaStream> {
    let width = 1920;

    let maxWidth = camera.capabilities.width?.max;
    if (maxWidth && maxWidth > 1920) {
      width = 1920;
    } else {
      width = maxWidth || 640;
    }

    const constraints: any = {
      audio: false,
      video: {
        width: {
          exact: width,
        },
        aspectRatio: 16 / 9,
      },
    };

    if (cameraResolution === CameraResolution.VGA) {
      constraints.video = {
        width: 640,
      };
    } else if (cameraResolution === CameraResolution.HD) {
      constraints.video = {
        width: 1280,
      };
    } else if (cameraResolution === CameraResolution.FULL_HD) {
      constraints.video = {
        width: 1920,
      };
    } else if (cameraResolution === CameraResolution.QHD) {
      constraints.video = {
        width: 2560,
      };
    } else if (cameraResolution === CameraResolution.UHD) {
      constraints.video = {
        width: 3840,
      };
    }

    // Non-iOS devices and pre-iPhone-12 hardware are pinned to 1080p for
    // stability. A deliberate high-resolution request (QHD/2K or UHD/4K) is
    // honoured instead of being pinned, because manual capture trades throughput
    // for detail on purpose -- one frame, as much resolution as the camera will
    // give. Width is requested as an ideal, so a camera that cannot reach the
    // asked-for width degrades to its best.
    const wantsHighRes =
      cameraResolution === CameraResolution.UHD || cameraResolution === CameraResolution.QHD;

    if (!wantsHighRes && (!Browser.isIOS() || detectIphoneModel() < 12)) {
      constraints.video = {
        width: 1920,
      };
    }

    if (camera.info && camera.info.deviceId) {
      // @ts-ignore
      constraints.video = {
        // @ts-ignore
        deviceId: { exact: camera.info.deviceId },
        ...constraints.video,
      };
    } else {
      // @ts-ignore
      constraints.video.facingMode = {
        ideal: cameraType === CameraType.Back ? 'environment' : 'user',
      };
    }

    // @ts-ignore
    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    // If autofocus is supported

    if (
      Browser.isIOS() &&
      // @ts-ignore
      camera.capabilities.whiteBalanceMode &&
      // @ts-ignore
      camera.capabilities.whiteBalanceMode.includes('manual')
    ) {
      const track = stream.getVideoTracks()[0];
      await track.applyConstraints({
        // @ts-ignore
        advanced: [{ whiteBalanceMode: 'manual', zoom: 0.5 }],
      });
    }

    videoFeed.controls = false;
    videoFeed.srcObject = stream;

    // Mirror the video feed if the chosen camera is front, or a desktop's
    // webcam (which faces the user too). An iPad counts as mobile, so its rear
    // camera is not mirrored.
    if (cameraType === CameraType.Front || !Browser.isMobile()) {
      videoFeed.style.transform = 'scaleX(-1)';
    }

    return stream;
  }

  /**
   * Captures image frame from canvas.
   */
  /**
   * Grabs the current frame from the video feed.
   *
   * @param videoSource Video element to read from.
   * @param videoFrame Whether the engine should treat this as one frame of a
   * live stream. Pass `false` for a deliberate single capture: the engine then
   * skips the motion/stability gates that only make sense across a sequence of
   * frames and evaluates the frame on its own.
   */
  public static getImageData(
    videoSource: HTMLVideoElement,
    videoFrame: boolean = true,
    // Cap the width and downscale (aspect preserved).
    // The good-location probe passes 640 so the frame is cheap to create/send.
    maxWidth?: number,
  ): ImageSettings {
    const imageWidth = videoSource.videoWidth;
    const imageHeight = videoSource.videoHeight;

    const scale = maxWidth && imageWidth > maxWidth ? maxWidth / imageWidth : 1;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(imageWidth * scale);
    canvas.height = Math.round(imageHeight * scale);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Failed to create canvas.');
    }

    // @ts-ignore
    ctx.drawImage(videoSource, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Release the canvas' backing store now rather than waiting for GC. A 4K
    // canvas holds a ~33MB GPU-backed surface, and WebKit is slow to reclaim
    // it; on memory-tight iPhones the leftover surfaces from captures and
    // probes add up. Zeroing the dimensions frees the buffer immediately.
    canvas.width = 0;
    canvas.height = 0;

    return new ImageSettings(imageData, videoFrame);
  }

  /**
   * Maps a {@link CameraResolution} to the pixel width used when requesting it
   * from the camera. Mirrors the widths in {@link bindStreamToVideoFeed}.
   */
  public static resolutionWidth(res: CameraResolution): number {
    switch (res) {
      case CameraResolution.VGA:
        return 640;
      case CameraResolution.HD:
        return 1280;
      case CameraResolution.FULL_HD:
        return 1920;
      case CameraResolution.QHD:
        return 2560;
      case CameraResolution.UHD:
        return 3840;
      default:
        return 1920;
    }
  }

  /**
   * TEMP (dynamic-resolution capture): re-requests the camera track at a new
   * width via `applyConstraints`, which reconfigures the underlying capture
   * session (and, on iOS, its buffer pool) rather than just downscaling. Used
   * to raise a 1080p preview to 4K for a single still and drop it back, so an
   * older iPhone never holds a continuous 4K stream.
   *
   * @param waitForWidth When true, resolves only once the video element is
   * actually delivering ~the requested width (the reconfigure takes a few
   * frames), or after `timeoutMs` as a fallback -- so the caller grabs the
   * frame at the new resolution, not the old one. When false (the drop back),
   * returns as soon as the constraint is applied.
   */
  public static async setTrackWidth(
    videoFeed: HTMLVideoElement,
    width: number,
    waitForWidth: boolean = false,
    timeoutMs: number = 1200,
  ): Promise<void> {
    const stream = videoFeed.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks?.()[0];
    if (!track) {
      return;
    }

    try {
      await track.applyConstraints({ width });
    } catch {
      // The camera refused the change (unsupported width, busy). The caller
      // proceeds at whatever resolution the stream is already at.
      return;
    }

    if (!waitForWidth) {
      return;
    }

    // Tolerate the camera settling on its nearest supported mode rather than
    // the exact width asked for.
    const target = Math.round(width * 0.9);
    if (videoFeed.videoWidth >= target) {
      return;
    }

    await new Promise<void>(resolve => {
      let done = false;
      let poll = 0;
      let timer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        videoFeed.removeEventListener('resize', check);
        window.clearInterval(poll);
        window.clearTimeout(timer);
        resolve();
      };
      const check = () => {
        if (videoFeed.videoWidth >= target) finish();
      };
      // `resize` fires when the element's frame dimensions change; the poll and
      // timeout cover browsers that don't fire it and the camera that never
      // reaches the target.
      videoFeed.addEventListener('resize', check);
      poll = window.setInterval(check, 50);
      timer = window.setTimeout(finish, timeoutMs);
    });
  }

  /**
   * Choose the camera by side (front or back) with best available resolution.
   */
  public static async chooseCamera(
    type: CameraType,
  ): Promise<{ info: MediaDeviceInfo | null; capabilities: MediaTrackCapabilities }> {
    const cameras = await this.getCameras();
    let selectedCameraType = cameras.frontCameras;

    if (type === CameraType.Back && cameras.backCameras.length) {
      selectedCameraType = cameras.backCameras;
    }

    let selectedCameraIndex = 0;

    const cameraResolutions: number[] = selectedCameraType.map(camera => {
      const regExp = RegExp(/\b([0-9]+)MP?\b/, 'i');
      const match = regExp.exec(camera.label);
      if (match !== null) {
        return parseInt(match[1], 10);
      } else {
        return NaN;
      }
    });

    if (!cameraResolutions.some(cameraResolution => isNaN(cameraResolution))) {
      selectedCameraIndex = cameraResolutions.lastIndexOf(Math.max(...cameraResolutions));
    } else {
      selectedCameraType.sort((a, b) => {
        return a.label.localeCompare(b.label);
      });
    }

    const info = selectedCameraType[selectedCameraIndex] || null;

    return { info: type === CameraType.Back ? info : null, capabilities: cameras.capabilities };
  }

  /**
   * Get media devices.
   */
  protected static async getMediaDevices(): Promise<{
    videoDevices: MediaDeviceInfo[];
    capabilities: MediaTrackCapabilities;
  }> {
    // @ts-ignore
    let devices = await navigator.mediaDevices.enumerateDevices();

    // Check if devices have label.
    const hasNoLabels = devices
      .filter((device: MediaDeviceInfo) => device.kind === 'videoinput')
      .every((device: MediaDeviceInfo) => device.label === '');

    // @ts-ignore
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });

    const videoTrack = stream.getVideoTracks()[0];
    const capabilities = videoTrack.getCapabilities();

    stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());

    // Make sure the label is not empty
    if (hasNoLabels) {
      // @ts-ignore
      devices = await navigator.mediaDevices.enumerateDevices();
    }

    const videoDevices = devices.filter((device: MediaDeviceInfo) => device.kind === 'videoinput');

    return { videoDevices, capabilities };
  }

  /**
   * Find and get front & back cameras.
   */
  protected static async getCameras(): Promise<{
    frontCameras: MediaDeviceInfo[];
    backCameras: MediaDeviceInfo[];
    capabilities: MediaTrackCapabilities;
  }> {
    const frontCameras: MediaDeviceInfo[] = [];
    const backCameras: MediaDeviceInfo[] = [];

    const { videoDevices: cameras, capabilities } = await this.getMediaDevices();

    let keywords = backCameraKeywords;

    for (const camera of cameras) {
      if (Browser.isIOS() && camera.label == 'Back Triple Camera') {
        keywords = iOSBackWideCameraKeywords;
        break;
      }
    }

    for (const camera of cameras) {
      if (this.isBackCameraLabel(camera.label, keywords)) {
        backCameras.push(camera);
      } else {
        frontCameras.push(camera);
      }
    }

    if (!backCameras.length) {
      for (const camera of cameras) {
        if (this.isBackCameraLabel(camera.label, backCameraKeywords)) {
          backCameras.push(camera);
        }
      }
    }

    return {
      frontCameras,
      backCameras,
      capabilities,
    };
  }

  /**
   * Whether the label mentions the camera being a back-facing one.
   *
   * @param label The camera label.
   */
  static isBackCameraLabel(label: string, keywords: string): boolean {
    const lowercaseLabel: string = label.toLowerCase();
    return keywords.split(',').some(keyword => {
      return lowercaseLabel.includes(keyword);
    });
  }

  /**
   * Check if Web Media Devices is Supported.
   */
  static isMediaDevicesSupported(): boolean {
    // @ts-ignore
    return navigator.mediaDevices && navigator.mediaDevices.getUserMedia !== undefined;
  }
}
