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

  // Parse error files — only .xml, skip .xml.json companion files
  const errorFiles = [];
  for (const obj of errorObjects) {
    const name = obj.Key.replace(/^errors\//, '');
    if (!name.endsWith('.xml') || name.endsWith('.xml.error.json')) continue;
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

  // Parse complete files
  const completeFiles = [];
  for (const obj of completeObjects) {
    const name = obj.Key.replace(/^complete\//, '');
    if (!name.endsWith('.xml')) continue;
    const parsed = parseFilename(name);
    if (!parsed) continue;
    if (obj.LastModified && obj.LastModified.getTime() < cutoff) continue;
    completeFiles.push({
      ...parsed,
      filename:     name,
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
// Downloads the .json error report and the .xml file in parallel, extracts
// key fields, caches the result, and returns the detail object.
//
// Returns cached data immediately if available. Failures are non-fatal —
// partial data is returned with null for missing fields.
//
// Returns: { stage, errorCount, warningCount, maxSeverity, topError,
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

  const jsonKey = `errors/${filename}.error.json`;
  const xmlKey  = `errors/${filename}`;

  // Download both in parallel — either may fail independently
  const [jsonResult, xmlResult] = await Promise.allSettled([
    downloadObject(s3, bucketName, jsonKey),
    downloadObject(s3, bucketName, xmlKey),
  ]);

  // Parse JSON error report
  let fullReport    = null;
  let stage         = null;
  let errorCount    = 0;
  let warningCount  = 0;
  let maxSeverity   = null;
  let topError      = null;

  if (jsonResult.status === 'fulfilled') {
    try {
      fullReport   = JSON.parse(jsonResult.value);
      stage        = fullReport.stage || null;
      errorCount   = (fullReport.errors || []).length;
      warningCount = (fullReport.warnings || []).length;
      maxSeverity  = deriveMaxSeverity(fullReport.errors || []);
      topError     = fullReport.errors?.[0]?.message || fullReport.error || null;
    } catch (e) {
      log('Failed to parse error JSON for', filename, e);
    }
  } else {
    log('Failed to download error JSON for', filename, jsonResult.reason);
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
    errorCount,
    warningCount,
    maxSeverity,
    topError,
    publicationId,
    cachedAt:   new Date().toISOString(),
    fullReport,
  };

  // Persist summary to localStorage (exclude fullReport to save space).
  // Only cache if we actually got a valid JSON report — don't cache failed lookups.
  if (fullReport) {
    const { fullReport: _, ...summary } = detail;
    setCachedError(filename, summary);
  }

  return detail;
}

// Derive the highest severity from an array of error objects.
function deriveMaxSeverity(errors) {
  if (errors.some(e => e.severity === 'critical')) return 'critical';
  if (errors.some(e => e.severity === 'error'))    return 'error';
  if (errors.some(e => e.severity === 'warning'))  return 'warning';
  return 'info';
}
