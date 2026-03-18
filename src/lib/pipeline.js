// Pipeline helpers — orchestrate the multi-step process between screen transitions.
//
// These functions sit between the Svelte step components and the lower-level lib
// modules. They read from and write to the shared Svelte stores, so step components
// don't need to import every lib module directly.
//
// Two functions are exported:
//   processSheet(wb, sheetName)  — called after the user selects a sheet
//   runValidation()              — called after column mappings are confirmed

import { get } from 'svelte/store';
import {
  workbook, selectedSheet,
  headerColumns, dataRows,
  columnMappings, mappingDistances,
  validRows, invalidRows,
  skipColumnReview,
} from '../stores.js';
import { getRows } from './spreadsheet.js';
import { detectHeaderRow, autoMapColumns, buildDataRows, shouldAutoSkip } from './mapping.js';
import { validateRows } from './validation.js';
import { log } from './debug.js';

// ---------------------------------------------------------------------------
// processSheet — run after a sheet is selected (either automatically for
// single-sheet workbooks, or after the user picks one in SheetSelection).
//
// Steps performed:
//   1. Read all rows from the sheet
//   2. Detect which row is the header row (scoring algorithm)
//   3. Build data row objects keyed by column header
//   4. Auto-map column headers to COLUMN_CONFIG fields
//   5. Write results to the shared stores
//
// Returns true if the auto-skip conditions are met (column review can be
// bypassed), or false if the user needs to review the mappings.
//
// Throws an Error with a user-facing message if the sheet cannot be processed.
// ---------------------------------------------------------------------------
export async function processSheet(wb, sheetName) {
  log('processSheet:', sheetName);

  const rows = getRows(wb, sheetName);
  if (rows.length === 0) throw new Error('The sheet appears to be empty.');

  // Find the header row (may not be row 0 if there are title/notes rows above it)
  const headerIdx = detectHeaderRow(rows);
  if (headerIdx === null) {
    throw new Error(
      'Could not find a header row in this sheet. ' +
      'Make sure the first row contains column headings.'
    );
  }

  // Build a clean list of header strings (non-string cells are dropped)
  const header = rows[headerIdx]
    .map((v) => (v && typeof v === 'string' ? v.trim() : null))
    .filter(Boolean);

  if (header.length === 0) throw new Error('Header row contains no readable column names.');

  // Build data row objects (rows after the header, keyed by column header)
  const data = buildDataRows(rows, headerIdx);
  if (data.length === 0) {
    throw new Error('No data rows found below the header row — nothing to upload.');
  }

  // Auto-map: match each header cell to a COLUMN_CONFIG field
  const { columnMappings: mappings, mappingDistances: distances } = autoMapColumns(header);

  // Write everything to stores so step components can read them reactively
  headerColumns.set(header);
  dataRows.set(data);
  columnMappings.set(mappings);
  mappingDistances.set(distances);

  log(`Parsed ${data.length} data rows, ${header.length} columns`);

  // Determine whether the Column Mapping Review screen should be shown
  return shouldAutoSkip(mappings, distances, get(skipColumnReview));
}

// ---------------------------------------------------------------------------
// runValidation — validate the current dataRows against the current
// columnMappings and update the validRows / invalidRows stores.
//
// Called:
//   - When auto-skip is triggered (immediately after processSheet)
//   - When the user clicks Proceed on the Column Mapping Review screen
//
// Returns the raw { validRows, invalidRows } result so the caller can decide
// which step to navigate to next.
// ---------------------------------------------------------------------------
export function runValidation() {
  const rows    = get(dataRows);
  const mapping = get(columnMappings);
  log('Running validation on', rows.length, 'rows');
  const result = validateRows(rows, mapping);
  // Write results to stores so ValidationReport and UploadProgress can read them
  validRows.set(result.validRows);
  invalidRows.set(result.invalidRows);
  return result;
}
