#include "framework/timer.hpp"

void Stopwatch::start()
{
    start_time_ = Clock::now();
    stop_time_ = TimePoint{};
    started_ = true;
    running_ = true;
}

void Stopwatch::stop()
{
    if (!running_)
    {
        return;
    }
    stop_time_ = Clock::now();
    running_ = false;
}

void Stopwatch::reset()
{
    start_time_ = TimePoint{};
    stop_time_ = TimePoint{};
    started_ = false;
    running_ = false;
}

bool Stopwatch::is_running() const
{
    return running_;
}

bool Stopwatch::has_started() const
{
    return started_;
}

double Stopwatch::elapsed_ms() const
{
    if (!started_)
    {
        return 0.0;
    }

    const TimePoint end = running_ ? Clock::now() : stop_time_;
    const auto micros = std::chrono::duration_cast<std::chrono::microseconds>(end - start_time_);
    return static_cast<double>(micros.count()) / 1000.0;
}

double Stopwatch::elapsed_us() const
{
    return elapsed_ms() * 1000.0;
}

double Stopwatch::elapsed_seconds() const
{
    return elapsed_ms() / 1000.0;
}

ScopedStopwatch::ScopedStopwatch(double &out_ms_ref)
    : out_ms_(out_ms_ref)
{
    stopwatch_.start();
}

ScopedStopwatch::~ScopedStopwatch()
{
    stopwatch_.stop();
    out_ms_ = stopwatch_.elapsed_ms();
}
