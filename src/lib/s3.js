// S3 operations — all interaction with Amazon S3 is contained in this file.
//
// Bucket folder layout (managed by TEP, not this app):
//   incoming/  ← this app writes here
//   complete/  ← TEP moves files here after successful ingestion
//   errors/    ← TEP places error reports here on ingestion failure
//
// File naming: incoming/{sha256_hash}-{yyyymmdd}-{hhmmss}-{random}.xml
// The hash prefix is what makes remote deduplication possible — we can use a
// ListObjectsV2 prefix scan instead of fetching every object.

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { log } from './debug.js';

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
// Format: incoming/{sha256_hash}-{yyyymmdd}-{hhmmss}-{random6digits}.xml
//
// Including the hash at the start of the key means ListObjectsV2 prefix scans
// can identify duplicates without downloading any file content.
// The timestamp and random suffix ensure uniqueness even if two browsers
// upload the same content at the same moment (which the dedup check would
// prevent in practice, but the key still needs to be unique).
// ---------------------------------------------------------------------------
export function makeS3Key(hash) {
  const now     = new Date();
  const pad     = (n, w = 2) => String(n).padStart(w, '0');
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const random  = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
  return `incoming/${hash}-${dateStr}-${timeStr}-${random}.xml`;
}
