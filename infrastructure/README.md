# Infrastructure

This directory contains the AWS control plane for KernelBench.

## Purpose

The infrastructure layer is responsible for:

- serving the frontend through CloudFront
- exposing a single JSON-RPC API at `POST /rpc`
- orchestrating CPU and GPU EC2 benchmark runners through SSM
- storing live run state and historical benchmark data in DynamoDB
- storing source bundles and benchmark artifacts in S3

## Architecture Decisions

- JSON-RPC over HTTP: the backend intentionally exposes one route, `POST /rpc`, and dispatches methods in Lambda rather than mixing many REST-style paths.
- Long-lived runner instances: CPU and GPU EC2 instances are provisioned once and started/stopped around work instead of launching a fresh instance for every run.
- Dedicated history table: chart-friendly historical data is stored separately from live run state so UI queries stay simple.
- Source bundles, not source-only uploads: uploads now include a manifest and can optionally embed prebuilt binaries.
- Prepared GPU AMIs: the deploy pipeline can bake a GPU-ready AMI with CUDA/tooling, publish its ID to SSM, and redeploy the runner to use that image.

## High-Level Flow

```text
Browser
  -> CloudFront
      -> S3 frontend bucket
      -> API Gateway HTTP API
          -> Lambda JSON-RPC handler
              -> DynamoDB runs table
              -> DynamoDB history table
              -> EC2 + SSM
              -> S3 artifact bucket
```

## JSON-RPC Methods

The dispatcher lives in [rpc_handler.ts](/Users/umairansari/projects/gpu-compute-framework/infrastructure/lambda/rpc_handler.ts).

Current methods:

- `startRun`
- `getRunStatus`
- `listInProgressRuns`
- `getInstanceStates`
- `historyVector`
- `historyMatmul`
- `historyConvolution`

The supporting Lambda modules live under [lambda](/Users/umairansari/projects/gpu-compute-framework/infrastructure/lambda).

## Data Model

### Runs Table

Purpose:

- live orchestration state
- lock and progress tracking
- run status polling

Primary key:

- `runId`

### History Table

Purpose:

- chart-friendly historical performance queries
- normalized vector, matrix, and convolution performance points

Primary key:

- `seriesKey`
- `completedAtRunId`

## Runner Strategy

### CPU Runner

- default instance type: `c7i.xlarge`
- standard Amazon Linux 2023 image

### GPU Runner

- default instance type: `g4dn.xlarge`
- either:
  - default Amazon Linux 2023 image with best-effort runtime GPU setup
  - or a prepared custom AMI when `KERNELBENCH_GPU_AMI_ID` / `gpuAmiId` is supplied

### Why Both Still Use Source Bundles

AMI contents are for environment setup, not normal benchmark source changes. C++ changes are reflected through the uploaded source bundle, cached builds, or embedded prebuilt binaries.

## Source Bundle Strategy

[upload-source.sh](/Users/umairansari/projects/gpu-compute-framework/infrastructure/scripts/upload-source.sh) packages the repo and writes a manifest under `.kernel-bench-bundle/manifest.json`.

The bundle may include:

- source tree
- `sourceHash`
- optional prebuilt CPU binary
- optional prebuilt GPU binary

[remote_kernel_benchmark.sh](/Users/umairansari/projects/gpu-compute-framework/infrastructure/scripts/remote_kernel_benchmark.sh) then chooses the fastest path available:

- use embedded prebuilt binary
- reuse cached binary for the same `sourceHash`
- build locally on the runner if needed

## GPU AMI Strategy

[prepare_gpu_ami.sh](/Users/umairansari/projects/gpu-compute-framework/infrastructure/scripts/prepare_gpu_ami.sh) is the bootstrap script used when baking a prepared GPU AMI.

The deploy workflow can:

- detect AMI-affecting changes
- launch a temporary GPU AMI builder instance
- install drivers, CUDA, and build tooling
- validate `nvidia-smi`, `nvcc`, and `cmake`
- create an AMI
- publish the AMI ID to SSM
- deploy the stack so the GPU runner instance is replaced with the latest baked image

Default SSM parameter:

- `/kernelbench/gpu/latest-ami-id`

## Security Model

- CloudFront fronts both frontend and API traffic.
- CloudFront injects `x-kernelbench-origin` when proxying to the API origin.
- The JSON-RPC Lambda verifies that secret header.
- Optional local override:
  - `KernelBenchAllowLocalDevOrigin=true`
  - allows `Origin: http://localhost:5173`
- Frontend bucket is private behind CloudFront OAC.
- EC2 access is through SSM; SSH is optional and CIDR-restricted.

## Important Files

- `bin/gpu-compute-infra.ts`
  CDK entrypoint and context/env resolution.
- `lib/gpu-benchmark-stack.ts`
  Main stack definition.
- `lambda/common.ts`
  JSON-RPC helpers, error envelopes, and origin verification.
- `lambda/rpc_handler.ts`
  Method dispatch surface.
- `lambda/history.ts`
  History table normalization and query logic.
- `scripts/upload-source.sh`
  Repo/source bundle uploader.
- `scripts/upload-frontend.sh`
  Frontend build + S3 sync helper.
- `scripts/remote_kernel_benchmark.sh`
  On-instance benchmark execution.
- `scripts/prepare_gpu_ami.sh`
  AMI bake bootstrap.

## Commands

Install dependencies:

```bash
cd infrastructure
npm install
```

Build:

```bash
npm run build
```

Synth:

```bash
npm run synth
```

Deploy:

```bash
npm run deploy
```

Optional deploy context:

```bash
npm run deploy -- -c cpuInstanceType=c7i.xlarge -c gpuInstanceType=g5.xlarge -c sshCidr=203.0.113.10/32
```

Manual source bundle upload:

```bash
./infrastructure/scripts/upload-source.sh <artifact-bucket>
```

With embedded prebuilt binaries:

```bash
./infrastructure/scripts/upload-source.sh <artifact-bucket> kernel-bench/source/latest.tar.gz --cpu-binary /path/to/cpu/compute --gpu-binary /path/to/gpu/compute
```

Manual frontend upload:

```bash
./infrastructure/scripts/upload-frontend.sh <frontend-bucket-name> ./frontend
```

## Outputs To Know

- `KernelBenchArtifactBucketName`
- `KernelBenchFrontendBucketName`
- `KernelBenchCloudFrontDomain`
- `KernelBenchGpuInstanceId`
- `KernelBenchRunnerInstanceProfileName`
- `KernelBenchRunsTableName`
- `KernelBenchHistoryTableName`

## Notes

- The CDK app still emits a DynamoDB `pointInTimeRecovery` deprecation warning during synth.
- The GPU bake workflow only runs for environment/toolchain-affecting changes, not every `.cpp` edit.
- Existing runner-local caches are lost when the EC2 instance is replaced during AMI roll-forward.
