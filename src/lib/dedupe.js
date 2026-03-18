// Deduplication helpers.
//
// Each row is converted to XML and hashed with SHA-256 before uploading.
// The hash is checked in two places:
//   1. Local cache  — a circular buffer stored in localStorage (fast, no network call)
//   2. Remote check — a ListObjectsV2 scan of the S3 bucket (catches uploads from other
//                     browsers or after the local cache has been cleared)
//
// If the hash is found in either place, the row is silently skipped.
// After a successful upload the hash is written to the local cache so subsequent
// runs from the same browser also skip it without needing a network round-trip.

import { log } from './debug.js';

const CACHE_KEY = 'tep_upload_hash_cache'; // localStorage key
const CACHE_MAX = 1000;                    // maximum hashes to keep (oldest are evicted)

// ---------------------------------------------------------------------------
// Compute a SHA-256 hash of an XML string using the browser-native Web Crypto
// API (no external library required). Returns a lowercase hex digest string.
// ---------------------------------------------------------------------------
export async function hashXML(xmlString) {
  const encoder = new TextEncoder();
  const data     = encoder.encode(xmlString);                         // UTF-8 bytes
  const hashBuf  = await crypto.subtle.digest('SHA-256', data);       // ArrayBuffer
  // Convert the raw bytes to a lowercase hex string (e.g. "a3f1c2…")
  const hex = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  log('SHA-256:', hex);
  return hex;
}

// ---------------------------------------------------------------------------
// Local cache helpers — the cache is a JSON array of hex strings held in
// localStorage. We load and save on every operation to stay in sync if the
// same page is open in multiple tabs.
// ---------------------------------------------------------------------------
function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
  } catch {
    // Corrupt data in localStorage — start fresh rather than crashing
    return [];
  }
}

function saveCache(cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

// Returns true if the hash is already in the local cache.
export function isInLocalCache(hash) {
  return loadCache().includes(hash);
}

// Adds a hash to the local cache, evicting the oldest entry if the buffer is full.
export function addToLocalCache(hash) {
  let cache = loadCache();
  cache.push(hash);
  if (cache.length > CACHE_MAX) {
    // Trim from the front — keep the most recent CACHE_MAX hashes
    cache = cache.slice(cache.length - CACHE_MAX);
  }
  saveCache(cache);
}
