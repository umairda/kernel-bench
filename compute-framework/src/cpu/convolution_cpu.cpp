#include "framework/cpu_ops.hpp"

namespace
{
    /**
     *
     * N = batch size (number of samples/images)
     * C = channels (e.g., RGB = 3, feature maps in deeper layers)
     * H = height
     * W = width
     *
     */
    // Convert 4D NCHW coordinates into a flat 1D index for contiguous storage.
    IndexType flatten_nchw(
        const IndexType n,
        const IndexType c,
        const IndexType h,
        const IndexType w,
        const IndexType channels,
        const IndexType height,
        const IndexType width)
    {
        return (((n * channels + c) * height + h) * width + w);
    }
} // namespace

StatusCode cpu_convolution_op(
    const ConvolutionParams &params,
    const std::vector<float> &input,
    const std::vector<float> &filter,
    std::vector<float> &out)
{
    if (params.input_shape.dims.size() != 4 ||
        params.filter_shape.dims.size() != 4 ||
        params.output_shape.dims.size() != 4)
    {
        return StatusCode::InvalidArgument;
    }

    const IndexType n = params.input_shape.dims[0];
    const IndexType c_in = params.input_shape.dims[1];
    const IndexType h_in = params.input_shape.dims[2];
    const IndexType w_in = params.input_shape.dims[3];

    const IndexType c_out = params.filter_shape.dims[0];
    const IndexType filter_c_in = params.filter_shape.dims[1];
    const IndexType k_h = params.filter_shape.dims[2];
    const IndexType k_w = params.filter_shape.dims[3];

    const IndexType out_n = params.output_shape.dims[0];
    const IndexType out_c = params.output_shape.dims[1];
    const IndexType h_out = params.output_shape.dims[2];
    const IndexType w_out = params.output_shape.dims[3];

    if (params.stride_height == 0 || params.stride_width == 0)
    {
        return StatusCode::InvalidArgument;
    }

    if (c_in != filter_c_in || out_n != n || out_c != c_out)
    {
        return StatusCode::InvalidArgument;
    }

    const IndexType expected_h_out =
        (h_in + 2 * params.padding_height < k_h)
            ? 0
            : ((h_in + 2 * params.padding_height - k_h) / params.stride_height + 1);
    const IndexType expected_w_out =
        (w_in + 2 * params.padding_width < k_w)
            ? 0
            : ((w_in + 2 * params.padding_width - k_w) / params.stride_width + 1);

    if (h_out != expected_h_out || w_out != expected_w_out)
    {
        return StatusCode::InvalidArgument;
    }

    const IndexType input_size = n * c_in * h_in * w_in;
    const IndexType filter_size = c_out * c_in * k_h * k_w;
    const IndexType out_size = out_n * out_c * h_out * w_out;

    if (input.size() != input_size || filter.size() != filter_size || out.size() != out_size)
    {
        return StatusCode::InvalidArgument;
    }

    if (out_size == 0)
    {
        return StatusCode::Success;
    }

    // Essentially this is a cross-correlation between a sliding input patch and filter slice
    // [Cin, Kh, Kw] = dimensions of input/filter patch, Cin = input channel, Kh/Kw = kernal height/width

    // Naive convolution in NCHW layout:
    // For each output element Y[n, c_out, out_y, out_x], compute:
    // sum_{c_in, k_y, k_x}
    //   X[n, c_in, out_y * stride_h + k_y - pad_h, out_x * stride_w + k_x - pad_w]
    // * W[c_out, c_in, k_y, k_x]
    for (IndexType batch = 0; batch < n; ++batch)
    {
        for (IndexType out_channel = 0; out_channel < c_out; ++out_channel)
        {
            for (IndexType out_y = 0; out_y < h_out; ++out_y)
            {
                for (IndexType out_x = 0; out_x < w_out; ++out_x)
                {
                    float sum = 0.0f;

                    for (IndexType in_channel = 0; in_channel < c_in; ++in_channel)
                    {
                        for (IndexType kernel_y = 0; kernel_y < k_h; ++kernel_y)
                        {
                            for (IndexType kernel_x = 0; kernel_x < k_w; ++kernel_x)
                            {
                                // Map output location + kernel offset back into input coordinates.
                                // Padding shifts this coordinate space.
                                const int input_y =
                                    static_cast<int>(out_y * params.stride_height + kernel_y) -
                                    static_cast<int>(params.padding_height);
                                const int input_x =
                                    static_cast<int>(out_x * params.stride_width + kernel_x) -
                                    static_cast<int>(params.padding_width);

                                // Zero-padding behavior: out-of-bounds input contributes 0.
                                if (input_y < 0 || input_x < 0 ||
                                    input_y >= static_cast<int>(h_in) ||
                                    input_x >= static_cast<int>(w_in))
                                {
                                    continue;
                                }

                                const IndexType input_idx = flatten_nchw(
                                    batch,
                                    in_channel,
                                    static_cast<IndexType>(input_y),
                                    static_cast<IndexType>(input_x),
                                    c_in,
                                    h_in,
                                    w_in);
                                // Filter is laid out as [c_out, c_in, k_h, k_w] in flat storage.
                                const IndexType filter_idx = (((out_channel * c_in + in_channel) * k_h + kernel_y) * k_w + kernel_x);

                                sum += input[input_idx] * filter[filter_idx];
                            }
                        }
                    }

                    // Store Y[n, c_out, out_y, out_x].
                    const IndexType out_idx = flatten_nchw(batch, out_channel, out_y, out_x, c_out, h_out, w_out);
                    out[out_idx] = sum;
                }
            }
        }
    }

    return StatusCode::Success;
}
