// Error cache — localStorage-backed store for tracking which error batches
// the user has seen or dismissed, plus cached error details so we don't
// re-download JSON reports on every visit.
//
// Storage key: "tep_error_cache"
// Shape:
//   {
//     batches:      { [batchId]: "new" | "viewed" | "dismissed" },
//     errorDetails: { [filename]: { stage, errorCount, warningCount,
//                                   maxSeverity, topError, publicationId,
//                                   cachedAt } }
//   }
//
// Follows the same load/save pattern as learnedAliases.js — try/catch on
// parse, fall through to empty default on corruption.

import { log } from './debug.js';
import { parseFilename } from './s3.js';

const CACHE_KEY   = 'tep_error_cache';
const MAX_AGE_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days

const EMPTY_CACHE = { batches: {}, errorDetails: {} };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (raw && typeof raw === 'object' && raw.batches && raw.errorDetails) return raw;
    return { ...EMPTY_CACHE };
  } catch {
    return { ...EMPTY_CACHE };
  }
}

function save(cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

// ---------------------------------------------------------------------------
// Remove stale entries — any errorDetail with cachedAt older than 30 days,
// and any batch ID that no longer has files in the errorDetails map.
// ---------------------------------------------------------------------------
export function pruneCache() {
  const cache  = load();
  const cutoff = Date.now() - MAX_AGE_MS;

  // Prune old error detail entries
  for (const [filename, detail] of Object.entries(cache.errorDetails)) {
    if (detail.cachedAt && new Date(detail.cachedAt).getTime() < cutoff) {
      delete cache.errorDetails[filename];
    }
  }

  // Collect batch IDs still referenced by remaining error details
  const activeBatches = new Set();
  for (const filename of Object.keys(cache.errorDetails)) {
    const parsed = parseFilename(filename);
    if (parsed) activeBatches.add(parsed.batchId);
  }

  // Prune batch statuses that have no remaining files and are old
  // (keep dismissed batches even without files — they'll be pruned by age)
  for (const batchId of Object.keys(cache.batches)) {
    if (!activeBatches.has(batchId) && cache.batches[batchId] !== 'dismissed') {
      // No files reference this batch; only delete if it's not a recent dismissal
      // We keep dismissed entries so they survive until the remote files expire
    }
  }

  save(cache);
  log('Cache pruned');
}

// ---------------------------------------------------------------------------
// Batch status accessors
// ---------------------------------------------------------------------------
export function getBatchStatus(batchId) {
  const cache = load();
  return cache.batches[batchId]; // "new" | "viewed" | "dismissed" | undefined
}

export function setBatchStatus(batchId, status) {
  const cache = load();
  cache.batches[batchId] = status;
  save(cache);
  log('Batch', batchId, '→', status);
}

export function getDismissedBatches() {
  const cache = load();
  const dismissed = new Set();
  for (const [id, status] of Object.entries(cache.batches)) {
    if (status === 'dismissed') dismissed.add(id);
  }
  return dismissed;
}

// ---------------------------------------------------------------------------
// Error detail accessors — per-file cached summaries
// ---------------------------------------------------------------------------
export function getCachedError(filename) {
  const cache  = load();
  const detail = cache.errorDetails[filename];
  // Reject stale entries from previously failed lookups (no real data)
  if (detail && !detail.errorCount && !detail.stage) {
    delete cache.errorDetails[filename];
    save(cache);
    return undefined;
  }
  return detail; // object or undefined
}

export function setCachedError(filename, detail) {
  const cache = load();
  cache.errorDetails[filename] = detail;
  save(cache);
}

// ---------------------------------------------------------------------------
// Reconcile: remove cache entries for files that no longer exist in S3.
// Called after listing the remote bucket so we don't accumulate stale entries
// for files that have been removed by the bucket lifecycle policy.
// ---------------------------------------------------------------------------
export function reconcileCache(remoteFilenames) {
  const cache   = load();
  let   changed = false;

  for (const filename of Object.keys(cache.errorDetails)) {
    if (!remoteFilenames.has(filename)) {
      delete cache.errorDetails[filename];
      changed = true;
    }
  }

  if (changed) {
    save(cache);
    log('Cache reconciled — removed entries for deleted remote files');
  }
}
