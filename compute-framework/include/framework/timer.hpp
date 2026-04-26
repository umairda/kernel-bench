#pragma once

#include <chrono>

class Stopwatch
{
public:
    using Clock = std::chrono::steady_clock;
    using TimePoint = Clock::time_point;

    void start();
    void stop();
    void reset();

    bool is_running() const;
    bool has_started() const;

    double elapsed_ms() const;
    double elapsed_us() const;
    double elapsed_seconds() const;

private:
    TimePoint start_time_{};
    TimePoint stop_time_{};
    bool started_ = false;
    bool running_ = false;
};

struct ScopedStopwatch
{
    explicit ScopedStopwatch(double &out_ms_ref);
    ~ScopedStopwatch();

private:
    Stopwatch stopwatch_;
    double &out_ms_;
};
