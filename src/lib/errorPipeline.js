// Error review pipeline — orchestrates S3 listing, filename parsing, batch
// grouping, and lazy error detail fetching.
//
// This is the equivalent of pipeline.js for the Error Review section. It reads
// from the S3 bucket, groups files by batch ID, reconciles with the local
// cache, and returns structured batch summaries for the UI.

import { listAllObjects, parseFilename, downloadObject } from './s3.js';
import {
  pruneCache, reconcileCache, getDismissedBatches,
  getBatchStatus, getCachedError, setCachedError,
} from './errorCache.js';
import { log } from './debug.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Load all error batches from S3.
//
// 1. Prune stale local cache entries
// 2. List errors/ and complete/ prefixes (in parallel)
// 3. Parse filenames — filter out non-matching and > 30 days old
// 4. Reconcile local cache with remote state
// 5. Group by batchId
// 6. Filter out dismissed batches
// 7. Return sorted array (newest first)
//
// Returns: BatchSummary[]
//   { batchId, timestamp, status, errorCount, okCount, errorFiles, completeFiles }
// ---------------------------------------------------------------------------
export async function loadErrorBatches(s3, bucketName) {
  pruneCache();

  // Fetch both prefixes in parallel
  const [errorObjects, completeObjects] = await Promise.all([
    listAllObjects(s3, bucketName, 'errors/'),
    listAllObjects(s3, bucketName, 'complete/'),
  ]);

  const cutoff = Date.now() - THIRTY_DAYS_MS;

  // Parse error files — the uploaded .xml only; TEP writes a companion
  // <base>.errors.xml report beside each one, which is fetched lazily by
  // loadErrorDetail() and must not be counted as a failed file itself.
  const errorFiles = [];
  for (const obj of errorObjects) {
    const name = obj.Key.replace(/^errors\//, '');
    if (!name.endsWith('.xml') || name.endsWith('.errors.xml')) continue;
    const parsed = parseFilename(name);
    if (!parsed) continue;
    if (obj.LastModified && obj.LastModified.getTime() < cutoff) continue;
    errorFiles.push({
      ...parsed,
      filename:     name,
      key:          obj.Key,
      lastModified: obj.LastModified,
    });
  }

  // Parse complete files. Per the S3 exchange protocol, complete/ holds one
  // <base>.status.xml receipt per successfully processed file — the uploaded
  // file itself is deleted, not moved. Objects from before protocol v1.4 may
  // still be the moved originals, so accept both forms until retention
  // clears them.
  const completeFiles = [];
  for (const obj of completeObjects) {
    const name = obj.Key.replace(/^complete\//, '');
    if (!name.endsWith('.xml')) continue;
    const dataName = name.endsWith('.status.xml')
      ? name.slice(0, -'.status.xml'.length) + '.xml'
      : name;
    const parsed = parseFilename(dataName);
    if (!parsed) continue;
    if (obj.LastModified && obj.LastModified.getTime() < cutoff) continue;
    completeFiles.push({
      ...parsed,
      filename:     dataName,
      key:          obj.Key,
      lastModified: obj.LastModified,
    });
  }

  // Reconcile cache: remove entries for files no longer in S3
  const allRemoteFilenames = new Set([
    ...errorFiles.map(f => f.filename),
    ...completeFiles.map(f => f.filename),
  ]);
  reconcileCache(allRemoteFilenames);

  // Group by batch ID
  const batchMap = new Map();
  for (const f of errorFiles) {
    if (!batchMap.has(f.batchId)) batchMap.set(f.batchId, { errors: [], complete: [] });
    batchMap.get(f.batchId).errors.push(f);
  }
  for (const f of completeFiles) {
    if (!batchMap.has(f.batchId)) batchMap.set(f.batchId, { errors: [], complete: [] });
    batchMap.get(f.batchId).complete.push(f);
  }

  // Filter out dismissed batches
  const dismissed = getDismissedBatches();
  const batches   = [];

  for (const [batchId, group] of batchMap) {
    if (dismissed.has(batchId)) continue;

    // Determine the most recent file timestamp for sorting
    const allFiles  = [...group.errors, ...group.complete];
    const timestamp = allFiles.reduce((latest, f) => {
      const t = f.lastModified ? f.lastModified.getTime() : 0;
      return t > latest ? t : latest;
    }, 0);

    const status = getBatchStatus(batchId) || 'new';

    batches.push({
      batchId,
      timestamp,
      status,
      errorCount:    group.errors.length,
      okCount:       group.complete.length,
      errorFiles:    group.errors,
      completeFiles: group.complete,
    });
  }

  // Sort newest first
  batches.sort((a, b) => b.timestamp - a.timestamp);

  log(`Loaded ${batches.length} batches (${errorFiles.length} errors, ${completeFiles.length} complete)`);
  return batches;
}

// ---------------------------------------------------------------------------
// Load error details for a single file.
//
// Downloads TEP's <base>.errors.xml error report and the uploaded .xml file
// in parallel, extracts key fields, caches the result, and returns the
// detail object.
//
// The error report is an XML document in the urn:tep:pdx:report:1.0
// namespace (root <errorReport>), defined by TEP's tep-pdx-report-v1.xsd —
// see docs/Diamond2_S3_XML_Exchange_Protocol.md §6.1 in the CDN-Diamond-XML
// repo. Faults sit under <file> (document-level) and <programmes>/<programme>
// (per-record), each as an <error code message severity field? line?/>.
// Warnings never appear on an error report.
//
// Returns cached data immediately if available. Failures are non-fatal —
// partial data is returned with null for missing fields.
//
// Returns: { stage, summary, errorCount, maxSeverity, topError,
//            publicationId, cachedAt, fullReport }
//
// Note: fullReport is kept in memory for the current session but NOT
// persisted to localStorage (setCachedError stores only the summary fields).
// ---------------------------------------------------------------------------
export async function loadErrorDetail(s3, bucketName, filename) {
  // Check cache first
  const cached = getCachedError(filename);
  if (cached) {
    log('Using cached error detail for', filename);
    return cached;
  }

  const base      = filename.replace(/\.xml$/, '');
  const reportKey = `errors/${base}.errors.xml`;
  const xmlKey    = `errors/${filename}`;

  // Download both in parallel — either may fail independently
  const [reportResult, xmlResult] = await Promise.allSettled([
    downloadObject(s3, bucketName, reportKey),
    downloadObject(s3, bucketName, xmlKey),
  ]);

  // Parse the XML error report
  let fullReport    = null;
  let stage         = null;
  let summary       = null;
  let errorCount    = 0;
  let maxSeverity   = null;
  let topError      = null;

  if (reportResult.status === 'fulfilled') {
    try {
      const doc  = new DOMParser().parseFromString(reportResult.value, 'application/xml');
      const root = doc.getElementsByTagNameNS('*', 'errorReport')[0];
      if (!root) throw new Error('no <errorReport> root element');

      stage   = root.getAttribute('stage')   || null;
      summary = root.getAttribute('summary') || null;

      const errors = [];
      for (const el of root.getElementsByTagNameNS('*', 'error')) {
        const parent = el.parentElement;
        errors.push({
          code:     el.getAttribute('code'),
          message:  el.getAttribute('message'),
          severity: el.getAttribute('severity'),
          field:    el.getAttribute('field'),
          line:     el.getAttribute('line'),
          // The Sender's record id from the enclosing <programme>, or null
          // for document-level faults under <file>
          recordId: parent && parent.localName === 'programme'
            ? parent.getAttribute('id')
            : null,
        });
      }

      fullReport  = { stage, summary, errors };
      errorCount  = errors.length;
      maxSeverity = deriveMaxSeverity(errors);
      topError    = summary || errors[0]?.message || null;
    } catch (e) {
      log('Failed to parse error report for', filename, e);
    }
  } else {
    log('Failed to download error report for', filename, reportResult.reason);
  }

  // Parse XML to extract publicationId
  let publicationId = null;

  if (xmlResult.status === 'fulfilled') {
    try {
      const parser = new DOMParser();
      const doc    = parser.parseFromString(xmlResult.value, 'application/xml');
      const pub    = doc.querySelector('Publication');
      if (pub) publicationId = pub.getAttribute('publicationId');
    } catch (e) {
      log('Failed to parse XML for', filename, e);
    }
  } else {
    log('Failed to download XML for', filename, xmlResult.reason);
  }

  const detail = {
    stage,
    summary,
    errorCount,
    maxSeverity,
    topError,
    publicationId,
    cachedAt:   new Date().toISOString(),
    fullReport,
  };

  // Persist summary to localStorage (exclude fullReport to save space).
  // Only cache if we actually got a valid report — don't cache failed lookups.
  if (fullReport) {
    const { fullReport: _, ...summary } = detail;
    setCachedError(filename, summary);
  }

  return detail;
}

// Derive the highest severity from an array of error objects.
// The report schema allows only "error" (bad data, fix and resubmit) and
// "critical" (TEP-side processing failure, resubmit unchanged).
function deriveMaxSeverity(errors) {
  if (errors.some(e => e.severity === 'critical')) return 'critical';
  if (errors.some(e => e.severity === 'error'))    return 'error';
  return 'info';
}
