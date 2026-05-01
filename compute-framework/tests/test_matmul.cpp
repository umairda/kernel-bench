#include <gtest/gtest.h>
#include "framework/runtime.hpp"

TEST(MatmulDispatch, InvalidOutputSizeReturnsInvalidArgument)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true,
        },
        .config = {
            .backend_config = {.preferred = Backend::CPU, .allow_fallback = false},
        },
    };

    const MatrixMultiplyParams params{
        .A_shape = MatrixShape{2, 3},
        .B_shape = MatrixShape{3, 2},
        .output_shape = MatrixShape{2, 2},
    };

    const std::vector<float> a{1, 2, 3, 4, 5, 6};
    const std::vector<float> b{7, 8, 9, 10, 11, 12};
    std::vector<float> out(3, 0.0f);
    Result result{};

    const StatusCode status = dispatch_matrix_multiply(ctx, params, a, b, out, result);
    EXPECT_EQ(status, StatusCode::InvalidArgument);
    EXPECT_EQ(result.status, StatusCode::InvalidArgument);
}

TEST(MatmulDispatch, CpuKnownAnswer)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true,
        },
        .config = {
            .backend_config = {.preferred = Backend::CPU, .allow_fallback = false},
        },
    };

    const MatrixMultiplyParams params{
        .A_shape = MatrixShape{2, 3},
        .B_shape = MatrixShape{3, 2},
        .output_shape = MatrixShape{2, 2},
    };

    const std::vector<float> a{1, 2, 3, 4, 5, 6};
    const std::vector<float> b{7, 8, 9, 10, 11, 12};
    std::vector<float> out(4, 0.0f);
    Result result{};

    const StatusCode status = dispatch_matrix_multiply(ctx, params, a, b, out, result);
    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_EQ(result.status, StatusCode::Success);
    EXPECT_EQ(result.backend_used, Backend::CPU);
    EXPECT_FLOAT_EQ(out[0], 58.0f);
    EXPECT_FLOAT_EQ(out[1], 64.0f);
    EXPECT_FLOAT_EQ(out[2], 139.0f);
    EXPECT_FLOAT_EQ(out[3], 154.0f);
}
