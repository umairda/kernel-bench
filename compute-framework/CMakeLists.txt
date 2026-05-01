cmake_minimum_required(VERSION 3.24)

project(gpu_compute_framework LANGUAGES CXX)

option(ENABLE_CUDA "Build CUDA sources" OFF)
if(ENABLE_CUDA)
  if(APPLE)
    message(FATAL_ERROR "ENABLE_CUDA=ON is not supported on Apple Silicon/macOS for NVIDIA CUDA builds. Use a Linux/Windows NVIDIA machine or cloud GPU instance.")
  endif()

  enable_language(CUDA)
  find_package(CUDAToolkit REQUIRED)

  set(CMAKE_CUDA_STANDARD 17)
  set(CMAKE_CUDA_STANDARD_REQUIRED ON)

  if(NOT DEFINED CMAKE_CUDA_ARCHITECTURES)
    set(
      CMAKE_CUDA_ARCHITECTURES
      "75;80;86;89"
      CACHE STRING
      "CUDA SM architectures to compile for (e.g. 75;80;86;89)"
    )
  endif()

  message(STATUS "CUDA architectures: ${CMAKE_CUDA_ARCHITECTURES}")
  add_compile_definitions(GPU_FRAMEWORK_ENABLE_CUDA=1)
  include_directories(${CUDAToolkit_INCLUDE_DIRS})
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_executable(compute
  src/main.cpp
  src/cli/parse_args.cpp
  src/runtime/dispatcher.cpp
  src/common/timer.cpp
  src/common/logger.cpp
  src/cpu/matmul_cpu.cpp
  src/cpu/convolution_cpu.cpp
  src/cpu/vector_ops_cpu.cpp
)

set(VECTOR_OPS_GPU_SOURCE src/gpu/gpu_ops_stub.cpp)
if(ENABLE_CUDA)
  set(VECTOR_OPS_GPU_SOURCE src/gpu/vector_ops_gpu.cu)
  target_sources(compute PRIVATE
    src/gpu/matmul_gpu.cu
    src/gpu/convolution_gpu.cu
    src/gpu/cuda_utils.cu
  )
endif()
target_sources(compute PRIVATE ${VECTOR_OPS_GPU_SOURCE})

target_include_directories(compute PRIVATE ${CMAKE_SOURCE_DIR}/include)

# GoogleTest setup

include(CTest)
enable_testing()

include(FetchContent)
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/refs/tags/v1.15.2.zip
)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

add_executable(vector_ops_tests
  tests/test_vector_ops_cpu.cpp
  src/cpu/vector_ops_cpu.cpp
  src/cpu/matmul_cpu.cpp
  src/cpu/convolution_cpu.cpp
  src/common/timer.cpp
  src/runtime/dispatcher.cpp
  ${VECTOR_OPS_GPU_SOURCE}
)

add_executable(dispatcher_tests
  tests/test_dispatcher.cpp
  src/common/timer.cpp
  src/runtime/dispatcher.cpp
  src/cpu/vector_ops_cpu.cpp
  src/cpu/matmul_cpu.cpp
  src/cpu/convolution_cpu.cpp
  ${VECTOR_OPS_GPU_SOURCE}
)

add_executable(convolution_cpu_tests
  tests/test_convolution_cpu.cpp
  src/cpu/convolution_cpu.cpp
)

add_executable(matmul_cpu_tests
  tests/test_matmul_cpu.cpp
  src/cpu/matmul_cpu.cpp
)

add_executable(matmul_tests
  tests/test_matmul.cpp
  src/runtime/dispatcher.cpp
  src/common/timer.cpp
  src/cpu/vector_ops_cpu.cpp
  src/cpu/matmul_cpu.cpp
  src/cpu/convolution_cpu.cpp
  ${VECTOR_OPS_GPU_SOURCE}
)

add_executable(runtime_tests
  tests/test_runtime.cpp
  src/runtime/dispatcher.cpp
  src/common/timer.cpp
  src/cpu/vector_ops_cpu.cpp
  src/cpu/matmul_cpu.cpp
  src/cpu/convolution_cpu.cpp
  ${VECTOR_OPS_GPU_SOURCE}
)

add_executable(common_tests
  tests/test_logger.cpp
  tests/test_timer.cpp
  src/common/logger.cpp
  src/common/timer.cpp
)

add_executable(gpu_ops_tests
  tests/test_vector_ops_gpu.cpp
  tests/test_matmul_gpu.cpp
  tests/test_convolution_gpu.cpp
  src/cpu/vector_ops_cpu.cpp
  src/cpu/matmul_cpu.cpp
  src/cpu/convolution_cpu.cpp
  ${VECTOR_OPS_GPU_SOURCE}
)
if(ENABLE_CUDA)
  target_sources(gpu_ops_tests PRIVATE
    src/gpu/matmul_gpu.cu
    src/gpu/convolution_gpu.cu
    src/gpu/cuda_utils.cu
  )
endif()

add_executable(parse_args_tests
  tests/test_parse_args.cpp
  src/cli/parse_args.cpp
)

add_executable(benchmark_runner
  benchmarks/benchmark_main.cpp
  benchmarks/benchmark_lib.cpp
  src/runtime/dispatcher.cpp
  src/common/timer.cpp
  src/cpu/vector_ops_cpu.cpp
  src/cpu/matmul_cpu.cpp
  src/cpu/convolution_cpu.cpp
  ${VECTOR_OPS_GPU_SOURCE}
)
if(ENABLE_CUDA)
  target_sources(benchmark_runner PRIVATE
    src/gpu/matmul_gpu.cu
    src/gpu/convolution_gpu.cu
    src/gpu/cuda_utils.cu
  )
endif()

add_executable(benchmark_tests
  tests/test_benchmark_lib.cpp
  benchmarks/benchmark_lib.cpp
)

target_include_directories(vector_ops_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(vector_ops_tests PRIVATE GTest::gtest_main)
target_include_directories(dispatcher_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(dispatcher_tests PRIVATE GTest::gtest_main)
target_include_directories(convolution_cpu_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(convolution_cpu_tests PRIVATE GTest::gtest_main)
target_include_directories(matmul_cpu_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(matmul_cpu_tests PRIVATE GTest::gtest_main)
target_include_directories(matmul_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(matmul_tests PRIVATE GTest::gtest_main)
target_include_directories(runtime_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(runtime_tests PRIVATE GTest::gtest_main)
target_include_directories(common_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(common_tests PRIVATE GTest::gtest_main)
target_include_directories(gpu_ops_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(gpu_ops_tests PRIVATE GTest::gtest_main)
target_include_directories(parse_args_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(parse_args_tests PRIVATE GTest::gtest_main)
target_include_directories(benchmark_runner PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_include_directories(benchmark_tests PRIVATE ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(benchmark_tests PRIVATE GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(vector_ops_tests)
gtest_discover_tests(dispatcher_tests)
gtest_discover_tests(convolution_cpu_tests)
gtest_discover_tests(matmul_cpu_tests)
gtest_discover_tests(matmul_tests)
gtest_discover_tests(runtime_tests)
gtest_discover_tests(common_tests)
gtest_discover_tests(gpu_ops_tests)
gtest_discover_tests(parse_args_tests)
gtest_discover_tests(benchmark_tests)
