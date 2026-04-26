#pragma once

#include "backend.hpp"
#include "ops.hpp"
#include "types.hpp"

// Holds runtime-wide state/config used by dispatch.
struct RuntimeContext
{
    BackendCapabilities capabilities{}; // what is available on this machine
    ExecutionConfig config{};           // user/runtime preferences
};

// ----- Init / Probe -----

// Detect hardware/software capabilities (CPU always true, GPU probed).
StatusCode probe_backend_capabilities(BackendCapabilities &out_caps);

// Build a ready-to-use runtime context from config + detected capabilities.
StatusCode initialize_runtime(const ExecutionConfig &config, RuntimeContext &out_ctx);

// ----- Backend Selection -----

// Pick backend for a specific operation, considering config + capabilities.
Backend select_backend(const RuntimeContext &ctx);

// ----- Dispatch -----

StatusCode dispatch_matrix_multiply(
    const RuntimeContext &ctx,
    const MatrixMultiplyParams &params,
    const std::vector<float> &a,
    const std::vector<float> &b,
    std::vector<float> &out,
    Result &result);

StatusCode dispatch_convolution(
    const RuntimeContext &ctx,
    const ConvolutionParams &params,
    const std::vector<float> &input,
    const std::vector<float> &filter,
    std::vector<float> &out,
    Result &result);

StatusCode dispatch_vector_operation(
    const RuntimeContext &ctx,
    const VectorOpParams &params,
    const std::vector<float> &v1,
    const std::vector<float> &v2,
    std::vector<float> &out,
    Result &result);
