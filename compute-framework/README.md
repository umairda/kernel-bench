# KernelBench

`KernelBench` is a C++ compute framework for comparing CPU and GPU implementations of:

- Vector operations
- Matrix multiplication
- 2D convolution (NCHW)

It includes:

- CPU and GPU backends
- Runtime backend selection + dispatch
- CLI runner
- Benchmark runner with CSV-style output
- Unit tests (GoogleTest)

## Current Status

Implemented:

- CPU vector ops: add, subtract, multiply, divide
- GPU vector ops
- CPU matrix multiply
- GPU matrix multiply
- CPU convolution
- GPU convolution
- Runtime capability probing + backend selection
- CLI parsing with flags
- Benchmark runner for vector + matmul + convolution

Notes:

- On non-CUDA builds, GPU calls return `NotImplemented` via `src/gpu/gpu_ops_stub.cpp`.
- On Apple Silicon/macOS, CUDA builds are blocked in CMake.

## Project Structure

- `include/framework/` public headers (`types`, `ops`, `runtime`, `parse_args`, etc.)
- `src/cpu/` CPU implementations
- `src/gpu/` CUDA implementations + non-CUDA stubs
- `src/runtime/` backend probe/selection/dispatch
- `src/common/` logger/timer utilities
- `src/main.cpp` CLI entrypoint
- `benchmarks/benchmark_main.cpp` benchmark runner
- `tests/` GoogleTest test suite

## Build

```bash
cmake -S . -B build
cmake --build build
```

## Run Unit Tests

```bash
ctest --test-dir build --output-on-failure
```

## CLI Usage

```bash
./build/compute --help
```

### Vector

```bash
./build/compute --op vector --backend cpu --vector-op add --a "1,2,3" --b "4,5,6"
```

Sample output:

```text
Success, out = 5,7,9
```

### Matmul

```bash
./build/compute --op matmul --backend cpu --a-rows 2 --a-cols 3 --b-rows 3 --b-cols 2 --a "1,2,3,4,5,6" --b "7,8,9,10,11,12"
```

Sample output:

```text
Success, out = 58,64,139,154
```

### Convolution

```bash
./build/compute --op convolution --backend cpu --n 1 --c-in 1 --h-in 3 --w-in 3 --c-out 1 --k-h 3 --k-w 3 --stride-h 1 --stride-w 1 --pad-h 0 --pad-w 0 --input "1,2,3,4,5,6,7,8,9" --filter "1,1,1,1,1,1,1,1,1"
```

Sample output:

```text
Success, out = 45
```

### GPU call on non-CUDA build

```bash
./build/compute --op vector --backend gpu --vector-op add --a "1,2,3" --b "4,5,6"
```

Sample output:

```text
NotImplemented
```

## Benchmark Runner

Build target:

```bash
cmake --build build --target benchmark_runner
```

Run:

```bash
./build/benchmark_runner
```

Sample output (first lines):

```text
op,backend,case_size,run_index,status,kernel_ms,transfer_ms,total_ms
summary_prefix,op,backend,case_size,status,success_count,mean_ms,p50_ms,p95_ms,min_ms,max_ms,throughput_items_per_s
vector_add,cpu,1024,0,Success,0.013000,0.000000,0.013000
vector_add,cpu,1024,1,Success,0.013000,0.000000,0.013000
```

## CUDA Build (Non-Apple NVIDIA Host)

```bash
cmake -S . -B build -DENABLE_CUDA=ON
cmake --build build
```

Optional architectures:

```bash
cmake -S . -B build -DENABLE_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES="75;80;86;89"
```

## Useful Targets

- `compute` -> CLI executable
- `benchmark_runner` -> benchmark executable
- `vector_ops_tests`
- `dispatcher_tests`
- `matmul_cpu_tests`
- `convolution_cpu_tests`
- `gpu_ops_tests`
- `parse_args_tests`
- `benchmark_tests`
