#include <gtest/gtest.h>
#include "framework/cpu_ops.hpp"

TEST(MatmulCpu, BasicTwoByThreeTimesThreeByTwo)
{
    MatrixMultiplyParams params{
        .A_shape = MatrixShape{2, 3},
        .B_shape = MatrixShape{3, 2},
        .output_shape = MatrixShape{2, 2},
    };

    // A = [ [1, 2, 3],
    //       [4, 5, 6] ]
    const std::vector<float> a{
        1, 2, 3,
        4, 5, 6};

    // B = [ [7,  8],
    //       [9, 10],
    //       [11,12] ]
    const std::vector<float> b{
        7, 8,
        9, 10,
        11, 12};

    std::vector<float> out(4, 0.0f);

    const StatusCode status = cpu_matrix_multiply_op(params, a, b, out);
    EXPECT_EQ(status, StatusCode::Success);

    // C = A * B = [ [58, 64],
    //               [139,154] ]
    EXPECT_FLOAT_EQ(out[0], 58.0f);
    EXPECT_FLOAT_EQ(out[1], 64.0f);
    EXPECT_FLOAT_EQ(out[2], 139.0f);
    EXPECT_FLOAT_EQ(out[3], 154.0f);
}

TEST(MatmulCpu, InvalidShapesReturnInvalidArgument)
{
    MatrixMultiplyParams params{
        .A_shape = MatrixShape{2, 3},
        .B_shape = MatrixShape{4, 2}, // invalid: 3 != 4
        .output_shape = MatrixShape{2, 2},
    };

    const std::vector<float> a(6, 1.0f);
    const std::vector<float> b(8, 1.0f);
    std::vector<float> out(4, 0.0f);

    const StatusCode status = cpu_matrix_multiply_op(params, a, b, out);
    EXPECT_EQ(status, StatusCode::InvalidArgument);
}

TEST(MatmulCpu, ZeroSizedMatricesReturnSuccess)
{
    MatrixMultiplyParams params{
        .A_shape = MatrixShape{0, 3},
        .B_shape = MatrixShape{3, 2},
        .output_shape = MatrixShape{0, 2},
    };

    const std::vector<float> a{};
    const std::vector<float> b(6, 1.0f);
    std::vector<float> out{};

    const StatusCode status = cpu_matrix_multiply_op(params, a, b, out);
    EXPECT_EQ(status, StatusCode::Success);
}
