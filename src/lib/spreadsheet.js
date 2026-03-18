/**
 * Spreadsheet adapter — all XLSX reading goes through this file.
 *
 * To swap the underlying library, update only this module.
 * The rest of the app depends solely on the three exported functions below.
 *
 * Current implementation: ExcelJS (actively maintained, no known high-severity
 * vulnerabilities). Replaces SheetJS (xlsx@0.18.5), which has known prototype-
 * pollution and ReDoS vulnerabilities (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9).
 *
 * Contract for all implementations:
 *   parseWorkbook(arrayBuffer)         → Promise<workbook>
 *   getSheetNames(workbook)            → string[]
 *   getRows(workbook, sheetName, max)  → Array<Array<string|number|boolean|Date|null>>
 *
 * Cell value types returned by getRows:
 *   - Date-formatted cells  → JavaScript Date
 *   - Boolean cells         → true | false
 *   - Number cells          → number
 *   - String/RichText cells → trimmed string, or null if empty
 *   - Empty / error cells   → null
 */

import ExcelJS from 'exceljs';
import { log } from './debug.js';

// ---------------------------------------------------------------------------
// Parse an ArrayBuffer (from FileReader) into an opaque workbook handle.
// The returned object is passed to getSheetNames() and getRows() — nothing
// outside this file should access its internals directly.
// ---------------------------------------------------------------------------
export async function parseWorkbook(arrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  log('Parsed workbook, sheets:', wb.worksheets.map((s) => s.name));
  return wb;
}

// ---------------------------------------------------------------------------
// Return the list of sheet names in the workbook, in tab order.
// ---------------------------------------------------------------------------
export function getSheetNames(workbook) {
  return workbook.worksheets.map((ws) => ws.name);
}

// ---------------------------------------------------------------------------
// Return up to `maxRows` rows from the named sheet.
// Each row is a 0-indexed array of cell values. Cells within a row that are
// empty are represented as null. Rows that are entirely empty are skipped.
//
// maxRows defaults to Infinity (return all rows). Pass a limit when you only
// need to scan the top of the sheet, e.g. during header row detection.
// ---------------------------------------------------------------------------
export function getRows(workbook, sheetName, maxRows = Infinity) {
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);

  const result = [];

  ws.eachRow({ includeEmpty: false }, (row) => {
    if (result.length >= maxRows) return;

    const rowValues = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      // ExcelJS uses 1-based column numbers; we build a 0-based array.
      // Fill any gap between the last cell and this one with nulls so that
      // column positions stay aligned with the header row.
      while (rowValues.length < colNumber - 1) rowValues.push(null);
      rowValues.push(extractCellValue(cell));
    });

    // Skip rows where every cell resolved to null (avoids processing blank rows
    // that Excel sometimes includes at the end of a sheet)
    if (rowValues.some((v) => v !== null)) {
      result.push(rowValues);
    }
  });

  log(`getRows("${sheetName}"): ${result.length} non-empty rows`);
  return result;
}

// ---------------------------------------------------------------------------
// Internal: convert an ExcelJS Cell object to a plain JavaScript value.
//
// ExcelJS exposes a numeric `cell.type` — we switch on the named constants
// rather than raw numbers so the intent is clear.
//
// Critical: Date cells must come back as Date objects, not strings. The
// validation layer (validation.js) checks instanceof Date to enforce that
// date columns are properly formatted in the spreadsheet.
// ---------------------------------------------------------------------------
function extractCellValue(cell) {
  if (!cell) return null;

  switch (cell.type) {
    case ExcelJS.ValueType.Null:
    case ExcelJS.ValueType.Merge:  // merged cells read as null in their non-primary positions
      return null;

    case ExcelJS.ValueType.Date:
      // Return the Date object directly; validation.js will call .toISOString()
      return cell.value instanceof Date ? cell.value : null;

    case ExcelJS.ValueType.Boolean:
      return cell.value; // true | false

    case ExcelJS.ValueType.Number:
      return cell.value;

    case ExcelJS.ValueType.String:
    case ExcelJS.ValueType.SharedString: {
      // Trim whitespace; return null for empty strings so downstream code
      // can treat null as "no value" uniformly
      const s = String(cell.value ?? '').trim();
      return s || null;
    }

    case ExcelJS.ValueType.RichText: {
      // Rich-text cells expose a .text property (plain text without formatting)
      const s = (cell.text ?? '').trim();
      return s || null;
    }

    case ExcelJS.ValueType.Formula: {
      // For formula cells, ExcelJS provides the cached result from the last
      // time Excel calculated the workbook. We extract the result value using
      // the same type logic as above.
      const r = cell.result;
      if (r instanceof Date)       return r;
      if (typeof r === 'boolean')  return r;
      if (typeof r === 'number')   return r;
      if (typeof r === 'string')   return r.trim() || null;
      return null;
    }

    case ExcelJS.ValueType.Error:
      // Cell contains a formula error (e.g. #REF!, #DIV/0!) — treat as empty
      return null;

    default:
      // Future-proofing: fall back to the raw value for any types added later
      return cell.value ?? null;
  }
}
