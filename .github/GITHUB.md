# GitHub Automation

This directory contains the CI/CD automation for KernelBench.

## Purpose

The workflows here are responsible for:

- deploying infrastructure changes
- uploading source bundles for remote benchmark execution
- baking and publishing new GPU AMIs when environment changes require it
- building and deploying the frontend SPA

## Layout

- [workflows](/Users/umairansari/projects/gpu-compute-framework/.github/workflows)
  GitHub Actions workflow definitions.

## Important Behavior

- Infrastructure and frontend deploy independently.
- The infrastructure workflow can also upload the latest benchmark source bundle.
- GPU AMI bakes are conditional, not automatic for every C++ change.

See [workflows/README.md](/Users/umairansari/projects/gpu-compute-framework/.github/workflows/README.md) for per-workflow details.
