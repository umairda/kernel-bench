#!/usr/bin/env bash
set -euo pipefail

PS4='+ [${BASH_SOURCE##*/}:${LINENO}] '
set -x

upload_partial_results_on_error() {
  local rc="$1"
  local line="$2"
  local command="$3"
  echo "[ERROR] command failed (rc=${rc}) at line ${line}: ${command}" >&2
  if [[ -n "${RESULTS_DIR:-}" && -d "${RESULTS_DIR}" ]]; then
    cat > "${RESULTS_DIR}/shell_failure.json" <<JSON
{"exitCode":${rc},"line":${line},"command":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${command}" 2>/dev/null || printf '"unavailable"')}
JSON
    if command -v aws >/dev/null 2>&1 && [[ -n "${BUCKET_NAME:-}" && -n "${S3_PREFIX:-}" ]]; then
      aws s3 cp "${RESULTS_DIR}" "s3://${BUCKET_NAME}/${S3_PREFIX}" --recursive >/dev/null 2>&1 || true
    fi
  fi
  exit "${rc}"
}

trap 'upload_partial_results_on_error "$?" "${LINENO}" "${BASH_COMMAND}"' ERR

RUNNER="$1"
BENCHMARK="$2"
PARAMS_B64="$3"
RUN_ID="$4"
BUCKET_NAME="$5"
S3_PREFIX="$6"
LAUNCH_TIMING_B64="${7:-}"
IMDS_TOKEN=""

metadata_token() {
  if [[ -z "${IMDS_TOKEN}" ]]; then
    IMDS_TOKEN="$(curl -sS --connect-timeout 1 --max-time 2 \
      -X PUT "http://169.254.169.254/latest/api/token" \
      -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null || true)"
  fi
  printf '%s' "${IMDS_TOKEN}"
}

metadata_get() {
  local path="$1"
  local token
  token="$(metadata_token)"
  if [[ -n "${token}" ]]; then
    curl -sS --connect-timeout 1 --max-time 2 \
      -H "X-aws-ec2-metadata-token: ${token}" \
      "http://169.254.169.254/latest/meta-data/${path}" 2>/dev/null || true
    return 0
  fi

  curl -sS --connect-timeout 1 --max-time 2 \
    "http://169.254.169.254/latest/meta-data/${path}" 2>/dev/null || true
}

INSTANCE_ID="$(metadata_get instance-id)"

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
  cmake_meets_minimum() {
    local current
    if ! command -v cmake >/dev/null 2>&1; then
      return 1
    fi

    current="$(cmake --version | head -n1 | awk '{print $3}')"
    [[ "$(printf '%s\n' "3.24.0" "${current}" | sort -V | head -n1)" == "3.24.0" ]]
  }

  install_pip_cmake() {
    if ! command -v python3 >/dev/null 2>&1; then
      echo "python3 is required to install a newer cmake fallback." >&2
      exit 2
    fi

    if ! python3 -m pip --version >/dev/null 2>&1; then
      if command -v dnf >/dev/null 2>&1; then
        dnf install -y python3-pip
      elif command -v apt-get >/dev/null 2>&1; then
        DEBIAN_FRONTEND=noninteractive apt-get update -y
        DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip
      fi
    fi

    # Amazon Linux 2023 ships CMake 3.22, below the project minimum. Install a
    # newer CMake only when the OS package manager cannot satisfy the version.
    if python3 -m pip install --upgrade "cmake>=3.24,<4"; then
      hash -r || true
      return 0
    fi

    python3 -m pip install --break-system-packages --upgrade "cmake>=3.24,<4"
    hash -r || true
  }

  if cmake_meets_minimum; then
    return 0
  fi

  if command -v cmake >/dev/null 2>&1; then
    local current
    current="$(cmake --version | head -n1 | awk '{print $3}')"
    echo "cmake ${current} is below required 3.24.0; attempting upgrade."
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

  if ! cmake_meets_minimum; then
    install_pip_cmake
  fi

  if ! cmake_meets_minimum; then
    cmake --version >&2 || true
    echo "cmake is unavailable or still below 3.24.0 after installation." >&2
    exit 2
  fi
}

ensure_cuda_toolkit_for_gpu() {
  if [[ "${RUNNER}" != "gpu" ]]; then
    return 0
  fi

  find_nvcc() {
    if command -v nvcc >/dev/null 2>&1; then
      CUDA_NVCC_PATH="$(command -v nvcc)"
      CUDA_ROOT="$(dirname "$(dirname "${CUDA_NVCC_PATH}")")"
      return 0
    fi

    for candidate in /usr/local/cuda/bin/nvcc /usr/local/cuda-*/bin/nvcc /opt/cuda/bin/nvcc; do
      if [[ -x "${candidate}" ]]; then
        CUDA_NVCC_PATH="${candidate}"
        CUDA_ROOT="$(dirname "$(dirname "${CUDA_NVCC_PATH}")")"
        return 0
      fi
    done

    return 1
  }

  if find_nvcc; then
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

  if find_nvcc; then
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
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
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
operations = []
gpu_warmup_ms = None
gpu_warmup_kernel_ms = None


def read_int(path):
    try:
        return int(Path(path).read_text().strip())
    except Exception:
        return None


def read_memory_events(path):
    events_path = Path(path) / "memory.events"
    try:
        return {
            key: int(value)
            for key, value in (line.split() for line in events_path.read_text().splitlines() if line.strip())
        }
    except Exception:
        return {}


class CgroupDiagnostics:
    def __init__(self, name):
        self.root = Path("/sys/fs/cgroup")
        self.path = self.root / name
        self.available = False
        self.before = {}
        self.after = {}
        self.memory_peak_bytes = None
        self.error = None

    def setup(self):
        try:
            if not (self.root / "cgroup.controllers").exists():
                self.error = "cgroup-v2-unavailable"
                return
            self.path.mkdir(mode=0o755, exist_ok=False)
            self.before = read_memory_events(self.path)
            self.available = True
        except Exception as exc:
            self.error = str(exc)

    def attach(self, pid):
        if not self.available:
            return
        try:
            (self.path / "cgroup.procs").write_text(str(pid))
        except Exception as exc:
            self.error = str(exc)

    def finish(self):
        if not self.available:
            return
        self.after = read_memory_events(self.path)
        self.memory_peak_bytes = read_int(self.path / "memory.peak")
        try:
            self.path.rmdir()
        except Exception:
            pass

    def summary(self):
        oom_delta = max(0, self.after.get("oom", 0) - self.before.get("oom", 0))
        oom_kill_delta = max(0, self.after.get("oom_kill", 0) - self.before.get("oom_kill", 0))
        return {
            "available": self.available,
            "path": str(self.path) if self.available else None,
            "error": self.error,
            "memoryPeakBytes": self.memory_peak_bytes,
            "memoryEventsBefore": self.before,
            "memoryEventsAfter": self.after,
            "oomDelta": oom_delta,
            "oomKillDelta": oom_kill_delta,
        }


class GpuMemorySampler:
    def __init__(self, enabled):
        self.enabled = enabled and shutil.which("nvidia-smi") is not None
        self.stop_event = threading.Event()
        self.thread = None
        self.peak_used_mib = None
        self.total_mib = None
        self.samples = 0
        self.error = None

    def start(self):
        if not self.enabled:
            return
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        while not self.stop_event.is_set():
            try:
                resp = subprocess.run(
                    [
                        "nvidia-smi",
                        "--query-gpu=memory.used,memory.total",
                        "--format=csv,noheader,nounits",
                    ],
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    timeout=2,
                    check=False,
                )
                if resp.returncode == 0:
                    for line in resp.stdout.splitlines():
                        parts = [p.strip() for p in line.split(",")]
                        if len(parts) < 2:
                            continue
                        used = int(parts[0])
                        total = int(parts[1])
                        self.peak_used_mib = used if self.peak_used_mib is None else max(self.peak_used_mib, used)
                        self.total_mib = total if self.total_mib is None else max(self.total_mib, total)
                        self.samples += 1
            except Exception as exc:
                self.error = str(exc)
            self.stop_event.wait(1.0)

    def stop(self):
        if not self.enabled:
            return
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=3)

    def summary(self):
        return {
            "available": self.enabled,
            "peakUsedMiB": self.peak_used_mib,
            "totalMiB": self.total_mib,
            "samples": self.samples,
            "error": self.error,
        }


def parse_kernel_ms(output):
    metrics_line = None
    for line in output.splitlines():
        if line.startswith("KERNEL_BENCH_METRICS "):
            metrics_line = line
    if not metrics_line:
        return None

    match = re.search(r"kernel_ms=([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)", metrics_line)
    return float(match.group(1)) if match else None


def parse_kernel_bench_errors(output):
    errors = []
    for line in output.splitlines():
        if not line.startswith("KERNEL_BENCH_ERROR "):
            continue
        fields = {}
        for match in re.finditer(r"([a-zA-Z_]+)=(\"[^\"]*\"|\S+)", line[len("KERNEL_BENCH_ERROR "):]):
            value = match.group(2)
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            fields[match.group(1)] = value
        if fields:
            errors.append(fields)
    return errors


def classify_failure(returncode, output, cgroup_summary):
    errors = parse_kernel_bench_errors(output)
    if cgroup_summary.get("oomKillDelta", 0) > 0:
        return "HOST_OOM_KILLED"
    for err in reversed(errors):
        if err.get("type") in {"CUDA_OUT_OF_MEMORY", "BENCHMARK_OUT_OF_MEMORY"}:
            return "CUDA_OUT_OF_MEMORY" if err.get("type") == "CUDA_OUT_OF_MEMORY" else "BENCHMARK_OUT_OF_MEMORY"
    for err in reversed(errors):
        if err.get("type"):
            return err["type"]
    if returncode == -signal.SIGKILL:
        return "PROCESS_SIGKILL_UNKNOWN"
    if returncode == 137:
        return "PROCESS_KILLED_OR_OOM"
    return "BENCHMARK_EXIT_NONZERO"


def write_failure_diagnostics(name, argv, returncode, output, wall_ms, cgroup, gpu_sampler):
    cgroup_summary = cgroup.summary()
    diagnostics = {
        "name": name,
        "operationType": name,
        "runner": runner,
        "benchmark": benchmark,
        "runId": run_id,
        "command": argv,
        "returnCode": returncode,
        "signal": -returncode if returncode < 0 else None,
        "signalName": signal.Signals(-returncode).name if returncode < 0 and -returncode in [s.value for s in signal.Signals] else None,
        "wallDurationMs": round(wall_ms, 3),
        "classification": classify_failure(returncode, output, cgroup_summary),
        "kernelBenchErrors": parse_kernel_bench_errors(output),
        "cgroup": cgroup_summary,
        "gpuMemory": gpu_sampler.summary(),
        "tail": output.splitlines()[-40:],
    }
    (results_dir / "failure_diagnostics.json").write_text(json.dumps(diagnostics, indent=2))
    print(
        "KERNEL_BENCH_ERROR "
        f"type={diagnostics['classification']} "
        f"return_code={returncode} "
        f"detail=\"benchmark command failed; see failure_diagnostics.json\"",
        flush=True,
    )
    return diagnostics


def run_command(name, argv):
    output_lines = []
    cgroup = CgroupDiagnostics(f"kernelbench-{run_id}-{name}-{os.getpid()}".replace("/", "-"))
    cgroup.setup()
    gpu_sampler = GpuMemorySampler(runner == "gpu")
    op_start = time.perf_counter()
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    cgroup.attach(proc.pid)
    gpu_sampler.start()
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line, end='', flush=True)
        output_lines.append(line)
    proc.wait()
    gpu_sampler.stop()
    cgroup.finish()
    output = ''.join(output_lines)
    if proc.returncode != 0:
        wall_ms = (time.perf_counter() - op_start) * 1000.0
        diagnostics = write_failure_diagnostics(name, argv, proc.returncode, output, wall_ms, cgroup, gpu_sampler)
        raise subprocess.CalledProcessError(proc.returncode, argv, output=output) from RuntimeError(diagnostics["classification"])
    return output


def run_gpu_warmup():
    if runner != 'gpu':
        return None, None

    # Warm up CUDA before timed operations so first-use driver/context costs do not get charged to vector-add.
    cmd = [
        compute_bin,
        '--op', 'vector',
        '--backend', 'gpu',
        '--vector-op', 'add',
        '--length', '1',
    ]
    op_start = time.perf_counter()
    output = run_command('gpu_warmup', cmd)
    wall_ms = (time.perf_counter() - op_start) * 1000.0
    (results_dir / "gpu_warmup.txt").write_text(output)
    return round(wall_ms, 3), parse_kernel_ms(output)


def run_and_capture(name, argv, op_type=None):
    op_start = time.perf_counter()
    output = run_command(name, argv)
    elapsed_ms = (time.perf_counter() - op_start) * 1000.0
    (results_dir / f"{name}.txt").write_text(output)
    measured_ms = elapsed_ms
    kernel_ms = parse_kernel_ms(output)
    if kernel_ms is not None:
        measured_ms = kernel_ms
    operations.append({
        "name": name,
        "operationType": op_type or name,
        "durationMs": round(measured_ms, 3),
        "wallDurationMs": round(elapsed_ms, 3),
        "command": argv,
    })


gpu_warmup_ms, gpu_warmup_kernel_ms = run_gpu_warmup()
run_start = time.perf_counter()

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
if gpu_warmup_ms is not None:
    benchmark_metrics["gpuWarmupMs"] = gpu_warmup_ms
if gpu_warmup_kernel_ms is not None:
    benchmark_metrics["gpuWarmupKernelMs"] = round(gpu_warmup_kernel_ms, 3)
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
    INSTANCE_ID="$(metadata_get instance-id)"
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
    "gpuWarmupMs": benchmark_metrics.get("gpuWarmupMs"),
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
