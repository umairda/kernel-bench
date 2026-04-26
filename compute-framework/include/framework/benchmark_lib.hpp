#pragma once

#include "framework/backend.hpp"
#include "framework/types.hpp"

#include <cstdint>
#include <vector>

namespace benchmark
{
struct BenchmarkConfig
{
    unsigned int warmup_runs = 3;
    unsigned int measured_runs = 20;
    bool strict_backend = true;
};

struct RunMetrics
{
    std::int64_t run_index = -1;
    StatusCode status = StatusCode::NotImplemented;
    double kernel_ms = 0.0;
    double transfer_ms = 0.0;
    double total_ms = 0.0;
};

struct CaseSummary
{
    StatusCode overall_status = StatusCode::Success;
    std::size_t success_count = 0;
    double mean_ms = 0.0;
    double p50_ms = 0.0;
    double p95_ms = 0.0;
    double min_ms = 0.0;
    double max_ms = 0.0;
    double throughput_items_per_second = 0.0;
};

struct VectorCase
{
    VectorOperation op = VectorOperation::Add;
    IndexType length = 0;
    Backend backend = Backend::CPU;
};

struct MatmulCase
{
    IndexType a_rows = 0;
    IndexType a_cols = 0;
    IndexType b_rows = 0;
    IndexType b_cols = 0;
    Backend backend = Backend::CPU;
};

struct ConvCase
{
    IndexType n = 0;
    IndexType c_in = 0;
    IndexType h_in = 0;
    IndexType w_in = 0;
    IndexType c_out = 0;
    IndexType k_h = 0;
    IndexType k_w = 0;
    IndexType stride_h = 1;
    IndexType stride_w = 1;
    IndexType pad_h = 0;
    IndexType pad_w = 0;
    Backend backend = Backend::CPU;
};

CaseSummary summarize_runs(const std::vector<RunMetrics> &runs, double work_items);
void fill_random(std::vector<float> &buffer, std::uint32_t seed);
void build_vector_inputs(const VectorCase &c, std::vector<float> &a, std::vector<float> &b);

} // namespace benchmark
