#include <gtest/gtest.h>
#include "framework/gpu_ops.hpp"
#include "framework/cpu_ops.hpp"

TEST(ConvolutionGpu, ThreeByThreeNoPaddingStrideOneOrSkipWhenUnavailable)
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
    std::vector<float> cpu_out(1, 0.0f);
    std::vector<float> gpu_out(1, 0.0f);

    const StatusCode cpu_status = cpu_convolution_op(params, input, filter, cpu_out);
    ASSERT_EQ(cpu_status, StatusCode::Success);

    const StatusCode status = gpu_convolution_op(params, input, filter, gpu_out);
    if (status == StatusCode::NotImplemented)
    {
        GTEST_SKIP() << "GPU convolution not available in this build/environment.";
    }

    EXPECT_EQ(status, StatusCode::Success);
    ASSERT_EQ(gpu_out.size(), cpu_out.size());
    for (std::size_t i = 0; i < cpu_out.size(); ++i)
    {
        EXPECT_NEAR(gpu_out[i], cpu_out[i], 1e-4f);
    }
}

TEST(ConvolutionGpu, InvalidOutputShapeInvalidArgumentOrSkipWhenUnavailable)
{
    ConvolutionParams params{
        .input_shape = Tensor{.dims = {1, 1, 3, 3}},
        .filter_shape = Tensor{.dims = {1, 1, 2, 2}},
        .output_shape = Tensor{.dims = {1, 1, 3, 3}}, // intentionally wrong
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

    const StatusCode status = gpu_convolution_op(params, input, filter, out);
    if (status == StatusCode::NotImplemented)
    {
        GTEST_SKIP() << "GPU convolution not available in this build/environment.";
    }

    EXPECT_EQ(status, StatusCode::InvalidArgument);
}
