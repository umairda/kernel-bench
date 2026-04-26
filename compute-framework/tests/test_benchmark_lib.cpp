#include "framework/benchmark_lib.hpp"

#include <gtest/gtest.h>

#include <cmath>
#include <vector>

TEST(BenchmarkLib, SummarizeRunsComputesStats)
{
    const std::vector<benchmark::RunMetrics> runs{
        {.run_index = 0, .status = StatusCode::Success, .total_ms = 1.0},
        {.run_index = 1, .status = StatusCode::Success, .total_ms = 2.0},
        {.run_index = 2, .status = StatusCode::Success, .total_ms = 3.0},
        {.run_index = 3, .status = StatusCode::Success, .total_ms = 4.0},
        {.run_index = 4, .status = StatusCode::Success, .total_ms = 5.0},
    };

    const benchmark::CaseSummary summary = benchmark::summarize_runs(runs, 1000.0);

    EXPECT_EQ(summary.overall_status, StatusCode::Success);
    EXPECT_EQ(summary.success_count, 5u);
    EXPECT_DOUBLE_EQ(summary.mean_ms, 3.0);
    EXPECT_DOUBLE_EQ(summary.p50_ms, 3.0);
    EXPECT_DOUBLE_EQ(summary.p95_ms, 4.0);
    EXPECT_DOUBLE_EQ(summary.min_ms, 1.0);
    EXPECT_DOUBLE_EQ(summary.max_ms, 5.0);
    EXPECT_NEAR(summary.throughput_items_per_second, 333333.333, 0.1);
}

TEST(BenchmarkLib, SummarizeRunsTracksFailureStatus)
{
    const std::vector<benchmark::RunMetrics> runs{
        {.run_index = 0, .status = StatusCode::Success, .total_ms = 10.0},
        {.run_index = 1, .status = StatusCode::BackendUnavailable, .total_ms = 0.0},
    };

    const benchmark::CaseSummary summary = benchmark::summarize_runs(runs, 10.0);

    EXPECT_EQ(summary.overall_status, StatusCode::BackendUnavailable);
    EXPECT_EQ(summary.success_count, 1u);
    EXPECT_DOUBLE_EQ(summary.mean_ms, 10.0);
}

TEST(BenchmarkLib, BuildVectorInputsIsDeterministic)
{
    const benchmark::VectorCase c{
        .op = VectorOperation::Multiply,
        .length = 64,
        .backend = Backend::CPU,
    };

    std::vector<float> a1;
    std::vector<float> b1;
    std::vector<float> a2;
    std::vector<float> b2;

    benchmark::build_vector_inputs(c, a1, b1);
    benchmark::build_vector_inputs(c, a2, b2);

    ASSERT_EQ(a1.size(), a2.size());
    ASSERT_EQ(b1.size(), b2.size());
    EXPECT_EQ(a1, a2);
    EXPECT_EQ(b1, b2);
}

TEST(BenchmarkLib, BuildVectorInputsDivideAvoidsNearZeroDenominator)
{
    const benchmark::VectorCase c{
        .op = VectorOperation::Divide,
        .length = 1024,
        .backend = Backend::CPU,
    };

    std::vector<float> a;
    std::vector<float> b;
    benchmark::build_vector_inputs(c, a, b);

    ASSERT_EQ(a.size(), 1024u);
    ASSERT_EQ(b.size(), 1024u);
    for (const float v : b)
    {
        EXPECT_GE(std::fabs(v), 1.0e-5f);
    }
}
