# KernelBench

KernelBench is a full-stack CPU vs GPU benchmarking system.

It combines:

- a native C++/CUDA benchmark engine
- an AWS JSON-RPC control plane
- a React frontend for live runs and historical charts

## Repo Layout

- [compute-framework](/Users/umairansari/projects/gpu-compute-framework/compute-framework)
  Native benchmark engine and CLI.
- [frontend](/Users/umairansari/projects/gpu-compute-framework/frontend)
  Vite/React SPA for live runs and historical comparison.
- [infrastructure](/Users/umairansari/projects/gpu-compute-framework/infrastructure)
  CDK stack, Lambda JSON-RPC backend, S3/DynamoDB/EC2 orchestration.
- [.github](/Users/umairansari/projects/gpu-compute-framework/.github)
  GitHub Actions workflows for infrastructure and frontend deployment.

Each of those directories now has its own README with deeper architectural notes and usage.

## System Overview

```text
Frontend SPA
  -> CloudFront
      -> S3 static assets
      -> POST /rpc JSON-RPC API
          -> Lambda dispatcher
              -> DynamoDB runs/history
              -> EC2 + SSM benchmark runners
              -> S3 artifact storage
                  -> compute-framework binary execution
```

## Key Decisions

- True JSON-RPC API instead of REST-shaped `/rpc/*` routes.
- Separate live run state and historical chart data in DynamoDB.
- Long-lived CPU/GPU runner instances controlled with SSM.
- Source bundles for normal C++ changes.
- Prepared GPU AMIs for environment/toolchain startup speed.
- Lazy-loaded historical chart UI so the default run experience stays lighter.

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
- Infrastructure pushes can deploy the CDK stack, upload the latest source bundle, and conditionally bake/publish a new GPU AMI before redeploy.
- Normal C++ source changes are usually reflected through the uploaded source bundle rather than a new AMI.

## Documentation Map

- Start with this file for the big picture.
- Read [compute-framework/README.md](/Users/umairansari/projects/gpu-compute-framework/compute-framework/README.md) for native benchmark behavior.
- Read [frontend/README.md](/Users/umairansari/projects/gpu-compute-framework/frontend/README.md) for UI and JSON-RPC usage.
- Read [infrastructure/README.md](/Users/umairansari/projects/gpu-compute-framework/infrastructure/README.md) for AWS orchestration and AMI strategy.
- Read [.github/GITHUB.md](/Users/umairansari/projects/gpu-compute-framework/.github/GITHUB.md) for CI/CD behavior.
