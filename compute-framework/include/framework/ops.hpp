#pragma once
#include "types.hpp"
#include "backend.hpp"
#include "tensor.hpp"

struct MatrixMultiplyParams
{
    MatrixShape A_shape;
    MatrixShape B_shape;

    MatrixShape output_shape;
};

struct ConvolutionParams
{
    Tensor input_shape;   // NCHW tensor metadata (dims used for convolution shape checks)
    Tensor filter_shape;  // [out_channels, in_channels, kernel_height, kernel_width] metadata
    Tensor output_shape;  // Output tensor metadata [batch_size, out_channels, out_height, out_width]
    IndexType stride_height;  // Stride along the height dimension
    IndexType stride_width;   // Stride along the width dimension
    IndexType padding_height; // Padding along the height dimension
    IndexType padding_width;  // Padding along the width dimension
};

struct VectorOpParams
{
    IndexType length;        // Length of the vectors involved in the operation
    VectorOperation op_type; // Type of vector operation (e.g., VectorAdd, VectorMultiply)
};

struct ExecutionConfig
{
    BackendConfig backend_config;     // Configuration for selecting the backend
    bool use_pinned_memory = false;   // Whether to use pinned memory for GPU operations
    bool use_async_transfers = false; // Whether to use asynchronous data transfers for GPU operations
};

struct Result
{
    StatusCode status = StatusCode::NotImplemented; // Status of the operation (e.g., Success, InvalidArgument)
    double kernel_ms = 0.0;                         // Execution time of the kernel in milliseconds
    double transfer_ms = 0.0;                       // Time taken for data transfer in milliseconds (if applicable)
    double total_ms = 0.0;                          // Total execution time in milliseconds (kernel + transfer)
    Backend backend_used = Backend::None;           // Backend used for the operation
};

void run_matrix_multiply(const MatrixMultiplyParams &params, const ExecutionConfig &config, Result &result);

void run_convolution(const ConvolutionParams &params, const ExecutionConfig &config, Result &result);

void run_vector_op(const VectorOpParams &params, const ExecutionConfig &config, Result &result);

bool validate_matrix_multiply_shapes(const MatrixShape &A_shape, const MatrixShape &B_shape);

bool validate_convolution_shapes(const Tensor &input_shape, const Tensor &filter_shape, const Tensor &output_shape);

bool validate_vector_shapes(IndexType length);
