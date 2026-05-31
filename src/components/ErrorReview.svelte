<script>
  // Error Review — section root.
  //
  // Manages:
  //   - Credentials check (prompts user to configure Settings if missing)
  //   - Loading state while S3 listing is in progress
  //   - Routing between batch list and batch detail views
  //   - Refresh trigger
  //
  // Component-local state: loading, error, batches array.
  // Store state: errorReviewView, errorReviewBatchId (persists across tab switches).

  import { get } from 'svelte/store';
  import {
    credentials, showSettings,
    errorReviewView, errorReviewBatchId,
  } from '../stores.js';
  import { makeS3Client } from '../lib/s3.js';
  import { loadErrorBatches } from '../lib/errorPipeline.js';
  import { setBatchStatus } from '../lib/errorCache.js';
  import { log } from '../lib/debug.js';

  import ErrorBatchList   from './ErrorBatchList.svelte';
  import ErrorBatchDetail from './ErrorBatchDetail.svelte';

  let loading = $state(false);
  let error   = $state('');
  let batches = $state([]);

  let hasCredentials = $derived.by(() => {
    const c = $credentials;
    return !!(c.accessKeyId && c.secretAccessKey && c.bucketName && c.region);
  });

  // Auto-load batches on first mount when credentials are configured
  let loaded = $state(false);
  $effect(() => {
    if (hasCredentials && !loaded) {
      loaded = true;
      refresh();
    }
  });

  async function refresh() {
    if (!hasCredentials) return;
    loading = true;
    error   = '';
    try {
      const creds = get(credentials);
      const s3    = makeS3Client(creds);
      batches     = await loadErrorBatches(s3, creds.bucketName);
      log('Loaded', batches.length, 'error batches');
    } catch (e) {
      error = e.message || 'Failed to load error reports from S3.';
      log('Error review load failed:', e);
    } finally {
      loading = false;
    }
  }

  function viewBatch(batchId) {
    errorReviewBatchId.set(batchId);
    errorReviewView.set('detail');
  }

  function dismissBatch(batchId) {
    setBatchStatus(batchId, 'dismissed');
    // Remove from local list immediately so the UI updates
    batches = batches.filter(b => b.batchId !== batchId);
  }

  function backToList() {
    errorReviewView.set('list');
    errorReviewBatchId.set(null);
    refresh(); // reload to pick up any status changes
  }

  let selectedBatch = $derived(
    batches.find(b => b.batchId === $errorReviewBatchId) ?? null
  );
</script>

<div class="page">
  <div class="content">
    {#if !hasCredentials}
      <div class="card" style="text-align:center; padding:48px 32px">
        <h2>Configure AWS Credentials</h2>
        <p class="mt-8">
          Set up your S3 connection in Settings to view error reports.
        </p>
        <div class="btn-row" style="justify-content:center">
          <button class="btn btn-primary" onclick={() => showSettings.set(true)}>
            Open Settings
          </button>
        </div>
      </div>
    {:else if $errorReviewView === 'detail' && selectedBatch}
      <ErrorBatchDetail
        batch={selectedBatch}
        onback={backToList}
        ondismiss={backToList}
      />
    {:else}
      <ErrorBatchList
        {loading}
        {error}
        {batches}
        onrefresh={refresh}
        onselect={viewBatch}
        ondismiss={dismissBatch}
      />
    {/if}
  </div>
</div>
