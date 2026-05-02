#include "framework/types.hpp"
#include "framework/ops.hpp"

#include <chrono>
#include <iostream>
#include <sstream>

namespace
{
constexpr std::chrono::seconds kHeartbeatInterval(60);
constexpr std::chrono::minutes kDetailedInterval(5);
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

    const auto op_start = std::chrono::steady_clock::now();
    auto next_heartbeat = op_start + kHeartbeatInterval;
    auto next_detailed = op_start + kDetailedInterval;

    for (IndexType rowA = 0; rowA < a_rows; rowA++)
    {
        for (IndexType colB = 0; colB < b_cols; colB++)
        {
            float sum = 0;
            for (IndexType colA = 0; colA < a_cols; colA++) // aka rowB
            {
                IndexType rowB = colA;

                sum += a[rowA * a_cols + colA] * b[rowB * b_cols + colB];
            }
            out[rowA * b_cols + colB] = sum;
        }

        const auto now = std::chrono::steady_clock::now();
        if (now >= next_heartbeat)
        {
            const double completed_rows = static_cast<double>(rowA + 1);
            const double total_rows = static_cast<double>(a_rows);
            const double percent = (total_rows > 0.0) ? (completed_rows * 100.0 / total_rows) : 100.0;

            const auto elapsed_ms =
                std::chrono::duration_cast<std::chrono::milliseconds>(now - op_start).count();
            const double elapsed_s = static_cast<double>(elapsed_ms) / 1000.0;
            const double rows_per_s = (elapsed_s > 0.0) ? (completed_rows / elapsed_s) : 0.0;
            const double remaining_rows = total_rows - completed_rows;
            const double eta_s = (rows_per_s > 0.0) ? (remaining_rows / rows_per_s) : -1.0;

            std::ostringstream heartbeat;
            heartbeat << "KERNEL_BENCH_PROGRESS "
                      << "op=matmul backend=cpu status=running heartbeat=1 "
                      << "rows_done=" << (rowA + 1) << " total_rows=" << a_rows;
            std::cout << heartbeat.str() << std::endl;

            if (now >= next_detailed)
            {
                std::ostringstream detail;
                detail.setf(std::ios::fixed);
                detail.precision(2);
                detail << "KERNEL_BENCH_PROGRESS "
                       << "op=matmul backend=cpu status=running detailed=1 "
                       << "rows_done=" << (rowA + 1)
                       << " total_rows=" << a_rows
                       << " percent=" << percent
                       << " elapsed_s=" << elapsed_s
                       << " eta_s=" << eta_s;
                std::cout << detail.str() << std::endl;
                next_detailed = now + kDetailedInterval;
            }

            next_heartbeat = now + kHeartbeatInterval;
        }
    }

    return StatusCode::Success;
}
