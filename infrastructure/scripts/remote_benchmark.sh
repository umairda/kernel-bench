#!/usr/bin/env bash
set -euo pipefail

# Run mode:
# - cpu: run CPU vector ops only
# - gpu: run CPU vector ops + attempt GPU vector ops when NVIDIA GPU is present
# - auto: same as gpu mode, but automatically skips GPU command if no NVIDIA GPU is detected
RUN_MODE="${1:-auto}"

if [[ "${RUN_MODE}" != "cpu" && "${RUN_MODE}" != "gpu" && "${RUN_MODE}" != "auto" ]]; then
  echo "Invalid RUN_MODE '${RUN_MODE}'. Use cpu|gpu|auto"
  exit 2
fi

RESULTS_DIR="$(pwd)/benchmark_results"
mkdir -p "${RESULTS_DIR}"

# Metadata for later comparison across instances.
{
  echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "hostname=$(hostname)"
  echo "run_mode=${RUN_MODE}"
  if curl -sS http://169.254.169.254/latest/meta-data/instance-type >/tmp/instance-type.txt 2>/dev/null; then
    echo "instance_type=$(cat /tmp/instance-type.txt)"
  fi
} > "${RESULTS_DIR}/metadata.txt"

GPU_PRESENT="false"
if command -v nvidia-smi >/dev/null 2>&1; then
  if nvidia-smi -L > "${RESULTS_DIR}/nvidia_smi.txt" 2>&1; then
    GPU_PRESENT="true"
  fi
fi

echo "Configuring project..."
if [[ "${RUN_MODE}" == "gpu" || "${RUN_MODE}" == "auto" ]]; then
  cmake -S ./compute-framework -B build -DENABLE_CUDA=ON || cmake -S ./compute-framework -B build
else
  cmake -S ./compute-framework -B build
fi

cmake --build build -j

# Always run CPU vector operations, regardless of host type.
{
  echo "=== CPU Vector Ops ==="
  ./build/compute --op vector --backend cpu --vector-op add --a "1,2,3,4" --b "5,6,7,8"
  ./build/compute --op vector --backend cpu --vector-op subtract --a "10,20,30,40" --b "1,2,3,4"
  ./build/compute --op vector --backend cpu --vector-op multiply --a "2,3,4,5" --b "6,7,8,9"
  ./build/compute --op vector --backend cpu --vector-op divide --a "8,18,32,50" --b "2,3,4,5"
} > "${RESULTS_DIR}/cpu_ops.txt" 2>&1

# GPU operation attempt only on GPU-capable hosts and non-cpu mode.
if [[ "${RUN_MODE}" != "cpu" && "${GPU_PRESENT}" == "true" ]]; then
  {
    echo "=== GPU Vector Ops ==="
    # This will work once gpu-vector-op is implemented in the CLI.
    ./build/compute --op vector --backend gpu --vector-op add --a "1,2,3,4" --b "5,6,7,8"
  } > "${RESULTS_DIR}/gpu_ops.txt" 2>&1 || true
else
  {
    echo "GPU benchmark skipped"
    echo "run_mode=${RUN_MODE}"
    echo "gpu_present=${GPU_PRESENT}"
  } > "${RESULTS_DIR}/gpu_ops.txt"
fi

echo "=== Metadata ==="
cat "${RESULTS_DIR}/metadata.txt"

echo "=== CPU Results ==="
cat "${RESULTS_DIR}/cpu_ops.txt"

echo "=== GPU Results ==="
cat "${RESULTS_DIR}/gpu_ops.txt"
