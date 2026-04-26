#pragma once

#include <cstddef>
#include <iosfwd>
#include <string>
#include <string_view>
#include <vector>
#include "framework/backend.hpp"
#include "framework/ops.hpp"

enum class LogLevel
{
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
};

struct LoggerConfig
{
    LogLevel min_level = LogLevel::Info;
    bool include_timestamp = true;
};

class Logger
{
public:
    static Logger &instance();

    void set_config(const LoggerConfig &config);
    LoggerConfig config() const;

    void log(LogLevel level, std::string_view message);
    void error(std::string_view message);
    void warn(std::string_view message);
    void info(std::string_view message);
    void debug(std::string_view message);

private:
    Logger() = default;

    LoggerConfig config_{};
};

const char *to_string(LogLevel level);
std::string to_string(StatusCode status);
std::string to_string(Backend backend);
std::string vector_to_csv(const std::vector<float> &values);

void print_operation_result(
    std::ostream &out,
    StatusCode status,
    const std::vector<float> &output);

void print_benchmark_row(
    std::ostream &out,
    std::string_view op_name,
    Backend backend,
    std::size_t size,
    const Result &result);
