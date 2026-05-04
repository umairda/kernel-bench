#include "framework/types.hpp"
#include "framework/ops.hpp"

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
    // Don’t create a new CPU worker thread unless there are at least ~256K vector elements worth of work.
    constexpr IndexType kMinElementsPerWorker = 262144; // 256 * 1024
    constexpr std::chrono::seconds kHeartbeatInterval(60);
    constexpr std::chrono::minutes kDetailedInterval(5);

    const char *op_name(const VectorOperation op)
    {
        switch (op)
        {
        case VectorOperation::Add:
            return "vector-add";
        case VectorOperation::Subtract:
            return "vector-subtract";
        case VectorOperation::Multiply:
            return "vector-multiply";
        case VectorOperation::Divide:
            return "vector-divide";
        default:
            return "vector-unknown";
        }
    }

    void log_progress(
        const char *operation,
        const IndexType completed_elements,
        const IndexType total_elements,
        const std::chrono::steady_clock::time_point op_start,
        const bool detailed)
    {
        std::ostringstream heartbeat;
        heartbeat << "KERNEL_BENCH_PROGRESS "
                  << "op=" << operation << " backend=cpu status=running heartbeat=1 "
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
               << "op=" << operation << " backend=cpu status=running detailed=1 "
               << "elements_done=" << completed_elements
               << " total_elements=" << total_elements
               << " percent=" << percent
               << " elapsed_s=" << elapsed_s
               << " eta_s=" << eta_s;
        std::cout << detail.str() << std::endl;
    }

    template <typename Fn>
    void parallel_for_range(const IndexType length, const char *operation, Fn fn)
    {
        if (length == 0)
        {
            return;
        }

        // How many hardware execution threads does this machine appear to support?
        const unsigned int hardware_threads = std::thread::hardware_concurrency();
        const IndexType available_workers = static_cast<IndexType>(hardware_threads == 0 ? 1 : hardware_threads);
        const IndexType useful_workers = std::max<IndexType>(1, (length + kMinElementsPerWorker - 1) / kMinElementsPerWorker);
        const IndexType worker_count = std::min<IndexType>(available_workers, useful_workers);

        if (worker_count == 1)
        {
            fn(0, length);
            return;
        }

        const auto op_start = std::chrono::steady_clock::now();
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

            // Create a thread that processes the range [begin, end), and store that thread so we can join it later.
            workers.emplace_back([&, begin, end]()
                                 {
                                     fn(begin, end);
                                     const IndexType completed = end - begin;
                                     const IndexType done = completed_elements.fetch_add(completed, std::memory_order_relaxed) + completed;
                                     if (done >= length)
                                     {
                                         progress_cv.notify_one();
                                     }
                                 });
        }

        auto next_heartbeat = op_start + kHeartbeatInterval;
        auto next_detailed = op_start + kDetailedInterval;
        std::unique_lock<std::mutex> progress_lock(progress_mutex);
        while (completed_elements.load(std::memory_order_relaxed) < length)
        {
            const auto now = std::chrono::steady_clock::now();
            if (now >= next_heartbeat)
            {
                const IndexType elements_done = completed_elements.load(std::memory_order_relaxed);
                const bool detailed = now >= next_detailed;
                log_progress(operation, elements_done, length, op_start, detailed);
                next_heartbeat = now + kHeartbeatInterval;
                if (detailed)
                {
                    next_detailed = now + kDetailedInterval;
                }
            }

            progress_cv.wait_until(progress_lock, next_heartbeat, [&]()
                                   { return completed_elements.load(std::memory_order_relaxed) >= length; });
        }
        progress_lock.unlock();

        for (auto &worker : workers)
        {
            worker.join();
        }
    }
} // namespace

StatusCode cpu_vector_op(
    const VectorOpParams &params,
    const std::vector<float> &a,
    const std::vector<float> &b,
    std::vector<float> &out,
    const bool validate_division)
{
    if (a.size() != params.length || b.size() != params.length || out.size() != params.length)
    {
        return StatusCode::InvalidArgument;
    }

    switch (params.op_type)
    {
    case VectorOperation::Add:
        parallel_for_range(params.length, op_name(params.op_type), [&](const IndexType begin, const IndexType end)
                           {
                               for (IndexType i = begin; i < end; ++i)
                               {
                                   out[i] = a[i] + b[i];
                               } });
        break;
    case VectorOperation::Subtract:
        parallel_for_range(params.length, op_name(params.op_type), [&](const IndexType begin, const IndexType end)
                           {
                               for (IndexType i = begin; i < end; ++i)
                               {
                                   out[i] = a[i] - b[i];
                               } });
        break;
    case VectorOperation::Multiply:
        parallel_for_range(params.length, op_name(params.op_type), [&](const IndexType begin, const IndexType end)
                           {
                               for (IndexType i = begin; i < end; ++i)
                               {
                                   out[i] = a[i] * b[i];
                               } });
        break;
    case VectorOperation::Divide:
    {
        if (validate_division)
        {
            std::atomic<bool> has_zero{false};
            parallel_for_range(params.length, op_name(params.op_type), [&](const IndexType begin, const IndexType end)
                               {
                                   for (IndexType i = begin; i < end; ++i)
                                   {
                                       if (b[i] == 0.0f)
                                       {
                                           has_zero.store(true, std::memory_order_relaxed);
                                           return;
                                       }
                                   } });

            if (has_zero.load(std::memory_order_relaxed))
            {
                return StatusCode::InvalidArgument;
            }
        }

        parallel_for_range(params.length, op_name(params.op_type), [&](const IndexType begin, const IndexType end)
                           {
                               for (IndexType i = begin; i < end; ++i)
                               {
                                   out[i] = a[i] / b[i];
                               } });
        break;
    }
    default:
        return StatusCode::NotImplemented;
    }

    return StatusCode::Success;
}
