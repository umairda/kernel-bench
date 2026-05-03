#include "framework/types.hpp"
#include "framework/ops.hpp"

#include <algorithm>
#include <atomic>
#include <thread>
#include <vector>

namespace
{
constexpr IndexType kMinElementsPerWorker = 262144;

template <typename Fn>
void parallel_for_range(const IndexType length, Fn fn)
{
    if (length == 0)
    {
        return;
    }

    const unsigned int hardware_threads = std::thread::hardware_concurrency();
    const IndexType available_workers = static_cast<IndexType>(hardware_threads == 0 ? 1 : hardware_threads);
    const IndexType useful_workers = std::max<IndexType>(1, (length + kMinElementsPerWorker - 1) / kMinElementsPerWorker);
    const IndexType worker_count = std::min<IndexType>(available_workers, useful_workers);

    if (worker_count == 1)
    {
        fn(0, length);
        return;
    }

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

        workers.emplace_back([=, &fn]()
                             { fn(begin, end); });
    }

    for (auto &worker : workers)
    {
        worker.join();
    }
}
} // namespace

StatusCode cpu_vector_op(const VectorOpParams &params, const std::vector<float> &a, const std::vector<float> &b, std::vector<float> &out)
{
    if (a.size() != params.length || b.size() != params.length || out.size() != params.length)
    {
        return StatusCode::InvalidArgument;
    }

    switch (params.op_type)
    {
    case VectorOperation::Add:
        parallel_for_range(params.length, [&](const IndexType begin, const IndexType end)
                           {
                               for (IndexType i = begin; i < end; ++i)
                               {
                                   out[i] = a[i] + b[i];
                               }
                           });
        break;
    case VectorOperation::Subtract:
        parallel_for_range(params.length, [&](const IndexType begin, const IndexType end)
                           {
                               for (IndexType i = begin; i < end; ++i)
                               {
                                   out[i] = a[i] - b[i];
                               }
                           });
        break;
    case VectorOperation::Multiply:
        parallel_for_range(params.length, [&](const IndexType begin, const IndexType end)
                           {
                               for (IndexType i = begin; i < end; ++i)
                               {
                                   out[i] = a[i] * b[i];
                               }
                           });
        break;
    case VectorOperation::Divide:
    {
        std::atomic<bool> has_zero{false};
        parallel_for_range(params.length, [&](const IndexType begin, const IndexType end)
                           {
                               for (IndexType i = begin; i < end; ++i)
                               {
                                   if (b[i] == 0.0f)
                                   {
                                       has_zero.store(true, std::memory_order_relaxed);
                                       return;
                                   }
                               }
                           });

        if (has_zero.load(std::memory_order_relaxed))
        {
            return StatusCode::InvalidArgument;
        }

        parallel_for_range(params.length, [&](const IndexType begin, const IndexType end)
                           {
                               for (IndexType i = begin; i < end; ++i)
                               {
                                   out[i] = a[i] / b[i];
                               }
                           });
        break;
    }
    default:
        return StatusCode::NotImplemented;
    }

    return StatusCode::Success;
}
