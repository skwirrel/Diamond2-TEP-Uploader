#!/usr/bin/env bash
# Creates a test S3 bucket + a least-privilege IAM user scoped to that bucket.
#
# Config priority (highest → lowest):
#   1. Positional args:  ./create-test-bucket.sh <bucket-name> [region]
#   2. Environment vars: ADMIN_AWS_ACCESS_KEY_ID, ADMIN_AWS_SECRET_ACCESS_KEY,
#                        KEY_EXPIRY (ISO 8601 or duration like "8h", "2d")
#   3. Interactive prompt (fallback for anything still missing)

set -euo pipefail

IAM_USER="tep-uploader-test"
POLICY_NAME="tep-uploader-test-s3-policy"

# ── Helpers ───────────────────────────────────────────────────────────────────
prompt() {
  # prompt VAR_NAME "display text" [secret=false] [optional=false]
  local var_name="$1"
  local prompt_text="$2"
  local secret="${3:-false}"
  local optional="${4:-false}"
  local current_val="${!var_name:-}"

  if [[ -n "$current_val" ]]; then
    return  # already set
  fi

  if [[ "$secret" == "true" ]]; then
    read -r -s -p "$prompt_text" "$var_name"
    echo ""
  else
    read -r -p "$prompt_text" "$var_name"
  fi

  if [[ -z "${!var_name:-}" && "$optional" != "true" ]]; then
    echo "ERROR: $var_name cannot be empty."
    exit 1
  fi
}

# Convert a duration string ("8h", "2d", "90m") or ISO 8601 datetime to a
# UTC ISO 8601 datetime string suitable for aws:CurrentTime comparisons.
# Outputs nothing and returns 1 if the input is blank (no expiry).
parse_expiry() {
  local raw="$1"
  [[ -z "$raw" ]] && return 1

  python3 - "$raw" <<'PYEOF'
import sys, re
from datetime import datetime, timedelta, timezone

raw = sys.argv[1].strip()

# Try duration shorthand: 30m, 8h, 2d, 1w
m = re.fullmatch(r'(\d+(?:\.\d+)?)\s*([mhdw])', raw, re.IGNORECASE)
if m:
    qty, unit = float(m.group(1)), m.group(2).lower()
    delta = {'m': timedelta(minutes=qty),
             'h': timedelta(hours=qty),
             'd': timedelta(days=qty),
             'w': timedelta(weeks=qty)}[unit]
    dt = datetime.now(timezone.utc) + delta
else:
    # Try ISO 8601 (with or without timezone)
    for fmt in ('%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%dT%H:%M:%S',
                '%Y-%m-%dT%H:%MZ',    '%Y-%m-%dT%H:%M',
                '%Y-%m-%d %H:%M:%S',  '%Y-%m-%d'):
        try:
            dt = datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
            break
        except ValueError:
            continue
    else:
        print(f"ERROR: Cannot parse expiry '{raw}'. Use e.g. 8h, 2d, 2026-03-10T18:00:00Z", file=sys.stderr)
        sys.exit(1)

print(dt.strftime('%Y-%m-%dT%H:%M:%SZ'))
PYEOF
}

# ── Collect config ────────────────────────────────────────────────────────────
BUCKET_NAME="${1:-}"
REGION="${2:-}"

echo ""
echo "TEP Uploader — Test Environment Setup"
echo "======================================"
echo "Press Enter to accept defaults shown in [brackets]."
echo ""
echo "Bucket name rules: 3–63 chars, lowercase letters/numbers/hyphens only,"
echo "must start and end with a letter or number, globally unique across all AWS accounts."
echo ""

prompt BUCKET_NAME "S3 bucket name:                    " false false
prompt REGION      "AWS region             [us-east-1]: " false true
REGION="${REGION:-us-east-1}"
prompt ADMIN_AWS_ACCESS_KEY_ID     "Admin Access Key ID:               " false false
prompt ADMIN_AWS_SECRET_ACCESS_KEY "Admin Secret Access Key:           " true  false

# Expiry is optional — blank means no expiry
if [[ -z "${KEY_EXPIRY:-}" ]]; then
  read -r -p "Key expiry (e.g. 8h, 2d, 2026-03-10T18:00:00Z) [none]: " KEY_EXPIRY
fi

# Resolve expiry to an ISO 8601 timestamp (or empty)
EXPIRY_ISO=""
if [[ -n "${KEY_EXPIRY:-}" ]]; then
  EXPIRY_ISO=$(parse_expiry "$KEY_EXPIRY") || {
    echo "Aborting due to invalid expiry."
    exit 1
  }
fi

echo ""
echo "==> Bucket:   s3://$BUCKET_NAME"
echo "==> Region:   $REGION"
echo "==> IAM user: $IAM_USER"
if [[ -n "$EXPIRY_ISO" ]]; then
  echo "==> Expires:  $EXPIRY_ISO (UTC)"
else
  echo "==> Expires:  never (manual teardown required)"
fi
echo ""

export AWS_ACCESS_KEY_ID="$ADMIN_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$ADMIN_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$REGION"

# ── 1. Create the S3 bucket ──────────────────────────────────────────────────
echo "[1/7] Creating S3 bucket..."
if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
  echo "    Bucket already exists, skipping creation."
else
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket \
      --bucket "$BUCKET_NAME" \
      --region "$REGION"
  else
    aws s3api create-bucket \
      --bucket "$BUCKET_NAME" \
      --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION"
  fi
  echo "    Bucket created."
fi

# Always enforce — idempotent, and ensures existing buckets are also locked down
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo "    Public access blocked."

# ── 2. Create IAM user ───────────────────────────────────────────────────────
echo "[2/7] Creating IAM user '$IAM_USER'..."
if aws iam get-user --user-name "$IAM_USER" &>/dev/null; then
  echo "    User already exists, skipping creation."
else
  aws iam create-user --user-name "$IAM_USER"
fi

# ── 3. Attach least-privilege inline policy ───────────────────────────────────
echo "[3/7] Attaching least-privilege S3 policy..."

# Build the optional Condition block. When an expiry is set it is added to
# every Allow statement — once aws:CurrentTime passes the threshold the Allow
# no longer matches and all actions are implicitly denied.
if [[ -n "$EXPIRY_ISO" ]]; then
  CONDITION_BLOCK=',
      "Condition": {
        "DateLessThan": {"aws:CurrentTime": "'"$EXPIRY_ISO"'"}
      }'
else
  CONDITION_BLOCK=""
fi

POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}"${CONDITION_BLOCK}
    },
    {
      "Sid": "ReadWriteObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"${CONDITION_BLOCK}
    }
  ]
}
EOF
)

aws iam put-user-policy \
  --user-name "$IAM_USER" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOC"

echo "    Policy attached."

# ── 4. Create folder structure ────────────────────────────────────────────────
echo "[4/7] Creating bucket folder structure (incoming/, complete/, errors/)..."
for PREFIX in incoming complete errors; do
  aws s3api put-object \
    --bucket "$BUCKET_NAME" \
    --key "${PREFIX}/" \
    --content-length 0
  echo "    Created ${PREFIX}/"
done

# ── 5. Configure CORS ─────────────────────────────────────────────────────────
echo "[5/7] Configuring CORS..."

# Show existing origins so the user knows what's already there
EXISTING_CORS=$(aws s3api get-bucket-cors --bucket "$BUCKET_NAME" 2>/dev/null || true)
if [[ -n "$EXISTING_CORS" ]]; then
  EXISTING_ORIGINS=$(echo "$EXISTING_CORS" | python3 -c "
import sys, json
cors = json.load(sys.stdin)
origins = []
for rule in cors.get('CORSRules', []):
    origins.extend(rule.get('AllowedOrigins', []))
print(', '.join(origins)) if origins else print('(none)')
")
  echo "    Current allowed origins: $EXISTING_ORIGINS"
else
  echo "    No existing CORS configuration."
fi

# Accept via env var or prompt interactively
if [[ -z "${CORS_ORIGINS:-}" ]]; then
  echo "    Enter origins as a comma-separated list."
  echo "    Rules:"
  echo "      - No trailing slash  ✓ https://conflab.io  ✗ https://conflab.io/"
  echo "      - Include port if non-standard  e.g. http://localhost:5173"
  echo "      - Wildcards allowed in subdomains  e.g. https://*.conflab.io"
  echo "      - Use * to allow any origin (easy for testing, avoid in production)"
  echo "    Examples: https://conflab.io, http://localhost:5173"
  read -r -p "    Allowed origins [*]: " CORS_ORIGINS
fi
CORS_ORIGINS="${CORS_ORIGINS:-*}"

# Build CORS JSON and apply. All three methods are required by this app:
#   GET  — ListObjectsV2 (remote dedup check)
#   PUT  — PutObject (XML upload)
#   HEAD — preflight + head-bucket credential check
CORS_JSON=$(python3 -c "
import json, sys
origins = [o.strip() for o in '''$CORS_ORIGINS'''.split(',') if o.strip()]
config = {
    'CORSRules': [{
        'AllowedOrigins': origins,
        'AllowedMethods': ['GET', 'PUT', 'HEAD'],
        'AllowedHeaders': ['*'],
        'ExposeHeaders':  ['ETag'],
        'MaxAgeSeconds':  3600,
    }]
}
print(json.dumps(config))
")

aws s3api put-bucket-cors \
  --bucket "$BUCKET_NAME" \
  --cors-configuration "$CORS_JSON"

echo "    CORS configured for: $CORS_ORIGINS"

# ── 6. Rotate access keys ─────────────────────────────────────────────────────
echo "[6/7] Rotating access keys..."
EXISTING_KEYS=$(aws iam list-access-keys --user-name "$IAM_USER" \
  --query 'AccessKeyMetadata[*].AccessKeyId' --output text)

for KEY_ID in $EXISTING_KEYS; do
  aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$KEY_ID"
  echo "    Deleted old key: $KEY_ID"
done

# ── 7. Create fresh access key ────────────────────────────────────────────────
echo "[7/7] Creating access key..."
KEY_JSON=$(aws iam create-access-key --user-name "$IAM_USER")
NEW_KEY_ID=$(echo "$KEY_JSON" | python3 -c "import sys,json; k=json.load(sys.stdin)['AccessKey']; print(k['AccessKeyId'])")
NEW_SECRET=$(echo "$KEY_JSON" | python3 -c "import sys,json; k=json.load(sys.stdin)['AccessKey']; print(k['SecretAccessKey'])")

# ── Output ────────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  Test environment ready"
echo "=========================================="
echo ""
echo "Bucket:     $BUCKET_NAME"
echo "Region:     $REGION"
if [[ -n "$EXPIRY_ISO" ]]; then
  echo "Expires:    $EXPIRY_ISO (UTC) — policy auto-denies after this time"
fi
echo ""
echo "Paste these into the TEP Uploader credentials screen:"
echo ""
echo "  Access Key ID:     $NEW_KEY_ID"
echo "  Secret Access Key: $NEW_SECRET"
echo "  Region:            $REGION"
echo "  Bucket:            $BUCKET_NAME"
echo ""
echo "To clean up everything when done:"
echo "  ./scripts/teardown-test-bucket.sh $BUCKET_NAME"
echo ""
