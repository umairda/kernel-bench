# Infrastructure

This directory contains the AWS control plane for KernelBench.

## Purpose

The infrastructure layer is responsible for:

- serving the frontend through CloudFront
- exposing a single JSON-RPC API at `POST /api`
- orchestrating CPU and GPU EC2 benchmark runners through Step Functions and SSM
- queueing runner work so CPU and GPU execute one run at a time
- storing live run state and historical benchmark data in DynamoDB
- storing source bundles and benchmark artifacts in S3

## Architecture Decisions

- JSON-RPC over HTTP: the backend intentionally exposes one route, `POST /api`, and dispatches methods in Lambda rather than mixing many REST-style paths.
- Long-lived runner instances: CPU and GPU EC2 instances are provisioned once and started/stopped around work instead of launching a fresh instance for every run.
- Per-runner queues: CPU and GPU each execute one run at a time while additional work waits in DynamoDB.
- Step Functions workflow: startup, SSM dispatch, polling, finalization, and failure cleanup are coordinated by a state machine.
- Dedicated history table: chart-friendly historical data is stored separately from live run state so UI queries stay simple.
- Source bundles, not source-only uploads: uploads now include a manifest and can optionally embed prebuilt binaries.
- CUDA-ready GPU image: the GPU runner uses a CUDA-ready AWS image by default, or an explicit AMI override when supplied.

## High-Level Flow

```text
Browser
  -> CloudFront
      -> S3 frontend bucket
      -> API Gateway HTTP API
          -> Lambda JSON-RPC handler
              -> DynamoDB runs table, runner locks, and queues
              -> DynamoDB history table
              -> Step Functions run workflow
                  -> EC2 + SSM
              -> S3 artifact bucket
```

## JSON-RPC Methods

The dispatcher lives in [rpc_handler.ts](/Users/umairansari/projects/gpu-compute-framework/infrastructure/lambda/rpc_handler.ts).

Current methods:

- `startRun`
- `deleteQueuedRun`
- `reorderQueuedRuns`
- `getRunStatus`
- `listInProgressRuns`
- `getInstanceStates`
- `historyVector`
- `historyMatmul`
- `historyConvolution`
- `runHistory`

The supporting Lambda modules live under [lambda](/Users/umairansari/projects/gpu-compute-framework/infrastructure/lambda).

## Data Model

### Runs Table

Purpose:

- live orchestration state
- per-runner queue state
- runner lock records
- startup and benchmark progress tracking
- run status polling

Primary key:

- `runId`

Special lock records:

- `RUNNER_LOCK#cpu`
- `RUNNER_LOCK#gpu`

### History Table

Purpose:

- chart-friendly historical performance queries
- normalized vector, matrix, and convolution performance points

Primary key:

- `seriesKey`
- `completedAtRunId`

## Runner Strategy

### CPU Runner

- default instance type: `c7i.8xlarge`
- standard Amazon Linux 2023 image

### GPU Runner

- default instance type: `g6e.xlarge`
- either:
  - default Amazon-owned Deep Learning Base AMI with Single CUDA on Ubuntu 24.04
  - or an explicit AMI override when `KERNELBENCH_GPU_AMI_ID` / `gpuAmiId` is supplied

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

For GPU runs, the remote runner performs one tiny CUDA warmup command before timing the requested benchmark operations. This pays first-use CUDA driver/context startup separately and writes it as `phaseDurationsMs.gpuWarmupMs` in `performance.json`, so the first measured operation is not distorted by CUDA initialization.

## GPU AMI Strategy

The current default strategy is to use a CUDA-ready AWS image and keep benchmark source changes in the source bundle.

If `KERNELBENCH_GPU_AMI_ID` / `gpuAmiId` is provided, the stack uses that image for the GPU runner. If not, CDK looks up the default AWS image configured in [gpu-benchmark-stack.ts](/Users/umairansari/projects/gpu-compute-framework/infrastructure/lib/gpu-benchmark-stack.ts).

[prepare_gpu_ami.sh](/Users/umairansari/projects/gpu-compute-framework/infrastructure/scripts/prepare_gpu_ami.sh) still exists as an operational helper, but the default GitHub deploy workflow no longer bakes a custom GPU AMI.

## Security Model

- CloudFront fronts both frontend and API traffic.
- CloudFront injects `x-kernelbench-origin` when proxying to the API origin.
- The JSON-RPC Lambda verifies that secret header.
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
- `lambda/run_queue.ts`
  Per-runner queue dispatch, runner locks, and idle-stop coordination.
- `lambda/benchmark_registry.ts`
  Benchmark validation, S3 key generation, and timeout estimation.
- `lambda/instance_actions/run_workflow_step.ts`
  Step Functions task implementation for startup, dispatch, polling, finalization, and failure handling.
- `lambda/history.ts`
  History table normalization and query logic.
- `scripts/upload-source.sh`
  Repo/source bundle uploader.
- `scripts/upload-frontend.sh`
  Frontend build + S3 sync helper.
- `scripts/remote_kernel_benchmark.sh`
  On-instance benchmark execution.
- `scripts/prepare_gpu_ami.sh`
  Optional AMI preparation helper, not part of the default deploy workflow.

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
npm run deploy -- -c cpuInstanceType=c7i.8xlarge -c gpuInstanceType=g6e.xlarge -c sshCidr=203.0.113.10/32
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
- The default deploy workflow uses the configured CUDA-ready GPU image instead of baking a custom AMI.
- Existing runner-local caches are lost when the EC2 instance is replaced.
