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

DRIVER_PKG=""
if dnf list --available nvidia-driver-latest-dkms >/dev/null 2>&1; then
  DRIVER_PKG="nvidia-driver-latest-dkms"
elif dnf list --available nvidia-driver >/dev/null 2>&1; then
  DRIVER_PKG="nvidia-driver"
elif dnf list --available kmod-nvidia-latest-dkms >/dev/null 2>&1; then
  DRIVER_PKG="kmod-nvidia-latest-dkms"
else
  echo "No supported NVIDIA driver package found in configured repos."
  dnf list --available '*nvidia*' || true
  exit 1
fi

dnf install -y \
  "${DRIVER_PKG}" \
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
