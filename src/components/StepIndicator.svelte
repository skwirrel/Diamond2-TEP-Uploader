<script>
  // Step progress indicator — shown at the top of every wizard step.
  //
  // Renders a horizontal row of numbered circles connected by lines.
  // Steps that are in the past show a tick (✓) and are styled in blue.
  // The current step's circle is filled. Future steps are grey outlines.
  //
  // The connector lines between steps are rendered as explicit <div> elements
  // (not CSS ::after pseudo-elements) so they can be coloured independently
  // based on the done state of the preceding step.

  import { currentStep, STEPS } from '../stores.js';

  // Step definitions — label text must be short enough to display on one line
  const steps = [
    { id: STEPS.FILE_SELECTION,    label: 'Select File' },
    { id: STEPS.SHEET_SELECTION,   label: 'Select Sheet' },
    { id: STEPS.COLUMN_MAPPING,    label: 'Map Columns' },
    { id: STEPS.VALIDATION_REPORT, label: 'Validate' },
    { id: STEPS.UPLOAD_PROGRESS,   label: 'Upload' },
    { id: STEPS.RESULTS,           label: 'Results' },
  ];
</script>

<nav class="step-indicator" aria-label="Progress">
  {#each steps as step, i}
    <!-- step-item contains the dot and label; active/done classes drive styling -->
    <div class="step-item"
         class:active={$currentStep === step.id}
         class:done={$currentStep > step.id}>
      <div class="step-dot">
        {#if $currentStep > step.id}
          ✓  <!-- completed step -->
        {:else}
          {i + 1}  <!-- step number -->
        {/if}
      </div>
      <span class="step-label">{step.label}</span>
    </div>

    <!-- Connector line between steps; turns blue once the preceding step is done -->
    {#if i < steps.length - 1}
      <div class="step-connector" class:filled={$currentStep > step.id}></div>
    {/if}
  {/each}
</nav>

<style>
  nav { display: flex; align-items: center; margin-bottom: 32px; }

  /* Each step item shrinks to its content width; the connectors fill the gaps */
  .step-item {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  /* Connector lines grow to fill space between step items */
  .step-connector {
    flex: 1;
    height: 2px;
    background: var(--border);
    margin: 0 6px;
    min-width: 16px;
    transition: background .3s;
  }
  .step-connector.filled { background: var(--primary); }
</style>
