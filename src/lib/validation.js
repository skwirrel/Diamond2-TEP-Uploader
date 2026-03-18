// Field and record validation.
//
// Validation runs in two passes for each data row:
//   1. Field-level — each mapped cell value is checked against the field's
//      declared type (string, datetime, boolean, enum). Mandatory fields must
//      be non-empty. Any failure here skips the row immediately.
//   2. Record-level — RECORD_VALIDATOR in config.js receives the full set of
//      resolved (XML-ready) values and can check cross-field rules (e.g.
//      WindowClosureDateTime is only allowed when availabilityMode is onDemand).
//
// The main export, validateRows(), returns two arrays:
//   validRows   — rows that passed all checks, with values resolved for XML
//   invalidRows — rows with errors, with raw values preserved for display

import { COLUMN_CONFIG, RECORD_VALIDATOR } from '../config.js';
import { log } from './debug.js';

// Accepted string representations for boolean fields.
// Native spreadsheet boolean cells (true/false) are also accepted — see validateField().
const BOOLEAN_TRUTHY = ['true', 'yes', 'y', '1'];
const BOOLEAN_FALSY  = ['false', 'no', 'n', '0'];
const BOOLEAN_ALL    = [...BOOLEAN_TRUTHY, ...BOOLEAN_FALSY];

// ---------------------------------------------------------------------------
// Validate a single raw cell value against a field's type rules.
// Returns an error string describing the problem, or null if the value is valid.
// ---------------------------------------------------------------------------
function validateField(fieldConfig, rawValue) {
  const { fieldName, type, enumValues, mandatory } = fieldConfig;

  // Treat null, undefined, and whitespace-only strings as "empty"
  const isEmpty =
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue === 'string' && rawValue.trim() === '');

  if (isEmpty) {
    // Mandatory fields must have a value; optional fields are fine without one
    return mandatory ? `${fieldName} is required` : null;
  }

  switch (type) {
    case 'string':
      // Any non-empty string is valid
      return null;

    case 'datetime':
      // The cell must be a proper Date object (i.e. the Excel column was
      // formatted as Date, not as text). If the user types a date as plain
      // text we deliberately reject it with a helpful message — a text cell
      // formatted to look like a date could be in any regional format and
      // parsing it would be unreliable.
      if (!(rawValue instanceof Date) || isNaN(rawValue.getTime())) {
        return `${fieldName} must be a Date-formatted cell (not plain text)`;
      }
      return null;

    case 'boolean': {
      // Native spreadsheet boolean cells come through as JS booleans — always valid
      if (typeof rawValue === 'boolean') return null;
      // String representations are accepted case-insensitively
      const s = String(rawValue).toLowerCase().trim();
      if (!BOOLEAN_ALL.includes(s)) {
        return `${fieldName} must be true/false, yes/no, y/n, or 1/0`;
      }
      return null;
    }

    case 'enum':
      // Enum values are case-sensitive (e.g. "broadcast", not "Broadcast")
      if (!enumValues.includes(String(rawValue).trim())) {
        return `${fieldName} must be one of: ${enumValues.join(', ')}`;
      }
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Resolve a raw cell value to the final string that will be written into XML.
// Returns null if there is no usable value (field will be omitted from XML).
//
// resolvedRowSoFar is the partially-built resolved object for this row — it is
// passed to function defaults so they can reference earlier fields, e.g.:
//   Channel ID defaults to (row) => row['Channel Label']
// ---------------------------------------------------------------------------
function resolveValue(fieldConfig, rawValue, resolvedRowSoFar) {
  const { type, default: defaultFn } = fieldConfig;

  const isEmpty =
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue === 'string' && rawValue.trim() === '');

  let val = isEmpty ? null : rawValue;

  // Apply default if the cell was empty
  if (val === null) {
    // Default can be a literal value OR a function that derives from other fields
    val = typeof defaultFn === 'function' ? defaultFn(resolvedRowSoFar) : defaultFn;
  }

  if (val === null || val === undefined) return null;

  // Type-specific conversion to the string representation used in XML
  if (type === 'datetime') {
    // Date objects are serialised as ISO 8601 UTC strings (e.g. "2025-03-15T20:00:00.000Z")
    if (val instanceof Date) return val.toISOString();
    return null; // shouldn't reach here if validateField passed, but be safe
  }

  if (type === 'boolean') {
    // Normalise all accepted boolean representations to the literal strings
    // "true" or "false" for consistent XML output
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    const s = String(val).toLowerCase().trim();
    return BOOLEAN_TRUTHY.includes(s) ? 'true' : 'false';
  }

  // string and enum: trim whitespace and return as string
  return String(val).trim();
}

// ---------------------------------------------------------------------------
// Look up the raw cell value for a field in a data row object.
// columnMappings maps fieldName → spreadsheet column header string.
// Returns null if the field is unmapped or explicitly set to ignore.
// ---------------------------------------------------------------------------
function getRawValue(fieldName, dataRow, columnMappings) {
  const col = columnMappings[fieldName];
  // '__ignore__' is the sentinel value used by the Column Mapping Review UI
  // for optional fields the user has chosen not to map
  if (!col || col === '__ignore__') return null;
  return dataRow[col] ?? null;
}

// ---------------------------------------------------------------------------
// Main export: validate and resolve every data row.
//
// Returns:
//   validRows:   [ { rowIndex, resolvedFields } ]
//     resolvedFields: { fieldName: xmlReadyString | null }
//
//   invalidRows: [ { rowIndex, displayFields, fieldErrors } ]
//     displayFields: { fieldName: rawCellValue }  — shown in the Validation Report
//     fieldErrors:   { fieldName: errorString }   — '_record' key for cross-field errors
// ---------------------------------------------------------------------------
export function validateRows(dataRows, columnMappings) {
  const validRows   = [];
  const invalidRows = [];

  dataRows.forEach((dataRow, idx) => {
    // rowIndex is 1-based and accounts for the header row (row 1 in the spreadsheet)
    const rowIndex = idx + 2;
    log(`Validating row ${rowIndex}`, dataRow);

    const fieldErrors   = {};
    const displayFields = {};

    // --- Pass 1: field-level validation ---
    for (const fieldConfig of COLUMN_CONFIG) {
      const { fieldName } = fieldConfig;
      const raw = getRawValue(fieldName, dataRow, columnMappings);
      displayFields[fieldName] = raw; // preserve raw value for the error report

      const error = validateField(fieldConfig, raw);
      if (error) fieldErrors[fieldName] = error;
    }

    // If any field failed, record the row as invalid and move on
    if (Object.keys(fieldErrors).length > 0) {
      invalidRows.push({ rowIndex, displayFields, fieldErrors });
      return; // forEach callback — continues to the next row
    }

    // --- Pass 2: resolve values for XML ---
    // We build resolvedFields incrementally so that function defaults
    // (e.g. Channel ID defaulting to Channel Label) can reference fields
    // that were resolved earlier in the COLUMN_CONFIG order.
    const resolvedFields = {};
    for (const fieldConfig of COLUMN_CONFIG) {
      const { fieldName } = fieldConfig;
      const raw = getRawValue(fieldName, dataRow, columnMappings);
      resolvedFields[fieldName] = resolveValue(fieldConfig, raw, resolvedFields);
    }

    // --- Pass 3: record-level (cross-field) validation ---
    const recordError = RECORD_VALIDATOR(resolvedFields);
    if (recordError !== true) {
      // Store under the '_record' key so the UI can distinguish it from
      // field-level errors (which are keyed by fieldName)
      invalidRows.push({
        rowIndex,
        displayFields: resolvedFields,
        fieldErrors: { _record: recordError },
      });
      return;
    }

    validRows.push({ rowIndex, resolvedFields });
  });

  log(`Validation complete: ${validRows.length} valid, ${invalidRows.length} invalid`);
  return { validRows, invalidRows };
}
