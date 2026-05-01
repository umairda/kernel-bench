# Compute Framework

This directory contains the native benchmark engine that KernelBench runs on CPU and GPU hosts.

## Purpose

The `compute-framework` executable is the lowest-level benchmark surface in the repo. It is responsible for:

- parsing CLI benchmark requests
- dispatching work to CPU or CUDA implementations
- printing machine-readable benchmark output
- serving as the binary executed by remote benchmark runners

The frontend and JSON-RPC control plane never execute kernels directly. They always flow through this binary.

## Architecture Decisions

- One CLI binary: the project exposes a single `compute` executable rather than separate binaries per benchmark. That keeps local use, remote orchestration, and prebuilt artifact handling simpler.
- Runtime backend selection: the CLI accepts an explicit `--backend cpu|gpu` choice so the orchestration layer can compare CPU and GPU deterministically.
- Graceful non-CUDA builds: GPU entrypoints fall back to stub implementations on hosts that are built without CUDA support.
- Small benchmark contract: the AWS runner invokes the binary with generated arguments instead of handing it opaque config files. That keeps the runtime boundary simple and debuggable.

## Layout

- `include/framework/`
  Public headers for types, runtime dispatch, CLI parsing, and benchmark contracts.
- `src/cpu/`
  CPU implementations for vector, matrix multiplication, and convolution.
- `src/gpu/`
  CUDA implementations plus non-CUDA stub fallbacks.
- `src/runtime/`
  Backend dispatch and capability probing.
- `src/common/`
  Shared logging and timing utilities.
- `src/cli/`
  Argument parsing helpers.
- `src/main.cpp`
  CLI entrypoint for the `compute` executable.
- `benchmarks/`
  Benchmark runner entrypoint(s).
- `tests/`
  GoogleTest coverage for parsing, dispatch, and compute behavior.
- `scripts/`
  Local helper scripts. These are currently placeholders rather than production automation.

## Build

From this directory:

```bash
cmake -S . -B build
cmake --build build --target compute
```

From the repo root, the remote runner usually builds it like:

```bash
cmake -S compute-framework -B compute-framework/build
cmake --build compute-framework/build --target compute
```

## CUDA Build

On a CUDA-capable Linux host:

```bash
cmake -S . -B build -DENABLE_CUDA=ON
cmake --build build --target compute
```

Optional architecture override:

```bash
cmake -S . -B build -DENABLE_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES="75;80;86;89"
```

## Test

```bash
ctest --test-dir build --output-on-failure
```

## CLI Usage

Show help:

```bash
./build/compute --help
```

Vector example:

```bash
./build/compute --op vector --backend cpu --vector-op add --a "1,2,3" --b "4,5,6"
```

Matrix multiplication example:

```bash
./build/compute --op matmul --backend cpu --a-rows 2 --a-cols 3 --b-rows 3 --b-cols 2 --a "1,2,3,4,5,6" --b "7,8,9,10,11,12"
```

Convolution example:

```bash
./build/compute --op convolution --backend cpu --n 1 --c-in 1 --h-in 3 --w-in 3 --c-out 1 --k-h 3 --k-w 3 --stride-h 1 --stride-w 1 --pad-h 0 --pad-w 0 --input "1,2,3,4,5,6,7,8,9" --filter "1,1,1,1,1,1,1,1,1"
```

If the binary was built without CUDA support, a GPU call returns `NotImplemented`.

## Scripts

- `scripts/run_benchmarks.sh`
  Placeholder for a future local benchmark sweep script.
- `scripts/profile_gpu.sh`
  Placeholder for future GPU profiling automation.

These scripts are documented so contributors do not assume they are production-ready yet.

## Relationship To Infrastructure

This directory is bundled and uploaded by [upload-source.sh](/Users/umairansari/projects/gpu-compute-framework/infrastructure/scripts/upload-source.sh). Remote runners then do one of three things:

- use an embedded prebuilt `compute` binary
- reuse a cached build keyed by the bundle `sourceHash`
- build `compute` on-instance if no cache or prebuilt binary exists

That design keeps most C++ changes out of the AMI lifecycle.
