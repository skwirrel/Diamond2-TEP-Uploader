// S3 operations — all interaction with Amazon S3 is contained in this file.
//
// Bucket folder layout (managed by TEP, not this app):
//   incoming/  ← this app writes here
//   complete/  ← TEP moves files here after successful ingestion
//   errors/    ← TEP places error reports here on ingestion failure
//
// File naming: incoming/{sha256_hash}-{batchId}-{yyyymmdd}-{hhmmss}-{random}.xml
// The hash prefix is what makes remote deduplication possible — we can use a
// ListObjectsV2 prefix scan instead of fetching every object. The batchId
// groups all files from a single upload session so the Error Review section
// can display them together.

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { log } from './debug.js';

// ---------------------------------------------------------------------------
// Filename convention — used to identify files created by this tool and to
// extract the batch ID for grouping.
//
// Format: {sha256_hash}-{batchId}-{yyyymmdd}-{hhmmss}-{random6}.xml
//   sha256_hash: 64 lowercase hex characters
//   batchId:     8 lowercase hex characters (shared by all files in one upload)
//   yyyymmdd:    8-digit date
//   hhmmss:      6-digit time
//   random6:     6-digit zero-padded random number
// ---------------------------------------------------------------------------
export const TEP_FILENAME_REGEX = /^([a-f0-9]{64})-([a-f0-9]{8})-(\d{8})-(\d{6})-(\d{6})\.xml$/;

// Parse a filename (without folder prefix) and extract its components.
// Returns { hash, batchId, date, time, random } or null if the filename
// doesn't match the convention used by this tool.
export function parseFilename(filename) {
  const m = filename.match(TEP_FILENAME_REGEX);
  if (!m) return null;
  return { hash: m[1], batchId: m[2], date: m[3], time: m[4], random: m[5] };
}

// Generate a batch ID — 8 lowercase hex characters from crypto.getRandomValues.
// Called once per upload session so all files in the batch share the same ID.
export function generateBatchId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Build an S3Client from the credentials stored in Settings.
// Called once per upload session, before the upload loop starts.
// ---------------------------------------------------------------------------
export function makeS3Client(credentials) {
  return new S3Client({
    region: credentials.region,
    credentials: {
      accessKeyId:     credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });
}

// ---------------------------------------------------------------------------
// Remote duplicate check.
//
// The file name always starts with the SHA-256 hash of the XML content.
// We scan all three folders (incoming, complete, errors) using a prefix search
// so we catch files that were uploaded before and then moved by TEP.
//
// Returns true if the hash is found anywhere in the bucket (duplicate).
// Returns false if it is nowhere to be found (safe to upload).
//
// Failure (e.g. permission error or network timeout) is intentionally NOT
// caught here — the caller (UploadProgress) treats a failed check as
// non-fatal and proceeds with the upload anyway.
// ---------------------------------------------------------------------------
export async function isRemoteDuplicate(s3, bucketName, hash) {
  const prefixes = [
    `incoming/${hash}-`,   // uploaded but not yet processed
    `complete/${hash}-`,   // processed successfully
    `errors/${hash}-`,     // processed but failed TEP ingestion
  ];

  for (const prefix of prefixes) {
    log('Checking remote prefix:', prefix);
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket:  bucketName,
        Prefix:  prefix,
        MaxKeys: 1,          // we only need to know if at least one object exists
      })
    );
    if (result.Contents && result.Contents.length > 0) {
      log('Remote duplicate found:', prefix);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Upload a single XML string to S3 under the incoming/ prefix.
// The caller is responsible for building the key via makeS3Key().
// ---------------------------------------------------------------------------
export async function uploadXML(s3, bucketName, key, xmlString) {
  log('Uploading:', key);
  await s3.send(
    new PutObjectCommand({
      Bucket:      bucketName,
      Key:         key,
      Body:        xmlString,
      ContentType: 'application/xml',
    })
  );
  log('Uploaded:', key);
}

// ---------------------------------------------------------------------------
// Build the S3 key for a new upload.
//
// Format: incoming/{sha256_hash}-{batchId}-{yyyymmdd}-{hhmmss}-{random6}.xml
//
// Including the hash at the start of the key means ListObjectsV2 prefix scans
// can identify duplicates without downloading any file content.
// The batchId groups all files from a single upload session.
// The timestamp and random suffix ensure uniqueness even if two browsers
// upload the same content at the same moment (which the dedup check would
// prevent in practice, but the key still needs to be unique).
// ---------------------------------------------------------------------------
export function makeS3Key(hash, batchId) {
  const now     = new Date();
  const pad     = (n, w = 2) => String(n).padStart(w, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const random  = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
  return `incoming/${hash}-${batchId}-${dateStr}-${timeStr}-${random}.xml`;
}

// ---------------------------------------------------------------------------
// List all objects under a given S3 prefix, handling pagination automatically.
// Returns a flat array of S3 object metadata ({ Key, LastModified, Size, … }).
// ---------------------------------------------------------------------------
export async function listAllObjects(s3, bucketName, prefix) {
  const all = [];
  let token = undefined;
  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket:            bucketName,
        Prefix:            prefix,
        ContinuationToken: token,
      })
    );
    if (result.Contents) all.push(...result.Contents);
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (token);
  log(`Listed ${all.length} objects under ${prefix}`);
  return all;
}

// ---------------------------------------------------------------------------
// Download a single object from S3 and return its content as a string.
// Used by the Error Review section to fetch .json error reports and .xml files.
// ---------------------------------------------------------------------------
export async function downloadObject(s3, bucketName, key) {
  log('Downloading:', key);
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key })
  );
  return await result.Body.transformToString();
}
