#!/usr/bin/env bash
set -euo pipefail

PS4='+ [${BASH_SOURCE##*/}:${LINENO}] '
set -x
trap 'rc=$?; echo "[ERROR] command failed (rc=${rc}) at line ${LINENO}: ${BASH_COMMAND}" >&2; exit ${rc}' ERR

RUNNER="$1"
BENCHMARK="$2"
PARAMS_B64="$3"
RUN_ID="$4"
BUCKET_NAME="$5"
S3_PREFIX="$6"
LAUNCH_TIMING_B64="${7:-}"
INSTANCE_ID="$(curl -sS http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || true)"

stop_instance_on_exit() {
  local code=$?
  if command -v aws >/dev/null 2>&1 && [[ -n "${INSTANCE_ID}" ]]; then
    aws ec2 stop-instances --instance-ids "${INSTANCE_ID}" >/dev/null 2>&1 || true
  fi
  exit "${code}"
}
trap stop_instance_on_exit EXIT

if [[ "${RUNNER}" != "cpu" && "${RUNNER}" != "gpu" ]]; then
  echo "Invalid runner: ${RUNNER}"
  exit 2
fi

if [[ "${BENCHMARK}" != "vector" && "${BENCHMARK}" != "matrix-multiplication" && "${BENCHMARK}" != "convolution" ]]; then
  echo "Invalid benchmark: ${BENCHMARK}"
  exit 2
fi

RESULTS_DIR="$(pwd)/benchmark_results"
mkdir -p "${RESULTS_DIR}"
WORKSPACE_ROOT="$(pwd)"
SOURCE_ROOT="${WORKSPACE_ROOT}"
BUNDLE_DIR="${SOURCE_ROOT}/.kernel-bench-bundle"
CACHE_ROOT="/opt/kernel-bench/cache"
CUDA_NVCC_PATH=""
CUDA_ROOT=""

now_ms() {
  date +%s%3N
}

PARAMS_JSON="$(echo "${PARAMS_B64}" | base64 --decode)"
PARAMS_FILE="${RESULTS_DIR}/params.json"
printf '%s' "${PARAMS_JSON}" > "${PARAMS_FILE}"
LAUNCH_TIMING_FILE="${RESULTS_DIR}/launch_timing.json"
if [[ -n "${LAUNCH_TIMING_B64}" ]]; then
  echo "${LAUNCH_TIMING_B64}" | base64 --decode > "${LAUNCH_TIMING_FILE}" || echo '{}' > "${LAUNCH_TIMING_FILE}"
else
  echo '{}' > "${LAUNCH_TIMING_FILE}"
fi

BUILD_SETUP_START_MS="$(now_ms)"
BUILD_DIR=""
COMPUTE_BIN=""
SOURCE_HASH=""

if [[ -f "${BUNDLE_DIR}/manifest.json" ]]; then
  SOURCE_HASH="$(python3 - <<'PY' "${BUNDLE_DIR}/manifest.json"
import json, sys
from pathlib import Path
manifest = json.loads(Path(sys.argv[1]).read_text())
print(manifest.get("sourceHash", ""))
PY
)"
fi

if [[ -z "${SOURCE_HASH}" ]]; then
  SOURCE_HASH="adhoc-$(date +%s)"
fi

SOURCE_CACHE_DIR="${CACHE_ROOT}/${RUNNER}/${SOURCE_HASH}"
SOURCE_CACHE_SRC_DIR="${SOURCE_CACHE_DIR}/src"
SOURCE_CACHE_BUILD_DIR="${SOURCE_CACHE_DIR}/build"
PREBUILT_BIN="${BUNDLE_DIR}/prebuilt/${RUNNER}/compute"

ensure_cmake() {
  if command -v cmake >/dev/null 2>&1; then
    local current
    current="$(cmake --version | head -n1 | awk '{print $3}')"
    if [[ "$(printf '%s\n' "3.24.0" "${current}" | sort -V | head -n1)" == "3.24.0" ]]; then
      return 0
    fi
  fi

  if command -v dnf >/dev/null 2>&1; then
    dnf install -y cmake
  elif command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y cmake
  else
    echo "No supported package manager found (expected dnf or apt-get)." >&2
    exit 2
  fi

  if ! command -v cmake >/dev/null 2>&1; then
    echo "cmake is still unavailable after package installation." >&2
    exit 2
  fi
}

ensure_cuda_toolkit_for_gpu() {
  if [[ "${RUNNER}" != "gpu" ]]; then
    return 0
  fi

  if command -v nvcc >/dev/null 2>&1; then
    CUDA_NVCC_PATH="$(command -v nvcc)"
    CUDA_ROOT="$(dirname "$(dirname "${CUDA_NVCC_PATH}")")"
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    dnf install -y dnf-plugins-core
    dnf config-manager --add-repo https://developer.download.nvidia.com/compute/cuda/repos/amzn2023/x86_64/cuda-amzn2023.repo
    dnf clean all
    dnf makecache
    dnf install -y cuda-compiler-12-6 cuda-cudart-devel-12-6 cuda-libraries-devel-12-6

  elif command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential dkms
    DEBIAN_FRONTEND=noninteractive apt-get install -y cuda-toolkit-12-6 || \
      DEBIAN_FRONTEND=noninteractive apt-get install -y nvidia-cuda-toolkit
    if command -v nvidia-smi >/dev/null 2>&1; then
      :
    fi
  else
    echo "No supported package manager found (expected dnf or apt-get)." >&2
    exit 2
  fi

  if command -v nvcc >/dev/null 2>&1; then
    CUDA_NVCC_PATH="$(command -v nvcc)"
    CUDA_ROOT="$(dirname "$(dirname "${CUDA_NVCC_PATH}")")"
    return 0
  fi

  for candidate in /usr/local/cuda/bin/nvcc /usr/local/cuda-*/bin/nvcc /opt/cuda/bin/nvcc; do
    if [[ -x "${candidate}" ]]; then
      CUDA_NVCC_PATH="${candidate}"
      CUDA_ROOT="$(dirname "$(dirname "${CUDA_NVCC_PATH}")")"
      break
    fi
  done

  if [[ -n "${CUDA_NVCC_PATH}" && -x "${CUDA_NVCC_PATH}" ]]; then
    return 0
  fi

  if command -v nvcc >/dev/null 2>&1; then
    return 0
  fi

  echo "GPU runner requires nvcc but CUDA toolkit installation did not provide it."
  exit 2
}

ensure_cmake
ensure_cuda_toolkit_for_gpu

if [[ "${RUNNER}" == "gpu" ]]; then
  export PATH="$(dirname "${CUDA_NVCC_PATH}"):${PATH}"
  export CUDAToolkit_ROOT="${CUDA_ROOT}"
fi

if [[ -x "${PREBUILT_BIN}" ]]; then
  COMPUTE_BIN="${PREBUILT_BIN}"
else
  mkdir -p "${SOURCE_CACHE_DIR}"
  if [[ ! -x "${SOURCE_CACHE_BUILD_DIR}/compute" ]]; then
    rm -rf "${SOURCE_CACHE_SRC_DIR}" "${SOURCE_CACHE_BUILD_DIR}"
    mkdir -p "${SOURCE_CACHE_SRC_DIR}"
    cp -R "${SOURCE_ROOT}/." "${SOURCE_CACHE_SRC_DIR}/"
    if [[ "${RUNNER}" == "gpu" ]]; then
      cmake -S "${SOURCE_CACHE_SRC_DIR}/compute-framework" -B "${SOURCE_CACHE_BUILD_DIR}" -DENABLE_CUDA=ON -DCUDAToolkit_ROOT="${CUDAToolkit_ROOT}" || \
        cmake -S "${SOURCE_CACHE_SRC_DIR}/compute-framework" -B "${SOURCE_CACHE_BUILD_DIR}"
    else
      cmake -S "${SOURCE_CACHE_SRC_DIR}/compute-framework" -B "${SOURCE_CACHE_BUILD_DIR}"
    fi
    cmake --build "${SOURCE_CACHE_BUILD_DIR}" -j --target compute
  fi
  COMPUTE_BIN="${SOURCE_CACHE_BUILD_DIR}/compute"
fi

if [[ ! -x "${COMPUTE_BIN}" ]]; then
  echo "Missing compute binary after bundle resolution: ${COMPUTE_BIN}"
  exit 2
fi

BUILD_SETUP_END_MS="$(now_ms)"

BENCHMARK_PHASE_START_MS="$(now_ms)"
python3 - <<'PY' "${RUNNER}" "${BENCHMARK}" "${PARAMS_FILE}" "${RESULTS_DIR}" "${RUN_ID}" "${COMPUTE_BIN}"
import json
import re
import subprocess
import sys
import time
from pathlib import Path

runner = sys.argv[1]
benchmark = sys.argv[2]
params_path = Path(sys.argv[3])
results_dir = Path(sys.argv[4])
run_id = sys.argv[5]
compute_bin = sys.argv[6]
params = json.loads(params_path.read_text())
backend = runner
run_start = time.perf_counter()
operations = []


def run_and_capture(name, argv, op_type=None):
    op_start = time.perf_counter()
    output = subprocess.check_output(argv, text=True, stderr=subprocess.STDOUT)
    elapsed_ms = (time.perf_counter() - op_start) * 1000.0
    (results_dir / f"{name}.txt").write_text(output)
    measured_ms = elapsed_ms
    metrics_line = None
    for line in output.splitlines():
        if line.startswith("KERNEL_BENCH_METRICS "):
            metrics_line = line
    if metrics_line:
        match = re.search(r"kernel_ms=([0-9]+(?:\\.[0-9]+)?)", metrics_line)
        if match:
            measured_ms = float(match.group(1))
    operations.append({
        "name": name,
        "operationType": op_type or name,
        "durationMs": round(measured_ms, 3),
        "wallDurationMs": round(elapsed_ms, 3),
        "command": argv,
    })

if benchmark == 'vector':
    length = int(params['vectorLength'])
    for op in ['add', 'subtract', 'multiply', 'divide']:
        cmd = [
            compute_bin,
            '--op', 'vector',
            '--backend', backend,
            '--vector-op', op,
            '--length', str(length),
        ]
        run_and_capture(f'vector_{op}', cmd, op_type=f'vector-{op}')
elif benchmark == 'matrix-multiplication':
    rows = int(params['inputRows'])
    k = int(params['inputCols'])
    out_cols = int(params['outputCols'])
    cmd = [
        compute_bin,
        '--op', 'matmul',
        '--backend', backend,
        '--a-rows', str(rows),
        '--a-cols', str(k),
        '--b-rows', str(k),
        '--b-cols', str(out_cols),
    ]
    run_and_capture('matrix_multiplication', cmd, op_type='matrix-multiplication')
else:
    n = int(params['inputN'])
    c_in = int(params['inputC'])
    h_in = int(params['inputH'])
    w_in = int(params['inputW'])
    c_out = int(params['filterOutC'])
    k_h = int(params['filterH'])
    k_w = int(params['filterW'])
    stride_h = int(params['strideH'])
    stride_w = int(params['strideW'])
    pad_h = int(params['padH'])
    pad_w = int(params['padW'])

    cmd = [
        compute_bin,
        '--op', 'convolution',
        '--backend', backend,
        '--n', str(n),
        '--c-in', str(c_in),
        '--h-in', str(h_in),
        '--w-in', str(w_in),
        '--c-out', str(c_out),
        '--k-h', str(k_h),
        '--k-w', str(k_w),
        '--stride-h', str(stride_h),
        '--stride-w', str(stride_w),
        '--pad-h', str(pad_h),
        '--pad-w', str(pad_w),
    ]
    run_and_capture('convolution', cmd, op_type='convolution')

total_ms = (time.perf_counter() - run_start) * 1000.0
benchmark_metrics = {
    "runId": run_id,
    "runner": runner,
    "benchmark": benchmark,
    "params": params,
    "benchmarkExecutionMs": round(total_ms, 3),
    "operations": operations,
}
(results_dir / "benchmark_metrics.json").write_text(json.dumps(benchmark_metrics, indent=2))
PY
BENCHMARK_PHASE_END_MS="$(now_ms)"

FINALIZATION_PHASE_START_MS="$(now_ms)"
{
  echo "run_id=${RUN_ID}"
  echo "runner=${RUNNER}"
  echo "benchmark=${BENCHMARK}"
  echo "timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi -L || true
  fi
} > "${RESULTS_DIR}/metadata.txt"

if command -v aws >/dev/null 2>&1; then
  if [[ -n "${INSTANCE_ID}" ]]; then
    aws cloudwatch put-metric-data \
      --namespace "KernelBench/Runner" \
      --metric-data "MetricName=RunInvocations,Value=1,Unit=Count,Dimensions=[{Name=Runner,Value=${RUNNER}},{Name=Benchmark,Value=${BENCHMARK}},{Name=InstanceId,Value=${INSTANCE_ID}}]" \
      >/dev/null 2>&1 || true
  fi
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_ROW="$(nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1 || true)"
  if [[ -n "${GPU_ROW}" ]]; then
    GPU_UTIL="$(echo "${GPU_ROW}" | cut -d',' -f1 | xargs)"
    GPU_MEM_USED="$(echo "${GPU_ROW}" | cut -d',' -f2 | xargs)"
    GPU_MEM_TOTAL="$(echo "${GPU_ROW}" | cut -d',' -f3 | xargs)"
    INSTANCE_ID="$(curl -sS http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || true)"
    if [[ -n "${INSTANCE_ID}" ]] && command -v aws >/dev/null 2>&1; then
      aws cloudwatch put-metric-data \
        --namespace "KernelBench/Runner" \
        --metric-data "MetricName=GpuUtilizationPercent,Value=${GPU_UTIL},Unit=Percent,Dimensions=[{Name=Runner,Value=${RUNNER}},{Name=Benchmark,Value=${BENCHMARK}},{Name=InstanceId,Value=${INSTANCE_ID}}]" \
                      "MetricName=GpuMemoryUsedMiB,Value=${GPU_MEM_USED},Unit=Megabytes,Dimensions=[{Name=Runner,Value=${RUNNER}},{Name=Benchmark,Value=${BENCHMARK}},{Name=InstanceId,Value=${INSTANCE_ID}}]" \
                      "MetricName=GpuMemoryTotalMiB,Value=${GPU_MEM_TOTAL},Unit=Megabytes,Dimensions=[{Name=Runner,Value=${RUNNER}},{Name=Benchmark,Value=${BENCHMARK}},{Name=InstanceId,Value=${INSTANCE_ID}}]" \
        >/dev/null 2>&1 || true
    fi
  fi
fi

aws s3 cp "${RESULTS_DIR}" "s3://${BUCKET_NAME}/${S3_PREFIX}" --recursive --exclude "performance.json"
FINALIZATION_PHASE_END_MS="$(now_ms)"

python3 - <<'PY' "${RESULTS_DIR}" "${RUN_ID}" "${RUNNER}" "${BENCHMARK}" "${BUILD_SETUP_START_MS}" "${BUILD_SETUP_END_MS}" "${BENCHMARK_PHASE_START_MS}" "${BENCHMARK_PHASE_END_MS}" "${FINALIZATION_PHASE_START_MS}" "${FINALIZATION_PHASE_END_MS}"
import json
import sys
from pathlib import Path

results_dir = Path(sys.argv[1])
run_id = sys.argv[2]
runner = sys.argv[3]
benchmark = sys.argv[4]
build_start = int(sys.argv[5])
build_end = int(sys.argv[6])
bench_start = int(sys.argv[7])
bench_end = int(sys.argv[8])
fin_start = int(sys.argv[9])
fin_end = int(sys.argv[10])

launch_timing = {}
launch_path = results_dir / "launch_timing.json"
if launch_path.exists():
    try:
        launch_timing = json.loads(launch_path.read_text())
    except Exception:
        launch_timing = {}

benchmark_metrics = {}
benchmark_metrics_path = results_dir / "benchmark_metrics.json"
if benchmark_metrics_path.exists():
    try:
        benchmark_metrics = json.loads(benchmark_metrics_path.read_text())
    except Exception:
        benchmark_metrics = {}

operation_durations = []
for op in benchmark_metrics.get("operations", []) or []:
    if not isinstance(op, dict):
        continue
    name = op.get("operationType") or op.get("name")
    duration_ms = op.get("durationMs")
    if name is None or duration_ms is None:
        continue
    operation_durations.append({"name": name, "durationMs": duration_ms})

phase_durations = {
    "queueStartRequestMs": launch_timing.get("queueStartRequestMs"),
    "instanceBootSsmReadyMs": launch_timing.get("instanceBootSsmReadyMs"),
    "buildSetupMs": max(0, build_end - build_start),
    "benchmarkExecutionMs": benchmark_metrics.get("benchmarkExecutionMs", max(0, bench_end - bench_start)),
    "uploadFinalizationMs": max(0, fin_end - fin_start),
}

total_duration = 0.0
for value in phase_durations.values():
    if isinstance(value, (int, float)):
        total_duration += float(value)

performance = {
    "runId": run_id,
    "runner": runner,
    "benchmark": benchmark,
    "phaseDurationsMs": phase_durations,
    "totalDurationMs": round(total_duration, 3),
    "operationDurations": operation_durations,
}

(results_dir / "performance.json").write_text(json.dumps(performance, indent=2))
PY

aws s3 cp "${RESULTS_DIR}/performance.json" "s3://${BUCKET_NAME}/${S3_PREFIX}performance.json"

echo "Uploaded benchmark results to s3://${BUCKET_NAME}/${S3_PREFIX}"
