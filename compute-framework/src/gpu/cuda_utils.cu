#include "framework/cuda_utils.cuh"

namespace cuda_utils
{
StatusCode to_status_code(const cudaError_t err)
{
    if (err == cudaSuccess)
    {
        return StatusCode::Success;
    }

    if (err == cudaErrorMemoryAllocation)
    {
        return StatusCode::OutOfMemory;
    }

    if (err == cudaErrorNoDevice || err == cudaErrorInsufficientDriver || err == cudaErrorDeviceUninitialized)
    {
        return StatusCode::BackendUnavailable;
    }

    return StatusCode::BackendUnavailable;
}

StatusCode check_last_error()
{
    return to_status_code(cudaGetLastError());
}

StatusCode synchronize_device()
{
    return to_status_code(cudaDeviceSynchronize());
}

int div_up(const IndexType n, const int block_size)
{
    if (block_size <= 0)
    {
        return 0;
    }
    return static_cast<int>((n + static_cast<IndexType>(block_size) - 1) / static_cast<IndexType>(block_size));
}

bool is_gpu_available()
{
    int count = 0;
    return get_device_count(count) == StatusCode::Success && count > 0;
}

StatusCode get_device_count(int &out_count)
{
    out_count = 0;
    const cudaError_t err = cudaGetDeviceCount(&out_count);
    return to_status_code(err);
}

StatusCode query_device_info(const int device_index, DeviceInfo &out_info)
{
    cudaDeviceProp prop{};
    const cudaError_t err = cudaGetDeviceProperties(&prop, device_index);
    if (err != cudaSuccess)
    {
        return to_status_code(err);
    }

    out_info.index = device_index;
    out_info.name = prop.name;
    out_info.major = prop.major;
    out_info.minor = prop.minor;
    out_info.total_global_mem_bytes = prop.totalGlobalMem;
    return StatusCode::Success;
}
} // namespace cuda_utils
