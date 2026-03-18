<script>
  // Step 2 — Sheet Selection.
  //
  // Only shown when the workbook contains more than one sheet.
  // (Single-sheet workbooks skip this step automatically in FileSelection.)
  //
  // The user picks a sheet from the list, then clicks Continue.
  // processSheet() is called here (same as in FileSelection for single-sheet
  // workbooks) to parse the selected sheet and auto-map its columns.

  import { get } from 'svelte/store';
  import { workbook, sheetNames, selectedSheet, currentStep, STEPS } from '../stores.js';
  import { processSheet, runValidation } from '../lib/pipeline.js';
  import { log } from '../lib/debug.js';

  // Default selection is the first sheet in the list
  let chosen  = $state($sheetNames[0] ?? '');
  let loading = $state(false);
  let error   = $state('');

  async function proceed() {
    error   = '';
    loading = true;
    try {
      selectedSheet.set(chosen);
      const wb       = get(workbook);
      const autoSkip = await processSheet(wb, chosen);

      if (autoSkip) {
        // All column headers matched at distance 0 — skip the review screen
        const { invalidRows } = runValidation();
        currentStep.set(invalidRows.length > 0 ? STEPS.VALIDATION_REPORT : STEPS.UPLOAD_PROGRESS);
      } else {
        // Some columns need user review
        currentStep.set(STEPS.COLUMN_MAPPING);
      }
    } catch (err) {
      error = err.message;
      log('SheetSelection error:', err);
    } finally {
      loading = false;
    }
  }

  function back() {
    currentStep.set(STEPS.FILE_SELECTION);
  }
</script>

<div class="card">
  <div class="card-header">
    <h2>Select Sheet</h2>
    <p>This workbook contains multiple sheets. Choose the one with your publication data.</p>
  </div>

  {#if error}
    <div class="alert alert-error" role="alert">{error}</div>
  {/if}

  <!-- Radio list — one option per sheet name -->
  <div class="sheet-list" role="radiogroup" aria-label="Sheet selection">
    {#each $sheetNames as name}
      <label class="sheet-option">
        <input type="radio" name="sheet" value={name} bind:group={chosen} />
        <span class="sheet-name">📄 {name}</span>
      </label>
    {/each}
  </div>

  <div class="btn-row">
    <button class="btn btn-secondary" onclick={back}>← Back</button>
    <button class="btn btn-primary" onclick={proceed} disabled={!chosen || loading}>
      {loading ? 'Loading…' : 'Continue'}
    </button>
  </div>
</div>

<style>
  .sheet-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Each sheet option is a full-width clickable row */
  .sheet-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .sheet-option:hover { border-color: var(--primary); background: var(--primary-light); }
  /* :has() lets us style the label based on its child radio state */
  .sheet-option:has(input:checked) { border-color: var(--primary); background: var(--primary-light); }

  .sheet-option input[type="radio"] { width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; }
  .sheet-name { font-weight: 500; }
</style>
