// Column header detection and auto-mapping.
//
// Two problems are solved here:
//
// 1. Finding the header row — spreadsheets sometimes have title rows, notes, or
//    blank rows above the actual column headers. We scan the first 100 rows and
//    score each one by how many of the app's known field aliases it matches
//    (using Levenshtein distance ≤ 3 as the match threshold). The row with the
//    highest score is treated as the header row.
//
// 2. Mapping columns to fields — for each cell in the header row we find the
//    best-matching field. "Best" means lowest Levenshtein distance across all
//    aliases for all as-yet-unassigned fields. Ties are broken by field order in
//    COLUMN_CONFIG (earlier fields win).
//
//    Learned aliases (saved from previous user confirmations) are checked first
//    at distance 0, so repeat uploads of the same spreadsheet auto-resolve
//    without Levenshtein matching at all.

import { distance } from 'fastest-levenshtein';
import { COLUMN_CONFIG } from '../config.js';
import { log } from './debug.js';
import { getLearnedAliases } from './learnedAliases.js';

const HEADER_SCAN_LIMIT = 100; // maximum rows to scan when searching for the header
const HEADER_MATCH_DIST = 3;   // maximum Levenshtein distance to count as an alias match

// ---------------------------------------------------------------------------
// Scan the first HEADER_SCAN_LIMIT rows and return the index of the row that
// best matches known field aliases.
//
// Scoring: for each row, count how many distinct COLUMN_CONFIG fields have at
// least one cell that is within HEADER_MATCH_DIST of any of the field's aliases.
// The highest-scoring row wins.
//
// Returns null if no row scores > 0 (no recognisable headers found).
// ---------------------------------------------------------------------------
export function detectHeaderRow(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
  let bestScore = 0;
  let bestIndex = 0;

  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    const matchedFields = new Set(); // tracks which fields this row has matched

    for (const cell of row) {
      if (!cell || typeof cell !== 'string') continue;
      const cellLower = cell.trim().toLowerCase();

      for (const field of COLUMN_CONFIG) {
        if (matchedFields.has(field.fieldName)) continue; // already counted
        for (const alias of field.aliases) {
          if (distance(cellLower, alias.toLowerCase()) <= HEADER_MATCH_DIST) {
            matchedFields.add(field.fieldName);
            break; // one matching alias is enough to count this field
          }
        }
      }
    }

    if (matchedFields.size > bestScore) {
      bestScore = matchedFields.size;
      bestIndex = i;
    }
  }

  log(`Header detection: best row index ${bestIndex}, score ${bestScore}`);
  return bestScore > 0 ? bestIndex : null;
}

// ---------------------------------------------------------------------------
// Given the header row (array of cell values), auto-map each column to a
// COLUMN_CONFIG field.
//
// Algorithm (per column header cell):
//   1. Check learned aliases first — if the lowercased header matches a
//      previously confirmed mapping, assign it at distance 0. This satisfies
//      the auto-skip condition and avoids any Levenshtein work.
//   2. Otherwise, compute Levenshtein distance against every alias of every
//      unassigned field. Assign the field with the lowest distance.
//      Ties go to the field that appears earlier in COLUMN_CONFIG.
//   3. Each field can only be assigned once (greedy, first-come-first-served).
//
// Returns:
//   columnMappings:   { fieldName: columnHeaderString | null }
//   mappingDistances: { fieldName: distanceNumber | null }
//     (null means the field was not matched to any column)
// ---------------------------------------------------------------------------
export function autoMapColumns(headerRow) {
  const columnMappings   = {};
  const mappingDistances = {};
  const assignedFields   = new Set();                  // fields already claimed
  const learnedAliases   = getLearnedAliases();        // { lowerHeader: fieldName }

  for (const colHeader of headerRow) {
    if (!colHeader || typeof colHeader !== 'string') continue;
    const colTrimmed = colHeader.trim();
    const colLower   = colTrimmed.toLowerCase();

    // --- Step 1: learned alias check (distance 0) ---
    const learnedFieldName = learnedAliases[colLower];
    if (learnedFieldName && !assignedFields.has(learnedFieldName)) {
      const field = COLUMN_CONFIG.find((f) => f.fieldName === learnedFieldName);
      if (field) {
        log(`Learned alias match: "${colTrimmed}" → "${learnedFieldName}"`);
        columnMappings[learnedFieldName]   = colTrimmed;
        mappingDistances[learnedFieldName] = 0;
        assignedFields.add(learnedFieldName);
        continue; // skip Levenshtein for this column
      }
    }

    // --- Step 2: Levenshtein matching ---
    let bestField = null;
    let bestDist  = Infinity;

    for (const field of COLUMN_CONFIG) {
      if (assignedFields.has(field.fieldName)) continue; // already taken
      for (const alias of field.aliases) {
        const d = distance(colLower, alias.toLowerCase());
        if (d < bestDist) {
          bestDist  = d;
          bestField = field;
          // Note: we don't break early — we need the global minimum across
          // all fields and aliases. Iterating COLUMN_CONFIG in order means
          // that when two fields tie (same distance) the earlier one wins.
        }
      }
    }

    if (bestField) {
      columnMappings[bestField.fieldName]   = colTrimmed;
      mappingDistances[bestField.fieldName] = bestDist;
      assignedFields.add(bestField.fieldName);
    }
  }

  // Fields that weren't matched to any column get null values so downstream
  // code can check for unmapped fields without needing to check key existence
  for (const field of COLUMN_CONFIG) {
    if (!(field.fieldName in columnMappings)) {
      columnMappings[field.fieldName]   = null;
      mappingDistances[field.fieldName] = null;
    }
  }

  log('Auto-mapping result:', columnMappings);
  return { columnMappings, mappingDistances };
}

// ---------------------------------------------------------------------------
// Decide whether the Column Mapping Review screen can be skipped.
//
// Auto-skip is only safe when the user has opted in (checkbox) AND every field
// resolved at distance 0 — meaning the column headers are exact alias matches
// and no human verification is needed.
//
// Rules:
//   - All mandatory fields must be matched at distance 0
//   - All optional fields that WERE matched must also be at distance 0
//     (unmatched optional fields are fine — they'll use defaults)
// ---------------------------------------------------------------------------
export function shouldAutoSkip(columnMappings, mappingDistances, skipCheckboxTicked) {
  if (!skipCheckboxTicked) return false;

  for (const field of COLUMN_CONFIG) {
    const { fieldName, mandatory } = field;
    const mapped = columnMappings[fieldName];
    const dist   = mappingDistances[fieldName];

    if (mandatory) {
      // Mandatory field must be mapped AND must be an exact match
      if (!mapped || dist !== 0) return false;
    } else {
      // Optional field: if it was matched, the match must be exact
      if (mapped && dist !== 0) return false;
    }
  }

  log('Auto-skip: all conditions met');
  return true;
}

// ---------------------------------------------------------------------------
// Convert the raw row arrays (from getRows) into an array of objects keyed
// by column header string — the format expected by validateRows().
//
// allRows:        all rows including the header row
// headerRowIndex: index of the header row within allRows
//
// Example output row: { "Publication ID": "PUB-001", "Episode ID": "b0abc1234", … }
// ---------------------------------------------------------------------------
export function buildDataRows(allRows, headerRowIndex) {
  const headerRow = allRows[headerRowIndex];
  const dataRows  = [];

  for (let i = headerRowIndex + 1; i < allRows.length; i++) {
    const row = allRows[i];
    const obj = {};
    headerRow.forEach((header, col) => {
      // Only include columns that have a non-empty string header — numeric or
      // null header cells are skipped (they can't be looked up by name anyway)
      if (header && typeof header === 'string') {
        obj[header.trim()] = row[col] ?? null;
      }
    });
    // Skip rows where every value is null (trailing empty rows in the sheet)
    if (Object.values(obj).some((v) => v !== null)) {
      dataRows.push(obj);
    }
  }

  return dataRows;
}
