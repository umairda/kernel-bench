#include "framework/backend.hpp"
#include "framework/runtime.hpp"
#include "framework/cpu_ops.hpp"
#include "framework/gpu_ops.hpp"
#include "framework/timer.hpp"
#if defined(GPU_FRAMEWORK_ENABLE_CUDA)
#include "framework/cuda_utils.cuh"
#endif

StatusCode probe_backend_capabilities(BackendCapabilities &out_caps)
{
    out_caps.cpu_available = true;
    out_caps.gpu_available = false;

#if defined(GPU_FRAMEWORK_ENABLE_CUDA)
    out_caps.gpu_available = cuda_utils::is_gpu_available();
#endif

    return StatusCode::Success;
}

StatusCode initialize_runtime(const ExecutionConfig &config, RuntimeContext &out_ctx)
{
    out_ctx.config = config;

    BackendCapabilities caps{};
    const StatusCode status = probe_backend_capabilities(caps);
    if (status != StatusCode::Success)
    {
        return status;
    }

    out_ctx.capabilities = caps;
    return StatusCode::Success;
}

Backend select_backend(const RuntimeContext &ctx)
{
    Backend preferred = ctx.config.backend_config.preferred;

    switch (preferred)
    {
    case Backend::Auto:
    {
        if (ctx.capabilities.gpu_available)
        {
            return Backend::GPU;
        }
        else if (ctx.capabilities.cpu_available)
        {
            return Backend::CPU;
        }
        return Backend::None;
    }
    case Backend::GPU:
    {
        if (ctx.capabilities.gpu_available)
        {
            return Backend::GPU;
        }
        else if (ctx.config.backend_config.allow_fallback && ctx.capabilities.cpu_available)
        {
            return Backend::CPU;
        }
        return Backend::None;
    }
    case Backend::CPU:
    {
        if (ctx.capabilities.cpu_available)
        {
            return Backend::CPU;
        }
        return Backend::None;
    }
    default:
        return Backend::None;
    }
}

StatusCode dispatch_vector_operation(const RuntimeContext &ctx, const VectorOpParams &params, const std::vector<float> &v1, const std::vector<float> &v2, std::vector<float> &out, Result &result)
{
    result.kernel_ms = 0;
    result.total_ms = 0;
    result.transfer_ms = 0;
    result.backend_used = Backend::None;

    if (v1.size() != params.length || v2.size() != params.length || out.size() != params.length)
    {
        result.status = StatusCode::InvalidArgument;
        result.backend_used = Backend::None;
        return result.status;
    }

    Backend chosen = select_backend(ctx);

    Stopwatch stopwatch;
    stopwatch.start();
    if (chosen == Backend::GPU)
    {
        result.status = gpu_vector_op(params, v1, v2, out);
        result.backend_used = (result.status == StatusCode::Success) ? Backend::GPU : Backend::None;
    }
    else if (chosen == Backend::CPU)
    {
        result.status = cpu_vector_op(params, v1, v2, out);
        result.backend_used = (result.status == StatusCode::Success) ? Backend::CPU : Backend::None;
    }
    else
    {
        result.status = StatusCode::BackendUnavailable;
        result.backend_used = Backend::None;
    }
    stopwatch.stop();

    result.kernel_ms = stopwatch.elapsed_ms();
    result.total_ms = result.kernel_ms + result.transfer_ms;

    return result.status;
}

StatusCode dispatch_matrix_multiply(
    const RuntimeContext &ctx,
    const MatrixMultiplyParams &params,
    const std::vector<float> &a,
    const std::vector<float> &b,
    std::vector<float> &out,
    Result &result)
{
    result.kernel_ms = 0;
    result.total_ms = 0;
    result.transfer_ms = 0;
    result.backend_used = Backend::None;

    const IndexType expected_out = params.A_shape.rows * params.B_shape.cols;
    if (out.size() != expected_out)
    {
        result.status = StatusCode::InvalidArgument;
        return result.status;
    }

    const Backend chosen = select_backend(ctx);

    Stopwatch stopwatch;
    stopwatch.start();
    if (chosen == Backend::GPU)
    {
        result.status = gpu_matmul_op(params, a, b, out);
        result.backend_used = (result.status == StatusCode::Success) ? Backend::GPU : Backend::None;
    }
    else if (chosen == Backend::CPU)
    {
        result.status = cpu_matrix_multiply_op(params, a, b, out);
        result.backend_used = (result.status == StatusCode::Success) ? Backend::CPU : Backend::None;
    }
    else
    {
        result.status = StatusCode::BackendUnavailable;
    }
    stopwatch.stop();

    result.kernel_ms = stopwatch.elapsed_ms();
    result.total_ms = result.kernel_ms + result.transfer_ms;
    return result.status;
}

StatusCode dispatch_convolution(
    const RuntimeContext &ctx,
    const ConvolutionParams &params,
    const std::vector<float> &input,
    const std::vector<float> &filter,
    std::vector<float> &out,
    Result &result)
{
    result.kernel_ms = 0;
    result.total_ms = 0;
    result.transfer_ms = 0;
    result.backend_used = Backend::None;

    const IndexType expected_out = params.output_shape.element_count();
    if (out.size() != expected_out)
    {
        result.status = StatusCode::InvalidArgument;
        return result.status;
    }

    const Backend chosen = select_backend(ctx);

    Stopwatch stopwatch;
    stopwatch.start();
    if (chosen == Backend::GPU)
    {
        result.status = gpu_convolution_op(params, input, filter, out);
        result.backend_used = (result.status == StatusCode::Success) ? Backend::GPU : Backend::None;
    }
    else if (chosen == Backend::CPU)
    {
        result.status = cpu_convolution_op(params, input, filter, out);
        result.backend_used = (result.status == StatusCode::Success) ? Backend::CPU : Backend::None;
    }
    else
    {
        result.status = StatusCode::BackendUnavailable;
    }
    stopwatch.stop();

    result.kernel_ms = stopwatch.elapsed_ms();
    result.total_ms = result.kernel_ms + result.transfer_ms;
    return result.status;
}
