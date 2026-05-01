#include <gtest/gtest.h>
#include "framework/timer.hpp"

#include <thread>

TEST(Timer, StopwatchStartStopAndReset)
{
    Stopwatch sw;
    EXPECT_FALSE(sw.has_started());
    EXPECT_FALSE(sw.is_running());

    sw.start();
    EXPECT_TRUE(sw.has_started());
    EXPECT_TRUE(sw.is_running());

    std::this_thread::sleep_for(std::chrono::milliseconds(2));
    sw.stop();

    EXPECT_FALSE(sw.is_running());
    EXPECT_GT(sw.elapsed_ms(), 0.0);
    EXPECT_GT(sw.elapsed_us(), 0.0);
    EXPECT_GT(sw.elapsed_seconds(), 0.0);

    sw.reset();
    EXPECT_FALSE(sw.has_started());
    EXPECT_FALSE(sw.is_running());
    EXPECT_DOUBLE_EQ(sw.elapsed_ms(), 0.0);
}

TEST(Timer, ScopedStopwatchWritesOutput)
{
    double ms = 0.0;
    {
        ScopedStopwatch scoped(ms);
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    EXPECT_GT(ms, 0.0);
}
