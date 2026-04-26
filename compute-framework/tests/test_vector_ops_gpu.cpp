#include <gtest/gtest.h>
#include "framework/gpu_ops.hpp"
#include "framework/cpu_ops.hpp"

TEST(VectorOpsGpu, AddBasicOrSkipWhenUnavailable)
{
    VectorOpParams params{3, VectorOperation::Add};
    const std::vector<float> a{1, 2, 3};
    const std::vector<float> b{4, 5, 6};
    std::vector<float> cpu_out(3, 0.0f);
    std::vector<float> gpu_out(3, 0.0f);

    const StatusCode cpu_status = cpu_vector_op(params, a, b, cpu_out);
    ASSERT_EQ(cpu_status, StatusCode::Success);

    const StatusCode status = gpu_vector_op(params, a, b, gpu_out);
    if (status == StatusCode::NotImplemented)
    {
        GTEST_SKIP() << "GPU vector ops not available in this build/environment.";
    }

    EXPECT_EQ(status, StatusCode::Success);
    ASSERT_EQ(gpu_out.size(), cpu_out.size());
    for (std::size_t i = 0; i < cpu_out.size(); ++i)
    {
        EXPECT_NEAR(gpu_out[i], cpu_out[i], 1e-5f);
    }
}

TEST(VectorOpsGpu, DivideByZeroInvalidArgumentOrSkipWhenUnavailable)
{
    VectorOpParams params{3, VectorOperation::Divide};
    const std::vector<float> a{8, 10, 12};
    const std::vector<float> b{2, 0, 3};
    std::vector<float> out(3, 0.0f);

    const StatusCode status = gpu_vector_op(params, a, b, out);
    if (status == StatusCode::NotImplemented)
    {
        GTEST_SKIP() << "GPU vector ops not available in this build/environment.";
    }

    EXPECT_EQ(status, StatusCode::InvalidArgument);
}
