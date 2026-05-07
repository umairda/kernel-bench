#include <cstddef>
#include <cuda_runtime.h>
#include "framework/gpu_ops.hpp"
#include "framework/cuda_utils.cuh"

namespace
{
// Naive CUDA convolution kernel in NCHW layout.
// Each thread computes exactly one output element out[idx], where idx maps to:
//   (batch, out_channel, out_y, out_x).
__global__ void convolution2d_nchw_kernel(
    const float *input,
    const float *filter,
    float *out,
    const IndexType n,
    const IndexType c_in,
    const IndexType h_in,
    const IndexType w_in,
    const IndexType c_out,
    const IndexType k_h,
    const IndexType k_w,
    const IndexType h_out,
    const IndexType w_out,
    const IndexType stride_h,
    const IndexType stride_w,
    const IndexType padding_h,
    const IndexType padding_w)
{
    const IndexType idx = static_cast<IndexType>(blockIdx.x) * blockDim.x + threadIdx.x;
    const IndexType out_size = n * c_out * h_out * w_out;
    if (idx >= out_size)
    {
        return;
    }

    // Decode flat output index back to 4D coordinates (N, C_out, H_out, W_out).
    const IndexType out_x = idx % w_out;
    IndexType remaining = idx / w_out;
    const IndexType out_y = remaining % h_out;
    remaining /= h_out;
    const IndexType out_channel = remaining % c_out;
    const IndexType batch = remaining / c_out;

    float sum = 0.0f;
    // Same math as CPU version:
    // sum_{c_in, k_y, k_x} X[...] * W[...]
    for (IndexType in_channel = 0; in_channel < c_in; ++in_channel)
    {
        for (IndexType kernel_y = 0; kernel_y < k_h; ++kernel_y)
        {
            for (IndexType kernel_x = 0; kernel_x < k_w; ++kernel_x)
            {
                // Compute corresponding input coordinate for this output+kernel position.
                const int input_y =
                    static_cast<int>(out_y * stride_h + kernel_y) - static_cast<int>(padding_h);
                const int input_x =
                    static_cast<int>(out_x * stride_w + kernel_x) - static_cast<int>(padding_w);

                // Zero-padding behavior: out-of-bounds input contributes 0.
                if (input_y < 0 || input_x < 0 ||
                    input_y >= static_cast<int>(h_in) ||
                    input_x >= static_cast<int>(w_in))
                {
                    continue;
                }

                // Flat indexing for input tensor X[n, c_in, h, w].
                const IndexType input_idx =
                    (((batch * c_in + in_channel) * h_in + static_cast<IndexType>(input_y)) * w_in +
                     static_cast<IndexType>(input_x));
                // Flat indexing for filter tensor W[c_out, c_in, k_h, k_w].
                const IndexType filter_idx =
                    (((out_channel * c_in + in_channel) * k_h + kernel_y) * k_w + kernel_x);

                sum += input[input_idx] * filter[filter_idx];
            }
        }
    }

    out[idx] = sum;
}

} // namespace

StatusCode gpu_convolution_op(
    const ConvolutionParams &params,
    const std::vector<float> &input,
    const std::vector<float> &filter,
    std::vector<float> &out)
{
    if (params.input_shape.dims.size() != 4 ||
        params.filter_shape.dims.size() != 4 ||
        params.output_shape.dims.size() != 4)
    {
        return StatusCode::InvalidArgument;
    }

    const IndexType n = params.input_shape.dims[0];
    const IndexType c_in = params.input_shape.dims[1];
    const IndexType h_in = params.input_shape.dims[2];
    const IndexType w_in = params.input_shape.dims[3];

    const IndexType c_out = params.filter_shape.dims[0];
    const IndexType filter_c_in = params.filter_shape.dims[1];
    const IndexType k_h = params.filter_shape.dims[2];
    const IndexType k_w = params.filter_shape.dims[3];

    const IndexType out_n = params.output_shape.dims[0];
    const IndexType out_c = params.output_shape.dims[1];
    const IndexType h_out = params.output_shape.dims[2];
    const IndexType w_out = params.output_shape.dims[3];

    if (params.stride_height == 0 || params.stride_width == 0)
    {
        return StatusCode::InvalidArgument;
    }

    if (c_in != filter_c_in || out_n != n || out_c != c_out)
    {
        return StatusCode::InvalidArgument;
    }

    const IndexType expected_h_out =
        (h_in + 2 * params.padding_height < k_h)
            ? 0
            : ((h_in + 2 * params.padding_height - k_h) / params.stride_height + 1);
    const IndexType expected_w_out =
        (w_in + 2 * params.padding_width < k_w)
            ? 0
            : ((w_in + 2 * params.padding_width - k_w) / params.stride_width + 1);

    if (h_out != expected_h_out || w_out != expected_w_out)
    {
        return StatusCode::InvalidArgument;
    }

    const IndexType input_size = n * c_in * h_in * w_in;
    const IndexType filter_size = c_out * c_in * k_h * k_w;
    const IndexType out_size = out_n * out_c * h_out * w_out;

    if (input.size() != input_size || filter.size() != filter_size || out.size() != out_size)
    {
        return StatusCode::InvalidArgument;
    }

    if (out_size == 0)
    {
        return StatusCode::Success;
    }

    float *d_input = nullptr;
    float *d_filter = nullptr;
    float *d_out = nullptr;

    auto free_all = [&]()
    {
        cudaFree(d_input);
        cudaFree(d_filter);
        cudaFree(d_out);
    };

    const std::size_t input_bytes = input_size * sizeof(float);
    const std::size_t filter_bytes = filter_size * sizeof(float);
    const std::size_t out_bytes = out_size * sizeof(float);

    cudaError_t err = cudaMalloc(reinterpret_cast<void **>(&d_input), input_bytes);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "alloc-d_input");
        return cuda_utils::to_status_code(err);
    }

    err = cudaMalloc(reinterpret_cast<void **>(&d_filter), filter_bytes);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "alloc-d_filter");
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

    err = cudaMemcpy(d_input, input.data(), input_bytes, cudaMemcpyHostToDevice);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "copy-h2d-input");
        free_all();
        return cuda_utils::to_status_code(err);
    }

    err = cudaMemcpy(d_filter, filter.data(), filter_bytes, cudaMemcpyHostToDevice);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "copy-h2d-filter");
        free_all();
        return cuda_utils::to_status_code(err);
    }

    // 1D launch: one thread computes one output element.
    constexpr int kThreadsPerBlock = 256;
    const int blocks = cuda_utils::div_up(out_size, kThreadsPerBlock);

    convolution2d_nchw_kernel<<<blocks, kThreadsPerBlock>>>(
        d_input,
        d_filter,
        d_out,
        n,
        c_in,
        h_in,
        w_in,
        c_out,
        k_h,
        k_w,
        h_out,
        w_out,
        params.stride_height,
        params.stride_width,
        params.padding_height,
        params.padding_width);

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

    err = cudaMemcpy(out.data(), d_out, out_bytes, cudaMemcpyDeviceToHost);
    if (err != cudaSuccess)
    {
        cuda_utils::report_cuda_error(err, "copy-d2h");
        free_all();
        return cuda_utils::to_status_code(err);
    }

    free_all();
    return StatusCode::Success;
}
