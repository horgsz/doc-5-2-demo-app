import { IDScanFieldIssue, IDScanFieldIssues } from '@utils/interface';

// Shared between the review-screen component and its host: both key policy off
// the same predicate, and Stencil component modules cannot carry extra exports.

// The portrait and the barcode are told apart by name, not by field type: the
// two engines number them differently (5.2: 201 / 205, 6.0: 500 / 503) but name
// them the same, so one SDK runs against either engine.

/** Field name of the barcode, as it arrives in the field issues. */
export const BARCODE_FIELD_NAME = 'barcode';
/** Field name of the portrait. */
export const PORTRAIT_FIELD_NAME = 'face_photo';

export const isBarcodeField = (field: IDScanFieldIssue): boolean =>
  field?.name === BARCODE_FIELD_NAME;

export const isPortraitField = (field: IDScanFieldIssue): boolean =>
  field?.name === PORTRAIT_FIELD_NAME;

/**
 * Above this many text-field issues the list stops being actionable advice
 * and becomes an inventory of a bad capture -- the screen collapses to the
 * crop and one line saying the document is not clear. The portrait and the
 * barcode do not count towards it: they are side-wide verdicts, not lines the
 * user could read off the card.
 */
export const MAX_LISTED_FIELDS = 3;

/**
 * Whether the issues put the review screen in its collapsed, unusable-ID form.
 * A capture in this state is never accepted on the user's behalf.
 */
export const isUnclearDocument = (issues: IDScanFieldIssues): boolean =>
  (issues?.fields ?? []).filter(field => !isPortraitField(field) && !isBarcodeField(field))
    .length > MAX_LISTED_FIELDS;
