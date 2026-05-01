#include <gtest/gtest.h>
#include "framework/logger.hpp"

#include <sstream>

TEST(Logger, EnumToStringMappings)
{
    EXPECT_STREQ(to_string(LogLevel::Error), "ERROR");
    EXPECT_STREQ(to_string(LogLevel::Warn), "WARN");
    EXPECT_STREQ(to_string(LogLevel::Info), "INFO");
    EXPECT_STREQ(to_string(LogLevel::Debug), "DEBUG");

    EXPECT_EQ(to_string(StatusCode::Success), "Success");
    EXPECT_EQ(to_string(StatusCode::InvalidArgument), "InvalidArgument");
    EXPECT_EQ(to_string(Backend::CPU), "CPU");
    EXPECT_EQ(to_string(Backend::GPU), "GPU");
}

TEST(Logger, VectorToCsvFormatsValues)
{
    const std::vector<float> v{1.0f, 2.5f, -3.0f};
    EXPECT_EQ(vector_to_csv(v), "1.000000,2.500000,-3.000000");
}

TEST(Logger, PrintOperationResultSuccessIncludesOutput)
{
    std::ostringstream oss;
    const std::vector<float> out{5.0f, 7.0f, 9.0f};
    print_operation_result(oss, StatusCode::Success, out);

    const std::string s = oss.str();
    EXPECT_NE(s.find("Success"), std::string::npos);
    EXPECT_NE(s.find("5.000000,7.000000,9.000000"), std::string::npos);
}

TEST(Logger, PrintBenchmarkRowIncludesFields)
{
    std::ostringstream oss;
    const Result r{
        .status = StatusCode::Success,
        .kernel_ms = 1.25,
        .transfer_ms = 0.75,
        .total_ms = 2.0,
        .backend_used = Backend::CPU,
    };

    print_benchmark_row(oss, "vector_add", Backend::CPU, 1024, r);
    const std::string s = oss.str();
    EXPECT_NE(s.find("op=vector_add"), std::string::npos);
    EXPECT_NE(s.find("backend=CPU"), std::string::npos);
    EXPECT_NE(s.find("size=1024"), std::string::npos);
    EXPECT_NE(s.find("status=Success"), std::string::npos);
}
