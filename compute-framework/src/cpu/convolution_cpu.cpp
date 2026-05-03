#include "framework/cpu_ops.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <sstream>
#include <thread>
#include <vector>

namespace
{
    constexpr IndexType kMinOutputElementsPerWorker = 4096;
    constexpr std::chrono::seconds kHeartbeatInterval(60);
    constexpr std::chrono::minutes kDetailedInterval(5);

    /**
     *
     * N = batch size (number of samples/images)
     * C = channels (e.g., RGB = 3, feature maps in deeper layers)
     * H = height
     * W = width
     *
     */
    // Convert 4D NCHW coordinates into a flat 1D index for contiguous storage.
    IndexType flatten_nchw(
        const IndexType n,
        const IndexType c,
        const IndexType h,
        const IndexType w,
        const IndexType channels,
        const IndexType height,
        const IndexType width)
    {
        return (((n * channels + c) * height + h) * width + w);
    }

    void log_progress(
        const IndexType completed_elements,
        const IndexType total_elements,
        const std::chrono::steady_clock::time_point op_start,
        const bool detailed)
    {
        std::ostringstream heartbeat;
        heartbeat << "KERNEL_BENCH_PROGRESS "
                  << "op=convolution backend=cpu status=running heartbeat=1 "
                  << "elements_done=" << completed_elements << " total_elements=" << total_elements;
        std::cout << heartbeat.str() << std::endl;

        if (!detailed)
        {
            return;
        }

        const auto now = std::chrono::steady_clock::now();
        const double completed = static_cast<double>(completed_elements);
        const double total = static_cast<double>(total_elements);
        const double percent = (total > 0.0) ? (completed * 100.0 / total) : 100.0;

        const auto elapsed_ms =
            std::chrono::duration_cast<std::chrono::milliseconds>(now - op_start).count();
        const double elapsed_s = static_cast<double>(elapsed_ms) / 1000.0;
        const double elements_per_s = (elapsed_s > 0.0) ? (completed / elapsed_s) : 0.0;
        const double remaining_elements = total - completed;
        const double eta_s = (elements_per_s > 0.0) ? (remaining_elements / elements_per_s) : -1.0;

        std::ostringstream detail;
        detail.setf(std::ios::fixed);
        detail.precision(2);
        detail << "KERNEL_BENCH_PROGRESS "
               << "op=convolution backend=cpu status=running detailed=1 "
               << "elements_done=" << completed_elements
               << " total_elements=" << total_elements
               << " percent=" << percent
               << " elapsed_s=" << elapsed_s
               << " eta_s=" << eta_s;
        std::cout << detail.str() << std::endl;
    }

    template <typename Fn>
    void parallel_for_range_with_progress(
        const IndexType length,
        const IndexType total_elements,
        Fn fn)
    {
        if (length == 0)
        {
            return;
        }

        const auto op_start = std::chrono::steady_clock::now();
        const unsigned int hardware_threads = std::thread::hardware_concurrency();
        const IndexType available_workers = static_cast<IndexType>(hardware_threads == 0 ? 1 : hardware_threads);
        const IndexType useful_workers = std::max<IndexType>(1, (length + kMinOutputElementsPerWorker - 1) / kMinOutputElementsPerWorker);
        const IndexType worker_count = std::min<IndexType>(available_workers, useful_workers);

        if (worker_count == 1)
        {
            fn(0, length);
            return;
        }

        std::atomic<IndexType> completed_elements{0};
        std::condition_variable progress_cv;
        std::mutex progress_mutex;
        const IndexType chunk = (length + worker_count - 1) / worker_count;
        std::vector<std::thread> workers;
        workers.reserve(static_cast<std::size_t>(worker_count));

        for (IndexType worker = 0; worker < worker_count; ++worker)
        {
            const IndexType begin = worker * chunk;
            const IndexType end = std::min<IndexType>(length, begin + chunk);
            if (begin >= end)
            {
                continue;
            }

            workers.emplace_back([&, begin, end]()
                                 {
                                     const IndexType completed = fn(begin, end);
                                     const IndexType done = completed_elements.fetch_add(completed, std::memory_order_relaxed) + completed;
                                     if (done >= total_elements)
                                     {
                                         progress_cv.notify_one();
                                     }
                                 });
        }

        auto next_heartbeat = op_start + kHeartbeatInterval;
        auto next_detailed = op_start + kDetailedInterval;
        std::unique_lock<std::mutex> progress_lock(progress_mutex);
        while (completed_elements.load(std::memory_order_relaxed) < total_elements)
        {
            const auto now = std::chrono::steady_clock::now();
            if (now >= next_heartbeat)
            {
                const IndexType elements_done = completed_elements.load(std::memory_order_relaxed);
                const bool detailed = now >= next_detailed;
                log_progress(elements_done, total_elements, op_start, detailed);
                next_heartbeat = now + kHeartbeatInterval;
                if (detailed)
                {
                    next_detailed = now + kDetailedInterval;
                }
            }

            progress_cv.wait_until(progress_lock, next_heartbeat, [&]()
                                   { return completed_elements.load(std::memory_order_relaxed) >= total_elements; });
        }
        progress_lock.unlock();

        for (auto &worker : workers)
        {
            worker.join();
        }
    }
} // namespace

StatusCode cpu_convolution_op(
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

    const IndexType spatial_size = h_out * w_out;
    const IndexType channel_plane_count = out_n * out_c;

    parallel_for_range_with_progress(channel_plane_count, out_size, [&](const IndexType begin, const IndexType end)
                                     {
        IndexType completed = 0;
        for (IndexType plane = begin; plane < end; ++plane)
        {
            const IndexType batch = plane / out_c;
            const IndexType out_channel = plane % out_c;
            const IndexType input_batch_offset = batch * c_in * h_in * w_in;
            const IndexType output_plane_offset = plane * spatial_size;
            const IndexType filter_out_offset = out_channel * c_in * k_h * k_w;

            for (IndexType out_y = 0; out_y < h_out; ++out_y)
            {
                const int input_y_origin =
                    static_cast<int>(out_y * params.stride_height) -
                    static_cast<int>(params.padding_height);
                const IndexType kernel_y_begin =
                    input_y_origin < 0 ? static_cast<IndexType>(-input_y_origin) : 0;
                const IndexType kernel_y_end = std::min<IndexType>(
                    k_h,
                    h_in > static_cast<IndexType>(std::max(0, input_y_origin))
                        ? h_in - static_cast<IndexType>(std::max(0, input_y_origin)) + kernel_y_begin
                        : kernel_y_begin);

                for (IndexType out_x = 0; out_x < w_out; ++out_x)
                {
                    const int input_x_origin =
                        static_cast<int>(out_x * params.stride_width) -
                        static_cast<int>(params.padding_width);
                    const IndexType kernel_x_begin =
                        input_x_origin < 0 ? static_cast<IndexType>(-input_x_origin) : 0;
                    const IndexType kernel_x_end = std::min<IndexType>(
                        k_w,
                        w_in > static_cast<IndexType>(std::max(0, input_x_origin))
                            ? w_in - static_cast<IndexType>(std::max(0, input_x_origin)) + kernel_x_begin
                            : kernel_x_begin);

                    float sum = 0.0f;

                    for (IndexType in_channel = 0; in_channel < c_in; ++in_channel)
                    {
                        const IndexType input_channel_offset = input_batch_offset + in_channel * h_in * w_in;
                        const IndexType filter_channel_offset = filter_out_offset + in_channel * k_h * k_w;

                        for (IndexType kernel_y = kernel_y_begin; kernel_y < kernel_y_end; ++kernel_y)
                        {
                            const IndexType input_y = static_cast<IndexType>(input_y_origin + static_cast<int>(kernel_y));
                            const IndexType input_row_offset = input_channel_offset + input_y * w_in;
                            const IndexType filter_row_offset = filter_channel_offset + kernel_y * k_w;
                            const IndexType input_x_start = static_cast<IndexType>(input_x_origin + static_cast<int>(kernel_x_begin));

                            for (IndexType kernel_x = kernel_x_begin; kernel_x < kernel_x_end; ++kernel_x)
                            {
                                const IndexType input_idx = input_row_offset + input_x_start + (kernel_x - kernel_x_begin);
                                const IndexType filter_idx = filter_row_offset + kernel_x;
                                sum += input[input_idx] * filter[filter_idx];
                            }
                        }
                    }

                    out[output_plane_offset + out_y * w_out + out_x] = sum;
                }
            }

            completed += spatial_size;
        }

        return completed;
    });

    return StatusCode::Success;
}
