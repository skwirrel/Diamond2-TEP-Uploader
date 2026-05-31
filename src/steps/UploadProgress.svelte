<script>
  // Step 5 — Upload Progress.
  //
  // Iterates through the valid rows and uploads each one to S3.
  // For each row the sequence is:
  //   1. Generate XML from resolved field values
  //   2. Hash the XML with SHA-256
  //   3. Check the local hash cache — skip if already uploaded from this browser
  //   4. Check the remote S3 bucket — skip if already uploaded from any browser
  //      (remote check failure is non-fatal; the row is uploaded anyway)
  //   5. Upload to incoming/ in S3
  //   6. Add the hash to the local cache
  //
  // If any upload fails, the loop stops immediately. The user can retry from
  // the Results screen — already-uploaded rows will be skipped by deduplication.
  //
  // Debug mode (?debug=true): instead of going straight to upload, a preview
  // screen is shown first with all generated XML documents so the developer
  // can inspect the output without making any S3 calls.

  import { get } from 'svelte/store';
  import {
    validRows, invalidRows,
    credentials, uploadResults,
    currentStep, STEPS,
  } from '../stores.js';
  import { generateXML, previewXML } from '../lib/xml.js';
  import { hashXML, isInLocalCache, addToLocalCache } from '../lib/dedupe.js';
  import { makeS3Client, isRemoteDuplicate, uploadXML, makeS3Key, generateBatchId } from '../lib/s3.js';
  import { isDebug } from '../lib/debug.js';
  import { log } from '../lib/debug.js';

  // Upload state machine:
  //   'idle'       — ready to start, waiting for user to click Upload
  //   'previewing' — debug mode only; showing XML preview before upload
  //   'running'    — upload loop in progress
  //   'done'       — all rows processed successfully
  //   'error'      — upload failed; loop stopped
  let status    = $state('idle');
  let progress  = $state(0);    // 0–1 fraction of rows processed
  let uploaded  = $state(0);    // count of rows successfully uploaded
  let dupes     = $state(0);    // count of rows skipped as duplicates
  let failedRow = $state(null); // { rowIndex, resolvedFields, error } — first failure
  let remaining = $state(0);    // rows not processed after a failure
  let xmlStrings = $state([]);  // accumulated XML strings for debug preview

  const rows    = get(validRows);
  const total   = rows.length;
  const batchId = generateBatchId(); // shared by all files in this upload session

  // In debug mode, generate all XML documents upfront and show a preview screen
  // so the developer can inspect the output before any upload happens.
  if (isDebug) {
    status     = 'previewing';
    xmlStrings = rows.map((r) => generateXML(r.resolvedFields));
  }

  // Main upload loop — called when the user clicks the Upload button.
  async function startUpload() {
    status    = 'running';
    progress  = 0;
    uploaded  = 0;
    dupes     = 0;
    failedRow = null;

    const creds  = get(credentials);
    const s3     = makeS3Client(creds); // reuse one client for all rows in this session
    const bucket = creds.bucketName;

    for (let i = 0; i < rows.length; i++) {
      const { rowIndex, resolvedFields } = rows[i];
      const xml  = generateXML(resolvedFields);
      const hash = await hashXML(xml);

      // --- Dedup check 1: local cache (no network) ---
      if (isInLocalCache(hash)) {
        log(`Row ${rowIndex}: local duplicate, skipping`);
        dupes++;
        progress = (i + 1) / total;
        continue;
      }

      // --- Dedup check 2: remote S3 scan ---
      try {
        const remoteDupe = await isRemoteDuplicate(s3, bucket, hash);
        if (remoteDupe) {
          log(`Row ${rowIndex}: remote duplicate, skipping`);
          addToLocalCache(hash); // warm the local cache so next run is faster
          dupes++;
          progress = (i + 1) / total;
          continue;
        }
      } catch (e) {
        // A failed remote check (e.g. network error, permission denied) is not
        // fatal — we proceed with the upload rather than blocking on it.
        log(`Row ${rowIndex}: remote dedup check failed (${e.message}), uploading anyway`);
      }

      // --- Upload ---
      try {
        const key = makeS3Key(hash, batchId);
        await uploadXML(s3, bucket, key, xml);
        addToLocalCache(hash); // record success so future runs skip this row
        uploaded++;
        progress = (i + 1) / total;
      } catch (e) {
        // Upload failure stops the loop — the user can retry from Results
        failedRow = { rowIndex, resolvedFields, error: e.message };
        remaining = total - i - 1; // rows we didn't get to
        status    = 'error';
        break;
      }
    }

    if (status !== 'error') {
      status   = 'done';
      progress = 1;
    }

    // Write the final tally to the uploadResults store so ResultsSummary can display it
    uploadResults.set({
      uploaded,
      duplicates:        dupes,
      validationSkipped: get(invalidRows).length, // rows skipped before this step
      failed:            failedRow,
      remaining,
      total,
    });

    if (status === 'done') {
      currentStep.set(STEPS.RESULTS);
    }
    // On error we stay on this step so the user can see the failure details
    // and then navigate to Results via the store (which triggers automatically
    // in ResultsSummary via the retry button)
  }

  // Debug mode helpers
  function openPreview() {
    previewXML(xmlStrings); // opens a new window with formatted XML
  }

  function proceedAfterPreview() {
    status = 'idle'; // dismiss the preview and show the normal Upload button
  }
</script>

<div class="card">
  <div class="card-header">
    <h2>
      {#if status === 'previewing'}Reviewing XML Before Upload
      {:else if status === 'running'}Uploading…
      {:else if status === 'done'}Upload Complete
      {:else if status === 'error'}Upload Failed
      {:else}Ready to Upload
      {/if}
    </h2>
    {#if status === 'idle' || status === 'previewing'}
      <p>
        {total} row{total === 1 ? '' : 's'} ready to upload.
        Duplicates will be automatically skipped.
      </p>
    {/if}
  </div>

  <!-- Debug preview mode — only reachable via ?debug=true -->
  {#if status === 'previewing'}
    <div class="alert alert-info" role="alert">
      <strong>Debug mode:</strong> {xmlStrings.length} XML documents generated.
      Review them before uploading.
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick={openPreview}>🔍 Preview XML in new window</button>
      <button class="btn btn-primary" onclick={proceedAfterPreview}>Proceed to Upload</button>
    </div>

  <!-- Idle: show the Upload button -->
  {:else if status === 'idle'}
    <div class="btn-row">
      <button class="btn btn-primary btn-lg" onclick={startUpload}>
        Upload {total} row{total === 1 ? '' : 's'}
      </button>
    </div>

  <!-- Running: show live counters and a progress bar -->
  {:else if status === 'running'}
    <div class="upload-stats">
      <div class="stat success"><div class="stat-value">{uploaded}</div><div class="stat-label">Uploaded</div></div>
      <div class="stat warning"><div class="stat-value">{dupes}</div><div class="stat-label">Skipped (dup.)</div></div>
    </div>

    <div class="progress-wrap" style="margin-top:16px">
      <div class="progress-bar" style="width:{Math.round(progress * 100)}%"></div>
    </div>
    <div class="progress-label">
      {Math.round(progress * 100)}% — {uploaded + dupes} of {total} processed
    </div>

  <!-- Error: show the failed record details -->
  {:else if status === 'error'}
    <div class="alert alert-error" role="alert">
      Upload failed on row {failedRow?.rowIndex}.
      {#if remaining > 0}
        {remaining} row{remaining === 1 ? '' : 's'} were not processed.
      {/if}
    </div>

    <!-- Expandable section showing the field values of the failed record -->
    <details class="failed-detail">
      <summary>Show failed record</summary>
      <div class="failed-body">
        <table>
          <tbody>
            {#each Object.entries(failedRow?.resolvedFields ?? {}) as [k, v]}
              <tr>
                <td style="font-weight:500;width:40%">{k}</td>
                <td class="mono">{v ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="text-error mt-8 text-small">Error: {failedRow?.error}</p>
      </div>
    </details>
  {/if}
</div>

<style>
  .upload-stats {
    display: flex;
    gap: 16px;
  }

  .failed-detail {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    margin-top: 12px;
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
