#include <gtest/gtest.h>
#include "framework/gpu_ops.hpp"
#include "framework/cpu_ops.hpp"

TEST(MatmulGpu, BasicTwoByThreeTimesThreeByTwoOrSkipWhenUnavailable)
{
    MatrixMultiplyParams params{
        .A_shape = MatrixShape{2, 3},
        .B_shape = MatrixShape{3, 2},
        .output_shape = MatrixShape{2, 2},
    };

    const std::vector<float> a{
        1, 2, 3,
        4, 5, 6};
    const std::vector<float> b{
        7, 8,
        9, 10,
        11, 12};
    std::vector<float> cpu_out(4, 0.0f);
    std::vector<float> gpu_out(4, 0.0f);

    const StatusCode cpu_status = cpu_matrix_multiply_op(params, a, b, cpu_out);
    ASSERT_EQ(cpu_status, StatusCode::Success);

    const StatusCode status = gpu_matmul_op(params, a, b, gpu_out);
    if (status == StatusCode::NotImplemented)
    {
        GTEST_SKIP() << "GPU matmul not available in this build/environment.";
    }

    EXPECT_EQ(status, StatusCode::Success);
    ASSERT_EQ(gpu_out.size(), cpu_out.size());
    for (std::size_t i = 0; i < cpu_out.size(); ++i)
    {
        EXPECT_NEAR(gpu_out[i], cpu_out[i], 1e-4f);
    }
}

TEST(MatmulGpu, InvalidShapeInvalidArgumentOrSkipWhenUnavailable)
{
    MatrixMultiplyParams params{
        .A_shape = MatrixShape{2, 3},
        .B_shape = MatrixShape{4, 2},
        .output_shape = MatrixShape{2, 2},
    };

    const std::vector<float> a(6, 1.0f);
    const std::vector<float> b(8, 1.0f);
    std::vector<float> out(4, 0.0f);

    const StatusCode status = gpu_matmul_op(params, a, b, out);
    if (status == StatusCode::NotImplemented)
    {
        GTEST_SKIP() << "GPU matmul not available in this build/environment.";
    }

    EXPECT_EQ(status, StatusCode::InvalidArgument);
}
