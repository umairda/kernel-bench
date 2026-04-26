#include "framework/parse_args.hpp"

#include <format>
#include <stdexcept>
#include <string>
#include <unordered_map>

namespace
{
std::vector<float> parse_csv_floats(const std::string &csv)
{
    std::vector<float> out;
    std::size_t start = 0;

    while (start <= csv.size())
    {
        const std::size_t end = csv.find(',', start);
        const std::string token = (end == std::string::npos)
                                      ? csv.substr(start)
                                      : csv.substr(start, end - start);
        if (token.empty())
        {
            throw std::invalid_argument("CSV values must not contain empty entries");
        }

        out.push_back(std::stof(token));

        if (end == std::string::npos)
        {
            break;
        }
        start = end + 1;
    }

    return out;
}

IndexType parse_index(const std::string &s)
{
    return static_cast<IndexType>(std::stoull(s));
}

VectorOperation parse_vector_op(const std::string &name)
{
    if (name == "add")
    {
        return VectorOperation::Add;
    }
    if (name == "subtract")
    {
        return VectorOperation::Subtract;
    }
    if (name == "multiply")
    {
        return VectorOperation::Multiply;
    }
    if (name == "divide")
    {
        return VectorOperation::Divide;
    }
    throw std::invalid_argument(std::format("Unsupported vector operation: {}", name));
}

Backend parse_backend(const std::string &name)
{
    if (name == "cpu")
    {
        return Backend::CPU;
    }
    if (name == "gpu")
    {
        return Backend::GPU;
    }
    throw std::invalid_argument(std::format("Unsupported backend: {}", name));
}

const std::string &required_flag(
    const std::unordered_map<std::string, std::string> &flags,
    const std::string &name)
{
    const auto it = flags.find(name);
    if (it == flags.end())
    {
        throw std::invalid_argument(std::format("Missing required flag: {}", name));
    }
    return it->second;
}
} // namespace

void print_usage(const char *program, std::ostream &out)
{
    out << "Usage:\n";
    out << "  " << program << " --op vector --backend <cpu|gpu> --vector-op <add|subtract|multiply|divide> --a <csv> --b <csv>\n";
    out << "  " << program << " --op matmul --backend <cpu|gpu> --a-rows <n> --a-cols <n> --b-rows <n> --b-cols <n> --a <csv> --b <csv>\n";
    out << "  " << program << " --op convolution --backend <cpu|gpu> --n <n> --c-in <n> --h-in <n> --w-in <n> --c-out <n> --k-h <n> --k-w <n> --stride-h <n> --stride-w <n> --pad-h <n> --pad-w <n> --input <csv> --filter <csv>\n";
    out << "Examples:\n";
    out << "  " << program << " --op vector --backend cpu --vector-op add --a \"1,2,3\" --b \"4,5,6\"\n";
    out << "  " << program << " --op matmul --backend gpu --a-rows 2 --a-cols 3 --b-rows 3 --b-cols 2 --a \"1,2,3,4,5,6\" --b \"7,8,9,10,11,12\"\n";
    out << "  " << program << " --op convolution --backend cpu --n 1 --c-in 1 --h-in 3 --w-in 3 --c-out 1 --k-h 3 --k-w 3 --stride-h 1 --stride-w 1 --pad-h 0 --pad-w 0 --input \"1,2,3,4,5,6,7,8,9\" --filter \"1,1,1,1,1,1,1,1,1\"\n";
}

ParsedArgs parse_args(int argc, char *argv[])
{
    if (argc < 2)
    {
        throw std::invalid_argument("No arguments provided. Use --help for usage.");
    }

    std::unordered_map<std::string, std::string> flags;
    for (int i = 1; i < argc; ++i)
    {
        const std::string token = argv[i];
        if (token == "--help" || token == "-h")
        {
            throw std::invalid_argument("help");
        }
        if (!token.starts_with("--"))
        {
            throw std::invalid_argument(std::format("Unexpected positional argument: {}", token));
        }
        if (i + 1 >= argc)
        {
            throw std::invalid_argument(std::format("Flag {} requires a value", token));
        }
        flags[token] = argv[++i];
    }

    ParsedArgs parsed{};
    const std::string op = required_flag(flags, "--op");
    parsed.backend = parse_backend(required_flag(flags, "--backend"));

    if (op == "vector")
    {
        parsed.operation = CliOperation::Vector;
        parsed.a = parse_csv_floats(required_flag(flags, "--a"));
        parsed.b = parse_csv_floats(required_flag(flags, "--b"));

        if (parsed.a.size() != parsed.b.size())
        {
            throw std::invalid_argument(std::format(
                "Vector lengths differ: a={} b={}", parsed.a.size(), parsed.b.size()));
        }

        parsed.vector_params = VectorOpParams{
            .length = parsed.a.size(),
            .op_type = parse_vector_op(required_flag(flags, "--vector-op")),
        };
        return parsed;
    }

    if (op == "matmul")
    {
        parsed.operation = CliOperation::Matmul;
        const IndexType a_rows = parse_index(required_flag(flags, "--a-rows"));
        const IndexType a_cols = parse_index(required_flag(flags, "--a-cols"));
        const IndexType b_rows = parse_index(required_flag(flags, "--b-rows"));
        const IndexType b_cols = parse_index(required_flag(flags, "--b-cols"));

        parsed.matmul_params = MatrixMultiplyParams{
            .A_shape = MatrixShape{a_rows, a_cols},
            .B_shape = MatrixShape{b_rows, b_cols},
            .output_shape = MatrixShape{a_rows, b_cols},
        };

        parsed.a = parse_csv_floats(required_flag(flags, "--a"));
        parsed.b = parse_csv_floats(required_flag(flags, "--b"));
        return parsed;
    }

    if (op == "convolution")
    {
        parsed.operation = CliOperation::Convolution;

        const IndexType n = parse_index(required_flag(flags, "--n"));
        const IndexType c_in = parse_index(required_flag(flags, "--c-in"));
        const IndexType h_in = parse_index(required_flag(flags, "--h-in"));
        const IndexType w_in = parse_index(required_flag(flags, "--w-in"));
        const IndexType c_out = parse_index(required_flag(flags, "--c-out"));
        const IndexType k_h = parse_index(required_flag(flags, "--k-h"));
        const IndexType k_w = parse_index(required_flag(flags, "--k-w"));
        const IndexType stride_h = parse_index(required_flag(flags, "--stride-h"));
        const IndexType stride_w = parse_index(required_flag(flags, "--stride-w"));
        const IndexType pad_h = parse_index(required_flag(flags, "--pad-h"));
        const IndexType pad_w = parse_index(required_flag(flags, "--pad-w"));

        if (stride_h == 0 || stride_w == 0)
        {
            throw std::invalid_argument("stride values must be greater than zero");
        }

        const IndexType out_h =
            (h_in + 2 * pad_h < k_h)
                ? 0
                : ((h_in + 2 * pad_h - k_h) / stride_h + 1);
        const IndexType out_w =
            (w_in + 2 * pad_w < k_w)
                ? 0
                : ((w_in + 2 * pad_w - k_w) / stride_w + 1);

        parsed.convolution_params = ConvolutionParams{
            .input_shape = Tensor{.dims = {n, c_in, h_in, w_in}},
            .filter_shape = Tensor{.dims = {c_out, c_in, k_h, k_w}},
            .output_shape = Tensor{.dims = {n, c_out, out_h, out_w}},
            .stride_height = stride_h,
            .stride_width = stride_w,
            .padding_height = pad_h,
            .padding_width = pad_w,
        };
        parsed.input = parse_csv_floats(required_flag(flags, "--input"));
        parsed.filter = parse_csv_floats(required_flag(flags, "--filter"));
        return parsed;
    }

    throw std::invalid_argument(std::format("Unsupported --op value: {}", op));
}
