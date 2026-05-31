<script>
  // Batch list view — shows all non-dismissed batches with error/OK counts.
  // Clicking a batch with errors navigates to the detail view.

  import ErrorBatchCard from './ErrorBatchCard.svelte';

  let { loading, error, batches, onrefresh, onselect, ondismiss } = $props();
</script>

<div class="card">
  <div class="card-header">
    <h2>Error Review</h2>
    <p>Browse files that failed TEP ingestion, grouped by upload batch.</p>
  </div>

  {#if error}
    <div class="alert alert-error" role="alert">{error}</div>
  {/if}

  <div class="btn-row" style="margin-top:0; margin-bottom:16px">
    <button class="btn btn-secondary btn-sm" onclick={onrefresh} disabled={loading}>
      {loading ? 'Loading…' : 'Refresh'}
    </button>
  </div>

  {#if loading && batches.length === 0}
    <p class="text-muted" style="text-align:center; padding:32px 0">
      Scanning S3 bucket for error reports…
    </p>
  {:else if batches.length === 0}
    <div style="text-align:center; padding:32px 0">
      <div style="font-size:1.5rem; margin-bottom:8px; color:var(--success)">&#10003;</div>
      <p class="text-muted">No error reports found. All uploads processed successfully.</p>
    </div>
  {:else}
    <div class="batch-list">
      {#each batches as batch (batch.batchId)}
        <ErrorBatchCard
          {batch}
          onselect={() => onselect(batch.batchId)}
          ondismiss={() => ondismiss(batch.batchId)}
        />
      {/each}
    </div>
  {/if}
</div>
