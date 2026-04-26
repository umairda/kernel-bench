#include <cstddef>
#include <cuda_runtime.h>
#include "framework/gpu_ops.hpp"
#include "framework/cuda_utils.cuh"

namespace
{

    constexpr int kThreadsPerBlock = 256;

    // each kernal computes one output element per thread (guarded by idx < n)
    __global__ void vector_add_kernel(const float *a, const float *b, float *out, const std::size_t n)
    {
        const std::size_t idx = static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
        if (idx < n)
        {
            out[idx] = a[idx] + b[idx];
        }
    }

    __global__ void vector_subtract_kernel(const float *a, const float *b, float *out, const std::size_t n)
    {
        const std::size_t idx = static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
        if (idx < n)
        {
            out[idx] = a[idx] - b[idx];
        }
    }

    __global__ void vector_multiply_kernel(const float *a, const float *b, float *out, const std::size_t n)
    {
        const std::size_t idx = static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
        if (idx < n)
        {
            out[idx] = a[idx] * b[idx];
        }
    }

    __global__ void vector_divide_kernel(const float *a, const float *b, float *out, const std::size_t n)
    {
        const std::size_t idx = static_cast<std::size_t>(blockIdx.x) * blockDim.x + threadIdx.x;
        if (idx < n)
        {
            out[idx] = a[idx] / b[idx];
        }
    }

} // namespace

StatusCode gpu_vector_op(const VectorOpParams &params, const std::vector<float> &a, const std::vector<float> &b, std::vector<float> &out)
{
    if (a.size() != params.length || b.size() != params.length || out.size() != params.length)
    {
        return StatusCode::InvalidArgument;
    }

    if (params.op_type == VectorOperation::Divide)
    {
        for (IndexType i = 0; i < b.size(); ++i)
        {
            if (b[i] == 0.0f)
            {
                return StatusCode::InvalidArgument;
            }
        }
    }

    if (params.length == 0)
    {
        return StatusCode::Success;
    }

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

    // bytes of gpu memory to allocate for each vector
    const std::size_t bytes = params.length * sizeof(float);

    // allocate gpu memory for each vector: a, b, out
    cudaError_t err = cudaMalloc(reinterpret_cast<void **>(&d_a), bytes);
    if (err != cudaSuccess)
    {
        return cuda_utils::to_status_code(err);
    }

    err = cudaMalloc(reinterpret_cast<void **>(&d_b), bytes);
    if (err != cudaSuccess)
    {
        free_all();
        return cuda_utils::to_status_code(err);
    }

    err = cudaMalloc(reinterpret_cast<void **>(&d_out), bytes);
    if (err != cudaSuccess)
    {
        free_all();
        return cuda_utils::to_status_code(err);
    }

    // copy data from cpu memory to gpu memory
    err = cudaMemcpy(d_a, a.data(), bytes, cudaMemcpyHostToDevice);
    if (err != cudaSuccess)
    {
        free_all();
        return cuda_utils::to_status_code(err);
    }

    err = cudaMemcpy(d_b, b.data(), bytes, cudaMemcpyHostToDevice);
    if (err != cudaSuccess)
    {
        free_all();
        return cuda_utils::to_status_code(err);
    }

    // determine number of blocks based on vector length for kernel launch
    const int blocks = cuda_utils::div_up(params.length, kThreadsPerBlock);
    switch (params.op_type)
    {
    // launch selected kernel with blocks grid size and kThreadsPerBlock block size
    case VectorOperation::Add:
        vector_add_kernel<<<blocks, kThreadsPerBlock>>>(d_a, d_b, d_out, params.length);
        break;
    case VectorOperation::Subtract:
        vector_subtract_kernel<<<blocks, kThreadsPerBlock>>>(d_a, d_b, d_out, params.length);
        break;
    case VectorOperation::Multiply:
        vector_multiply_kernel<<<blocks, kThreadsPerBlock>>>(d_a, d_b, d_out, params.length);
        break;
    case VectorOperation::Divide:
        vector_divide_kernel<<<blocks, kThreadsPerBlock>>>(d_a, d_b, d_out, params.length);
        break;
    default:
        free_all();
        return StatusCode::NotImplemented;
    }

    // check if there were any errors while executing operation, free all gpu memory on error
    const StatusCode launch_status = cuda_utils::check_last_error();
    if (launch_status != StatusCode::Success)
    {
        free_all();
        return launch_status;
    }

    const StatusCode sync_status = cuda_utils::synchronize_device();
    if (sync_status != StatusCode::Success)
    {
        free_all();
        return sync_status;
    }

    // copy output data from gpu to cpu, free all gpu memory if there was an error copying data
    err = cudaMemcpy(out.data(), d_out, bytes, cudaMemcpyDeviceToHost);
    if (err != cudaSuccess)
    {
        free_all();
        return cuda_utils::to_status_code(err);
    }

    // free all memory allocated on gpu
    free_all();

    return StatusCode::Success;
}
