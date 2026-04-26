#include "framework/types.hpp"
#include "framework/ops.hpp"

StatusCode cpu_matrix_multiply_op(
    const MatrixMultiplyParams &params,
    const std::vector<float> &a, // size = rows * cols
    const std::vector<float> &b,
    std::vector<float> &out)
{
    IndexType a_rows = params.A_shape.rows,
              a_cols = params.A_shape.cols,
              b_rows = params.B_shape.rows,
              b_cols = params.B_shape.cols;

    if (a_cols != b_rows || a.size() != a_rows * a_cols || b.size() != b_rows * b_cols || out.size() != a_rows * b_cols)
    {
        return StatusCode::InvalidArgument;
    }

    for (IndexType rowA = 0; rowA < a_rows; rowA++)
    {
        for (IndexType colB = 0; colB < b_cols; colB++)
        {
            float sum = 0;
            for (IndexType colA = 0; colA < a_cols; colA++) // aka rowB
            {
                IndexType rowB = colA;

                sum += a[rowA * a_cols + colA] * b[rowB * b_cols + colB];
            }
            out[rowA * b_cols + colB] = sum;
        }
    }

    return StatusCode::Success;
}