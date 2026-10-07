import { ImageSettings, RecognizerSettings } from '../../lib/Interfaces';
import { Recognizer } from '../Recognizer';
import { IDScanRecognizerResult } from './IDScanResult';

/**
 * Defines document position point.
 */
interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A 2-dimensional quadrilateral shape representing the location of document.
 */
export interface Quadrilateral {
  /**
   * The top-left corner.
   */
  readonly topLeft: Point;
  /**
   * The top-right corner.
   */
  readonly topRight: Point;
  /**
   * The bottom-right corner.
   */
  readonly bottomRight: Point;
  /**
   * The bottom-left corner.
   */
  readonly bottomLeft: Point;
}

export interface BackOfCardDocumentConditionItem {
  documentType: string;
  countryCode: string;
  state?: string; // optional
  captureBackIfSupported: boolean;
}

/**
 * Defines ID Scan recognizer settings.
 */
export interface IDScanRecognizerSettings extends RecognizerSettings {
  /**
   * Forces scanning back side of document.
   */
  scanBothSides?: boolean;

  /**
   * Frames are submitted one at a time from a capture button rather than
   * streamed. The engine reports framing problems (too far, too near, off
   * centre) immediately for each submitted frame and rejects a badly framed
   * one, instead of the pacing it applies to a live stream.
   */
  semiAutoCapture?: boolean;

  backOfCardDocumentConditions?: BackOfCardDocumentConditionItem[];
}

/**
 * Defines IDScan detection status.
 *
 * Note: This status is only available for live process.
 */
export enum IDScanDetectionStatus {
  /**
   * Nothing has been detected.
   */
  Empty,
  /**
   * All the requirements has been recognized successfully.
   */
  Valid,
  /**
   * Recognized document is too far left.
   */
  DocumentFarLeft,
  /**
   * Recognized document is too far right.
   */
  DocumentFarRight,
  /**
   * Recognized document is too far from the camera.
   */
  DocumentTooFar,
  /**
   * Recognized document is too near to the camera.
   */
  DocumentTooNear,
  /**
   * Recognized document has glare.
   */
  DocumentHasGlare,
  /**
   * Recognized document is blurry.
   */
  DocumentIsBlurry,
  /**
   * Something is detected but cannot recognize it.
   */
  Unrecognizable,
  /**
   * Something is detected but need more processing.
   */
  Incomplete,
  /**
   * Too many issues were found.
   */
  TooManyIssues,
  /**
   * Capturing and waiting for good accuracy.
   */
  Capturing,
  /**
   * Extracting information from the captured document.
   */
  Extracting,
}

/**
 * Shape of the document the detector last saw, from its class output.
 */
export enum DocumentShape {
  /**
   * Nothing has been detected yet, so the shape is not known.
   */
  Unknown = -1,
  /**
   * An ID-1 card: driving licence, national ID, and similar.
   */
  Card = 0,
  /**
   * A passport data page.
   */
  Passport = 1,
}

/**
 * One field the last capture could not read well, and where it sits on the
 * cropped document.
 */
export interface IDScanFieldIssue {
  /**
   * Engine field type. The numbering is the engine's own and differs between
   * engines (the portrait is 201 in 5.2 and 500 in 6.0; the barcode 205 and
   * 503), so tell fields apart by `name`, which both engines share.
   */
  fieldType: number;
  /**
   * Engine field name, e.g. "last_name", "face_photo" for the portrait, or
   * "barcode" for a PDF417 the profile declares and the capture did not
   * decode.
   */
  name: string;
  /**
   * True when the field produced no value at all, false when it produced one
   * the engine does not trust -- which means one that failed its own
   * validation, since a value passing its mask is treated as sound whatever
   * the raw OCR score said. For the portrait this is true when the photo is
   * covered, and when no face was detected and the quality classifier could
   * not name a fault -- both mean there is no usable face. Always true for
   * the barcode: a barcode either decodes or it does not.
   */
  missing: boolean;
  /**
   * OCR confidence 0-100. Always 0 for a missing field, and always 0 for the
   * portrait and the barcode -- neither is read by OCR. See
   * `qualityConfidence` for the portrait.
   */
  confidence: number;
  /**
   * Portrait only: what the quality classifier made of the photo. Absent for
   * text fields, and absent when the portrait passed -- a good photo is not
   * reported at all. The classifier replaces face detection here: it judges a
   * photo that is present but unusable, which detection cannot.
   */
  quality?: 'blurry' | 'glare' | 'covered';
  /**
   * Portrait only: how sure the classifier is of `quality`, 0-100. The engine
   * only reports a problem above its own minimum, so this is never low.
   */
  qualityConfidence?: number;
  /**
   * Where the field sits, as fractions of the cropped image on each axis with
   * the origin top-left -- multiply by the rendered size to place a highlight.
   *
   * Absent only for a barcode reported against a back side that never matched
   * a profile: the barcode is known to be required, from the front side's
   * child document, but with nothing matched there is no mapping onto the crop
   * and so nowhere honest to point. Show the message without a highlight.
   * `crop` is still present in that case, so the user sees the card either way.
   */
  rect?: { x: number; y: number; w: number; h: number };
}

/**
 * The rectified document image for each side of the last scan, as base64
 * JPEGs with no data-URI prefix. A side that was never captured, or that
 * produced no crop, is absent.
 */
export interface IDScanCrops {
  front?: string;
  back?: string;
}

/**
 * The fields the last capture struggled with, alongside the document image
 * they were read from.
 */
export interface IDScanFieldIssues {
  /**
   * Profile the document was matched to -- or, for a back side that never
   * matched, the profile it was expected to match, taken from the front's
   * child documents.
   */
  documentId: number;
  /**
   * The cropped document, as a base64 JPEG with no data-URI prefix.
   *
   * Rectified by the engine, but capped at 300dpi of the document's physical
   * size -- about 1011px across a card. Use `quad` with the original frame
   * when the detail matters.
   */
  crop: string;
  /**
   * Where the document sat in the frame that was submitted, in that frame's
   * own pixels. Rectifying the original frame through this quad gives the same
   * geometry as `crop` at whatever resolution the camera actually captured.
   * Absent when the engine could not report a position.
   */
  quad?: Quadrilateral;
  /**
   * Every field worth asking the user about, in reading order down the
   * document, then the portrait, then the barcode -- the last two belong to
   * the side as a whole rather than to a line on it. Never empty.
   */
  fields: IDScanFieldIssue[];
  /**
   * Which side of the document this report is about. Absent on engines older
   * than the field, so treat "missing" as front.
   */
  side?: 'front' | 'back';
  /**
   * Whether the matched profile declares a PDF417 barcode on this side --
   * regardless of whether it decoded. A back side whose barcode is essential
   * is not offered "continue anyway".
   */
  expectsPDF417?: boolean;
}

export class IDScanRecognizer extends Recognizer {
  /**
   * Fields the last capture read poorly or not at all, with the cropped
   * document to show them on.
   *
   * Semi-auto capture only -- live scanning just keeps sampling frames, so there
   * is nobody to prompt. Returns null when the capture read cleanly.
   */
  /**
   * Puts the recognizer back before the front side was accepted.
   *
   * After a front side is accepted the next frame is matched against the back,
   * so a user who rejects their front side cannot just capture again. Call this
   * first, then capture the front as if it were the first time.
   */
  async retakeFrontSide(): Promise<void> {
    await this.invoke<void>('retakeFrontSide', []);
  }

  /**
   * Reports the device orientation to the engine.
   *
   * Landscape frames hold a well-placed document at a smaller fraction of
   * their area than portrait frames do, so the engine judges framing (and
   * words its "move closer / further" feedback) differently there. Call on
   * scan start and on every rotation.
   */
  async setLandscape(isLandscape: boolean): Promise<void> {
    await this.invoke<void>('setLandscape', [isLandscape]);
  }

  /**
   * The rectified document image for each side this scan captured, as a
   * base64 JPEG with no data-URI prefix.
   *
   * A side that produced no crop is absent. Both outlive the scan, so a
   * two-sided capture can still offer the front after the back is done --
   * unlike the raw camera frame, which is only ever the latest one.
   */
  async getCrops(): Promise<IDScanCrops> {
    const raw = await this.invoke<string>('getCrops', []);
    if (!raw) return {};

    try {
      return JSON.parse(raw) as IDScanCrops;
    } catch {
      return {};
    }
  }

  async getFieldIssues(): Promise<IDScanFieldIssues | null> {
    const raw = await this.invoke<string>('getFieldIssues', []);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as IDScanFieldIssues;
      return parsed?.fields?.length ? parsed : null;
    } catch {
      // A malformed payload is not worth interrupting a capture over.
      return null;
    }
  }

  /**
   * Gets the shape of the document the detector last saw.
   *
   * Useful after a rejected manual capture: it says whether to guide the user
   * towards a card or a passport outline.
   */
  getDocumentShape(): Promise<DocumentShape> {
    return this.invoke<DocumentShape>('getDocumentShape', []);
  }

  /**
   * Runs the object detector alone on one frame and reports the shape it saw.
   *
   * Not a scan: no OCR, no feedback, and the scan state is untouched. SemiAuto
   * capture uses it to size its alignment guide from what is actually in front
   * of the camera, before the user has captured anything.
   */
  detectDocumentShape(image: ImageSettings): Promise<DocumentShape> {
    return this.detectShape(image);
  }

  /**
   * Good-location probe. Detector only; resolves
   * `{ good, shape, vertical }` -- good = the ID is well placed in frame, shape =
   * the detected document type (card / passport / unknown), vertical = the
   * document is currently portrait (taller than wide) in frame. Fed a small
   * (640) frame ~1x/second so the UI can colour the guide corners AND size and
   * orient the guide.
   */
  detect(
    image: ImageSettings,
  ): Promise<{ good: boolean; shape: DocumentShape; vertical: boolean }> {
    return this.detectLocation(image);
  }
  /**
   * Get the process results.
   */
  getResults(): Promise<IDScanRecognizerResult> {
    return this.invoke<IDScanRecognizerResult>('getResults', []);
  }

  /**
   * Get the process results of front side.
   */
  getFrontSideResults(): Promise<IDScanRecognizerResult> {
    return this.invoke<IDScanRecognizerResult>('getFrontSideResults', []);
  }

  /**
   * Get the process results of back side.
   */
  getBackSideResults(): Promise<IDScanRecognizerResult> {
    return this.invoke<IDScanRecognizerResult>('getBackSideResults', []);
  }
}
