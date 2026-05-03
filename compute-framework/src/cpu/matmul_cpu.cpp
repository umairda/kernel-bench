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

namespace
{
constexpr std::chrono::seconds kHeartbeatInterval(60);
constexpr std::chrono::minutes kDetailedInterval(5);

float dot_product(const float *left, const float *right, const IndexType length)
{
    float sum0 = 0.0f;
    float sum1 = 0.0f;
    float sum2 = 0.0f;
    float sum3 = 0.0f;

    IndexType i = 0;
    for (; i + 3 < length; i += 4)
    {
        sum0 += left[i] * right[i];
        sum1 += left[i + 1] * right[i + 1];
        sum2 += left[i + 2] * right[i + 2];
        sum3 += left[i + 3] * right[i + 3];
    }

    float sum = sum0 + sum1 + sum2 + sum3;
    for (; i < length; ++i)
    {
        sum += left[i] * right[i];
    }

    return sum;
}

void log_progress(
    const IndexType completed_rows,
    const IndexType total_rows,
    const std::chrono::steady_clock::time_point op_start,
    const bool detailed)
{
    std::ostringstream heartbeat;
    heartbeat << "KERNEL_BENCH_PROGRESS "
              << "op=matmul backend=cpu status=running heartbeat=1 "
              << "rows_done=" << completed_rows << " total_rows=" << total_rows;
    std::cout << heartbeat.str() << std::endl;

    if (!detailed)
    {
        return;
    }

    const auto now = std::chrono::steady_clock::now();
    const double completed = static_cast<double>(completed_rows);
    const double total = static_cast<double>(total_rows);
    const double percent = (total > 0.0) ? (completed * 100.0 / total) : 100.0;

    const auto elapsed_ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(now - op_start).count();
    const double elapsed_s = static_cast<double>(elapsed_ms) / 1000.0;
    const double rows_per_s = (elapsed_s > 0.0) ? (completed / elapsed_s) : 0.0;
    const double remaining_rows = total - completed;
    const double eta_s = (rows_per_s > 0.0) ? (remaining_rows / rows_per_s) : -1.0;

    std::ostringstream detail;
    detail.setf(std::ios::fixed);
    detail.precision(2);
    detail << "KERNEL_BENCH_PROGRESS "
           << "op=matmul backend=cpu status=running detailed=1 "
           << "rows_done=" << completed_rows
           << " total_rows=" << total_rows
           << " percent=" << percent
           << " elapsed_s=" << elapsed_s
           << " eta_s=" << eta_s;
    std::cout << detail.str() << std::endl;
}
}

StatusCode cpu_matrix_multiply_op(
    const MatrixMultiplyParams &params,
    const std::vector<float> &a, // size = rows * cols
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

    if (a_rows == 0 || a_cols == 0 || b_cols == 0)
    {
        return StatusCode::Success;
    }

    const auto op_start = std::chrono::steady_clock::now();
    auto next_heartbeat = op_start + kHeartbeatInterval;
    auto next_detailed = op_start + kDetailedInterval;

    std::vector<float> b_transposed;
    try
    {
        b_transposed.assign(b_cols * b_rows, 0.0f);
    }
    catch (const std::bad_alloc &)
    {
        return StatusCode::OutOfMemory;
    }

    for (IndexType rowB = 0; rowB < b_rows; ++rowB)
    {
        for (IndexType colB = 0; colB < b_cols; ++colB)
        {
            b_transposed[colB * b_rows + rowB] = b[rowB * b_cols + colB];
        }
    }

    const unsigned int hardware_threads = std::thread::hardware_concurrency();
    const IndexType worker_count = std::min<IndexType>(
        a_rows,
        static_cast<IndexType>(hardware_threads == 0 ? 1 : hardware_threads));
    const IndexType rows_per_worker = (a_rows + worker_count - 1) / worker_count;
    std::atomic<IndexType> completed_rows{0};
    std::condition_variable progress_cv;
    std::mutex progress_mutex;
    std::vector<std::thread> workers;
    workers.reserve(static_cast<std::size_t>(worker_count));

    for (IndexType worker = 0; worker < worker_count; ++worker)
    {
        const IndexType row_begin = worker * rows_per_worker;
        const IndexType row_end = std::min<IndexType>(a_rows, row_begin + rows_per_worker);
        if (row_begin >= row_end)
        {
            continue;
        }

        workers.emplace_back([&, row_begin, row_end]()
        {
            for (IndexType rowA = row_begin; rowA < row_end; ++rowA)
            {
                const float *a_row = a.data() + rowA * a_cols;
                float *out_row = out.data() + rowA * b_cols;

                for (IndexType colB = 0; colB < b_cols; ++colB)
                {
                    const float *b_col = b_transposed.data() + colB * b_rows;
                    out_row[colB] = dot_product(a_row, b_col, a_cols);
                }

                const IndexType rows_done = completed_rows.fetch_add(1, std::memory_order_relaxed) + 1;
                if (rows_done == a_rows)
                {
                    progress_cv.notify_one();
                }
            }
        });
    }

    std::unique_lock<std::mutex> progress_lock(progress_mutex);
    while (completed_rows.load(std::memory_order_relaxed) < a_rows)
    {
        const auto now = std::chrono::steady_clock::now();
        if (now >= next_heartbeat)
        {
            const IndexType rows_done = completed_rows.load(std::memory_order_relaxed);
            const bool detailed = now >= next_detailed;
            log_progress(rows_done, a_rows, op_start, detailed);
            next_heartbeat = now + kHeartbeatInterval;
            if (detailed)
            {
                next_detailed = now + kDetailedInterval;
            }
        }

        progress_cv.wait_until(progress_lock, next_heartbeat, [&]()
                               { return completed_rows.load(std::memory_order_relaxed) >= a_rows; });
    }
    progress_lock.unlock();

    for (auto &worker : workers)
    {
        worker.join();
    }

    return StatusCode::Success;
}
