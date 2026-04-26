#include "framework/gpu_ops.hpp"

StatusCode gpu_vector_op(const VectorOpParams &, const std::vector<float> &, const std::vector<float> &, std::vector<float> &)
{
    return StatusCode::NotImplemented;
}

StatusCode gpu_matmul_op(const MatrixMultiplyParams &, const std::vector<float> &, const std::vector<float> &, std::vector<float> &)
{
    return StatusCode::NotImplemented;
}

StatusCode gpu_convolution_op(const ConvolutionParams &, const std::vector<float> &, const std::vector<float> &, std::vector<float> &)
{
    return StatusCode::NotImplemented;
}
