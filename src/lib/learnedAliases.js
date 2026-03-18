// Learned aliases — persist user-confirmed column header mappings across sessions.
//
// Problem: the first time a user uploads a spreadsheet, the column headers might
// not exactly match the hard-coded aliases in config.js (e.g. "TX Date" vs
// "Publication Date and Time"). The user fixes this on the Column Mapping Review
// screen. Without learned aliases, they'd have to do the same thing every time.
//
// Solution: when the user clicks Proceed on the Column Mapping Review, any
// column header that isn't already a hard-coded alias for its assigned field is
// saved here. On the next upload, autoMapColumns() checks these learned aliases
// first (at distance 0), so the mapping resolves automatically and — if all
// fields match — the review screen is skipped entirely.
//
// Storage: localStorage key "tep_learned_aliases"
// Format:  { "TX Date": "Publication Date and Time", "Pub Ref": "Publication ID", … }
// The keys are stored as-is (original casing); lookups are case-insensitive.

import { COLUMN_CONFIG } from '../config.js';

const STORAGE_KEY = 'tep_learned_aliases';

// Read the raw stored object from localStorage.
// Returns {} if the key is missing or the JSON is corrupt.
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Returns a lookup map keyed by lowercased column header for fast matching
// in autoMapColumns(). Example:
//   { "tx date": "Publication Date and Time", "pub ref": "Publication ID" }
// ---------------------------------------------------------------------------
export function getLearnedAliases() {
  const raw = load();
  const result = {};
  for (const [header, fieldName] of Object.entries(raw)) {
    result[header.toLowerCase()] = fieldName;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Called from ColumnMappingReview when the user clicks Proceed.
//
// Saves columnHeader as a learned alias for fieldName if — and only if — it
// isn't already listed in the field's hard-coded aliases array. This avoids
// bloating localStorage with entries that would be matched by the normal
// Levenshtein path anyway.
// ---------------------------------------------------------------------------
export function saveLearnedAlias(columnHeader, fieldName) {
  // Find the field config so we can check its hard-coded aliases
  const field = COLUMN_CONFIG.find((f) => f.fieldName === fieldName);
  if (!field) return; // unknown field — nothing to save

  // Case-insensitive check: is this header already a known alias?
  const headerLower  = columnHeader.toLowerCase();
  const alreadyKnown = field.aliases.some((a) => a.toLowerCase() === headerLower);
  if (alreadyKnown) return; // no need to store what the app already knows

  const stored = load();
  // Only write to localStorage if something has actually changed
  if (stored[columnHeader] !== fieldName) {
    stored[columnHeader] = fieldName;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }
}
