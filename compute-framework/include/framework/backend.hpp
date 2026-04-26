#pragma once

enum class Backend
{
    Auto, // Let the system decide the best backend.
    CPU,  // Use CPU for computations.
    GPU,  // Use GPU for computations.
    None  // Used when CPU/GPU are both unavailable
};

struct BackendConfig
{
    Backend preferred = Backend::Auto; // Selected backend.
    bool allow_fallback = true;        // Whether to allow fallback to other backends.
};

struct BackendCapabilities
{
    bool gpu_available = false;
    bool cpu_available = true;
};