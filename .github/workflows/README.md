# Workflows

This directory contains the GitHub Actions deployment workflows for KernelBench.

## deploy-infrastructure.yml

Purpose:

- install infrastructure dependencies
- build and deploy the CDK stack
- conditionally bake a GPU AMI for environment/toolchain changes
- publish the latest GPU AMI ID to SSM
- upload the latest source bundle to the artifact bucket

Important details:

- uses GitHub OIDC to assume the AWS deploy role
- reads the latest GPU AMI ID from SSM and passes it to the CDK app through `KERNELBENCH_GPU_AMI_ID`
- only bakes a new AMI for selected paths such as:
  - `infrastructure/lib/gpu-benchmark-stack.ts`
  - `infrastructure/bin/gpu-compute-infra.ts`
  - `infrastructure/scripts/prepare_gpu_ami.sh`
  - `infrastructure/scripts/remote_kernel_benchmark.sh`
  - `compute-framework/CMakeLists.txt`

Operational effect:

- normal benchmark source changes usually redeploy infra and upload a new source bundle
- environment changes can replace the GPU runner with a newly baked AMI

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
- `KERNELBENCH_GPU_AMI_SSM_PARAMETER_NAME`
- `KERNELBENCH_GPU_AMI_BUILDER_INSTANCE_TYPE`

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
