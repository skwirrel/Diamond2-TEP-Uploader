// Connection test — a ladder of probes that pins down WHY an S3 connection
// isn't working, so the user gets a specific, actionable message instead of
// the browser's bare "Failed to fetch".
//
// The probes run in order and each one is only meaningful if the previous
// one passed:
//
//   0. settings  — offline sanity checks on the five fields (format, stray
//                  whitespace, ASIA key without a session token, etc.)
//   1. network   — an unauthenticated no-cors fetch to the regional S3
//                  endpoint. Throws only if the network/browser blocks AWS
//                  outright (proxy, firewall, ad blocker). Nothing about the
//                  bucket or credentials is involved yet.
//   2. auth      — a signed ListObjectsV2 (MaxKeys 1) on incoming/. This is
//                  where S3 tells us, by error code, whether the key ID is
//                  unknown, the secret is wrong, the clock is skewed, or the
//                  keys are fine but lack read permission.
//   3. write     — a CONDITIONAL PutObject with an If-Match that can never
//                  succeed. IAM authorisation is evaluated before the
//                  precondition, so AccessDenied means "no write permission"
//                  while NoSuchKey / PreconditionFailed means "write permission
//                  confirmed" — and in neither case is anything written. This
//                  matters because a real probe object dropped in incoming/
//                  would be picked up by TEP as a broken file, and the app has
//                  no delete permission to tidy up after itself.
//
// Why "Failed to fetch" can't be a credentials problem: when S3 rejects bad
// keys it returns a proper 403 with a named error code, and the bucket's CORS
// config lets the browser read it. A TypeError from fetch() means the browser
// never got a readable response at all — wrong bucket name, wrong region,
// missing CORS rule, or a network block. Those are all settings/environment
// problems, not key problems, and the messages below say so.
//
// Also exported: describeUploadError(), used by the upload loop to turn a
// mid-run failure into the same friendly wording.

import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { log } from './debug.js';

// How long any single probe may take before we give up on it.
export const PROBE_TIMEOUT_MS = 15_000;

// Key used by the write probe. It is never created — the If-Match precondition
// guarantees the PUT is rejected after authorisation but before any write.
const WRITE_PROBE_KEY = 'incoming/.connection-test';

// An ETag that cannot match any real object (ETags are MD5 hex or multipart
// "hex-N"; this is neither).
const IMPOSSIBLE_ETAG = '"connection-test-never-matches"';

// ---------------------------------------------------------------------------
// Result vocabulary.
//
// Every outcome is one of these codes. `severity` is 'ok', 'warning' or
// 'error'. Titles are short enough for an alert heading; details are one or
// two sentences telling the user what to do next.
// ---------------------------------------------------------------------------
const OUTCOMES = {
  // --- stage 0: settings -------------------------------------------------
  MISSING_FIELDS: {
    severity: 'error',
    title:  'Some connection details are missing',
    detail: (x) => `Please fill in: ${x.fields.join(', ')}.`,
  },
  KEY_WHITESPACE: {
    severity: 'error',
    title:  'Access key ID contains stray spaces',
    detail: 'Remove any spaces or line breaks before or after the access key ID.',
  },
  KEY_FORMAT: {
    severity: 'error',
    title:  'Access key ID doesn’t look right',
    detail: 'AWS access key IDs are upper-case letters and digits, usually 20 characters ' +
            'starting with AKIA. Check you have pasted the key ID here and not the secret.',
  },
  SESSION_TOKEN_REQUIRED: {
    severity: 'error',
    title:  'This access key needs a session token',
    detail: 'Access key IDs starting with ASIA are temporary credentials and only work ' +
            'together with a session token, which cannot be entered here. Ask TEP support ' +
            'for a permanent access key (starting AKIA).',
  },
  SECRET_WHITESPACE: {
    severity: 'error',
    title:  'Secret access key contains stray spaces',
    detail: 'Remove any spaces or line breaks before or after the secret access key.',
  },
  SECRET_LENGTH: {
    severity: 'error',
    title:  'Secret access key doesn’t look right',
    detail: 'AWS secret access keys are exactly 40 characters. Check the whole key was ' +
            'copied and that nothing extra came with it.',
  },
  BUCKET_DOTS: {
    severity: 'error',
    title:  'Bucket name contains a dot',
    detail: 'Buckets with dots in their name cannot be used securely from a browser. ' +
            'Check the name against what TEP sent you; if it really does contain a dot, ' +
            'please contact support.',
  },
  BUCKET_FORMAT: {
    severity: 'error',
    title:  'Bucket name doesn’t look right',
    detail: 'Bucket names are lower-case letters, digits and hyphens only, with no spaces. ' +
            'Check it against what TEP sent you.',
  },
  REGION_MISSING: {
    severity: 'error',
    title:  'No region selected',
    detail: 'Choose the AWS region TEP gave you.',
  },

  // --- stage 1: network --------------------------------------------------
  NETWORK_BLOCKED: {
    severity: 'error',
    title:  'Your network or browser is blocking Amazon S3',
    detail: 'This page could not reach amazonaws.com at all. Try a different network ' +
            '(for example, off the office VPN), disable browser extensions such as ad ' +
            'blockers, and if the problem persists ask your IT team to allow access to ' +
            'amazonaws.com.',
  },
  TIMEOUT: {
    severity: 'error',
    title:  'Connection timed out',
    detail: `Amazon S3 did not respond within ${PROBE_TIMEOUT_MS / 1000} seconds. ` +
            'Check your internet connection and try again.',
  },

  // --- stage 2: auth -----------------------------------------------------
  BUCKET_UNREACHABLE: {
    severity: 'error',
    title:  'Amazon S3 is reachable, but the bucket could not be contacted',
    detail: 'This almost always means the bucket name or region does not match what TEP ' +
            'sent you. Check both carefully, character by character. If they are correct, ' +
            'the bucket may not be set up to accept uploads from this page: please contact ' +
            'support.',
  },
  KEY_UNKNOWN: {
    severity: 'error',
    title:  'Access key ID not recognised',
    detail: 'AWS does not recognise this access key ID. It may have been mistyped, rotated ' +
            'or deactivated. If you have recently rotated your key, make sure the new key ' +
            'ID is entered here. Otherwise request a new key from TEP support.',
  },
  SECRET_MISMATCH: {
    severity: 'error',
    title:  'Secret access key doesn’t match the key ID',
    detail: 'AWS recognised the access key ID, but the secret access key is not the one ' +
            'that belongs to it. Re-enter the secret, making sure the whole key is copied ' +
            'with nothing missing or added.',
  },
  TOKEN_EXPIRED: {
    severity: 'error',
    title:  'Session token has expired',
    detail: 'The temporary credentials supplied to this page have expired. Close this tab ' +
            'and relaunch the uploader to obtain fresh credentials.',
  },
  CLOCK_SKEW: {
    severity: 'error',
    title:  'Your computer’s clock is wrong',
    detail: 'AWS rejects requests from computers whose clock is more than 15 minutes out. ' +
            'Correct the date and time on this computer and try again.',
  },
  REGION_WRONG: {
    severity: 'error',
    title:  'Region doesn’t match the bucket',
    detail: (x) => 'The bucket exists but is in a different region' +
                   (x.expected ? ` (AWS reports ${x.expected})` : '') +
                   '. Select the region TEP gave you.',
  },
  BUCKET_MISSING: {
    severity: 'error',
    title:  'Bucket not found',
    detail: 'AWS reports that no bucket with this name exists. Check the bucket name ' +
            'against what TEP sent you.',
  },
  READ_DENIED: {
    severity: 'warning',
    title:  'Keys accepted, but they cannot read the bucket',
    detail: 'Your credentials work but do not have permission to list files in the bucket. ' +
            'Uploads should still succeed, but duplicate detection and Error Review will ' +
            'not work. Please contact support.',
  },

  // --- stage 3: write ----------------------------------------------------
  BUCKET_PROBLEM: {
    severity: 'error',
    title:  'Everything looks OK at your end, but there appears to be a problem with the TEP bucket',
    detail: (x) => 'Your credentials were accepted, but AWS refused to let them write to the ' +
                   'bucket. This needs fixing on the TEP side: please contact support and ' +
                   `quote the reference “${x.reference}”.`,
  },
  TRANSIENT: {
    severity: 'error',
    title:  'Amazon S3 is temporarily unavailable',
    detail: 'AWS asked us to slow down or reported a temporary fault. Wait a minute and try again.',
  },
  UNEXPECTED: {
    severity: 'error',
    title:  'Unexpected response from Amazon S3',
    detail: (x) => `AWS returned an error this app does not recognise (${x.reference}). ` +
                   'Please contact support and quote this message.',
  },

  // --- mid-upload only ---------------------------------------------------
  CONNECTION_LOST: {
    severity: 'error',
    title:  'Lost connection to Amazon S3 during upload',
    detail: 'The connection worked at the start of the upload but a later request never got ' +
            'a response. Check your network and retry; rows already uploaded will be skipped ' +
            'automatically.',
  },

  // --- success -----------------------------------------------------------
  OK: {
    severity: 'ok',
    title:  'Connection test passed',
    detail: 'Credentials accepted and write access to the bucket confirmed.',
  },
};

// Build a result object from an outcome code plus any values the detail
// template needs. `raw` carries the underlying error text for support/debug.
function outcome(code, extra = {}, raw = null) {
  const o = OUTCOMES[code];
  return {
    ok:       o.severity !== 'error',
    code,
    severity: o.severity,
    title:    o.title,
    detail:   typeof o.detail === 'function' ? o.detail(extra) : o.detail,
    raw,
  };
}

// ---------------------------------------------------------------------------
// Stage 0 — offline settings checks. Returns a result or null if all is well.
// ---------------------------------------------------------------------------
export function validateSettings(c) {
  const labels = {
    accessKeyId: 'Access Key ID', secretAccessKey: 'Secret Access Key',
    bucketName: 'Bucket Name', region: 'Region',
  };
  const missing = Object.keys(labels).filter((k) => !(c[k] ?? '').trim());
  if (missing.length) return outcome('MISSING_FIELDS', { fields: missing.map((k) => labels[k]) });

  const key = c.accessKeyId, secret = c.secretAccessKey, bucket = c.bucketName;

  if (key !== key.trim())                 return outcome('KEY_WHITESPACE');
  if (!/^[A-Z0-9]{16,128}$/.test(key))    return outcome('KEY_FORMAT');
  if (key.startsWith('ASIA') && !c.sessionToken) return outcome('SESSION_TOKEN_REQUIRED');

  if (secret !== secret.trim())           return outcome('SECRET_WHITESPACE');
  if (secret.length !== 40)               return outcome('SECRET_LENGTH');

  if (bucket.includes('.'))               return outcome('BUCKET_DOTS');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) return outcome('BUCKET_FORMAT');

  if (!/^[a-z]{2}-[a-z]+-\d$/.test(c.region)) return outcome('REGION_MISSING');

  return null;
}

// ---------------------------------------------------------------------------
// Error classification — the heart of the module. Maps whatever the SDK or
// the browser threw to an outcome code, given which stage we were in.
//
// `stage` is 'auth', 'write' or 'upload'. The same S3 error can mean
// different things at different stages (AccessDenied on a list is a warning;
// on a put it's a bucket-side problem).
// ---------------------------------------------------------------------------
export function classifyError(e, stage) {
  const name   = e?.name || '';
  const status = e?.$metadata?.httpStatusCode;
  const raw    = `${name}${e?.message ? ': ' + e.message : ''}`;

  if (name === 'AbortError' || name === 'TimeoutError') return outcome('TIMEOUT', {}, raw);

  // No HTTP status means the browser never handed the SDK a response: a
  // fetch() TypeError (CORS rejection, DNS failure, connection reset).
  if (status === undefined && (name === 'TypeError' || e instanceof TypeError || !name)) {
    return outcome(stage === 'upload' ? 'CONNECTION_LOST' : 'BUCKET_UNREACHABLE', {}, raw);
  }

  switch (name) {
    case 'InvalidAccessKeyId':
      return outcome('KEY_UNKNOWN', {}, raw);
    case 'SignatureDoesNotMatch':
      return outcome('SECRET_MISMATCH', {}, raw);
    case 'ExpiredToken':
    case 'InvalidToken':
    case 'TokenRefreshRequired':
      return outcome('TOKEN_EXPIRED', {}, raw);
    case 'RequestTimeTooSkewed':
    case 'RequestExpired':
      return outcome('CLOCK_SKEW', {}, raw);
    case 'AuthorizationHeaderMalformed': {
      // Message reads "...the region 'x' is wrong; expecting 'y'"
      const m = /expecting '([a-z0-9-]+)'/.exec(e.message || '');
      return outcome('REGION_WRONG', { expected: m?.[1] || e.Region }, raw);
    }
    case 'PermanentRedirect':
      return outcome('REGION_WRONG', { expected: e.Region }, raw);
    case 'NoSuchBucket':
    case 'InvalidBucketName':
      return outcome('BUCKET_MISSING', {}, raw);
    case 'AccessDenied':
    case 'AllAccessDisabled':
    case 'AccountProblem':
      return stage === 'auth'
        ? outcome('READ_DENIED', {}, raw)
        : outcome('BUCKET_PROBLEM', { reference: name }, raw);
    case 'SlowDown':
    case 'ServiceUnavailable':
    case 'InternalError':
      return outcome('TRANSIENT', {}, raw);
    default:
      if (status === 503 || status === 500) return outcome('TRANSIENT', {}, raw);
      return outcome('UNEXPECTED', { reference: name || `HTTP ${status ?? '?'}` }, raw);
  }
}

// ---------------------------------------------------------------------------
// Probe helpers
// ---------------------------------------------------------------------------
function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

// Stage 1: is amazonaws.com reachable from this browser at all?
// A no-cors request yields an opaque response (status 0) if anything at all
// answered, and throws only if the request could not be made.
async function probeNetwork(region) {
  const t = withTimeout(PROBE_TIMEOUT_MS);
  try {
    await fetch(`https://s3.${region}.amazonaws.com/`, {
      mode: 'no-cors', cache: 'no-store', signal: t.signal,
    });
    return null;
  } catch (e) {
    return outcome(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_BLOCKED', {}, `${e.name}: ${e.message}`);
  } finally {
    t.clear();
  }
}

// A client with retries disabled so a probe answers quickly and once.
function makeProbeClient(c) {
  return new S3Client({
    region: c.region,
    maxAttempts: 1,
    credentials: {
      accessKeyId:     c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
      ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}),
    },
  });
}

// Stage 2: signed list. Returns null on success, otherwise a result (which
// may be a warning the caller should keep going after).
async function probeAuth(s3, bucket) {
  const t = withTimeout(PROBE_TIMEOUT_MS);
  try {
    await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'incoming/', MaxKeys: 1 }),
      { abortSignal: t.signal },
    );
    return null;
  } catch (e) {
    return classifyError(e, 'auth');
  } finally {
    t.clear();
  }
}

// Stage 3: conditional put that is guaranteed to be refused *after*
// authorisation. Returns null if write permission is confirmed.
async function probeWrite(s3, bucket) {
  const t = withTimeout(PROBE_TIMEOUT_MS);
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket:      bucket,
        Key:         WRITE_PROBE_KEY,
        Body:        'connection test',
        ContentType: 'text/plain',
        IfMatch:     IMPOSSIBLE_ETAG,
      }),
      { abortSignal: t.signal },
    );
    // Should be impossible — the precondition can't be satisfied. If S3 ever
    // did accept it, the object is harmless (not .xml, so TEP ignores it) but
    // we still treat the test as passed since the write clearly succeeded.
    log('Write probe unexpectedly succeeded');
    return null;
  } catch (e) {
    const status = e?.$metadata?.httpStatusCode;
    // 404 (object doesn't exist), 412 (precondition failed) and 409
    // (conditional conflict) all mean authorisation passed and S3 evaluated
    // the condition — exactly the proof we wanted.
    if (status === 404 || status === 412 || status === 409 ||
        ['NoSuchKey', 'NotFound', 'PreconditionFailed', 'ConditionalRequestConflict'].includes(e?.name)) {
      return null;
    }
    return classifyError(e, 'write');
  } finally {
    t.clear();
  }
}

// ---------------------------------------------------------------------------
// The full ladder.
//
// Resolves to { ok, code, severity, title, detail, raw, warnings: [...] }.
// `warnings` holds non-fatal results (currently only READ_DENIED) gathered on
// the way to a pass. Never rejects — every failure is a classified result.
// ---------------------------------------------------------------------------
export async function runConnectionTest(creds) {
  const warnings = [];
  const finish = (r) => ({ ...r, warnings });

  const bad = validateSettings(creds);
  if (bad) { log('Connection test: settings', bad.code); return finish(bad); }

  const net = await probeNetwork(creds.region);
  if (net) { log('Connection test: network', net.code, net.raw); return finish(net); }

  const s3 = makeProbeClient(creds);

  const auth = await probeAuth(s3, creds.bucketName);
  if (auth) {
    log('Connection test: auth', auth.code, auth.raw);
    if (auth.severity === 'error') return finish(auth);
    warnings.push(auth);
  }

  const write = await probeWrite(s3, creds.bucketName);
  if (write) { log('Connection test: write', write.code, write.raw); return finish(write); }

  log('Connection test: passed', warnings.map((w) => w.code));
  return finish(outcome('OK'));
}

// ---------------------------------------------------------------------------
// Support report. The raw SDK/browser error is deliberately NOT shown on
// screen (it only confuses non-technical users); instead the UI offers a
// "Copy technical details" button that puts this report on the clipboard so
// it can be pasted into an email to support. Secrets are never included —
// only the last four characters of the key ID, for identification.
// ---------------------------------------------------------------------------
export function formatDebugReport(result, creds = {}, extra = {}) {
  const keyId = creds.accessKeyId || '';
  const lines = [
    'TEP Data Uploader — technical details',
    `Time:        ${new Date().toISOString()}`,
    `Page:        ${window.location.href}`,
    `Browser:     ${navigator.userAgent}`,
    `Bucket:      ${creds.bucketName || '(not set)'}`,
    `Region:      ${creds.region || '(not set)'}`,
    `Key ID ends: ${keyId ? '…' + keyId.slice(-4) : '(not set)'}`,
    ...Object.entries(extra).map(([k, v]) => `${k.padEnd(12)} ${v}`),
    `Outcome:     ${result.code} (${result.severity})`,
    `Title:       ${result.title}`,
    `Detail:      ${result.detail}`,
    `Raw error:   ${result.raw || '(none)'}`,
  ];
  for (const w of result.warnings ?? []) {
    lines.push(`Warning:     ${w.code} — ${w.raw || w.title}`);
  }
  return lines.join('\n');
}

// Copy text to the clipboard; resolves true on success. Falls back to a
// hidden textarea + execCommand for contexts where the async API is blocked.
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// For the upload loop: turn an error thrown by uploadXML() into the same
// friendly vocabulary. The pre-flight has already passed by the time this is
// called, so a fetch failure here is worded as a dropped connection.
// ---------------------------------------------------------------------------
export function describeUploadError(e) {
  return classifyError(e, 'upload');
}
