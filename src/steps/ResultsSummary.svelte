<script>
  // Step 6 — Results Summary.
  //
  // Displays the outcome of the upload session: how many rows were uploaded,
  // skipped as duplicates, skipped due to validation failures, and (if the
  // upload was interrupted) how many rows were not processed.
  //
  // If the upload failed mid-way, a Retry button returns to the UploadProgress
  // step. Because the deduplication logic skips already-uploaded rows, retrying
  // is always safe — it will pick up exactly where the last attempt left off.
  //
  // "Upload another file" resets the wizard to the beginning by clearing the
  // workbook store (which triggers FileSelection to show a fresh state).

  import { uploadResults, currentStep, STEPS, workbook } from '../stores.js';

  // Read the results snapshot written by UploadProgress at the end of the session.
  // Using $uploadResults directly in the template would also work, but storing in
  // a local const makes the template a bit cleaner.
  const r = $uploadResults;

  function retry() {
    // Return to the upload step — deduplication will skip already-uploaded rows
    currentStep.set(STEPS.UPLOAD_PROGRESS);
  }

  function startOver() {
    // Clearing the workbook store signals FileSelection to reset its UI.
    // All other wizard state (mappings, validation results, etc.) will be
    // overwritten when the user picks a new file and processes it.
    workbook.set(null);
    currentStep.set(STEPS.FILE_SELECTION);
  }
</script>

<div class="card">
  <div class="card-header">
    <h2>{r.failed ? 'Upload Interrupted' : 'Upload Complete'}</h2>
    <p>
      {#if r.failed}
        An error occurred during upload. See details below.
      {:else}
        All rows have been processed successfully.
      {/if}
    </p>
  </div>

  <!-- Stats grid — shows key numbers at a glance -->
  <div class="stats">
    <div class="stat success">
      <div class="stat-value">{r.uploaded}</div>
      <div class="stat-label">Uploaded</div>
    </div>
    <!-- Duplicate count only gets the warning colour when there are actually dupes -->
    <div class="stat {r.duplicates > 0 ? 'warning' : ''}">
      <div class="stat-value">{r.duplicates}</div>
      <div class="stat-label">Duplicates skipped</div>
    </div>
    {#if r.validationSkipped > 0}
      <div class="stat warning">
        <div class="stat-value">{r.validationSkipped}</div>
        <div class="stat-label">Invalid rows skipped</div>
      </div>
    {/if}
    {#if r.remaining > 0}
      <div class="stat error">
        <div class="stat-value">{r.remaining}</div>
        <div class="stat-label">Not processed</div>
      </div>
    {/if}
  </div>

  <!-- Failure detail — only shown when the upload was interrupted -->
  {#if r.failed}
    <div class="alert alert-error" role="alert">
      Upload stopped at row {r.failed.rowIndex}: {r.failed.error}
    </div>

    <!-- Expandable section showing the field values of the failed record,
         useful for diagnosing whether the problem was in the data or the network -->
    <details class="failed-detail">
      <summary>Show failed record</summary>
      <div class="failed-body">
        <table>
          <tbody>
            {#each Object.entries(r.failed.resolvedFields ?? {}) as [k, v]}
              <tr>
                <td style="font-weight:500;width:40%">{k}</td>
                <td class="mono">{v ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  {/if}

  <div class="btn-row">
    {#if r.remaining > 0}
      <!-- Retry is safe: deduplication skips rows that were already uploaded -->
      <button class="btn btn-primary" onclick={retry}>
        Retry ({r.remaining} remaining)
      </button>
    {/if}
    <button class="btn btn-secondary" onclick={startOver}>
      ← Upload another file
    </button>
  </div>
</div>

<style>
  .failed-detail {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: 8px;
  }
  .failed-detail summary {
    padding: 10px 14px;
    cursor: pointer;
    font-weight: 500;
    font-size: .875rem;
    background: var(--bg);
  }
  .failed-body { padding: 12px; overflow-x: auto; }
</style>
