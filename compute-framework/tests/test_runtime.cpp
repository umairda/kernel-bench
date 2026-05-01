#include <gtest/gtest.h>
#include "framework/runtime.hpp"

TEST(Runtime, InitializeRuntimeCopiesConfig)
{
    const ExecutionConfig config{
        .backend_config = {
            .preferred = Backend::GPU,
            .allow_fallback = true,
        },
        .use_pinned_memory = true,
        .use_async_transfers = true,
    };

    RuntimeContext ctx{};
    const StatusCode status = initialize_runtime(config, ctx);

    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_EQ(ctx.config.backend_config.preferred, Backend::GPU);
    EXPECT_TRUE(ctx.config.backend_config.allow_fallback);
    EXPECT_TRUE(ctx.config.use_pinned_memory);
    EXPECT_TRUE(ctx.config.use_async_transfers);
}

TEST(Runtime, ProbeBackendCapabilitiesAlwaysHasCpu)
{
    BackendCapabilities caps{};
    const StatusCode status = probe_backend_capabilities(caps);

    EXPECT_EQ(status, StatusCode::Success);
    EXPECT_TRUE(caps.cpu_available);
}

TEST(Runtime, SelectBackendAutoPrefersGpuThenCpu)
{
    RuntimeContext ctx_gpu{
        .capabilities = {
            .gpu_available = true,
            .cpu_available = true,
        },
        .config = {
            .backend_config = {.preferred = Backend::Auto, .allow_fallback = true},
        },
    };

    EXPECT_EQ(select_backend(ctx_gpu), Backend::GPU);

    RuntimeContext ctx_cpu{
        .capabilities = {
            .gpu_available = false,
            .cpu_available = true,
        },
        .config = {
            .backend_config = {.preferred = Backend::Auto, .allow_fallback = true},
        },
    };

    EXPECT_EQ(select_backend(ctx_cpu), Backend::CPU);
}
