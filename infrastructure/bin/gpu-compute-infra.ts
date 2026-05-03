#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { KernelBenchStack } from '../lib/gpu-benchmark-stack';

const app = new cdk.App();

const sshCidr = app.node.tryGetContext('sshCidr') ?? '0.0.0.0/32';
const cpuInstanceType = app.node.tryGetContext('cpuInstanceType') ?? 'c7i.8xlarge';
const gpuInstanceType = app.node.tryGetContext('gpuInstanceType') ?? 'g6e.xlarge';
const gpuAmiId = app.node.tryGetContext('gpuAmiId') ?? process.env.KERNELBENCH_GPU_AMI_ID;
const sourceArchiveKey =
  app.node.tryGetContext('sourceArchiveKey') ?? 'kernel-bench/source/latest.tar.gz';

new KernelBenchStack(app, 'KernelBench-Infrastructure', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  sshCidr,
  cpuInstanceType,
  gpuInstanceType,
  gpuAmiId,
  sourceArchiveKey,
});
