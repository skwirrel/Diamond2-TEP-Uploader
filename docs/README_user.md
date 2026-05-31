# TEP Data Uploader — User Guide

## What is TEP Data Uploader?

TEP Data Uploader is a tool that takes publication data from a spreadsheet and sends it to TEP (The Everyone Project) for processing. It converts each row of your spreadsheet into the format TEP expects and uploads it automatically.

The application runs entirely in your web browser — nothing is installed on your computer and no data passes through any intermediate server.

## Getting Started

### Settings

Before you can upload anything, you need to configure the app with the connection details provided to you by TEP. You will need four pieces of information:

- **Access Key ID**
- **Secret Access Key**
- **Bucket Name**
- **Region**

Click the settings icon in the top navigation bar to open the Settings panel. Your credentials are saved in your browser so you only need to do this once (unless you clear your browser data or switch browsers). The Settings panel can be opened at any time without losing your place in the upload process.

If the app detects that settings are missing when you start an upload, it will prompt you to enter them.

## Uploading Data

### Step 1: Select Your Spreadsheet

Click the file selector and choose your XLSX spreadsheet. The app will check that the file can be read. If there is a problem with the file, you will see an error message.

You will also see a checkbox labelled **"Skip column review if all columns matched OK"**. If you tick this, the app will try to automatically match your spreadsheet columns to the expected fields and skip the review step if everything matches perfectly. This is useful if you upload the same format regularly and want to save time.

### Step 2: Select Sheet

If your workbook contains more than one sheet, you will be asked to choose which sheet to process. If there is only one sheet, this step is skipped automatically.

### Step 3: Column Matching

The app needs to know which column in your spreadsheet corresponds to which piece of data. It will attempt to do this automatically by looking at your column headers.

If automatic matching was not perfect (or you chose not to skip the review), you will see a **Column Mapping** screen. This shows every expected field alongside a dropdown where you can select the matching column from your spreadsheet.

- Fields highlighted in **red** are mandatory — you must assign a column to each of these before you can proceed.
- Fields highlighted in **amber** are optional — if your spreadsheet does not include this data, leave the dropdown set to "Ignore this column".

You cannot assign the same spreadsheet column to two different fields. The **Proceed** button will only become active once all mandatory fields are assigned and there are no conflicts.

### Required Fields

You must provide data for the following fields:

- **Publication ID** — a unique identifier for this broadcast event
- **Episode ID** — the identifier for the episode that was broadcast
- **Availability Mode** — must be exactly `broadcast` or `onDemand`
- **Publication Date and Time** — the transmission date/time (for broadcast) or start of availability window (for on-demand). The column must be formatted as a **Date** in your spreadsheet — the app will handle the rest.
- **Channel Label** — the channel or platform name (e.g. "BBC One", "iPlayer")

### Optional Fields

- **Is Repeat?** — whether this is a repeat broadcast (defaults to `true` if omitted). Accepted values: `true`/`false`, `yes`/`no`, `y`/`n`, or `1`/`0`.
- **Is Primary?** — whether this is the primary broadcast (defaults to `false` if omitted). Accepted values: same as above.
- **Window Closure Date and Time** — end of availability window. Must be a **Date**-formatted column. Only valid for on-demand content (`Availability Mode: onDemand`). Including this field on a broadcast row will cause a validation error.
- **Channel ID** — a machine-readable channel identifier (defaults to the Channel Label if omitted)
- **Sub-channel 1–4 Label and ID** — regional variants or sub-channels (e.g. "BBC One Wales"). Up to four sub-channels are supported. If a sub-channel ID is omitted, it defaults to the sub-channel label.

### Step 4: Validation

Before uploading anything, the app checks every row in your spreadsheet for data problems. This includes:

- **Format checks** — date/time columns must be formatted as Date in your spreadsheet (not plain text); Availability Mode must be `broadcast` or `onDemand`; Is Repeat? and Is Primary? must be `true` or `false`.
- **Cross-field checks** — for example, Window Closure Date and Time may only appear on rows where Availability Mode is `onDemand`.

If any rows fail validation, a **Validation Report** is shown. Each failing row is listed with all of its field values; invalid fields are highlighted in red with a description of the problem. You can either go back to correct your spreadsheet, or choose to proceed with only the valid rows (invalid rows will be skipped and reported in the final results).

If all rows pass, this step is skipped automatically.

### Step 5: Processing and Upload

Once you click **Proceed**, the app will process each valid row of your spreadsheet and upload it. A **progress bar** shows how many rows have been processed. The app automatically detects and skips duplicate rows — if the same data has already been uploaded (from this browser or another), it will not upload it again.

If an upload fails for any reason, the app will stop and show you the record that failed. Any rows that were uploaded before the failure are safe and do not need to be re-uploaded.

### Step 6: Results

After processing, you will see a summary:

- How many rows were **uploaded successfully**.
- How many rows were **skipped** because they were duplicates.
- How many rows were **skipped** because they failed validation.
- If there was a **failure**, the details of the record that failed.
- How many rows were **not processed** (rows remaining after a failure).

If there are unprocessed rows, you will see a **Retry** button. You can safely click this — rows that were already uploaded will be automatically skipped, so only the remaining rows will be processed.

## Error Review

After you upload data, TEP processes each file asynchronously. If a file is processed successfully, it is moved to a "complete" folder. If there is a problem, the file is moved to an "errors" folder along with a report describing what went wrong.

The **Error Review** tab lets you see the results of this processing.

### Viewing Batches

Click the **Error Review** tab in the navigation bar. The app will scan the S3 bucket and display a list of upload batches. Each batch corresponds to one upload session (one click of the "Upload" button).

For each batch, you will see:

- How many files **errored** during processing (shown in red)
- How many files were **OK** (shown in green)
- A **new** badge if you haven't viewed the batch yet

Click **Refresh** to re-scan the bucket for the latest results. Processing happens asynchronously, so newly uploaded files may not appear immediately.

### Viewing Error Details

Click on any batch that has errors to see the details. The app will download the error reports from S3 and show you:

- The **publication ID** of each failed record (extracted from the uploaded XML)
- The **processing stage** where the error occurred (e.g. "VALIDATING")
- The **number of errors** and their **severity** (critical, error, warning)
- The **full error message** for each error

Click the arrow on any error row to expand it and see all errors, warnings, and processing metrics.

### Downloading Files

From the batch detail view, you can download the original **XML file** that was uploaded and the **JSON error report** generated by TEP. This is useful for debugging or sharing with support.

### Dismissing Batches

Once you have dealt with the errors in a batch (e.g. fixed the spreadsheet and re-uploaded), click **Dismiss batch** to hide it from the list. Dismissed batches will not appear again.

The actual files remain in the S3 bucket — the dismiss action only hides them from your view. The bucket's lifecycle policy automatically removes old files after 14 days.

### Notes

- You need AWS credentials configured in Settings before you can use Error Review.
- The error review cache is stored in your browser. If you clear your browser data, all batches will reappear as "new" (until they are removed by the bucket lifecycle policy).
- Only files uploaded by this tool are shown. Files uploaded by other means are ignored.

## Tips

- You can upload the same spreadsheet multiple times without worrying about creating duplicates — the app will detect and skip them.
- **The app learns your column names.** The first time you confirm a column mapping on the Column Matching screen, the app saves your column header for that field. Next time you upload a spreadsheet with the same column names, the app will match them automatically — no review needed.
- Make sure your date/time columns are formatted as **Date** in Excel or Google Sheets, not as plain text. The app reads the cell type directly and will flag text cells as invalid even if they look like dates.
- If you change browsers or clear your browser data, you will need to re-enter your AWS settings. Previously uploaded data is not affected — it is already safely stored.
- The app works entirely in your browser. Your AWS credentials and data are not sent to any third-party server.
