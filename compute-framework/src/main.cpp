#include "framework/parse_args.hpp"
#include "framework/cpu_ops.hpp"
#include "framework/gpu_ops.hpp"
#include "framework/logger.hpp"

#include <sstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{
StatusCode run_vector(const ParsedArgs &args, std::vector<float> &out)
{
    out.assign(args.a.size(), 0.0f);
    if (args.backend == Backend::GPU)
    {
        return gpu_vector_op(args.vector_params, args.a, args.b, out);
    }
    return cpu_vector_op(args.vector_params, args.a, args.b, out);
}

StatusCode run_matmul(const ParsedArgs &args, std::vector<float> &out)
{
    out.assign(args.matmul_params.output_shape.element_count(), 0.0f);
    if (args.backend == Backend::GPU)
    {
        return gpu_matmul_op(args.matmul_params, args.a, args.b, out);
    }
    return cpu_matrix_multiply_op(args.matmul_params, args.a, args.b, out);
}

StatusCode run_convolution(const ParsedArgs &args, std::vector<float> &out)
{
    out.assign(args.convolution_params.output_shape.element_count(), 0.0f);
    if (args.backend == Backend::GPU)
    {
        return gpu_convolution_op(args.convolution_params, args.input, args.filter, out);
    }
    return cpu_convolution_op(args.convolution_params, args.input, args.filter, out);
}

void run_main(int argc, char *argv[])
{
    const ParsedArgs args = parse_args(argc, argv);
    std::vector<float> out;

    StatusCode status = StatusCode::InvalidArgument;
    switch (args.operation)
    {
    case CliOperation::Vector:
        status = run_vector(args, out);
        break;
    case CliOperation::Matmul:
        status = run_matmul(args, out);
        break;
    case CliOperation::Convolution:
        status = run_convolution(args, out);
        break;
    }

    print_operation_result(std::cout, status, out);
}
} // namespace

int main(int argc, char *argv[])
{
    try
    {
        run_main(argc, argv);
        return 0;
    }
    catch (const std::invalid_argument &e)
    {
        if (std::string(e.what()) == "help")
        {
            print_usage(argv[0], std::cout);
            return 0;
        }

        Logger::instance().error(std::string("Invalid argument: ") + e.what());
        print_usage(argv[0], std::cerr);
        return 2;
    }
    catch (const std::exception &e)
    {
        Logger::instance().error(std::string("Error: ") + e.what());
        return 1;
    }
}
