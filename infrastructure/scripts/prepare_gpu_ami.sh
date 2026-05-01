#!/usr/bin/env bash
set -euxo pipefail

dnf update -y
dnf install -y \
  git \
  cmake \
  gcc \
  gcc-c++ \
  make \
  tar \
  gzip \
  unzip \
  jq \
  awscli \
  python3 \
  python3-pip \
  amazon-cloudwatch-agent \
  kernel-devel \
  kernel-headers \
  dkms

dnf install -y dnf-plugins-core
dnf config-manager --add-repo https://developer.download.nvidia.com/compute/cuda/repos/amzn2023/x86_64/cuda-amzn2023.repo
dnf clean all
dnf makecache

dnf install -y \
  nvidia-driver-latest-dkms \
  cuda-compiler-12-6 \
  cuda-cudart-devel-12-6 \
  cuda-libraries-devel-12-6

modprobe nvidia || true
ln -sf /usr/local/cuda-12.6/bin/nvcc /usr/local/bin/nvcc

cat > /etc/profile.d/kernelbench-cuda.sh <<'EOF'
export PATH=/usr/local/cuda-12.6/bin:$PATH
export CUDAToolkit_ROOT=/usr/local/cuda-12.6
EOF

mkdir -p /opt/kernel-bench
chown ec2-user:ec2-user /opt/kernel-bench

touch /opt/kernel-bench/image-prepared
