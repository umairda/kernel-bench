#include <gtest/gtest.h>
#include "framework/runtime.hpp"

TEST(Dispatcher, ProbeBackendCapabilitiesAlwaysHasCpu)
{
    BackendCapabilities caps{};
    const StatusCode status = probe_backend_capabilities(caps);

    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_TRUE(caps.cpu_available);
}

TEST(Dispatcher, InitializeRuntimeCopiesConfigAndProbesCapabilities)
{
    const ExecutionConfig config{
        .backend_config = {.preferred = Backend::GPU, .allow_fallback = true},
        .use_pinned_memory = true,
        .use_async_transfers = true};

    RuntimeContext ctx{};
    const StatusCode status = initialize_runtime(config, ctx);

    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_EQ(ctx.config.backend_config.preferred, Backend::GPU);
    EXPECT_TRUE(ctx.config.backend_config.allow_fallback);
    EXPECT_TRUE(ctx.config.use_pinned_memory);
    EXPECT_TRUE(ctx.config.use_async_transfers);
    EXPECT_TRUE(ctx.capabilities.cpu_available);
}

TEST(Dispatcher, ValidCPUAdd)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true
        },
        .config = {
            .backend_config = {.preferred = Backend::CPU, .allow_fallback = false},
            .use_pinned_memory = false,
            .use_async_transfers = false
        }
    };

    VectorOpParams params{
        .length = 3,
        .op_type = VectorOperation::Add
    };

    Result result{};

    std::vector<float> v1{1, 2, 3};
    std::vector<float> v2{4, 5, 6};
    std::vector<float> out(3, 0);

    StatusCode status_code = dispatch_vector_operation(ctx, params, v1, v2, out, result);

    EXPECT_EQ(status_code, StatusCode::Success);
    EXPECT_EQ(result.status, StatusCode::Success);
    EXPECT_FLOAT_EQ(out[0], 5.0f);
    EXPECT_FLOAT_EQ(out[1], 7.0f);
    EXPECT_FLOAT_EQ(out[2], 9.0f);
    EXPECT_EQ(result.backend_used, Backend::CPU);
    EXPECT_GE(result.kernel_ms, 0.0);
    EXPECT_GE(result.total_ms, 0.0);
}

TEST(Dispatcher, PreferredGpuFallsBackToCpuWhenAllowed)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true
        },
        .config = {
            .backend_config = {.preferred = Backend::GPU, .allow_fallback = true},
            .use_pinned_memory = false,
            .use_async_transfers = false
        }
    };

    VectorOpParams params{
        .length = 3,
        .op_type = VectorOperation::Multiply
    };

    Result result{};
    std::vector<float> v1{1, 2, 3};
    std::vector<float> v2{4, 5, 6};
    std::vector<float> out(3, 0);

    StatusCode status_code = dispatch_vector_operation(ctx, params, v1, v2, out, result);

    EXPECT_EQ(status_code, StatusCode::Success);
    EXPECT_EQ(result.backend_used, Backend::CPU);
    EXPECT_FLOAT_EQ(out[0], 4.0f);
    EXPECT_FLOAT_EQ(out[1], 10.0f);
    EXPECT_FLOAT_EQ(out[2], 18.0f);
}

TEST(Dispatcher, PreferredGpuNoFallbackReturnsBackendUnavailable)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true
        },
        .config = {
            .backend_config = {.preferred = Backend::GPU, .allow_fallback = false},
            .use_pinned_memory = false,
            .use_async_transfers = false
        }
    };

    VectorOpParams params{
        .length = 3,
        .op_type = VectorOperation::Add
    };

    Result result{};
    std::vector<float> v1{1, 2, 3};
    std::vector<float> v2{4, 5, 6};
    std::vector<float> out(3, 0);

    StatusCode status_code = dispatch_vector_operation(ctx, params, v1, v2, out, result);

    EXPECT_EQ(status_code, StatusCode::BackendUnavailable);
    EXPECT_EQ(result.status, StatusCode::BackendUnavailable);
    EXPECT_EQ(result.backend_used, Backend::None);
}

TEST(Dispatcher, PreferredGpuAvailableReturnsNotImplemented)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = true,
            .cpu_available = true
        },
        .config = {
            .backend_config = {.preferred = Backend::GPU, .allow_fallback = false},
            .use_pinned_memory = false,
            .use_async_transfers = false
        }
    };

    VectorOpParams params{
        .length = 3,
        .op_type = VectorOperation::Add
    };

    Result result{};
    std::vector<float> v1{1, 2, 3};
    std::vector<float> v2{4, 5, 6};
    std::vector<float> out(3, 0);

    StatusCode status_code = dispatch_vector_operation(ctx, params, v1, v2, out, result);

    EXPECT_EQ(status_code, StatusCode::NotImplemented);
    EXPECT_EQ(result.status, StatusCode::NotImplemented);
    EXPECT_EQ(result.backend_used, Backend::None);
}

TEST(Dispatcher, InvalidInputLengthReturnsInvalidArgument)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true
        },
        .config = {
            .backend_config = {.preferred = Backend::CPU, .allow_fallback = false},
            .use_pinned_memory = false,
            .use_async_transfers = false
        }
    };

    VectorOpParams params{
        .length = 3,
        .op_type = VectorOperation::Add
    };

    Result result{};
    std::vector<float> v1{1, 2};
    std::vector<float> v2{4, 5, 6};
    std::vector<float> out(3, 0);

    StatusCode status_code = dispatch_vector_operation(ctx, params, v1, v2, out, result);

    EXPECT_EQ(status_code, StatusCode::InvalidArgument);
    EXPECT_EQ(result.status, StatusCode::InvalidArgument);
    EXPECT_EQ(result.backend_used, Backend::None);
}

TEST(Dispatcher, InvalidOutputLengthReturnsInvalidArgument)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true
        },
        .config = {
            .backend_config = {.preferred = Backend::CPU, .allow_fallback = false},
            .use_pinned_memory = false,
            .use_async_transfers = false
        }
    };

    VectorOpParams params{
        .length = 3,
        .op_type = VectorOperation::Add
    };

    Result result{};
    std::vector<float> v1{1, 2, 3};
    std::vector<float> v2{4, 5, 6};
    std::vector<float> out(2, 0);

    StatusCode status_code = dispatch_vector_operation(ctx, params, v1, v2, out, result);

    EXPECT_EQ(status_code, StatusCode::InvalidArgument);
    EXPECT_EQ(result.status, StatusCode::InvalidArgument);
    EXPECT_EQ(result.backend_used, Backend::None);
}

TEST(Dispatcher, AutoBackendWithNoCapabilitiesReturnsBackendUnavailable)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = false
        },
        .config = {
            .backend_config = {.preferred = Backend::Auto, .allow_fallback = true},
            .use_pinned_memory = false,
            .use_async_transfers = false
        }
    };

    VectorOpParams params{
        .length = 3,
        .op_type = VectorOperation::Add
    };

    Result result{};
    std::vector<float> v1{1, 2, 3};
    std::vector<float> v2{4, 5, 6};
    std::vector<float> out(3, 0);

    StatusCode status_code = dispatch_vector_operation(ctx, params, v1, v2, out, result);

    EXPECT_EQ(status_code, StatusCode::BackendUnavailable);
    EXPECT_EQ(result.status, StatusCode::BackendUnavailable);
    EXPECT_EQ(result.backend_used, Backend::None);
}

TEST(Dispatcher, MatrixMultiplyDispatchesToCpu)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true
        },
        .config = {
            .backend_config = {.preferred = Backend::CPU, .allow_fallback = false},
            .use_pinned_memory = false,
            .use_async_transfers = false
        }
    };

    MatrixMultiplyParams params{
        .A_shape = MatrixShape{2, 3},
        .B_shape = MatrixShape{3, 2},
        .output_shape = MatrixShape{2, 2}
    };

    const std::vector<float> a{
        1, 2, 3,
        4, 5, 6};
    const std::vector<float> b{
        7, 8,
        9, 10,
        11, 12};
    std::vector<float> out(4, 0.0f);
    Result result{};

    const StatusCode status = dispatch_matrix_multiply(ctx, params, a, b, out, result);

    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_EQ(result.backend_used, Backend::CPU);
    EXPECT_FLOAT_EQ(out[0], 58.0f);
    EXPECT_FLOAT_EQ(out[1], 64.0f);
    EXPECT_FLOAT_EQ(out[2], 139.0f);
    EXPECT_FLOAT_EQ(out[3], 154.0f);
}

TEST(Dispatcher, ConvolutionDispatchesToCpu)
{
    RuntimeContext ctx{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true
        },
        .config = {
            .backend_config = {.preferred = Backend::CPU, .allow_fallback = false},
            .use_pinned_memory = false,
            .use_async_transfers = false
        }
    };

    ConvolutionParams params{
        .input_shape = Tensor{.dims = {1, 1, 3, 3}},
        .filter_shape = Tensor{.dims = {1, 1, 3, 3}},
        .output_shape = Tensor{.dims = {1, 1, 1, 1}},
        .stride_height = 1,
        .stride_width = 1,
        .padding_height = 0,
        .padding_width = 0
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
    Result result{};

    const StatusCode status = dispatch_convolution(ctx, params, input, filter, out, result);

    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_EQ(result.backend_used, Backend::CPU);
    EXPECT_FLOAT_EQ(out[0], 45.0f);
}
