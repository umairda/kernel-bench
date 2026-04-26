# Benchmark Cases

This file defines the benchmark scenarios to run for CPU vs GPU comparisons.

## Global Benchmark Rules

- Warmup runs per case: `3`
- Measured runs per case: `20`
- Reported latency: `mean_ms`, `p50_ms`, `p95_ms`, `min_ms`, `max_ms`
- Also report operation status and backend used
- For GPU runs, report transfer and kernel time separately when available

## Vector Operation Cases

Operations:
- `add`
- `subtract`
- `multiply`
- `divide`

Sizes (vector length):
- `1_024`
- `4_096`
- `16_384`
- `65_536`
- `262_144`
- `1_048_576`
- `4_194_304`
- `16_777_216`

Backends:
- `cpu`
- `gpu`

Notes:
- Use deterministic data generation (fixed seed).
- Skip divide cases where denominator contains `0`.

## Matrix Multiply Cases

Case groups:
- Square:
  - `128x128 * 128x128`
  - `256x256 * 256x256`
  - `512x512 * 512x512`
  - `1024x1024 * 1024x1024`
  - `2048x2048 * 2048x2048`
- Rectangular:
  - `256x1024 * 1024x256`
  - `512x2048 * 2048x512`
  - `1024x4096 * 4096x1024`

Backends:
- `cpu`
- `gpu`

Notes:
- Validate output shape and output buffer size before timing.
- Use row-major contiguous buffers.

## Convolution Cases (NCHW)

Convolution config conventions:
- Input tensor shape: `[N, C_in, H, W]`
- Filter tensor shape: `[C_out, C_in, K_h, K_w]`
- Output shape computed from stride/padding

Case groups:
- Small:
  - `N=1, C_in=3, H=W=64, C_out=16, K=3x3, stride=1x1, pad=1x1`
  - `N=1, C_in=3, H=W=128, C_out=32, K=3x3, stride=1x1, pad=1x1`
- Medium:
  - `N=4, C_in=16, H=W=128, C_out=32, K=3x3, stride=1x1, pad=1x1`
  - `N=4, C_in=32, H=W=256, C_out=64, K=3x3, stride=1x1, pad=1x1`
- Stride variation:
  - `N=1, C_in=16, H=W=224, C_out=32, K=3x3, stride=2x2, pad=1x1`
- Kernel variation:
  - `N=1, C_in=16, H=W=224, C_out=32, K=5x5, stride=1x1, pad=2x2`

Backends:
- `cpu`
- `gpu`

## Output Format (CSV)

Recommended CSV header:

`op,backend,case_id,run_index,status,input_size,kernel_ms,transfer_ms,total_ms`

Example rows:

`vector_add,cpu,vec_1048576,0,Success,1048576,1.231,0.000,1.231`
`vector_add,gpu,vec_1048576,0,Success,1048576,0.145,0.622,0.767`

## Reporting Views

For each operation family, produce:

- CPU vs GPU latency chart over input size
- Speedup chart: `cpu_total_ms / gpu_total_ms`
- Transfer share chart: `transfer_ms / total_ms` (GPU only)

## Suggested Execution Order

1. Vector operations
2. Matrix multiply
3. Convolution

Run each group with CPU and GPU backends under the same data generation seed.
