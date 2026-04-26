#pragma once

#include <cstddef>
#include <cuda_runtime.h>
#include <string>
#include "framework/types.hpp"

namespace cuda_utils
{
struct DeviceInfo
{
    int index = 0;
    std::string name;
    int major = 0;
    int minor = 0;
    std::size_t total_global_mem_bytes = 0;
};

StatusCode to_status_code(cudaError_t err);
StatusCode check_last_error();
StatusCode synchronize_device();

int div_up(IndexType n, int block_size);

bool is_gpu_available();
StatusCode get_device_count(int &out_count);
StatusCode query_device_info(int device_index, DeviceInfo &out_info);
} // namespace cuda_utils
