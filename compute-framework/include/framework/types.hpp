#pragma once
#include <cstddef>
#include <vector>

enum class DataType
{
    Float32,
    Float64,
    Int32,
    Int64,
};

enum class VectorOperation
{
    Add,
    Subtract,
    Multiply,
    Divide
};

enum class OperationKind
{
    MatrixMultiply,
    Convolution,
    VectorOperation
};

enum class StatusCode
{
    Success,
    InvalidArgument,
    OutOfMemory,
    NotImplemented,
    BackendUnavailable,
    BackendBusy
};

using IndexType = std::size_t;

struct VectorShape
{
    IndexType length;

    IndexType element_count() const
    {
        return length;
    }
};

struct MatrixShape
{
    IndexType rows;
    IndexType cols;

    IndexType element_count() const
    {
        if (rows == 0 || cols == 0)
        {
            return 0;
        }

        return rows * cols;
    }
};
