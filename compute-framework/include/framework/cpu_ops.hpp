#pragma once
#include <vector>
#include "framework/types.hpp"
#include "framework/ops.hpp"

StatusCode cpu_vector_op(
    const VectorOpParams &params,
    const std::vector<float> &v1,
    const std::vector<float> &v2,
    std::vector<float> &out,
    bool validate_division = true);

StatusCode cpu_matrix_multiply_op(
    const MatrixMultiplyParams &params,
    const std::vector<float> &a,
    const std::vector<float> &b,
    std::vector<float> &out);

StatusCode cpu_convolution_op(
    const ConvolutionParams &params,
    const std::vector<float> &input,
    const std::vector<float> &filter,
    std::vector<float> &out);
