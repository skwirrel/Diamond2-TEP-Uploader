# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Always activate Node 24 first** (system default is Node 16, which is too old):
```bash
. ~/.nvm/nvm.sh && nvm use
```

```bash
npm run dev      # dev server (Vite HMR)
npm run build    # production build → dist/
npm run preview  # serve dist/ locally
```

There are no tests or lint scripts configured.

## Architecture

This is a **fully client-side Svelte 5 + Vite** app — no server. It converts XLSX rows to XML and uploads to S3. The compiled output in `dist/` is plain static files.

### Data flow through the wizard

```
FileSelection → (SheetSelection) → ColumnMappingReview → ValidationReport → UploadProgress → ResultsSummary
```

State lives in **`src/stores.js`** (Svelte writable stores). Navigation is driven by the `currentStep` integer store using `STEPS` constants — there is no router. The `currentSection` store switches between `'wizard'` and `'errorReview'`.

### Key modules and their responsibilities

| File | Role |
|---|---|
| `src/config.js` | `COLUMN_CONFIG` (17 field definitions) + `RECORD_VALIDATOR` — the only place to change field schema or cross-field validation rules |
| `src/lib/spreadsheet.js` | ExcelJS adapter — **only file that touches XLSX parsing**; swap library here |
| `src/lib/mapping.js` | Header row detection (scoring algorithm) + `autoMapColumns()` (learned aliases first, then Levenshtein) + auto-skip logic |
| `src/lib/pipeline.js` | `processSheet()` and `runValidation()` — orchestrates lib functions and writes to stores; called by step components |
| `src/lib/validation.js` | Field-level + record-level validation; `validateRows()` produces `validRows`/`invalidRows` |
| `src/lib/xml.js` | DOM-based XML generation using XPath-like notation from `COLUMN_CONFIG.xpath` |
| `src/lib/dedupe.js` | SHA-256 via `crypto.subtle`; localStorage circular buffer (1000 hashes, key `tep_upload_hash_cache`) |
| `src/lib/s3.js` | AWS SDK v3 S3 operations: remote dedup check, PutObject upload, batch ID generation, filename parsing, paginated listing, object download |
| `src/lib/errorCache.js` | localStorage cache (`tep_error_cache`) for error review: batch status (new/viewed/dismissed) and cached error detail summaries |
| `src/lib/errorPipeline.js` | Error review orchestrator: `loadErrorBatches()` (list + group by batch ID) and `loadErrorDetail()` (lazy JSON + XML download) |
| `src/lib/learnedAliases.js` | Persist user-confirmed column→field mappings to localStorage (`tep_learned_aliases`); checked at distance 0 before Levenshtein |
| `src/lib/debug.js` | `log()` utility — no-op unless `?debug=true` in URL |

### COLUMN_CONFIG field shape

```js
{
  fieldName: 'Publication ID',   // display name + store key
  xpath: '@publicationId',       // relative to <Publication> element; @attr, Child/el, El[n]/@attr
  type: 'string' | 'datetime' | 'boolean' | 'enum',
  enumValues: [...],             // only for type:'enum'
  mandatory: true | false,
  default: null | 'literal' | (resolvedRowSoFar) => value,
  aliases: ['...'],              // hard-coded fuzzy-match aliases
}
```

### Svelte 5 conventions used

- Runes: `$state`, `$derived`, `$derived.by()`, `$props()`
- Event handlers: `onclick={}` not `on:click={}`
- Writable stores still work with `$store` shorthand in templates
- `get(store)` (from `svelte/store`) used in plain JS modules

### localStorage keys

| Key | Content |
|---|---|
| `tep_aws_*` | Credentials (4 keys) |
| `tep_upload_hash_cache` | JSON array, circular buffer of SHA-256 hashes |
| `tep_learned_aliases` | JSON object `{ "columnHeader": "fieldName" }` |
| `tep_error_cache` | JSON object `{ batches: { batchId: status }, errorDetails: { filename: summary } }` |

### SheetJS was replaced with ExcelJS

SheetJS (`xlsx@0.18.5`) has prototype-pollution + ReDoS vulnerabilities. All XLSX logic is isolated in `src/lib/spreadsheet.js`. ExcelJS returns native `Date` objects for date cells automatically (no `cellDates` option needed). **Do not re-introduce SheetJS.**

### Bundle size

~1.2 MB minified (AWS SDK + ExcelJS). This is expected for an internal tool and not a problem to solve.
