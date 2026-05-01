#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./infrastructure/scripts/upload-and-run.sh <bucket-name> <instance-id> [run-mode]
# Example:
#   ./infrastructure/scripts/upload-and-run.sh my-artifact-bucket i-0123456789abcdef0 auto

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 <bucket-name> <instance-id> [run-mode]"
  echo "run-mode: cpu | gpu | auto (default: auto)"
  exit 2
fi

BUCKET_NAME="$1"
INSTANCE_ID="$2"
RUN_MODE="${3:-auto}"

if [[ "${RUN_MODE}" != "cpu" && "${RUN_MODE}" != "gpu" && "${RUN_MODE}" != "auto" ]]; then
  echo "Invalid run mode: ${RUN_MODE}"
  echo "Allowed values: cpu | gpu | auto"
  exit 2
fi
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="gpu-compute-framework-${TIMESTAMP}.tar.gz"
S3_KEY="source/${ARCHIVE_NAME}"

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_ARCHIVE="/tmp/${ARCHIVE_NAME}"

echo "Packaging source tree from: ${ROOT_DIR}"
tar \
  --exclude='.git' \
  --exclude='build' \
  --exclude='infrastructure/node_modules' \
  --exclude='infrastructure/cdk.out' \
  -czf "${TMP_ARCHIVE}" \
  -C "${ROOT_DIR}" .

echo "Uploading archive to s3://${BUCKET_NAME}/${S3_KEY}"
aws s3 cp "${TMP_ARCHIVE}" "s3://${BUCKET_NAME}/${S3_KEY}"

echo "Sending SSM command to ${INSTANCE_ID}"
COMMAND_ID="$(
aws ssm send-command \
  --instance-ids "${INSTANCE_ID}" \
  --document-name "AWS-RunShellScript" \
  --comment "Build and run gpu-compute-framework benchmark (${RUN_MODE})" \
  --parameters commands="[
    \"set -euxo pipefail\",
    \"mkdir -p /opt/gpu-compute-framework-runs/${TIMESTAMP}\",
    \"cd /opt/gpu-compute-framework-runs/${TIMESTAMP}\",
    \"aws s3 cp s3://${BUCKET_NAME}/${S3_KEY} source.tar.gz\",
    \"tar -xzf source.tar.gz\",
    \"bash ./infrastructure/scripts/remote_benchmark.sh ${RUN_MODE}\"
  ]" \
  --query 'Command.CommandId' \
  --output text
)"

echo "Command ID: ${COMMAND_ID}"
echo "Check status with:"
echo "aws ssm get-command-invocation --command-id ${COMMAND_ID} --instance-id ${INSTANCE_ID}"
