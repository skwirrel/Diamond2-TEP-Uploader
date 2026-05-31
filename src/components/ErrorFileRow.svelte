<script>
  // A single error file row — expandable to show full error details.
  //
  // Follows the same <details>-based collapsible pattern as ValidationReport's
  // invalid rows. Summary shows the filename and key stats; expanded body
  // shows the full error list, warnings, metrics, and download buttons.

  let { file, detail, loading, error, ondownloadxml, ondownloadjson } = $props();

  function severityBadge(sev) {
    if (sev === 'critical' || sev === 'error') return 'badge-error';
    if (sev === 'warning') return 'badge-warning';
    return 'badge-neutral';
  }
</script>

<details class="error-file-row">
  <summary class="error-file-summary">
    {#if detail?.publicationId}
      <span style="font-weight:600">{detail.publicationId}</span>
    {:else}
      <span class="mono">{file.filename.slice(0, 16)}…</span>
    {/if}

    {#if loading}
      <span class="badge badge-neutral">loading…</span>
    {:else if error}
      <span class="badge badge-warning">fetch failed</span>
    {:else if detail}
      <span class="badge {severityBadge(detail.maxSeverity)}">
        {detail.errorCount} error{detail.errorCount === 1 ? '' : 's'}
      </span>
      {#if detail.stage}
        <span class="badge badge-neutral">{detail.stage}</span>
      {/if}
    {/if}
  </summary>

  <div class="error-file-body">
    {#if error}
      <div class="alert alert-warning">{error}</div>
    {:else if detail}
      {#if detail.publicationId}
        <p class="text-muted text-small" style="margin-bottom:4px">
          Publication ID: <span class="mono">{detail.publicationId}</span>
        </p>
      {/if}

      {#if detail.topError}
        <p class="text-error text-small" style="margin-bottom:8px">{detail.topError}</p>
      {/if}

      {#if detail.fullReport?.errors?.length > 0}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Message</th><th>Severity</th></tr></thead>
            <tbody>
              {#each detail.fullReport.errors as err}
                <tr>
                  <td class="mono">{err.code ?? ''}</td>
                  <td>{err.message ?? ''}</td>
                  <td><span class="badge {severityBadge(err.severity)}">{err.severity}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if detail.fullReport?.warnings?.length > 0}
        <h4 class="mt-8">Warnings</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Message</th></tr></thead>
            <tbody>
              {#each detail.fullReport.warnings as warn}
                <tr>
                  <td class="mono">{warn.code ?? ''}</td>
                  <td>{warn.message ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if detail.fullReport?.metrics}
        <p class="text-muted text-small mt-8">
          Records: {detail.fullReport.metrics.recordsProcessed ?? 0} processed,
          {detail.fullReport.metrics.recordsCreated ?? 0} created,
          {detail.fullReport.metrics.recordsFailed ?? 0} failed
        </p>
      {/if}
    {:else if !loading}
      <p class="text-muted text-small">No details available yet.</p>
    {/if}

    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-secondary btn-sm" onclick={ondownloadxml}>Download XML</button>
      <button class="btn btn-secondary btn-sm" onclick={ondownloadjson}>Download JSON</button>
    </div>
  </div>
</details>

<style>
  .error-file-row {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .error-file-summary {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    background: var(--error-light);
    list-style: none;
    font-size: .875rem;
  }
  .error-file-summary::-webkit-details-marker { display: none; }
  .error-file-summary::before { content: '\25B6'; font-size: .65rem; color: var(--error); }
  details[open] .error-file-summary::before { content: '\25BC'; }

  .error-file-body {
    padding: 12px;
    overflow-x: auto;
  }
  .error-file-body table { margin: 0; }
</style>
