/**
 *  Defines ocr engine process status.
 */
export enum IDScanProcessStatus {
  /**
   * Nothing has been detected.
   */
  Empty,
  /**
   * All the requirements has been recognized successfully.
   */
  Valid,
  /**
   * Recognized ID document is not readable.
   */
  Unreadable,
  /**
   * Recognized ID document is not supported.
   */
  Unsupported,
  /**
   * Invalid front side of the document.
   */
  InvalidFrontSide,
  /**
   * Invalid back side of the document.
   */
  InvalidBackSide,
  /**
   * Waiting for back side of document to be captured.
   */
  BackSideRequired,
  /**
   * Unknown error.
   */
  Unknown,
}

/**
 * Date instance.
 */
export interface DateType {
  /**
   * Day of the month.
   */
  readonly day: number;
  /**
   * Month of the year.
   */
  readonly month: number;
  /**
   * Year.
   */
  readonly year: number;
  /**
   * Full date in yyyy-mm-dd format.
   */
  readonly date: string;
}

export enum DocumentSide {
  /**
   * Front side of the document.
   */
  Front = 1,
  /**
   * Back side of the document.
   */
  Back,
  /**
   * Combined front and back sides of the document.
   */
  Combined,
}

export enum DateStatus {
  /**
   * Presents false value.
   */
  No = 0,
  /**
   * Presents true value.
   */
  Yes,
  /**
   * Presents unknown value.
   */
  Unknown,
}

export interface Address {
  /**
   * The full address of the document holder.
   */
  fullAddress: string;
  /**
   * The address street of the document holder.
   */
  street: string;
  /**
   * The address city of the document holder.
   */
  city: string;
  /**
   * The address postal code of the document holder.
   */
  postalCode: string;
  /**
   * The address jurisdiction of the document holder.
   */
  jurisdiction: string;
}

export interface DocumentInfo {
  /**
   * The 3 letter ISO code of the document country.
   */
  readonly countryCode: string;
  /**
   * The document country name.
   */
  readonly countryName: string;
  /**
   * The document type.
   */
  readonly documentType: string;
  /**
   * The document side type. (Front, Back or both)
   */
  readonly documentSide: DocumentSide;
  /**
   * Variant Issue Date.
   */
  readonly variantIssueDate: string;
  /**
   * The age of the document holder.
   */
  readonly age: number;
  /**
   * The gender of the document holder.
   * Returns first letter of the value.
   * i.e. "M" which is the short value of Male.
   */
  readonly gender: string;
  /**
   * The full name of the document holder.
   */
  readonly fullName: string;
  /**
   * The first name of the document holder.
   */
  readonly firstName: string;
  /**
   * The last name of the document holder.
   */
  readonly lastName: string;
  /**
   * The middle name of the document holder.
   */
  readonly middleName: string;
  /**
   * The extracted document ID.
   */
  readonly documentId: string;
  /**
   * The extracted document number.
   */
  readonly documentNumber: string;
  /**
   * The address of the document holder.
   */
  readonly address: Address;
  /**
   * The expiry date of the document.
   * Use .date to get full date in string with yyyy-mm-dd format.
   */
  readonly dateOfExpiry: DateType;
  /**
   * The birth date of the document holder.
   * Use .date to get full date in string with yyyy-mm-dd format.
   */
  readonly dateOfBirth: DateType;
}

export interface ImageValidation {
  /**
   * Whether document image is blurry.
   */
  readonly blur: boolean;
  /**
   * Whether document image has glare.
   */
  readonly glare: boolean;
  /**
   * Invalid document image dimension has been detected.
   */
  readonly invalidDimension: boolean;
}

export interface DateValidation {
  /**
   * Whether the document is expired.
   */
  readonly isExpired: DateStatus;
  /**
   * If recognized age is over 18 years old.
   */
  readonly isOver18: DateStatus;
  /**
   * If recognized age is over 21 years old.
   */
  readonly isOver21: DateStatus;
  /**
   * Remaining days before the document expires.
   */
  readonly remainingDays: number;
}

export interface DocumentAnalysis {
  /**
   * Whether back side of the document is required.
   */
  readonly backSideRequired: boolean;
  /**
   * Whether back side of the document is supported.
   */
  readonly backSideSupport: boolean;
  /**
   * Whether document has barcode.
   */
  readonly barcode: boolean;
  /**
   * Whether the document has MRZ.
   */
  readonly mrz: boolean;
  /**
   * Whether NFC feature is supported.
   */
  readonly nfcSupport: boolean;
}

export interface Viz {
  readonly primary: Record<string, string>;
  readonly transliterated: Record<string, Record<string, string>>;
}

export interface ExtractedInfo {
  /**
   * The extracted data from The Visual Inspection Zone.
   */
  readonly viz: Viz;
  /**
   * The extracted data from The Machine Readable Zone.
   */
  readonly mrz: Record<string, string>;
  /**
   * The extracted data from The Barcode.
   */
  readonly barcode: Record<string, string>;
}

export enum ComparedFieldValue {
  Empty = -1,
  NoMatch = 0,
  Match = 1,
}

export interface ComparedResultsField {
  readonly idNumber: ComparedFieldValue;
  readonly lastName: ComparedFieldValue;
  readonly birthDate: ComparedFieldValue;
  readonly firstName: ComparedFieldValue;
  readonly givenName: ComparedFieldValue;
  readonly expiryDate: ComparedFieldValue;
  readonly middleName: ComparedFieldValue;
  readonly documentNumber: ComparedFieldValue;
}

export interface ComparedResultsVizVsMachineReadable {
  /**
   * The machine-readable source used for comparison. Enum: "PDF417" or "MRZ".
   */
  readonly comparedWith: string;
  readonly fields: ComparedResultsField;
  readonly fullDataMatch: boolean;
}

export interface IDScanRecognizerDetails {
  /**
   * Document analysis.
   */
  readonly documentAnalysis: DocumentAnalysis;
  /**
   * Document information.
   */
  readonly documentInfo: DocumentInfo;
  /**
   * Document image validation.
   */
  readonly imageValidation: ImageValidation;
  /**
   * Document date validation.
   */
  readonly dateValidation: DateValidation;
  /**
   * Extracted OCR data.
   */
  readonly extractedInfo: ExtractedInfo;
  /**
   * Extracted VIZ vs. Barcode/MRZ comparisons.
   */
  readonly comparedResultsVizVsMachineReadable: ComparedResultsVizVsMachineReadable;
}

/**
 * Defines ID Scan recognizer result.
 */
export class IDScanRecognizerResult {
  /**
   * Process status.
   */
  readonly status: IDScanProcessStatus;
  /**
   * ID Scan recognizer details.
   */
  readonly details: IDScanRecognizerDetails;

  constructor(status: IDScanProcessStatus, data: IDScanRecognizerDetails) {
    this.status = status;
    this.details = data;
  }
}

/**
 * Defines Document Result Wrapper containing document_id.
 */
export class DocumentIDScanResultWrapper {
  /**
   * Id of the document has been uploaded/submitted.
   */
  readonly document_id: String;

  /**
   * ID Scan recognizer result.
   */
  readonly id_scan_recognizer_result: IDScanRecognizerResult;

  constructor(document_id: String, id_scan_recognizer_result: IDScanRecognizerResult) {
    this.document_id = document_id;
    this.id_scan_recognizer_result = id_scan_recognizer_result;
  }
}
