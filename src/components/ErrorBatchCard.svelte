<script>
  // One row in the batch list — shows batch ID, timestamp, error/OK counts,
  // and a dismiss button. Clicking the card navigates to the batch detail view
  // (unless the batch has no errors, in which case there's nothing to drill into).

  let { batch, onselect, ondismiss } = $props();

  let dateStr = $derived(
    batch.timestamp ? new Date(batch.timestamp).toLocaleString() : 'Unknown'
  );

  let hasErrors = $derived(batch.errorCount > 0);

  function handleClick() {
    if (hasErrors) onselect();
  }

  function handleDismiss(e) {
    e.stopPropagation(); // don't trigger card click
    ondismiss();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="batch-card"
  class:all-ok={!hasErrors}
  role={hasErrors ? 'button' : undefined}
  tabindex={hasErrors ? 0 : -1}
  onclick={handleClick}
  onkeydown={hasErrors ? (e) => { if (e.key === 'Enter') handleClick(); } : undefined}
>
  <div class="batch-left">
    <span class="mono" style="font-weight:600">Batch {batch.batchId}</span>
    <span class="text-muted text-small">{dateStr}</span>
    {#if batch.status === 'new' && hasErrors}
      <span class="badge badge-error">new</span>
    {/if}
  </div>
  <div class="batch-right">
    {#if hasErrors}
      <span class="badge badge-error">
        {batch.errorCount} error{batch.errorCount === 1 ? '' : 's'}
      </span>
    {/if}
    {#if batch.okCount > 0}
      <span class="badge badge-success">
        {batch.okCount} OK
      </span>
    {/if}
    {#if !hasErrors}
      <span class="badge badge-success">all OK</span>
    {/if}
    <button class="btn btn-secondary btn-sm" onclick={handleDismiss}
            title="Dismiss this batch">
      Dismiss
    </button>
  </div>
</div>
