#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: upload-source.sh <bucket-name> [s3-key] [--cpu-binary <path>] [--gpu-binary <path>]

Default s3-key: kernel-bench/source/latest.tar.gz

The uploaded archive always includes the source tree plus a bundle manifest.
Optional prebuilt binaries can be embedded so runners can skip local builds.
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 2
fi

BUCKET_NAME="$1"
shift

S3_KEY="kernel-bench/source/latest.tar.gz"
if [[ $# -gt 0 && "$1" != --* ]]; then
  S3_KEY="$1"
  shift
fi

CPU_BINARY=""
GPU_BINARY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cpu-binary)
      CPU_BINARY="${2:-}"
      shift 2
      ;;
    --gpu-binary)
      GPU_BINARY="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 2
      ;;
  esac
done

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/kernel-bench-bundle-XXXXXX)"
SOURCE_TARBALL="${TMP_DIR}/source.tar.gz"
SOURCE_HASH_FILE="${TMP_DIR}/source.sha256"
STAGING_DIR="${TMP_DIR}/staging"
FINAL_ARCHIVE="/tmp/kernel-bench-source-$(date +%Y%m%d-%H%M%S).tar.gz"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "Packaging source tree from: ${ROOT_DIR}"
COPYFILE_DISABLE=1 tar \
  --no-xattrs \
  --exclude='.git' \
  --exclude='build' \
  --exclude='compute-framework/build' \
  --exclude='frontend/node_modules' \
  --exclude='infrastructure/node_modules' \
  --exclude='infrastructure/cdk.out' \
  --exclude='infrastructure/dist' \
  --exclude='._*' \
  -czf "${SOURCE_TARBALL}" \
  -C "${ROOT_DIR}" .

shasum -a 256 "${SOURCE_TARBALL}" | awk '{print $1}' > "${SOURCE_HASH_FILE}"
SOURCE_HASH="$(cat "${SOURCE_HASH_FILE}")"

mkdir -p "${STAGING_DIR}"
tar -xzf "${SOURCE_TARBALL}" -C "${STAGING_DIR}"

BUNDLE_DIR="${STAGING_DIR}/.kernel-bench-bundle"
mkdir -p "${BUNDLE_DIR}/prebuilt/cpu" "${BUNDLE_DIR}/prebuilt/gpu"

CPU_INCLUDED=false
GPU_INCLUDED=false

if [[ -n "${CPU_BINARY}" ]]; then
  if [[ ! -f "${CPU_BINARY}" ]]; then
    echo "CPU binary not found: ${CPU_BINARY}"
    exit 2
  fi
  cp "${CPU_BINARY}" "${BUNDLE_DIR}/prebuilt/cpu/compute"
  chmod +x "${BUNDLE_DIR}/prebuilt/cpu/compute"
  CPU_INCLUDED=true
fi

if [[ -n "${GPU_BINARY}" ]]; then
  if [[ ! -f "${GPU_BINARY}" ]]; then
    echo "GPU binary not found: ${GPU_BINARY}"
    exit 2
  fi
  cp "${GPU_BINARY}" "${BUNDLE_DIR}/prebuilt/gpu/compute"
  chmod +x "${BUNDLE_DIR}/prebuilt/gpu/compute"
  GPU_INCLUDED=true
fi

cat > "${BUNDLE_DIR}/manifest.json" <<EOF
{
  "bundleVersion": 1,
  "sourceHash": "${SOURCE_HASH}",
  "prebuilt": {
    "cpu": ${CPU_INCLUDED},
    "gpu": ${GPU_INCLUDED}
  }
}
EOF

COPYFILE_DISABLE=1 tar --no-xattrs --exclude='._*' -czf "${FINAL_ARCHIVE}" -C "${STAGING_DIR}" .

echo "Uploading bundle archive to s3://${BUCKET_NAME}/${S3_KEY}"
aws s3 cp "${FINAL_ARCHIVE}" "s3://${BUCKET_NAME}/${S3_KEY}"

echo "Done."
echo "Source hash: ${SOURCE_HASH}"
echo "Embedded CPU binary: ${CPU_INCLUDED}"
echo "Embedded GPU binary: ${GPU_INCLUDED}"
