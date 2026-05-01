#include "framework/parse_args.hpp"

#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>

namespace
{
template <typename... Args>
std::string join_message(Args &&...args)
{
    std::ostringstream oss;
    (oss << ... << std::forward<Args>(args));
    return oss.str();
}

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

std::vector<float> parse_csv_file(const std::string &path)
{
    std::ifstream in(path);
    if (!in.is_open())
    {
        throw std::invalid_argument(join_message("Unable to open file: ", path));
    }

    std::ostringstream contents;
    contents << in.rdbuf();
    return parse_csv_floats(contents.str());
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
    throw std::invalid_argument(join_message("Unsupported vector operation: ", name));
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
    throw std::invalid_argument(join_message("Unsupported backend: ", name));
}

bool parse_bool_flag_value(const std::string &value, const std::string &name)
{
    if (value == "true" || value == "1" || value == "yes")
    {
        return true;
    }
    if (value == "false" || value == "0" || value == "no")
    {
        return false;
    }
    throw std::invalid_argument(join_message("Unsupported value for ", name, ": ", value, " (expected true/false)"));
}

const std::string &required_flag(
    const std::unordered_map<std::string, std::string> &flags,
    const std::string &name)
{
    const auto it = flags.find(name);
    if (it == flags.end())
    {
        throw std::invalid_argument(join_message("Missing required flag: ", name));
    }
    return it->second;
}

std::vector<float> parse_data_values(
    const std::unordered_map<std::string, std::string> &flags,
    const std::string &inline_flag,
    const std::string &file_flag)
{
    const auto inline_it = flags.find(inline_flag);
    const auto file_it = flags.find(file_flag);
    const bool has_inline = inline_it != flags.end();
    const bool has_file = file_it != flags.end();

    if (has_inline == has_file)
    {
        throw std::invalid_argument(
            join_message("Specify exactly one of ", inline_flag, " or ", file_flag));
    }

    if (has_inline)
    {
        return parse_csv_floats(inline_it->second);
    }

    return parse_csv_file(file_it->second);
}

bool has_any_flag(
    const std::unordered_map<std::string, std::string> &flags,
    const std::string &a,
    const std::string &b)
{
    return (flags.find(a) != flags.end()) || (flags.find(b) != flags.end());
}

std::vector<float> generate_sequence(IndexType count, float start, float step = 1.0f)
{
    std::vector<float> out(count);
    for (IndexType i = 0; i < count; ++i)
    {
        out[i] = start + static_cast<float>(i) * step;
    }
    return out;
}

std::vector<float> generate_modulated(IndexType count, IndexType mod_base)
{
    std::vector<float> out(count);
    for (IndexType i = 0; i < count; ++i)
    {
        out[i] = static_cast<float>((i % mod_base) + 1);
    }
    return out;
}
} // namespace

void print_usage(const char *program, std::ostream &out)
{
    out << "Usage:\n";
    out << "  " << program << " --op vector --backend <cpu|gpu> --vector-op <add|subtract|multiply|divide> [--length <n>] [--a <csv>|--a-file <path>] [--b <csv>|--b-file <path>] [--dump-output-csv <true|false>]\n";
    out << "  " << program << " --op matmul --backend <cpu|gpu> --a-rows <n> --a-cols <n> --b-rows <n> --b-cols <n> [--a <csv>|--a-file <path>] [--b <csv>|--b-file <path>] [--dump-output-csv <true|false>]\n";
    out << "  " << program << " --op convolution --backend <cpu|gpu> --n <n> --c-in <n> --h-in <n> --w-in <n> --c-out <n> --k-h <n> --k-w <n> --stride-h <n> --stride-w <n> --pad-h <n> --pad-w <n> [--input <csv>|--input-file <path>] [--filter <csv>|--filter-file <path>] [--dump-output-csv <true|false>]\n";
    out << "Examples:\n";
    out << "  " << program << " --op vector --backend cpu --vector-op add --length 1000000\n";
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
            throw std::invalid_argument(join_message("Unexpected positional argument: ", token));
        }
        if (i + 1 >= argc)
        {
            throw std::invalid_argument(join_message("Flag ", token, " requires a value"));
        }
        flags[token] = argv[++i];
    }

    ParsedArgs parsed{};
    const std::string op = required_flag(flags, "--op");
    parsed.backend = parse_backend(required_flag(flags, "--backend"));
    const auto dump_csv_it = flags.find("--dump-output-csv");
    if (dump_csv_it != flags.end())
    {
        parsed.dump_output_csv = parse_bool_flag_value(dump_csv_it->second, "--dump-output-csv");
    }

    if (op == "vector")
    {
        parsed.operation = CliOperation::Vector;
        const bool has_a = has_any_flag(flags, "--a", "--a-file");
        const bool has_b = has_any_flag(flags, "--b", "--b-file");
        const bool has_length = flags.find("--length") != flags.end();
        if ((has_a || has_b) && has_length)
        {
            throw std::invalid_argument(
                "Specify either generated vector length (--length) or explicit inputs (--a/--a-file and --b/--b-file), not both");
        }

        if (has_a || has_b)
        {
            parsed.a = parse_data_values(flags, "--a", "--a-file");
            parsed.b = parse_data_values(flags, "--b", "--b-file");
            if (parsed.a.size() != parsed.b.size())
            {
                throw std::invalid_argument(
                    join_message("Vector lengths differ: a=", parsed.a.size(), " b=", parsed.b.size()));
            }
        }
        else
        {
            const IndexType length = has_length ? parse_index(required_flag(flags, "--length")) : 0;
            if (length == 0)
            {
                throw std::invalid_argument("Vector operation requires either --length or explicit --a/--b inputs");
            }
            parsed.a = generate_sequence(length, 1.0f);
            parsed.b = generate_sequence(length, 2.0f);
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

        const bool has_a = has_any_flag(flags, "--a", "--a-file");
        const bool has_b = has_any_flag(flags, "--b", "--b-file");
        if (has_a || has_b)
        {
            parsed.a = parse_data_values(flags, "--a", "--a-file");
            parsed.b = parse_data_values(flags, "--b", "--b-file");
        }
        else
        {
            parsed.a = generate_sequence(a_rows * a_cols, 1.0f);
            parsed.b = generate_sequence(b_rows * b_cols, 1.0f);
        }
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
        const bool has_input = has_any_flag(flags, "--input", "--input-file");
        const bool has_filter = has_any_flag(flags, "--filter", "--filter-file");
        if (has_input || has_filter)
        {
            parsed.input = parse_data_values(flags, "--input", "--input-file");
            parsed.filter = parse_data_values(flags, "--filter", "--filter-file");
        }
        else
        {
            parsed.input = generate_modulated(n * c_in * h_in * w_in, 11);
            parsed.filter = generate_modulated(c_out * c_in * k_h * k_w, 7);
        }
        return parsed;
    }

    throw std::invalid_argument(join_message("Unsupported --op value: ", op));
}
