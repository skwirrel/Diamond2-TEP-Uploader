// Shared application state — all Svelte writable stores live here.
//
// Stores are imported directly by step components and lib modules. Because
// everything is centralised here, any component can read or write any piece of
// state without prop-drilling or component coupling.
//
// Svelte 5 note: these are classic writable stores (not runes). They work
// with the $store shorthand in component templates and with get(store) in
// plain JS modules.

import { writable } from 'svelte/store';

// ---------------------------------------------------------------------------
// Debug mode — set once on load from the URL query string.
// Exported so components and lib modules can branch on it (e.g. UploadProgress
// shows an XML preview screen when this is true).
// ---------------------------------------------------------------------------
export const debugMode = writable(
  new URLSearchParams(window.location.search).get('debug') === 'true'
);

// ---------------------------------------------------------------------------
// Navigation
//
// currentSection: which top-level area of the app is shown
//   'wizard'      — the main upload flow (default)
//   'errorReview' — the TEP error review tab (future feature)
//
// currentStep: integer index into the wizard step sequence (see STEPS below)
//
// showSettings: whether the Settings modal is open. The modal can be opened
//   at any time without resetting the current wizard step.
// ---------------------------------------------------------------------------
export const currentSection = writable('wizard');
export const currentStep    = writable(0);
export const showSettings   = writable(false);

// Named constants for wizard step indices.
// Use these everywhere instead of raw numbers so step order can be changed
// in one place without hunting for magic numbers across the codebase.
export const STEPS = Object.freeze({
  FILE_SELECTION:    0,
  SHEET_SELECTION:   1,
  COLUMN_MAPPING:    2,
  VALIDATION_REPORT: 3,
  UPLOAD_PROGRESS:   4,
  RESULTS:           5,
});

// ---------------------------------------------------------------------------
// AWS credentials — persisted to localStorage so the user only needs to enter
// them once. The store auto-saves on every change via the subscribe callback.
// ---------------------------------------------------------------------------
function makeCredentialsStore() {
  // Initialise from localStorage on startup (empty strings if not set)
  const store = writable({
    accessKeyId:     localStorage.getItem('tep_aws_access_key_id')     || '',
    secretAccessKey: localStorage.getItem('tep_aws_secret_access_key') || '',
    bucketName:      localStorage.getItem('tep_aws_bucket_name')       || '',
    region:          localStorage.getItem('tep_aws_region')            || '',
  });
  // Mirror every change back to localStorage
  store.subscribe((c) => {
    localStorage.setItem('tep_aws_access_key_id',     c.accessKeyId);
    localStorage.setItem('tep_aws_secret_access_key', c.secretAccessKey);
    localStorage.setItem('tep_aws_bucket_name',       c.bucketName);
    localStorage.setItem('tep_aws_region',            c.region);
  });
  return store;
}
export const credentials = makeCredentialsStore();

// ---------------------------------------------------------------------------
// Upload wizard state
// The stores below are populated progressively as the user moves through the
// wizard steps. They are reset when the user clicks "Upload another file".
// ---------------------------------------------------------------------------

// Whether to skip the Column Mapping Review screen when all fields are
// auto-matched at distance 0. Controlled by a checkbox on FileSelection.
export const skipColumnReview = writable(false);

// The parsed ExcelJS workbook object (opaque — only used via lib/spreadsheet.js)
export const workbook      = writable(null);
// List of sheet names in the workbook (populated after file is parsed)
export const sheetNames    = writable([]);
// The sheet the user selected (or the only sheet, if there is just one)
export const selectedSheet = writable('');

// Header row cell values from the selected sheet (string[]).
// Populated by processSheet(); used to populate the dropdowns in ColumnMappingReview.
export const headerColumns = writable([]);

// Data rows from the selected sheet — one object per row, keyed by column header.
// e.g. [ { "Publication ID": "PUB-001", "Episode ID": "b0abc1234", … }, … ]
export const dataRows = writable([]);

// Auto-mapped column assignments — keyed by fieldName, value is the matched
// column header string, '__ignore__', or null.
// e.g. { "Publication ID": "Pub ID", "Episode ID": null, … }
export const columnMappings = writable({});

// Levenshtein distance for each auto-mapped field — used to determine whether
// auto-skip is safe (all distances must be 0).
export const mappingDistances = writable({});

// Validation results — populated by runValidation() in lib/pipeline.js.
// validRows:   rows that passed all checks, with XML-ready resolved values
// invalidRows: rows with errors, with raw values and error messages for display
export const validRows   = writable([]);
export const invalidRows = writable([]);

// Final upload results — populated at the end of the UploadProgress step.
// Read by ResultsSummary to display the outcome.
export const uploadResults = writable({
  uploaded:          0,   // rows successfully uploaded to S3
  duplicates:        0,   // rows skipped because they were already in the bucket
  validationSkipped: 0,   // rows skipped because they failed validation
  failed:            null, // { rowIndex, resolvedFields, error } | null — first failure
  remaining:         0,   // rows not processed due to early failure
  total:             0,   // total valid rows attempted
});

// ---------------------------------------------------------------------------
// Error Review state
//
// These stores power the Error Review section. They persist across tab
// switches so the user doesn't lose their position if they briefly switch
// to the Upload tab and back.
// ---------------------------------------------------------------------------

// The current view within the Error Review section:
//   'list'   — batch list (default)
//   'detail' — viewing a specific batch's error files
export const errorReviewView = writable('list');

// The batch ID currently being viewed in detail (null when on the list view)
export const errorReviewBatchId = writable(null);

// Whether any error batch has unviewed errors — drives the alert icon on the
// Error Review nav tab. Updated by the background startup check in App.svelte
// and by ErrorReview.svelte when batches are loaded/viewed/dismissed.
export const hasUnviewedErrors = writable(false);
