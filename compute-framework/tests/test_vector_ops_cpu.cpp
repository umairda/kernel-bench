#include <gtest/gtest.h>
#include "framework/ops.hpp"
#include "framework/cpu_ops.hpp"

TEST(VectorOpsCpu, AddBasic)
{
    VectorOpParams params{3, VectorOperation::Add};
    std::vector<float> a{1, 2, 3};
    std::vector<float> b{4, 5, 6};
    std::vector<float> out(3, 0);

    StatusCode s = cpu_vector_op(params, a, b, out);

    EXPECT_EQ(s, StatusCode::Success);
    EXPECT_FLOAT_EQ(out[0], 5.0f);
    EXPECT_FLOAT_EQ(out[1], 7.0f);
    EXPECT_FLOAT_EQ(out[2], 9.0f);
}

TEST(VectorOpsCpu, InvalidVectorLength)
{
    VectorOpParams params{3, VectorOperation::Subtract};
    std::vector<float> a{1, 2, 3};
    std::vector<float> b{4, 5};
    std::vector<float> out(3, 0);

    StatusCode s = cpu_vector_op(params, a, b, out);

    EXPECT_EQ(s, StatusCode::InvalidArgument);
}

TEST(VectorOpsCpu, SubtractBasic)
{
    VectorOpParams params{3, VectorOperation::Subtract};
    std::vector<float> a{5, 7, 9};
    std::vector<float> b{1, 2, 3};
    std::vector<float> out(3, 0);

    StatusCode s = cpu_vector_op(params, a, b, out);

    EXPECT_EQ(s, StatusCode::Success);
    EXPECT_FLOAT_EQ(out[0], 4.0f);
    EXPECT_FLOAT_EQ(out[1], 5.0f);
    EXPECT_FLOAT_EQ(out[2], 6.0f);
}

TEST(VectorOpsCpu, MultiplyBasic)
{
    VectorOpParams params{3, VectorOperation::Multiply};
    std::vector<float> a{1, 2, 3};
    std::vector<float> b{4, 5, 6};
    std::vector<float> out(3, 0);

    StatusCode s = cpu_vector_op(params, a, b, out);

    EXPECT_EQ(s, StatusCode::Success);
    EXPECT_FLOAT_EQ(out[0], 4.0f);
    EXPECT_FLOAT_EQ(out[1], 10.0f);
    EXPECT_FLOAT_EQ(out[2], 18.0f);
}

TEST(VectorOpsCpu, DivideBasic)
{
    VectorOpParams params{3, VectorOperation::Divide};
    std::vector<float> a{8, 10, 12};
    std::vector<float> b{2, 5, 3};
    std::vector<float> out(3, 0);

    StatusCode s = cpu_vector_op(params, a, b, out);

    EXPECT_EQ(s, StatusCode::Success);
    EXPECT_FLOAT_EQ(out[0], 4.0f);
    EXPECT_FLOAT_EQ(out[1], 2.0f);
    EXPECT_FLOAT_EQ(out[2], 4.0f);
}

TEST(VectorOpsCpu, DivideByZeroIsInvalidArgument)
{
    VectorOpParams params{3, VectorOperation::Divide};
    std::vector<float> a{8, 10, 12};
    std::vector<float> b{2, 0, 3};
    std::vector<float> out(3, 0);

    StatusCode s = cpu_vector_op(params, a, b, out);

    EXPECT_EQ(s, StatusCode::InvalidArgument);
}

TEST(VectorOpsCpu, ZeroLengthVectorsAreValid)
{
    VectorOpParams params{0, VectorOperation::Add};
    std::vector<float> a{};
    std::vector<float> b{};
    std::vector<float> out{};

    StatusCode s = cpu_vector_op(params, a, b, out);

    EXPECT_EQ(s, StatusCode::Success);
    EXPECT_TRUE(out.empty());
}
