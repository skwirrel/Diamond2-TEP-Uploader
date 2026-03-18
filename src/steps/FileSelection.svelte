<script>
  // Step 1 — File Selection.
  //
  // Responsibilities:
  //   - Prompt the user to pick an XLSX file
  //   - Parse the workbook in the browser (no server upload)
  //   - Redirect to Settings if credentials are missing
  //   - On Continue: if the workbook has multiple sheets, go to SheetSelection;
  //     otherwise auto-select the only sheet, run processSheet, and advance
  //     to Column Mapping Review or skip straight to validation if auto-skip fires
  //
  // The file input is visually hidden and triggered via a styled <label>,
  // giving a consistent look across browsers.

  import { get } from 'svelte/store';
  import {
    workbook, sheetNames, selectedSheet,
    skipColumnReview, credentials,
    currentStep, STEPS, showSettings,
  } from '../stores.js';
  import { parseWorkbook, getSheetNames } from '../lib/spreadsheet.js';
  import { processSheet, runValidation } from '../lib/pipeline.js';
  import { log } from '../lib/debug.js';

  let loading  = $state(false); // true while parsing or processing the file
  let error    = $state('');    // user-facing error message
  let filename = $state('');    // display name of the selected file

  // On mount: check that all four credentials are present.
  // If any are missing, open the Settings modal immediately so the user
  // can enter them before trying to upload.
  $effect(() => {
    const c = get(credentials);
    if (!c.accessKeyId || !c.secretAccessKey || !c.bucketName || !c.region) {
      showSettings.set(true);
    }
  });

  // Called when the user selects a file via the file input.
  // Parses the workbook and stores it — does NOT start processing yet.
  async function onFileChange(e) {
    error    = '';
    filename = '';
    const file = e.target.files?.[0];
    if (!file) return;

    loading = true;
    try {
      // FileReader-style: get the raw bytes as an ArrayBuffer
      const buffer = await file.arrayBuffer();
      const wb     = await parseWorkbook(buffer);
      const sheets = getSheetNames(wb);

      if (sheets.length === 0) throw new Error('No sheets found in this workbook.');

      // Store the parsed workbook and sheet list so later steps can use them
      workbook.set(wb);
      sheetNames.set(sheets);
      filename = file.name;
      log('Loaded workbook:', file.name, 'sheets:', sheets);
    } catch (err) {
      error = err.message || 'Could not read this file. Is it a valid XLSX workbook?';
      log('File load error:', err);
    } finally {
      loading = false;
    }
  }

  // Called when the user clicks Continue.
  // Decides which step to navigate to next.
  async function proceed() {
    error   = '';
    loading = true;
    try {
      const wb     = get(workbook);
      const sheets = get(sheetNames);

      if (sheets.length > 1) {
        // Multiple sheets — let the user choose which one to process
        currentStep.set(STEPS.SHEET_SELECTION);
        return;
      }

      // Single sheet — auto-select it and go straight to processing
      const sheet = sheets[0];
      selectedSheet.set(sheet);
      const autoSkip = await processSheet(wb, sheet);

      if (autoSkip) {
        // All columns matched exactly — run validation and skip the mapping review
        const { invalidRows } = runValidation();
        currentStep.set(invalidRows.length > 0 ? STEPS.VALIDATION_REPORT : STEPS.UPLOAD_PROGRESS);
      } else {
        // Some columns need user review before we can proceed
        currentStep.set(STEPS.COLUMN_MAPPING);
      }
    } catch (err) {
      error = err.message;
      log('Proceed error:', err);
    } finally {
      loading = false;
    }
  }
</script>

<div class="card">
  <div class="card-header">
    <h2>Select Your Spreadsheet</h2>
    <p>Choose an XLSX file. The app will read it entirely in your browser —
       nothing is uploaded until you click Proceed.</p>
  </div>

  {#if error}
    <div class="alert alert-error" role="alert">{error}</div>
  {/if}

  <!-- File drop area — the actual <input> is invisible; the label acts as the click target -->
  <div class="drop-area">
    <label for="file-input" class="file-label">
      <span class="file-icon">📂</span>
      {#if filename}
        <strong>{filename}</strong>
        <span class="text-muted text-small">Click to choose a different file</span>
      {:else}
        <strong>Click to choose an XLSX file</strong>
        <span class="text-muted text-small">Supports .xlsx format</span>
      {/if}
    </label>
    <input id="file-input" type="file" accept=".xlsx" onchange={onFileChange} />
  </div>

  <!-- Only shown after a file is loaded — allows the user to opt in to auto-skip -->
  {#if $workbook}
    <label class="checkbox-row mt-16">
      <input type="checkbox" bind:checked={$skipColumnReview} />
      <span>Skip column review if all columns matched OK</span>
    </label>
  {/if}

  <div class="btn-row">
    <button class="btn btn-primary btn-lg"
            onclick={proceed}
            disabled={!$workbook || loading}>
      {loading ? 'Loading…' : 'Continue'}
    </button>
  </div>
</div>

<style>
  /* Dashed border file drop zone — highlights on hover/focus */
  .drop-area {
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius);
    padding: 32px;
    text-align: center;
    transition: border-color .2s, background .2s;
    margin-top: 4px;
  }
  .drop-area:has(input:focus-within),
  .drop-area:hover { border-color: var(--primary); background: var(--primary-light); }

  .file-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: .9375rem;
  }
  .file-icon { font-size: 2rem; }

  /* Hide the native file input — the label handles all interaction */
  input[type="file"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
</style>
