#pragma once

#include <ostream>
#include <vector>
#include "framework/backend.hpp"
#include "framework/ops.hpp"

enum class CliOperation
{
    Vector,
    Matmul,
    Convolution
};

struct ParsedArgs
{
    CliOperation operation = CliOperation::Vector;
    Backend backend = Backend::CPU;

    VectorOpParams vector_params{};
    MatrixMultiplyParams matmul_params{};
    ConvolutionParams convolution_params{};

    std::vector<float> a;
    std::vector<float> b;
    std::vector<float> input;
    std::vector<float> filter;
};

ParsedArgs parse_args(int argc, char *argv[]);
void print_usage(const char *program, std::ostream &out);
