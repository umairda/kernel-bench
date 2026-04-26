#include "framework/parse_args.hpp"

#include <gtest/gtest.h>
#include <string>
#include <vector>

namespace
{
std::vector<char *> to_argv(std::vector<std::string> &parts)
{
    std::vector<char *> argv;
    argv.reserve(parts.size());
    for (std::string &part : parts)
    {
        argv.push_back(part.data());
    }
    return argv;
}
} // namespace

TEST(ParseArgs, VectorCpuSuccess)
{
    std::vector<std::string> parts = {
        "compute",
        "--op", "vector",
        "--backend", "cpu",
        "--vector-op", "add",
        "--a", "1,2,3",
        "--b", "4,5,6",
    };
    std::vector<char *> argv = to_argv(parts);

    const ParsedArgs parsed = parse_args(static_cast<int>(argv.size()), argv.data());

    EXPECT_EQ(parsed.operation, CliOperation::Vector);
    EXPECT_EQ(parsed.backend, Backend::CPU);
    EXPECT_EQ(parsed.vector_params.op_type, VectorOperation::Add);
    ASSERT_EQ(parsed.a.size(), 3u);
    ASSERT_EQ(parsed.b.size(), 3u);
    EXPECT_FLOAT_EQ(parsed.a[1], 2.0f);
    EXPECT_FLOAT_EQ(parsed.b[2], 6.0f);
}

TEST(ParseArgs, MatmulGpuSuccess)
{
    std::vector<std::string> parts = {
        "compute",
        "--op", "matmul",
        "--backend", "gpu",
        "--a-rows", "2",
        "--a-cols", "3",
        "--b-rows", "3",
        "--b-cols", "2",
        "--a", "1,2,3,4,5,6",
        "--b", "7,8,9,10,11,12",
    };
    std::vector<char *> argv = to_argv(parts);

    const ParsedArgs parsed = parse_args(static_cast<int>(argv.size()), argv.data());

    EXPECT_EQ(parsed.operation, CliOperation::Matmul);
    EXPECT_EQ(parsed.backend, Backend::GPU);
    EXPECT_EQ(parsed.matmul_params.A_shape.rows, 2u);
    EXPECT_EQ(parsed.matmul_params.A_shape.cols, 3u);
    EXPECT_EQ(parsed.matmul_params.B_shape.rows, 3u);
    EXPECT_EQ(parsed.matmul_params.B_shape.cols, 2u);
    EXPECT_EQ(parsed.matmul_params.output_shape.rows, 2u);
    EXPECT_EQ(parsed.matmul_params.output_shape.cols, 2u);
}

TEST(ParseArgs, ConvolutionSuccess)
{
    std::vector<std::string> parts = {
        "compute",
        "--op", "convolution",
        "--backend", "cpu",
        "--n", "1",
        "--c-in", "1",
        "--h-in", "3",
        "--w-in", "3",
        "--c-out", "1",
        "--k-h", "3",
        "--k-w", "3",
        "--stride-h", "1",
        "--stride-w", "1",
        "--pad-h", "0",
        "--pad-w", "0",
        "--input", "1,2,3,4,5,6,7,8,9",
        "--filter", "1,1,1,1,1,1,1,1,1",
    };
    std::vector<char *> argv = to_argv(parts);

    const ParsedArgs parsed = parse_args(static_cast<int>(argv.size()), argv.data());

    EXPECT_EQ(parsed.operation, CliOperation::Convolution);
    EXPECT_EQ(parsed.convolution_params.input_shape.dims.size(), 4u);
    EXPECT_EQ(parsed.convolution_params.filter_shape.dims.size(), 4u);
    EXPECT_EQ(parsed.convolution_params.output_shape.dims.size(), 4u);
    EXPECT_EQ(parsed.convolution_params.output_shape.dims[2], 1u);
    EXPECT_EQ(parsed.convolution_params.output_shape.dims[3], 1u);
}

TEST(ParseArgs, MissingRequiredFlagFails)
{
    std::vector<std::string> parts = {
        "compute",
        "--op", "vector",
        "--backend", "cpu",
        "--a", "1,2,3",
    };
    std::vector<char *> argv = to_argv(parts);

    EXPECT_THROW(parse_args(static_cast<int>(argv.size()), argv.data()), std::invalid_argument);
}

TEST(ParseArgs, UnsupportedBackendFails)
{
    std::vector<std::string> parts = {
        "compute",
        "--op", "vector",
        "--backend", "auto",
        "--vector-op", "add",
        "--a", "1",
        "--b", "2",
    };
    std::vector<char *> argv = to_argv(parts);

    EXPECT_THROW(parse_args(static_cast<int>(argv.size()), argv.data()), std::invalid_argument);
}

TEST(ParseArgs, HelpThrowsMarker)
{
    std::vector<std::string> parts = {"compute", "--help"};
    std::vector<char *> argv = to_argv(parts);

    try
    {
        (void)parse_args(static_cast<int>(argv.size()), argv.data());
        FAIL() << "Expected help marker exception";
    }
    catch (const std::invalid_argument &e)
    {
        EXPECT_STREQ(e.what(), "help");
    }
}
