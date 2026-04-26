#include "framework/benchmark_lib.hpp"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <random>
#include <vector>

namespace benchmark
{
CaseSummary summarize_runs(const std::vector<RunMetrics> &runs, const double work_items)
{
    CaseSummary summary{};
    std::vector<double> totals;
    totals.reserve(runs.size());

    for (const RunMetrics &run : runs)
    {
        if (run.status == StatusCode::Success)
        {
            totals.push_back(run.total_ms);
        }
        else if (summary.overall_status == StatusCode::Success)
        {
            summary.overall_status = run.status;
        }
    }

    summary.success_count = totals.size();
    if (totals.empty())
    {
        return summary;
    }

    std::sort(totals.begin(), totals.end());
    const double sum = std::accumulate(totals.begin(), totals.end(), 0.0);

    summary.mean_ms = sum / static_cast<double>(totals.size());
    summary.min_ms = totals.front();
    summary.max_ms = totals.back();
    summary.p50_ms = totals[(totals.size() - 1) * 50 / 100];
    summary.p95_ms = totals[(totals.size() - 1) * 95 / 100];

    if (summary.mean_ms > 0.0)
    {
        summary.throughput_items_per_second = work_items / (summary.mean_ms / 1000.0);
    }

    return summary;
}

void fill_random(std::vector<float> &buffer, const std::uint32_t seed)
{
    std::mt19937 rng(seed);
    std::uniform_real_distribution<float> dist(-1000.0f, 1000.0f);
    for (float &v : buffer)
    {
        v = dist(rng);
    }
}

void build_vector_inputs(const VectorCase &c, std::vector<float> &a, std::vector<float> &b)
{
    a.resize(c.length);
    b.resize(c.length);

    fill_random(a, static_cast<std::uint32_t>(1337u + c.length));
    fill_random(b, static_cast<std::uint32_t>(2333u + c.length));

    if (c.op == VectorOperation::Divide)
    {
        for (float &v : b)
        {
            if (std::fabs(v) < 1.0e-5f)
            {
                v = 1.0f;
            }
        }
    }
}
} // namespace benchmark
