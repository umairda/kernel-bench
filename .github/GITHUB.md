# GitHub Automation

This directory contains the CI/CD automation for KernelBench.

## Purpose

The workflows here are responsible for:

- deploying infrastructure changes
- uploading source bundles for remote benchmark execution
- building and deploying the frontend SPA

## Layout

- [workflows](./workflows)
  GitHub Actions workflow definitions.

## Important Behavior

- Infrastructure and frontend deploy independently.
- The infrastructure workflow can also upload the latest benchmark source bundle.
- GPU AMIs are supplied by `KERNELBENCH_GPU_AMI_ID` when needed; otherwise the CDK stack uses its configured CUDA-ready AWS image lookup.

See [workflows/README.md](./workflows/README.md) for per-workflow details.
