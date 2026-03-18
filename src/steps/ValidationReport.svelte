<script>
  // Step 4 — Validation Report.
  //
  // Shown when one or more rows failed field-level or record-level validation.
  // (If all rows pass, this step is skipped and the app goes straight to Upload.)
  //
  // The report shows one collapsible row per invalid record. Each expanded row
  // displays a table of all mapped field values, with failing fields highlighted
  // in red and their error messages shown inline.
  //
  // The user has two options:
  //   Go back    — return to Column Mapping to fix a mapping mistake, or fix
  //                the spreadsheet and start over from File Selection
  //   Proceed    — upload the valid rows only; invalid rows are counted in results
  //                (Proceed is disabled if there are zero valid rows)

  import { invalidRows, validRows, currentStep, STEPS } from '../stores.js';
  import { COLUMN_CONFIG } from '../config.js';

  // Field display order matches COLUMN_CONFIG order for consistency
  const fields = COLUMN_CONFIG.map((f) => f.fieldName);

  // Format a raw cell value for display in the table.
  // Date objects are shown in the user's locale; null/undefined show as a dash.
  function formatValue(v) {
    if (v === null || v === undefined) return '—';
    if (v instanceof Date) return v.toLocaleString();
    return String(v);
  }

  function proceed() {
    currentStep.set(STEPS.UPLOAD_PROGRESS);
  }

  function back() {
    currentStep.set(STEPS.COLUMN_MAPPING);
  }
</script>

<div class="card">
  <div class="card-header">
    <h2>Validation Report</h2>
    <p>
      {$invalidRows.length} row{$invalidRows.length === 1 ? '' : 's'} failed validation.
      Fix your spreadsheet and start over, or proceed with the
      {$validRows.length} valid row{$validRows.length === 1 ? '' : 's'} only.
    </p>
  </div>

  {#if $validRows.length === 0}
    <!-- No usable rows at all — prevent the user from proceeding -->
    <div class="alert alert-error" role="alert">
      No valid rows found. Please go back and fix your spreadsheet.
    </div>
  {:else}
    <div class="alert alert-warning" role="alert">
      Only valid rows will be uploaded. Invalid rows will be skipped and counted in the results.
    </div>
  {/if}

  <!-- Collapsible list of invalid rows — each expands to show field values and errors -->
  <div class="invalid-list">
    {#each $invalidRows as row}
      <details class="invalid-row">
        <summary class="invalid-summary">
          <span class="row-num">Row {row.rowIndex}</span>
          {#if row.fieldErrors._record}
            <!-- Cross-field error (from RECORD_VALIDATOR) — show the error directly -->
            <span class="badge badge-error">{row.fieldErrors._record}</span>
          {:else}
            <!-- Count of individual field errors -->
            {@const errCount = Object.keys(row.fieldErrors).length}
            <span class="badge badge-error">
              {errCount} field error{errCount === 1 ? '' : 's'}
            </span>
          {/if}
        </summary>

        <!-- Expanded: full table of field values with errors highlighted -->
        <div class="invalid-body">
          <table>
            <thead>
              <tr><th>Field</th><th>Value</th><th>Error</th></tr>
            </thead>
            <tbody>
              {#each fields as fieldName}
                {@const val = row.displayFields?.[fieldName]}
                {@const err = row.fieldErrors?.[fieldName]}
                <!-- Row turns red if this specific field has an error -->
                <tr class={err ? 'row-error' : ''}>
                  <td style="font-weight:500">{fieldName}</td>
                  <td class="mono">{formatValue(val)}</td>
                  <td class="text-error text-small">{err ?? ''}</td>
                </tr>
              {/each}
              {#if row.fieldErrors._record}
                <!-- Cross-field error shown as an extra row at the bottom -->
                <tr class="row-error">
                  <td colspan="2" style="font-style:italic">Cross-field check</td>
                  <td class="text-error text-small">{row.fieldErrors._record}</td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      </details>
    {/each}
  </div>

  <div class="btn-row">
    <button class="btn btn-secondary" onclick={back}>← Back to Column Mapping</button>
    <button class="btn btn-primary"
            onclick={proceed}
            disabled={$validRows.length === 0}>
      Proceed with {$validRows.length} valid row{$validRows.length === 1 ? '' : 's'}
    </button>
  </div>
</div>

<style>
  .invalid-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 8px;
  }

  .invalid-row {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .invalid-summary {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    background: var(--error-light);
    list-style: none;
    font-size: .875rem;
  }
  /* Hide the browser's default disclosure triangle */
  .invalid-summary::-webkit-details-marker { display: none; }
  /* Replace with a custom triangle that rotates on open */
  .invalid-summary::before { content: '▶'; font-size: .65rem; color: var(--error); }
  details[open] .invalid-summary::before { content: '▼'; }

  .row-num { font-weight: 600; color: var(--error); }

  .invalid-body { padding: 12px; overflow-x: auto; }
  .invalid-body table { margin: 0; }
</style>
