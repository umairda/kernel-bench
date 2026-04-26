#include "framework/backend.hpp"
#include "framework/benchmark_lib.hpp"
#include "framework/runtime.hpp"
#include "framework/types.hpp"

#include <array>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <vector>

namespace
{
using benchmark::BenchmarkConfig;
using benchmark::CaseSummary;
using benchmark::ConvCase;
using benchmark::MatmulCase;
using benchmark::RunMetrics;
using benchmark::VectorCase;
using benchmark::build_vector_inputs;
using benchmark::fill_random;
using benchmark::summarize_runs;

const char *backend_name(const Backend backend)
{
    switch (backend)
    {
    case Backend::CPU:
        return "cpu";
    case Backend::GPU:
        return "gpu";
    case Backend::Auto:
        return "auto";
    case Backend::None:
        return "none";
    default:
        return "unknown_backend";
    }
}

const char *status_name(const StatusCode status)
{
    switch (status)
    {
    case StatusCode::Success:
        return "Success";
    case StatusCode::InvalidArgument:
        return "InvalidArgument";
    case StatusCode::OutOfMemory:
        return "OutOfMemory";
    case StatusCode::NotImplemented:
        return "NotImplemented";
    case StatusCode::BackendUnavailable:
        return "BackendUnavailable";
    default:
        return "UnknownStatus";
    }
}

const char *vector_op_name(const VectorOperation op)
{
    switch (op)
    {
    case VectorOperation::Add:
        return "vector_add";
    case VectorOperation::Subtract:
        return "vector_subtract";
    case VectorOperation::Multiply:
        return "vector_multiply";
    case VectorOperation::Divide:
        return "vector_divide";
    default:
        return "vector_unknown";
    }
}

StatusCode build_runtime_context(const Backend backend, const BenchmarkConfig &cfg, RuntimeContext &out_ctx)
{
    const ExecutionConfig exec_cfg{
        .backend_config = {
            .preferred = backend,
            .allow_fallback = !cfg.strict_backend,
        },
        .use_pinned_memory = false,
        .use_async_transfers = false,
    };
    return initialize_runtime(exec_cfg, out_ctx);
}

void print_run_csv_row(
    const char *op_name,
    const Backend backend,
    const std::int64_t case_size,
    const RunMetrics &run)
{
    std::cout << op_name << ","
              << backend_name(backend) << ","
              << case_size << ","
              << run.run_index << ","
              << status_name(run.status) << ","
              << std::fixed << std::setprecision(6)
              << run.kernel_ms << ","
              << run.transfer_ms << ","
              << run.total_ms << "\n";
}

void print_summary_row(
    const char *op_name,
    const Backend backend,
    const std::int64_t case_size,
    const CaseSummary &summary)
{
    std::cout << "summary,"
              << op_name << ","
              << backend_name(backend) << ","
              << case_size << ","
              << status_name(summary.overall_status) << ","
              << summary.success_count << ","
              << std::fixed << std::setprecision(6)
              << summary.mean_ms << ","
              << summary.p50_ms << ","
              << summary.p95_ms << ","
              << summary.min_ms << ","
              << summary.max_ms << ","
              << summary.throughput_items_per_second << "\n";
}

std::vector<RunMetrics> run_vector_benchmark_case(const VectorCase &c, const BenchmarkConfig &cfg)
{
    RuntimeContext ctx{};
    const StatusCode init = build_runtime_context(c.backend, cfg, ctx);
    if (init != StatusCode::Success)
    {
        return {RunMetrics{.run_index = -1, .status = init}};
    }

    std::vector<float> a;
    std::vector<float> b;
    build_vector_inputs(c, a, b);
    std::vector<float> out(c.length, 0.0f);

    const VectorOpParams params{
        .length = c.length,
        .op_type = c.op,
    };

    for (unsigned int i = 0; i < cfg.warmup_runs; ++i)
    {
        std::fill(out.begin(), out.end(), 0.0f);
        Result warmup{};
        const StatusCode s = dispatch_vector_operation(ctx, params, a, b, out, warmup);
        if (s != StatusCode::Success)
        {
            return {RunMetrics{
                .run_index = -1,
                .status = s,
                .kernel_ms = warmup.kernel_ms,
                .transfer_ms = warmup.transfer_ms,
                .total_ms = warmup.total_ms,
            }};
        }
    }

    std::vector<RunMetrics> runs;
    runs.reserve(cfg.measured_runs);
    for (unsigned int i = 0; i < cfg.measured_runs; ++i)
    {
        std::fill(out.begin(), out.end(), 0.0f);
        Result result{};
        const StatusCode s = dispatch_vector_operation(ctx, params, a, b, out, result);
        runs.push_back(RunMetrics{
            .run_index = static_cast<std::int64_t>(i),
            .status = s,
            .kernel_ms = result.kernel_ms,
            .transfer_ms = result.transfer_ms,
            .total_ms = result.total_ms,
        });
    }
    return runs;
}

std::vector<RunMetrics> run_matmul_benchmark_case(const MatmulCase &c, const BenchmarkConfig &cfg)
{
    RuntimeContext ctx{};
    const StatusCode init = build_runtime_context(c.backend, cfg, ctx);
    if (init != StatusCode::Success)
    {
        return {RunMetrics{.run_index = -1, .status = init}};
    }

    const MatrixMultiplyParams params{
        .A_shape = MatrixShape{c.a_rows, c.a_cols},
        .B_shape = MatrixShape{c.b_rows, c.b_cols},
        .output_shape = MatrixShape{c.a_rows, c.b_cols},
    };

    std::vector<float> a(c.a_rows * c.a_cols);
    std::vector<float> b(c.b_rows * c.b_cols);
    std::vector<float> out(c.a_rows * c.b_cols, 0.0f);
    fill_random(a, static_cast<std::uint32_t>(31337u + c.a_rows + c.a_cols));
    fill_random(b, static_cast<std::uint32_t>(41337u + c.b_rows + c.b_cols));

    for (unsigned int i = 0; i < cfg.warmup_runs; ++i)
    {
        std::fill(out.begin(), out.end(), 0.0f);
        Result warmup{};
        const StatusCode s = dispatch_matrix_multiply(ctx, params, a, b, out, warmup);
        if (s != StatusCode::Success)
        {
            return {RunMetrics{
                .run_index = -1,
                .status = s,
                .kernel_ms = warmup.kernel_ms,
                .transfer_ms = warmup.transfer_ms,
                .total_ms = warmup.total_ms,
            }};
        }
    }

    std::vector<RunMetrics> runs;
    runs.reserve(cfg.measured_runs);
    for (unsigned int i = 0; i < cfg.measured_runs; ++i)
    {
        std::fill(out.begin(), out.end(), 0.0f);
        Result result{};
        const StatusCode s = dispatch_matrix_multiply(ctx, params, a, b, out, result);
        runs.push_back(RunMetrics{
            .run_index = static_cast<std::int64_t>(i),
            .status = s,
            .kernel_ms = result.kernel_ms,
            .transfer_ms = result.transfer_ms,
            .total_ms = result.total_ms,
        });
    }
    return runs;
}

std::vector<RunMetrics> run_conv_benchmark_case(const ConvCase &c, const BenchmarkConfig &cfg)
{
    RuntimeContext ctx{};
    const StatusCode init = build_runtime_context(c.backend, cfg, ctx);
    if (init != StatusCode::Success)
    {
        return {RunMetrics{.run_index = -1, .status = init}};
    }

    const IndexType out_h =
        (c.h_in + 2 * c.pad_h < c.k_h) ? 0 : ((c.h_in + 2 * c.pad_h - c.k_h) / c.stride_h + 1);
    const IndexType out_w =
        (c.w_in + 2 * c.pad_w < c.k_w) ? 0 : ((c.w_in + 2 * c.pad_w - c.k_w) / c.stride_w + 1);

    const ConvolutionParams params{
        .input_shape = Tensor{.dims = {c.n, c.c_in, c.h_in, c.w_in}},
        .filter_shape = Tensor{.dims = {c.c_out, c.c_in, c.k_h, c.k_w}},
        .output_shape = Tensor{.dims = {c.n, c.c_out, out_h, out_w}},
        .stride_height = c.stride_h,
        .stride_width = c.stride_w,
        .padding_height = c.pad_h,
        .padding_width = c.pad_w,
    };

    std::vector<float> input(c.n * c.c_in * c.h_in * c.w_in);
    std::vector<float> filter(c.c_out * c.c_in * c.k_h * c.k_w);
    std::vector<float> out(c.n * c.c_out * out_h * out_w, 0.0f);
    fill_random(input, static_cast<std::uint32_t>(51511u + c.h_in + c.w_in));
    fill_random(filter, static_cast<std::uint32_t>(61511u + c.k_h + c.k_w));

    for (unsigned int i = 0; i < cfg.warmup_runs; ++i)
    {
        std::fill(out.begin(), out.end(), 0.0f);
        Result warmup{};
        const StatusCode s = dispatch_convolution(ctx, params, input, filter, out, warmup);
        if (s != StatusCode::Success)
        {
            return {RunMetrics{
                .run_index = -1,
                .status = s,
                .kernel_ms = warmup.kernel_ms,
                .transfer_ms = warmup.transfer_ms,
                .total_ms = warmup.total_ms,
            }};
        }
    }

    std::vector<RunMetrics> runs;
    runs.reserve(cfg.measured_runs);
    for (unsigned int i = 0; i < cfg.measured_runs; ++i)
    {
        std::fill(out.begin(), out.end(), 0.0f);
        Result result{};
        const StatusCode s = dispatch_convolution(ctx, params, input, filter, out, result);
        runs.push_back(RunMetrics{
            .run_index = static_cast<std::int64_t>(i),
            .status = s,
            .kernel_ms = result.kernel_ms,
            .transfer_ms = result.transfer_ms,
            .total_ms = result.total_ms,
        });
    }
    return runs;
}
} // namespace

int main()
{
    const BenchmarkConfig cfg{
        .warmup_runs = 3,
        .measured_runs = 20,
        .strict_backend = true,
    };

    std::cout << "op,backend,case_size,run_index,status,kernel_ms,transfer_ms,total_ms\n";
    std::cout << "summary_prefix,op,backend,case_size,status,success_count,mean_ms,p50_ms,p95_ms,min_ms,max_ms,throughput_items_per_s\n";

    const std::array<Backend, 2> backends{Backend::CPU, Backend::GPU};

    const std::array<VectorOperation, 4> vector_ops{
        VectorOperation::Add,
        VectorOperation::Subtract,
        VectorOperation::Multiply,
        VectorOperation::Divide,
    };
    const std::array<IndexType, 8> vector_sizes{
        1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216};

    for (const VectorOperation op : vector_ops)
    {
        for (const IndexType size : vector_sizes)
        {
            for (const Backend backend : backends)
            {
                const VectorCase c{
                    .op = op,
                    .length = size,
                    .backend = backend,
                };
                const std::vector<RunMetrics> runs = run_vector_benchmark_case(c, cfg);
                for (const RunMetrics &run : runs)
                {
                    print_run_csv_row(vector_op_name(op), backend, static_cast<std::int64_t>(size), run);
                }
                const CaseSummary summary = summarize_runs(runs, static_cast<double>(size));
                print_summary_row(vector_op_name(op), backend, static_cast<std::int64_t>(size), summary);
            }
        }
    }

    const std::array<MatmulCase, 4> matmul_cases{
        MatmulCase{.a_rows = 128, .a_cols = 128, .b_rows = 128, .b_cols = 128},
        MatmulCase{.a_rows = 256, .a_cols = 256, .b_rows = 256, .b_cols = 256},
        MatmulCase{.a_rows = 512, .a_cols = 512, .b_rows = 512, .b_cols = 512},
        MatmulCase{.a_rows = 256, .a_cols = 1024, .b_rows = 1024, .b_cols = 256},
    };

    for (const MatmulCase &base : matmul_cases)
    {
        for (const Backend backend : backends)
        {
            MatmulCase c = base;
            c.backend = backend;
            const std::int64_t case_size =
                static_cast<std::int64_t>(c.a_rows) * static_cast<std::int64_t>(c.a_cols) +
                static_cast<std::int64_t>(c.b_rows) * static_cast<std::int64_t>(c.b_cols);
            const std::vector<RunMetrics> runs = run_matmul_benchmark_case(c, cfg);
            for (const RunMetrics &run : runs)
            {
                print_run_csv_row("matmul", backend, case_size, run);
            }
            const double flops = 2.0 * static_cast<double>(c.a_rows) * static_cast<double>(c.a_cols) * static_cast<double>(c.b_cols);
            const CaseSummary summary = summarize_runs(runs, flops);
            print_summary_row("matmul", backend, case_size, summary);
        }
    }

    const std::array<ConvCase, 4> conv_cases{
        ConvCase{.n = 1, .c_in = 3, .h_in = 64, .w_in = 64, .c_out = 16, .k_h = 3, .k_w = 3, .stride_h = 1, .stride_w = 1, .pad_h = 1, .pad_w = 1},
        ConvCase{.n = 1, .c_in = 3, .h_in = 128, .w_in = 128, .c_out = 32, .k_h = 3, .k_w = 3, .stride_h = 1, .stride_w = 1, .pad_h = 1, .pad_w = 1},
        ConvCase{.n = 1, .c_in = 16, .h_in = 224, .w_in = 224, .c_out = 32, .k_h = 3, .k_w = 3, .stride_h = 2, .stride_w = 2, .pad_h = 1, .pad_w = 1},
        ConvCase{.n = 1, .c_in = 16, .h_in = 224, .w_in = 224, .c_out = 32, .k_h = 5, .k_w = 5, .stride_h = 1, .stride_w = 1, .pad_h = 2, .pad_w = 2},
    };

    for (const ConvCase &base : conv_cases)
    {
        for (const Backend backend : backends)
        {
            ConvCase c = base;
            c.backend = backend;
            const IndexType out_h =
                (c.h_in + 2 * c.pad_h < c.k_h) ? 0 : ((c.h_in + 2 * c.pad_h - c.k_h) / c.stride_h + 1);
            const IndexType out_w =
                (c.w_in + 2 * c.pad_w < c.k_w) ? 0 : ((c.w_in + 2 * c.pad_w - c.k_w) / c.stride_w + 1);
            const std::int64_t case_size =
                static_cast<std::int64_t>(c.n) * static_cast<std::int64_t>(c.c_in) *
                static_cast<std::int64_t>(c.h_in) * static_cast<std::int64_t>(c.w_in);
            const std::vector<RunMetrics> runs = run_conv_benchmark_case(c, cfg);
            for (const RunMetrics &run : runs)
            {
                print_run_csv_row("convolution", backend, case_size, run);
            }
            const double macs = static_cast<double>(c.n) * static_cast<double>(c.c_out) * static_cast<double>(out_h) *
                                static_cast<double>(out_w) * static_cast<double>(c.c_in) *
                                static_cast<double>(c.k_h) * static_cast<double>(c.k_w);
            const CaseSummary summary = summarize_runs(runs, macs);
            print_summary_row("convolution", backend, case_size, summary);
        }
    }

    return 0;
}
