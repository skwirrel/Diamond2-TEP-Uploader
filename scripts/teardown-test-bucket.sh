#!/usr/bin/env bash
# Deletes the test S3 bucket and the IAM user created by create-test-bucket.sh.
#
# Config priority (highest → lowest):
#   1. Positional arg:   ./teardown-test-bucket.sh <bucket-name>
#   2. Environment vars: ADMIN_AWS_ACCESS_KEY_ID, ADMIN_AWS_SECRET_ACCESS_KEY
#   3. Interactive prompt (fallback for anything still missing)

set -euo pipefail

IAM_USER="tep-uploader-test"
POLICY_NAME="tep-uploader-test-s3-policy"

# ── Helper ────────────────────────────────────────────────────────────────────
prompt() {
  local var_name="$1"
  local prompt_text="$2"
  local secret="${3:-false}"
  local current_val="${!var_name:-}"

  if [[ -n "$current_val" ]]; then
    return
  fi

  if [[ "$secret" == "true" ]]; then
    read -r -s -p "$prompt_text" "$var_name"
    echo ""
  else
    read -r -p "$prompt_text" "$var_name"
  fi

  if [[ -z "${!var_name:-}" ]]; then
    echo "ERROR: $var_name cannot be empty."
    exit 1
  fi
}

# ── Collect config ────────────────────────────────────────────────────────────
BUCKET_NAME="${1:-}"
REGION="${2:-}"

echo ""
echo "TEP Uploader — Test Environment Teardown"
echo "========================================"
echo ""

prompt BUCKET_NAME  "S3 bucket name to delete:     " false
prompt REGION       "AWS region          [us-east-1]: " false
REGION="${REGION:-us-east-1}"
prompt ADMIN_AWS_ACCESS_KEY_ID     "Admin Access Key ID:          " false
prompt ADMIN_AWS_SECRET_ACCESS_KEY "Admin Secret Access Key:      " true

echo ""
echo "==> Will DELETE bucket: s3://$BUCKET_NAME"
echo "==> Will DELETE IAM user: $IAM_USER"
echo ""
read -r -p "Are you sure? [y/N]: " CONFIRM
if [[ "${CONFIRM,,}" != "y" ]]; then
  echo "Aborted."
  exit 0
fi
echo ""

export AWS_ACCESS_KEY_ID="$ADMIN_AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$ADMIN_AWS_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$REGION"

# ── 1. Empty and delete bucket ────────────────────────────────────────────────
echo "[1/3] Emptying and deleting bucket s3://$BUCKET_NAME..."

# Delete all object versions (handles versioned buckets too)
VERSIONS=$(aws s3api list-object-versions --bucket "$BUCKET_NAME" \
  --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' \
  --output json 2>/dev/null || echo '{"Objects": null}')

if [[ "$VERSIONS" != '{"Objects": null}' && "$VERSIONS" != '{"Objects":[]}' ]]; then
  echo "$VERSIONS" | python3 -c "
import sys, json, subprocess
data = json.load(sys.stdin)
objs = data.get('Objects') or []
if objs:
    batch = json.dumps({'Objects': objs, 'Quiet': True})
    subprocess.run(['aws', 's3api', 'delete-objects',
                    '--bucket', '$(echo $BUCKET_NAME)',
                    '--delete', batch], check=True)
    print(f'    Deleted {len(objs)} object version(s).')
"
fi

# Delete all delete markers
MARKERS=$(aws s3api list-object-versions --bucket "$BUCKET_NAME" \
  --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' \
  --output json 2>/dev/null || echo '{"Objects": null}')

if [[ "$MARKERS" != '{"Objects": null}' && "$MARKERS" != '{"Objects":[]}' ]]; then
  echo "$MARKERS" | python3 -c "
import sys, json, subprocess
data = json.load(sys.stdin)
objs = data.get('Objects') or []
if objs:
    batch = json.dumps({'Objects': objs, 'Quiet': True})
    subprocess.run(['aws', 's3api', 'delete-objects',
                    '--bucket', '$(echo $BUCKET_NAME)',
                    '--delete', batch], check=True)
    print(f'    Deleted {len(objs)} delete marker(s).')
"
fi

# For unversioned buckets, do a plain recursive delete as a safety net
aws s3 rm "s3://$BUCKET_NAME" --recursive --quiet 2>/dev/null || true

aws s3api delete-bucket --bucket "$BUCKET_NAME" --region "$REGION"
echo "    Bucket deleted."

# ── 2. Delete IAM access keys ─────────────────────────────────────────────────
echo "[2/3] Deleting IAM access keys for '$IAM_USER'..."
EXISTING_KEYS=$(aws iam list-access-keys --user-name "$IAM_USER" \
  --query 'AccessKeyMetadata[*].AccessKeyId' --output text 2>/dev/null || true)

for KEY_ID in $EXISTING_KEYS; do
  aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$KEY_ID"
  echo "    Deleted key: $KEY_ID"
done

# ── 3. Delete inline policy then IAM user ─────────────────────────────────────
echo "[3/3] Deleting IAM user '$IAM_USER'..."
aws iam delete-user-policy --user-name "$IAM_USER" --policy-name "$POLICY_NAME" 2>/dev/null || true
aws iam delete-user --user-name "$IAM_USER" 2>/dev/null || true
echo "    IAM user deleted."

echo ""
echo "Teardown complete."
echo ""
