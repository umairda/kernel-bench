#include <cstddef>
#include <cuda_runtime.h>
#include "framework/gpu_ops.hpp"
#include "framework/cuda_utils.cuh"

#include <chrono>
#include <iostream>
#include <sstream>

namespace
{
    __global__ void compute_row_kernel(
        const float *a,
        const float *b,
        IndexType a_rows,
        IndexType a_cols,
        IndexType b_cols,
        float *out)
    {
        IndexType row = blockIdx.y * blockDim.y + threadIdx.y;
        IndexType col = blockIdx.x * blockDim.x + threadIdx.x;

        if (row < a_rows && col < b_cols)
        {
            float sum = 0.0f;
            for (IndexType k = 0; k < a_cols; k++)
            {
                sum += a[row * a_cols + k] * b[k * b_cols + col];
            }
            out[row * b_cols + col] = sum;
        }
    }

} // namespace

StatusCode gpu_matmul_op(
    const MatrixMultiplyParams &params,
    const std::vector<float> &a,
    const std::vector<float> &b,
    std::vector<float> &out)
{
    IndexType a_rows = params.A_shape.rows,
              a_cols = params.A_shape.cols,
              b_rows = params.B_shape.rows,
              b_cols = params.B_shape.cols;

    if (a_cols != b_rows || a.size() != a_rows * a_cols || b.size() != b_rows * b_cols || out.size() != a_rows * b_cols)
    {
        return StatusCode::InvalidArgument;
    }

    const auto op_start = std::chrono::steady_clock::now();

    auto log_phase = [&](const char *phase, const char *detail)
    {
        const auto now = std::chrono::steady_clock::now();
        const auto elapsed_ms =
            std::chrono::duration_cast<std::chrono::milliseconds>(now - op_start).count();
        std::ostringstream message;
        message << "KERNEL_BENCH_PROGRESS "
                << "op=matmul backend=gpu status=running phase=" << phase
                << " elapsed_ms=" << elapsed_ms
                << " detail=\"" << detail << "\"";
        std::cout << message.str() << std::endl;
    };

    if (a_rows == 0 || a_cols == 0 || b_rows == 0 || b_cols == 0)
    {
        log_phase("done", "empty-shape fast path");
        return StatusCode::Success;
    }

    log_phase("allocating", "allocating device buffers");

    float *d_a = nullptr;
    float *d_b = nullptr;
    float *d_out = nullptr;

    // lambda to free gpu memory
    auto free_all = [&]()
    {
        cudaFree(d_a);
        cudaFree(d_b);
        cudaFree(d_out);
    };

    IndexType a_size = a_rows * a_cols,
              b_size = b_rows * b_cols,
              out_size = a_rows * b_cols;

    // bytes of gpu memory for each vector: a, b, out
    const std::size_t a_bytes = a_size * sizeof(float);
    const std::size_t b_bytes = b_size * sizeof(float);
    const std::size_t out_bytes = out_size * sizeof(float);

    // allocate gpu memory for each vector: a, b, out
    cudaError_t err = cudaMalloc(reinterpret_cast<void **>(&d_a), a_bytes);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "alloc-d_a");
        return cuda_utils::to_status_code(err);
    }

    err = cudaMalloc(reinterpret_cast<void **>(&d_b), b_bytes);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "alloc-d_b");
        free_all();
        return cuda_utils::to_status_code(err);
    }

    err = cudaMalloc(reinterpret_cast<void **>(&d_out), out_bytes);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "alloc-d_out");
        free_all();
        return cuda_utils::to_status_code(err);
    }

    log_phase("h2d", "copying A and B from host to device");

    // copy data from cpu memory to gpu memory
    err = cudaMemcpy(d_a, a.data(), a_bytes, cudaMemcpyHostToDevice);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "copy-h2d-a");
        free_all();
        return cuda_utils::to_status_code(err);
    }

    err = cudaMemcpy(d_b, b.data(), b_bytes, cudaMemcpyHostToDevice);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "copy-h2d-b");
        free_all();
        return cuda_utils::to_status_code(err);
    }

    // determine number of blocks based on output matrix size
    dim3 threads(16, 16);
    dim3 blocks(
        static_cast<unsigned int>((b_cols + threads.x - 1) / threads.x),
        static_cast<unsigned int>((a_rows + threads.y - 1) / threads.y));

    log_phase("kernel-launch", "launching matmul kernel");

    // Each thread computes one output matrix element
    compute_row_kernel<<<blocks, threads>>>(d_a, d_b, a_rows, a_cols, b_cols, d_out);

    // check if there were any errors while executing operation, free all gpu memory on error
    const StatusCode launch_status = cuda_utils::check_last_error();
    if (launch_status != StatusCode::Success)
    {
        free_all();
        return launch_status;
    }

    log_phase("kernel-sync", "waiting for kernel completion");

    const StatusCode sync_status = cuda_utils::synchronize_device();
    if (sync_status != StatusCode::Success)
    {
        free_all();
        return sync_status;
    }

    log_phase("d2h", "copying output from device to host");

    // copy output data from gpu to cpu, free all gpu memory if there was an error copying data
    err = cudaMemcpy(out.data(), d_out, out_bytes, cudaMemcpyDeviceToHost);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "copy-d2h");
        free_all();
        return cuda_utils::to_status_code(err);
    }

    // free all memory allocated on gpu
    free_all();

    log_phase("done", "matmul gpu operation completed");

    return StatusCode::Success;
}
