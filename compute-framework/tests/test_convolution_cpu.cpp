#include <gtest/gtest.h>
#include "framework/cpu_ops.hpp"

TEST(ConvolutionCpu, OneByOneKernelAcrossChannels)
{
    ConvolutionParams params{
        .input_shape = Tensor{.dims = {1, 2, 2, 2}},
        .filter_shape = Tensor{.dims = {1, 2, 1, 1}},
        .output_shape = Tensor{.dims = {1, 1, 2, 2}},
        .stride_height = 1,
        .stride_width = 1,
        .padding_height = 0,
        .padding_width = 0,
    };

    // NCHW input:
    // channel 0:
    // [1 2]
    // [3 4]
    // channel 1:
    // [10 20]
    // [30 40]
    const std::vector<float> input{1, 2, 3, 4, 10, 20, 30, 40};

    // One output channel, two input channels, 1x1 kernel.
    // y = 2*x_c0 + 3*x_c1
    const std::vector<float> filter{2, 3};
    std::vector<float> out(4, 0.0f);

    const StatusCode status = cpu_convolution_op(params, input, filter, out);

    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_FLOAT_EQ(out[0], 32.0f);
    EXPECT_FLOAT_EQ(out[1], 64.0f);
    EXPECT_FLOAT_EQ(out[2], 96.0f);
    EXPECT_FLOAT_EQ(out[3], 128.0f);
}

TEST(ConvolutionCpu, ThreeByThreeNoPaddingStrideOne)
{
    ConvolutionParams params{
        .input_shape = Tensor{.dims = {1, 1, 3, 3}},
        .filter_shape = Tensor{.dims = {1, 1, 3, 3}},
        .output_shape = Tensor{.dims = {1, 1, 1, 1}},
        .stride_height = 1,
        .stride_width = 1,
        .padding_height = 0,
        .padding_width = 0,
    };

    const std::vector<float> input{
        1, 2, 3,
        4, 5, 6,
        7, 8, 9};
    const std::vector<float> filter{
        1, 1, 1,
        1, 1, 1,
        1, 1, 1};
    std::vector<float> out(1, 0.0f);

    const StatusCode status = cpu_convolution_op(params, input, filter, out);

    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_FLOAT_EQ(out[0], 45.0f);
}

TEST(ConvolutionCpu, PaddingAndStrideMath)
{
    ConvolutionParams params{
        .input_shape = Tensor{.dims = {1, 1, 2, 2}},
        .filter_shape = Tensor{.dims = {1, 1, 3, 3}},
        .output_shape = Tensor{.dims = {1, 1, 2, 2}},
        .stride_height = 1,
        .stride_width = 1,
        .padding_height = 1,
        .padding_width = 1,
    };

    const std::vector<float> input{
        1, 2,
        3, 4};

    // 3x3 cross-shaped kernel:
    // [0 1 0]
    // [1 4 1]
    // [0 1 0]
    const std::vector<float> filter{
        0, 1, 0,
        1, 4, 1,
        0, 1, 0};
    std::vector<float> out(4, 0.0f);

    const StatusCode status = cpu_convolution_op(params, input, filter, out);

    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_FLOAT_EQ(out[0], 9.0f);
    EXPECT_FLOAT_EQ(out[1], 13.0f);
    EXPECT_FLOAT_EQ(out[2], 17.0f);
    EXPECT_FLOAT_EQ(out[3], 21.0f);
}

TEST(ConvolutionCpu, InvalidShapesReturnInvalidArgument)
{
    ConvolutionParams params{
        .input_shape = Tensor{.dims = {1, 1, 3, 3}},
        .filter_shape = Tensor{.dims = {1, 1, 2, 2}},
        // This should be 2x2 for stride 1 and no padding, but set wrong on purpose.
        .output_shape = Tensor{.dims = {1, 1, 3, 3}},
        .stride_height = 1,
        .stride_width = 1,
        .padding_height = 0,
        .padding_width = 0,
    };

    const std::vector<float> input{
        1, 2, 3,
        4, 5, 6,
        7, 8, 9};
    const std::vector<float> filter{
        1, 0,
        0, 1};
    std::vector<float> out(9, 0.0f);

    const StatusCode status = cpu_convolution_op(params, input, filter, out);
    EXPECT_EQ(status, StatusCode::InvalidArgument);
}
