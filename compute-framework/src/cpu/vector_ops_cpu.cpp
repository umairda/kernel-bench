#include "framework/types.hpp"
#include "framework/ops.hpp"

using BinaryOp = float (*)(float, float);

float add_fn(const float a, const float b)
{
    return a + b;
}

float subtract_fn(const float a, const float b)
{
    return a - b;
}

float multiply_fn(const float a, const float b)
{
    return a * b;
}

float divide_fn(const float dividend, const float divisor)
{
    return dividend / divisor;
}

StatusCode cpu_vector_op(const VectorOpParams &params, const std::vector<float> &a, const std::vector<float> &b, std::vector<float> &out)
{
    if (a.size() != params.length || b.size() != params.length || out.size() != params.length)
    {
        return StatusCode::InvalidArgument;
    }

    BinaryOp op = nullptr;
    switch (params.op_type)
    {
    case VectorOperation::Add:
        op = add_fn;
        break;
    case VectorOperation::Subtract:
        op = subtract_fn;
        break;
    case VectorOperation::Multiply:
        op = multiply_fn;
        break;
    case VectorOperation::Divide:
        for (IndexType i = 0; i < b.size(); ++i)
        {
            if (b[i] == 0.0f)
            {
                return StatusCode::InvalidArgument;
            }
        }
        op = divide_fn;
        break;
    default:
        return StatusCode::NotImplemented;
    }

    for (IndexType i = 0; i < a.size(); ++i)
    {
        out[i] = op(a[i], b[i]);
    }

    return StatusCode::Success;
}
