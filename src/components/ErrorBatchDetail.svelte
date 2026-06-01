<script>
  // Batch detail view — shows all error files in a single batch with lazy-loaded
  // error details, plus download buttons for XML and JSON files.
  //
  // On mount, marks the batch as "viewed" and begins fetching error details for
  // all error files. Details are loaded one at a time from S3 (JSON + XML per
  // file), cached in localStorage, and the display updates as each one arrives.

  import { get } from 'svelte/store';
  import { credentials } from '../stores.js';
  import { makeS3Client, downloadObject } from '../lib/s3.js';
  import { loadErrorDetail } from '../lib/errorPipeline.js';
  import { setBatchStatus } from '../lib/errorCache.js';
  import { log } from '../lib/debug.js';
  import ErrorFileRow from './ErrorFileRow.svelte';

  let { batch, onback, ondismiss } = $props();

  // Reactive state for async detail loading
  let errorDetails = $state({});   // filename → detail object
  let loadingFiles = $state({});   // filename → true while loading
  let fileErrors   = $state({});   // filename → error message string

  // Mark batch as viewed on mount and start loading details
  $effect(() => {
    setBatchStatus(batch.batchId, 'viewed');
    loadAllDetails();
  });

  async function loadAllDetails() {
    const creds = get(credentials);
    const s3    = makeS3Client(creds);

    for (const file of batch.errorFiles) {
      if (errorDetails[file.filename] || loadingFiles[file.filename]) continue;

      loadingFiles = { ...loadingFiles, [file.filename]: true };

      try {
        const detail = await loadErrorDetail(s3, creds.bucketName, file.filename);
        errorDetails = { ...errorDetails, [file.filename]: detail };
      } catch (e) {
        fileErrors = { ...fileErrors, [file.filename]: e.message };
        log('Failed to load detail for', file.filename, e);
      } finally {
        const { [file.filename]: _, ...rest } = loadingFiles;
        loadingFiles = rest;
      }
    }
  }

  async function downloadFile(key) {
    try {
      const creds   = get(credentials);
      const s3      = makeS3Client(creds);
      const content = await downloadObject(s3, creds.bucketName, key);
      const blob    = new Blob([content], { type: 'application/octet-stream' });
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement('a');
      a.href        = url;
      a.download    = key.split('/').pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      log('Download failed:', key, e);
      alert('Download failed: ' + e.message);
    }
  }

  function handleDismiss() {
    setBatchStatus(batch.batchId, 'dismissed');
    ondismiss();
  }

  let dateStr = $derived(
    batch.timestamp ? new Date(batch.timestamp).toLocaleString() : 'Unknown'
  );
</script>

<div class="card">
  <div class="card-header">
    <h2>Batch <span class="mono">{batch.batchId}</span></h2>
    <p>
      {batch.errorCount} error{batch.errorCount === 1 ? '' : 's'},
      {batch.okCount} OK
      &mdash; {dateStr}
    </p>
  </div>

  <!-- Error files -->
  {#if batch.errorFiles.length > 0}
    <h3>Failed Files</h3>
    <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px">
      {#each batch.errorFiles as file (file.filename)}
        <ErrorFileRow
          {file}
          detail={errorDetails[file.filename] ?? null}
          loading={!!loadingFiles[file.filename]}
          error={fileErrors[file.filename] ?? ''}
          ondownloadxml={() => downloadFile(file.key)}
          ondownloadjson={() => downloadFile(`errors/${file.filename}.error.json`)}
        />
      {/each}
    </div>
  {/if}

  <!-- Complete files summary -->
  {#if batch.completeFiles.length > 0}
    <h3 class="mt-24">Successful Files</h3>
    <p class="text-muted text-small mt-4">
      {batch.completeFiles.length} file{batch.completeFiles.length === 1 ? '' : 's'}
      processed successfully.
    </p>
  {/if}

  <div class="btn-row">
    <button class="btn btn-secondary" onclick={onback}>&#8592; Back to list</button>
    <button class="btn btn-danger btn-sm" onclick={handleDismiss}>Dismiss batch</button>
  </div>
</div>
