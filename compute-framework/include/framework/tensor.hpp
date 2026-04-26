#pragma once

#include <cstddef>
#include <stdexcept>
#include <vector>
#include "types.hpp"

struct Tensor
{
    std::vector<float> data;

    // Size of each axis
    // NCHW = [N, C, H, W]
    std::vector<IndexType> dims;

    // How far you jump in flat memory when one index in an axis increases by 1
    std::vector<IndexType> strides;

    // Number of axes/dimensions (e.g., NCHW -> 4).
    IndexType rank() const
    {
        return dims.size();
    }

    // Product of dims. Dense tensor data size should match this value.
    IndexType element_count() const
    {
        if (dims.empty())
        {
            return 0;
        }

        IndexType count = 1;
        for (IndexType d : dims)
        {
            if (d == 0)
            {
                return 0;
            }
            count *= d;
        }
        return count;
    }

    bool is_empty() const
    {
        return element_count() == 0;
    }

    // Compute row-major strides from dims.
    // Example dims [N, C, H, W] -> strides [C*H*W, H*W, W, 1].
    std::vector<IndexType> compute_row_major_strides() const
    {
        std::vector<IndexType> out(rank(), 1);
        if (rank() == 0)
        {
            return out;
        }

        for (IndexType i = rank() - 1; i > 0; --i)
        {
            out[i - 1] = out[i] * dims[i];
        }
        return out;
    }

    // Convert N-D indices into one flat contiguous index.
    IndexType flat_index(const std::vector<IndexType> &indices) const
    {
        if (indices.size() != rank())
        {
            throw std::invalid_argument("indices rank does not match tensor rank");
        }

        const std::vector<IndexType> active_strides = strides.empty() ? compute_row_major_strides() : strides;

        IndexType idx = 0;
        for (IndexType axis = 0; axis < rank(); ++axis)
        {
            if (indices[axis] >= dims[axis])
            {
                throw std::out_of_range("tensor index out of range");
            }
            idx += indices[axis] * active_strides[axis];
        }
        return idx;
    }
};
