#include "framework/logger.hpp"

#include <chrono>
#include <iostream>
#include <mutex>
#include <sstream>
#include <iomanip>

namespace
{
std::mutex g_logger_mutex;

std::string now_timestamp_ms()
{
    const auto now = std::chrono::system_clock::now();
    const auto ms =
        std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
    return std::to_string(ms);
}
} // namespace

Logger &Logger::instance()
{
    static Logger logger;
    return logger;
}

void Logger::set_config(const LoggerConfig &config)
{
    std::lock_guard<std::mutex> lock(g_logger_mutex);
    config_ = config;
}

LoggerConfig Logger::config() const
{
    std::lock_guard<std::mutex> lock(g_logger_mutex);
    return config_;
}

void Logger::log(const LogLevel level, const std::string_view message)
{
    std::lock_guard<std::mutex> lock(g_logger_mutex);
    if (static_cast<int>(level) > static_cast<int>(config_.min_level))
    {
        return;
    }

    std::ostream &stream =
        (level == LogLevel::Error || level == LogLevel::Warn) ? std::cerr : std::cout;

    if (config_.include_timestamp)
    {
        stream << "[" << now_timestamp_ms() << "]";
    }
    stream << "[" << to_string(level) << "] " << message << "\n";
}

void Logger::error(const std::string_view message)
{
    log(LogLevel::Error, message);
}

void Logger::warn(const std::string_view message)
{
    log(LogLevel::Warn, message);
}

void Logger::info(const std::string_view message)
{
    log(LogLevel::Info, message);
}

void Logger::debug(const std::string_view message)
{
    log(LogLevel::Debug, message);
}

const char *to_string(const LogLevel level)
{
    switch (level)
    {
    case LogLevel::Error:
        return "ERROR";
    case LogLevel::Warn:
        return "WARN";
    case LogLevel::Info:
        return "INFO";
    case LogLevel::Debug:
        return "DEBUG";
    default:
        return "UNKNOWN";
    }
}

std::string to_string(const StatusCode status)
{
    switch (status)
    {
    case StatusCode::Success:
        return "Success";
    case StatusCode::InvalidArgument:
        return "InvalidArgument";
    case StatusCode::OutOfMemory:
        return "OutOfMemory";
    case StatusCode::NotImplemented:
        return "NotImplemented";
    case StatusCode::BackendUnavailable:
        return "BackendUnavailable";
    default:
        return "UnknownStatus(" + std::to_string(static_cast<int>(status)) + ")";
    }
}

std::string to_string(const Backend backend)
{
    switch (backend)
    {
    case Backend::Auto:
        return "Auto";
    case Backend::CPU:
        return "CPU";
    case Backend::GPU:
        return "GPU";
    case Backend::None:
        return "None";
    default:
        return "UnknownBackend(" + std::to_string(static_cast<int>(backend)) + ")";
    }
}

std::string vector_to_csv(const std::vector<float> &values)
{
    std::string out;
    out.reserve(values.size() * 8);

    for (std::size_t i = 0; i < values.size(); ++i)
    {
        if (i > 0)
        {
            out += ",";
        }
        out += std::to_string(values[i]);
    }

    return out;
}

void print_operation_result(
    std::ostream &out,
    const StatusCode status,
    const std::vector<float> &output)
{
    if (status == StatusCode::Success)
    {
        out << "Success, out = " << vector_to_csv(output) << std::endl;
        return;
    }

    out << to_string(status) << std::endl;
}

void print_benchmark_row(
    std::ostream &out,
    const std::string_view op_name,
    const Backend backend,
    const std::size_t size,
    const Result &result)
{
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(3)
        << "op=" << op_name
        << " backend=" << to_string(backend)
        << " size=" << size
        << " status=" << to_string(result.status)
        << " kernel_ms=" << result.kernel_ms
        << " transfer_ms=" << result.transfer_ms
        << " total_ms=" << result.total_ms;
    out << oss.str() << std::endl;
}
