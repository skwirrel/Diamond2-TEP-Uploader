<script>
  // Root application shell.
  //
  // Renders:
  //   - A persistent top navigation bar (always visible)
  //   - The Settings modal (rendered on top of everything when showSettings is true)
  //   - Either the upload wizard or the Error Review section, depending on
  //     which nav tab is active
  //
  // Navigation between wizard steps is handled inside each step component by
  // writing to the currentStep store — this component just switches between
  // the step components based on that value.

  import { currentSection, currentStep, showSettings, STEPS } from './stores.js';

  import StepIndicator  from './components/StepIndicator.svelte';
  import Settings       from './components/Settings.svelte';
  import ErrorReview    from './components/ErrorReview.svelte';

  import FileSelection       from './steps/FileSelection.svelte';
  import SheetSelection      from './steps/SheetSelection.svelte';
  import ColumnMappingReview from './steps/ColumnMappingReview.svelte';
  import ValidationReport    from './steps/ValidationReport.svelte';
  import UploadProgress      from './steps/UploadProgress.svelte';
  import ResultsSummary      from './steps/ResultsSummary.svelte';

  import cdnLogo from '/cdn-logo-white.png';
</script>

<!-- Navigation bar — persistent across all steps and sections -->
<header class="nav">
  <span class="nav-brand">
    <img src={cdnLogo} alt="CDN" />
    TEP Uploader
  </span>

  <!-- Section tabs: Upload wizard vs Error Review -->
  <div class="nav-tabs">
    <button class="nav-tab"
            class:active={$currentSection === 'wizard'}
            onclick={() => currentSection.set('wizard')}>
      Upload
    </button>
    <button class="nav-tab"
            class:active={$currentSection === 'errorReview'}
            onclick={() => currentSection.set('errorReview')}>
      Error Review
    </button>
  </div>

  <!-- Settings gear icon — opens the modal without losing wizard progress -->
  <button class="nav-settings"
          onclick={() => showSettings.set(true)}
          title="Settings"
          aria-label="Open settings">
    ⚙
  </button>
</header>

<!-- Settings modal — rendered here so it overlays any step or section -->
{#if $showSettings}
  <Settings />
{/if}

<!-- Main content area -->
<main>
  {#if $currentSection === 'wizard'}
    <div class="page">
      <div class="content">
        <!-- Progress indicator shown at the top of every wizard step -->
        <StepIndicator />

        <!-- Step routing — one component per wizard step -->
        {#if $currentStep === STEPS.FILE_SELECTION}
          <FileSelection />
        {:else if $currentStep === STEPS.SHEET_SELECTION}
          <SheetSelection />
        {:else if $currentStep === STEPS.COLUMN_MAPPING}
          <ColumnMappingReview />
        {:else if $currentStep === STEPS.VALIDATION_REPORT}
          <ValidationReport />
        {:else if $currentStep === STEPS.UPLOAD_PROGRESS}
          <UploadProgress />
        {:else if $currentStep === STEPS.RESULTS}
          <ResultsSummary />
        {/if}
      </div>
    </div>
  {:else}
    <!-- Error Review section (future feature — currently shows a placeholder) -->
    <ErrorReview />
  {/if}
</main>
