<script>
  // Step 3 — Column Mapping Review.
  //
  // Shows the user a table of every expected field alongside a dropdown that lets
  // them assign (or re-assign) a spreadsheet column. The dropdowns are pre-filled
  // by the auto-mapper (lib/mapping.js), so in most cases the user just verifies
  // and clicks Proceed.
  //
  // State is held in a LOCAL COPY (local) so that the user can make changes
  // without immediately affecting the columnMappings store. The store is only
  // updated when the user clicks Proceed.
  //
  // When the user proceeds:
  //   1. Learned aliases are saved for any non-exact-match mappings
  //   2. The mappings are written to the store
  //   3. Validation runs immediately
  //   4. Navigation goes to ValidationReport (if there are errors) or
  //      UploadProgress (if all rows are valid)

  import { columnMappings, headerColumns, currentStep, STEPS } from '../stores.js';
  import { runValidation } from '../lib/pipeline.js';
  import { COLUMN_CONFIG } from '../config.js';
  import { log } from '../lib/debug.js';
  import { saveLearnedAlias } from '../lib/learnedAliases.js';

  // Local working copy of mappings — not reactive to the store after initialisation
  let local = $state({ ...$columnMappings });

  // Sentinel value used for optional fields the user explicitly wants to ignore
  const IGNORE = '__ignore__';

  // Split fields into mandatory and optional for display order
  // (mandatory fields shown first so the most important ones are immediately visible)
  const mandatory = COLUMN_CONFIG.filter((f) => f.mandatory);
  const optional  = COLUMN_CONFIG.filter((f) => !f.mandatory);

  // Derived: set of fieldNames where two fields share the same column header.
  // Conflicts block the Proceed button because each column can only map to one field.
  let conflicts = $derived.by(() => {
    const seen  = {}; // columnHeader → first fieldName that claimed it
    const dupes = new Set();
    for (const [fieldName, col] of Object.entries(local)) {
      if (!col || col === IGNORE) continue; // unmapped / ignored fields can't conflict
      if (seen[col]) {
        // Both the original claimant and this field are in conflict
        dupes.add(seen[col]);
        dupes.add(fieldName);
      } else {
        seen[col] = fieldName;
      }
    }
    return dupes;
  });

  // Derived: whether the Proceed button should be enabled.
  // Requires: no conflicts, and all mandatory fields have a non-ignore mapping.
  let canProceed = $derived.by(() => {
    if (conflicts.size > 0) return false;
    for (const f of mandatory) {
      const v = local[f.fieldName];
      if (!v || v === IGNORE) return false;
    }
    return true;
  });

  // Returns the CSS class for a table row based on its mapping state
  function rowClass(field) {
    const val = local[field.fieldName];
    if (conflicts.has(field.fieldName))        return 'row-error';   // red — conflict
    if (field.mandatory && (!val || val === IGNORE)) return 'row-error';   // red — missing required
    if (!field.mandatory && (!val || val === IGNORE)) return 'row-warning'; // amber — optional unmapped
    return 'row-ok';                                                  // green — all good
  }

  function proceed() {
    // Save learned aliases before committing — this allows future uploads with
    // the same spreadsheet structure to auto-match without showing this screen.
    // saveLearnedAlias() is a no-op for headers that are already hard-coded aliases.
    for (const field of COLUMN_CONFIG) {
      const colHeader = local[field.fieldName];
      if (colHeader && colHeader !== IGNORE) {
        saveLearnedAlias(colHeader, field.fieldName);
      }
    }

    columnMappings.set({ ...local }); // commit mappings to the shared store
    log('Final column mappings:', local);

    const { invalidRows } = runValidation();
    currentStep.set(invalidRows.length > 0 ? STEPS.VALIDATION_REPORT : STEPS.UPLOAD_PROGRESS);
  }

  function back() {
    currentStep.set(STEPS.FILE_SELECTION);
  }
</script>

<div class="card">
  <div class="card-header">
    <h2>Map Columns</h2>
    <p>Review how your spreadsheet columns have been matched to the expected fields.
       Adjust any that don't look right using the dropdowns.</p>
  </div>

  <!-- Conflict warning — shown when two fields are mapped to the same column -->
  {#if conflicts.size > 0}
    <div class="alert alert-error" role="alert">
      Two or more fields are mapped to the same column. Each column can only be used once.
    </div>
  {/if}

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:40%">Field</th>
          <th>Spreadsheet column</th>
          <th style="width:80px">Status</th>
        </tr>
      </thead>
      <tbody>
        <!-- Mandatory fields first, then optional -->
        {#each [...mandatory, ...optional] as field}
          {@const val = local[field.fieldName]}
          {@const cls = rowClass(field)}
          <tr class={cls}>
            <td>
              <span class="field-name">{field.fieldName}</span>
              {#if field.mandatory}
                <span class="badge badge-error" style="margin-left:6px;font-size:.65rem">required</span>
              {/if}
            </td>
            <td>
              <!-- Dropdown populated with all column headers from the spreadsheet -->
              <div class="select-wrap">
                <select bind:value={local[field.fieldName]}>
                  {#if !field.mandatory}
                    <!-- Optional fields can be excluded from the upload -->
                    <option value={IGNORE}>— Ignore this column —</option>
                  {/if}
                  {#each $headerColumns as col}
                    <option value={col}>{col}</option>
                  {/each}
                </select>
              </div>
            </td>
            <td>
              <!-- Status badge reflects mapping validity at a glance -->
              {#if conflicts.has(field.fieldName)}
                <span class="badge badge-error">conflict</span>
              {:else if !val || val === IGNORE}
                {#if field.mandatory}
                  <span class="badge badge-error">missing</span>
                {:else}
                  <span class="badge badge-neutral">ignored</span>
                {/if}
              {:else}
                <span class="badge badge-success">✓</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="btn-row">
    <button class="btn btn-secondary" onclick={back}>← Back</button>
    <button class="btn btn-primary" onclick={proceed} disabled={!canProceed}>
      Proceed
    </button>
  </div>
</div>

<style>
  .field-name { font-weight: 500; }
</style>
