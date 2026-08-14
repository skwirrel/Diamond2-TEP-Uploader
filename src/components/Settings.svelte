<script>
  // Settings modal — allows the user to enter and save AWS connection details.
  //
  // The modal works on a LOCAL COPY of the credentials so that clicking Cancel
  // discards any changes without affecting the live credentials store. Changes
  // are only committed to the store (and therefore localStorage) when the user
  // clicks Save.
  //
  // The modal can be opened at any time from the nav bar without interrupting
  // the current wizard step. It closes on: Save, Cancel, Escape key, or
  // clicking the backdrop outside the modal box.

  import { credentials, credentialsOrigin, setCredentials, showSettings } from '../stores.js';

  // Local copy — edits here don't hit the store until save() is called.
  // When credentials were supplied via postMessage the fields are hidden and
  // the local copy is left empty so the keys never reach the form inputs.
  let local = $state($credentialsOrigin
    ? { accessKeyId: '', secretAccessKey: '', sessionToken: '', bucketName: '', region: '' }
    : { ...$credentials });

  function save() {
    setCredentials(local, true); // commit to store and persist to localStorage
    showSettings.set(false);
  }

  function close() {
    showSettings.set(false);
    // local changes are simply discarded — the store is unchanged
  }

  let cacheCleared = $state(false);

  function clearCaches() {
    localStorage.removeItem('tep_error_cache');
    localStorage.removeItem('tep_upload_hash_cache');
    localStorage.removeItem('tep_learned_aliases');
    cacheCleared = true;
  }

  // Close when the user clicks the dark backdrop area (not the modal box itself)
  function onBackdropClick(e) {
    if (e.target === e.currentTarget) close();
  }

  // Close on Escape key — standard modal UX behaviour
  function onBackdropKeydown(e) {
    if (e.key === 'Escape') close();
  }
</script>

<!-- Backdrop — fills the viewport; clicking it closes the modal -->
<div class="modal-backdrop" onclick={onBackdropClick} onkeydown={onBackdropKeydown} role="presentation">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <div class="modal-header">
      <h2 id="settings-title">Settings</h2>
      <button class="modal-close" onclick={close} aria-label="Close settings">✕</button>
    </div>

    <div class="modal-body">
      {#if $credentialsOrigin}
        <!-- Credentials arrived via postMessage — never show or allow saving them -->
        <p class="ephemeral-note">
          AWS connection details were supplied by the launching application
          ({$credentialsOrigin}) and cannot be viewed or edited here. They
          are never stored in this browser and will be forgotten when this
          tab is closed.
        </p>
      {:else}
      <p class="settings-intro">
        Enter the AWS connection details provided by TEP. These are stored in
        your browser and never sent to any third-party server.
      </p>

      <!-- Access Key ID — the public part of the AWS IAM credential pair -->
      <div class="field">
        <label for="s-key">Access Key ID</label>
        <input id="s-key" type="text" bind:value={local.accessKeyId}
               placeholder="AKIA…" autocomplete="off" spellcheck="false" />
      </div>

      <!-- Secret Access Key — treat as a password; never log or display in plain text -->
      <div class="field">
        <label for="s-secret">Secret Access Key</label>
        <input id="s-secret" type="password" bind:value={local.secretAccessKey}
               autocomplete="off" spellcheck="false" />
      </div>

      <!-- S3 bucket name — provided by TEP; must match exactly -->
      <div class="field">
        <label for="s-bucket">Bucket Name</label>
        <input id="s-bucket" type="text" bind:value={local.bucketName}
               placeholder="my-tep-bucket" autocomplete="off" spellcheck="false" />
      </div>

      <!-- AWS region — determines which regional S3 endpoint is used -->
      <div class="field">
        <label for="s-region">Region</label>
        <div class="select-wrap">
          <select id="s-region" bind:value={local.region}>
            <option value="">— Select a region —</option>
            <optgroup label="Europe">
              <option value="eu-west-1">eu-west-1 — Europe (Ireland)</option>
              <option value="eu-west-2">eu-west-2 — Europe (London)</option>
              <option value="eu-west-3">eu-west-3 — Europe (Paris)</option>
              <option value="eu-central-1">eu-central-1 — Europe (Frankfurt)</option>
              <option value="eu-central-2">eu-central-2 — Europe (Zurich)</option>
              <option value="eu-north-1">eu-north-1 — Europe (Stockholm)</option>
              <option value="eu-south-1">eu-south-1 — Europe (Milan)</option>
              <option value="eu-south-2">eu-south-2 — Europe (Spain)</option>
            </optgroup>
            <optgroup label="US East">
              <option value="us-east-1">us-east-1 — US East (N. Virginia)</option>
              <option value="us-east-2">us-east-2 — US East (Ohio)</option>
            </optgroup>
            <optgroup label="US West">
              <option value="us-west-1">us-west-1 — US West (N. California)</option>
              <option value="us-west-2">us-west-2 — US West (Oregon)</option>
            </optgroup>
            <optgroup label="Asia Pacific">
              <option value="ap-south-1">ap-south-1 — Asia Pacific (Mumbai)</option>
              <option value="ap-southeast-1">ap-southeast-1 — Asia Pacific (Singapore)</option>
              <option value="ap-southeast-2">ap-southeast-2 — Asia Pacific (Sydney)</option>
              <option value="ap-northeast-1">ap-northeast-1 — Asia Pacific (Tokyo)</option>
              <option value="ap-northeast-2">ap-northeast-2 — Asia Pacific (Seoul)</option>
            </optgroup>
            <optgroup label="Other">
              <option value="ca-central-1">ca-central-1 — Canada (Central)</option>
              <option value="sa-east-1">sa-east-1 — South America (São Paulo)</option>
              <option value="af-south-1">af-south-1 — Africa (Cape Town)</option>
              <option value="me-south-1">me-south-1 — Middle East (Bahrain)</option>
            </optgroup>
          </select>
        </div>
      </div>
      {/if}
    </div>

    <div class="modal-divider">
      <hr class="divider" />
      <p class="text-muted text-small">
        Clear locally cached data: error review history, upload deduplication
        hashes, and learned column mappings. Your AWS credentials are not affected.
      </p>
      <button class="btn btn-danger btn-sm" onclick={clearCaches} disabled={cacheCleared}>
        {cacheCleared ? 'Cache cleared' : 'Clear local cache'}
      </button>
    </div>

    <div class="modal-footer">
      {#if $credentialsOrigin}
        <button class="btn btn-secondary" onclick={close}>Close</button>
      {:else}
        <button class="btn btn-secondary" onclick={close}>Cancel</button>
        <button class="btn btn-primary" onclick={save}>Save</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .settings-intro {
    margin-bottom: 20px;
    line-height: 1.6;
  }
  .ephemeral-note {
    margin-bottom: 20px;
    padding: 10px 12px;
    border-left: 3px solid #e0a800;
    background: rgba(224, 168, 0, 0.08);
    font-size: 0.9em;
    line-height: 1.5;
  }
  .modal-divider {
    padding: 0 24px 16px;
  }
</style>
