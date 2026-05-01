#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <frontend-bucket-name> [frontend-dir]"
  echo "Default frontend-dir: ./frontend"
  exit 2
fi

BUCKET_NAME="$1"
FRONTEND_DIR="${2:-./frontend}"

pushd "${FRONTEND_DIR}" >/dev/null
npm run build
popd >/dev/null

aws s3 sync "${FRONTEND_DIR}/dist/" "s3://${BUCKET_NAME}/" --delete

echo "Uploaded frontend assets to s3://${BUCKET_NAME}/"
