# Workflows

This directory contains the GitHub Actions deployment workflows for KernelBench.

## deploy-infrastructure.yml

Purpose:

- install infrastructure dependencies
- build and deploy the CDK stack
- upload the latest source bundle to the artifact bucket

Important details:

- uses GitHub OIDC to assume the AWS deploy role
- optionally uses `KERNELBENCH_GPU_AMI_ID` when provided
- if `KERNELBENCH_GPU_AMI_ID` is not set, CDK looks up the latest x86_64 NVIDIA GPU-Optimized AMI from AWS Marketplace

Operational effect:

- benchmark/infrastructure changes redeploy infra and upload a new source bundle
- GPU runner launches from your configured NVIDIA AMI, or the latest Marketplace NVIDIA GPU-Optimized AMI fallback (no custom AMI bake step)

## deploy-frontend.yml

Purpose:

- install frontend dependencies
- build the SPA
- sync `frontend/dist` to the frontend S3 bucket
- invalidate CloudFront

Operational effect:

- frontend-only changes can ship without touching the infrastructure stack

## Required AWS/Repo Inputs

Examples used by the workflows:

- `AWS_DEPLOY_ROLE_ARN`
- `KERNELBENCH_ORIGIN_VERIFY_SECRET`
- `AWS_REGION`
- `KERNELBENCH_GITHUB_REPO`
- `KERNELBENCH_GITHUB_BRANCH`
- `KERNELBENCH_GPU_AMI_ID` (optional override)

## Local Equivalent Commands

Infrastructure:

```bash
cd infrastructure
npm run build
npm run deploy
./infrastructure/scripts/upload-source.sh <artifact-bucket>
```

Frontend:

```bash
./infrastructure/scripts/upload-frontend.sh <frontend-bucket-name> ./frontend
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths '/*'
```
