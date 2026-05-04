# KernelBench

KernelBench is a full-stack CPU vs GPU benchmarking system.

It combines:

- a native C++/CUDA benchmark engine
- an AWS JSON-RPC control plane backed by Step Functions
- serialized CPU/GPU runner queues
- a React frontend for live runs, queue control, performance charts, and run history

## Repo Layout

- [compute-framework](./compute-framework)
  Native benchmark engine and CLI.
- [frontend](./frontend)
  Vite/React SPA for live runs and historical comparison.
- [infrastructure](./infrastructure)
  CDK stack, Lambda JSON-RPC backend, S3/DynamoDB/EC2 orchestration.
- [.github](./.github)
  GitHub Actions workflows for infrastructure and frontend deployment.

Each of those directories now has its own README with deeper architectural notes and usage.

## System Overview

```text
Frontend SPA
  -> CloudFront
      -> S3 static assets
      -> POST /api JSON-RPC API
          -> Lambda dispatcher
              -> DynamoDB runs, locks, queues, and history
              -> Step Functions run workflow
                  -> EC2 start/readiness checks
                  -> SSM command dispatch and polling
                  -> source bundle execution on CPU/GPU runners
              -> S3 artifact storage
                  -> compute-framework binary execution
```

## Key Decisions

- True JSON-RPC API exposed at `/api` instead of a larger REST-style route surface.
- One active run per runner, with queued work serialized independently for CPU and GPU.
- Step Functions own runner startup, SSM dispatch, polling, finalization, and failure handling.
- Separate live run state and chart-friendly historical data in DynamoDB.
- Source bundles carry normal C++/CUDA changes without requiring runner replacement.
- Runner-local build caches avoid recompiling unchanged source bundles when possible.
- GPU runners use a CUDA-ready AMI by default, with an optional explicit AMI override.
- A benchmark registry keeps validation, labels, S3 parameter keys, and timeout estimates centralized.
- Lazy-loaded Performance and History views keep the default Benchmark screen lighter.

## Common Workflows

Frontend local dev:

```bash
cd frontend
npm install
npm run dev
```

Infrastructure build/synth:

```bash
cd infrastructure
npm install
npm run build
npm run synth
```

Native compute build:

```bash
cd compute-framework
cmake -S . -B build
cmake --build build --target compute
```

## Deployment Model

- Frontend pushes can build the SPA, sync to S3, and invalidate CloudFront.
- Infrastructure pushes deploy the CDK stack and upload the latest source bundle.
- Compute-framework pushes can run the separate source-bundle workflow without redeploying the whole stack.
- Normal C++/CUDA source changes are reflected through the uploaded source bundle rather than a new AMI.
- `KERNELBENCH_GPU_AMI_ID` can override the GPU AMI; otherwise CDK looks up the configured CUDA-ready AWS image.

## Documentation Map

- Start with this file for the big picture.
- Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the detailed end-to-end system architecture.
- Read [INSIGHTS.md](./INSIGHTS.md) for benchmark learnings and project takeaways.
- Read [compute-framework/README.md](./compute-framework/README.md) for native benchmark behavior.
- Read [frontend/README.md](./frontend/README.md) for UI and JSON-RPC usage.
- Read [infrastructure/README.md](./infrastructure/README.md) for AWS orchestration and runner strategy.
- Read [.github/GITHUB.md](./.github/GITHUB.md) for CI/CD behavior.
