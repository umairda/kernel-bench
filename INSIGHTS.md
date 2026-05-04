# KernelBench Insights

KernelBench started as a CPU vs GPU comparison, but the most important lesson is that "CPU vs GPU" is not a single question. Performance depends on the workload shape, memory footprint, algorithm, startup cost, data movement, and orchestration path around the actual math operation.

The right comparison is not simply "which machine is faster?" It is:

- What operation are we running?
- How much data does it require?
- Does the algorithm reuse data efficiently?
- How much work is done per byte moved?
- Are we measuring only execution time, or also cloud startup, build, upload, and shutdown time?
- What cost, memory, and instance-size constraints are we comparing under?

## Project Evolution

KernelBench evolved from a compute experiment into a real benchmarking system.

### Stage 1: Build The Native Benchmark Contract

The project started with the native compute framework: a C++/CUDA runtime, CLI, CPU implementations, GPU implementations, dispatch logic, and tests.

The key learning from this stage is that the benchmark needs a small, explicit contract. The cloud system should not know how to perform vector addition, matrix multiplication, or convolution. It should only know how to invoke the benchmark binary with validated parameters and collect structured output.

That separation keeps the system extensible. Once the binary contract is stable, adding a new benchmark becomes much less invasive.

### Stage 2: Turn Local Compute Into A Cloud-Controlled System

The next stage added the AWS control plane: JSON-RPC, Lambda, Step Functions, DynamoDB, S3, EC2 runners, SSM commands, and CloudFront.

This changed the problem. It was no longer just "does the CPU or GPU code work?" It became a distributed systems problem:

- Was the instance stopped, starting, running, stopping, or ready?
- Did SSM actually accept and start the command?
- Did the runner upload results?
- Did the workflow finalize correctly?
- Did the frontend see fresh state or stale DynamoDB state?

The lesson: once benchmarks run remotely, orchestration correctness becomes part of benchmark correctness.

### Stage 3: Make The Frontend Reflect Reality

The frontend evolved from a simple run launcher into a status dashboard with live runs, instance state, progress updates, historical charts, memory warnings, and queue visibility.

This exposed an important product lesson: benchmark users need confidence in what the system is doing. A long-running benchmark without progress looks broken, even if it is working. A failed run without a reason is not actionable. A chart without normalized history is not useful.

The UI is not just presentation. It is part of the observability layer.

### Stage 4: Harden The GPU Environment

A lot of project work went into the GPU runner environment: NVIDIA drivers, CUDA toolkit availability, `nvcc` detection, package-manager differences between Amazon Linux and Ubuntu, AMI strategy, source bundles, and CUDA warmup.

The learning here is that GPU benchmarking depends heavily on machine preparation. The CUDA kernel code can be correct and still fail if the image does not contain the right compiler, runtime, driver, or path configuration.

That is why the project separated:

- AMIs for machine/toolchain readiness
- source bundles for benchmark code changes
- runtime detection for paths like `nvcc` and CUDA toolkit root

### Stage 5: Improve Measurement Quality

Later work focused on better timing: in-process operation metrics, phase durations, progress heartbeats, CUDA warmup timing, and historical chart normalization.

This produced a critical insight: coarse wall-clock time is too blunt. It mixes together boot, setup, compilation, CUDA initialization, benchmark execution, upload, and shutdown.

To understand CPU vs GPU performance, the system needs both:

- operation-level timings for compute comparison
- phase-level timings for end-to-end product behavior

### Stage 6: Protect The Runner Lifecycle

The final major evolution was around lifecycle safety: rejecting unsafe starts, detecting stale states, recording failure reasons, canceling abandoned work, avoiding false failures during SSM/EC2 races, and moving toward queued runner dispatch.

The most subtle bug class was shared-runner interference. A previous run finalizer could stop an instance while a newer run was starting. That kind of failure looks like a benchmark failure, but it is actually an orchestration failure.

The queue architecture is the right direction because it treats each CPU/GPU runner as a scarce serialized resource. A runner should do one thing at a time, and ownership should be explicit.

## Core Takeaways

### 1. Memory Capacity Defines The Testable Range

Memory limits the size of benchmark we can run on a given instance. An instance can be very performant right up until the workload no longer fits in memory. After that point, the benchmark does not merely get slower; it can fail outright through out-of-memory termination, stalled progress, or infrastructure-level timeout.

This means memory is not just a secondary spec. It defines the experimental envelope.

For each benchmark, the useful input size is bounded by the total memory needed for:

- input tensors or arrays
- output tensors or arrays
- filters or weights
- temporary working buffers
- runtime overhead from the process, OS, CUDA driver, and libraries

The frontend memory warnings are therefore not cosmetic. They prevent invalid comparisons where one runner is being asked to execute a workload that does not realistically fit on that instance.

### 2. Algorithmic Efficiency Matters As Much As Hardware

The implementation matters. A naive matrix multiplication using three nested loops is mathematically correct, but it is not a serious high-performance CPU implementation.

For large matrix multiplication, the key improvement is tiling/blocking. Instead of streaming through huge matrices with poor locality, the algorithm breaks the matrices into smaller blocks that fit better in CPU cache. Each tile is reused many times before moving on, which reduces memory traffic and improves throughput.

So a benchmark is not only comparing CPU hardware against GPU hardware. It is also comparing:

- the CPU algorithm
- the GPU algorithm
- memory access patterns
- cache behavior
- compiler optimizations
- thread scheduling

This is why improving the CPU matrix multiplication implementation can materially change the comparison, even though the hardware stays the same.

### 3. GPUs Are Best When There Is High Parallelism And Data Reuse

The GPU does not automatically win every parallel workload.

Vector operations are highly parallel, but each element usually does very little work. For example, vector addition performs roughly one arithmetic operation per element. That means the operation can be dominated by memory movement, CUDA kernel launch overhead, and CPU-to-GPU/GPU-to-CPU transfer costs.

Matrix multiplication and convolution are different. They perform many multiply-add operations for each input value loaded. That higher arithmetic intensity gives the GPU more useful work to do per byte moved. These workloads also create more opportunities for tiling, cache/shared-memory reuse, and thousands of concurrent threads.

That explains the observed pattern:

- CPU can outperform GPU for smaller or memory-bound vector operations.
- GPU can dramatically outperform CPU for matrix multiplication and convolution.
- The GPU advantage grows when the workload has enough arithmetic work to amortize launch and transfer overhead.

### 4. GPU Startup And Shutdown Are Part Of The Real System Cost

The GPU instance has more lifecycle overhead than the CPU instance. Starting and stopping a GPU runner involves more than changing an EC2 state flag. The OS, NVIDIA driver, CUDA runtime, GPU device initialization, and AWS host-level GPU attachment/detachment all add overhead.

The exact AWS internals are opaque, but the practical result is clear: GPU shutdown can take meaningfully longer than CPU shutdown.

That changes the architecture. If we immediately stop the GPU instance after every short benchmark, shutdown time can dominate the end-to-end experience. Keeping the GPU warm for a short idle period is often a better tradeoff:

- faster follow-up runs
- less repeated CUDA/driver startup cost
- better user experience
- slightly higher idle cost if no more work arrives

This is why the runner lifecycle needs an idle-stop policy rather than a naive "stop immediately after every run" rule.

### 5. End-To-End Duration And Operation Duration Are Different Metrics

A benchmark run has multiple timing phases:

- queue/start request time
- instance boot and SSM readiness
- build/setup time
- CUDA warmup time
- benchmark execution time
- upload/finalization time
- shutdown time

Only benchmark execution time represents the math operation itself. The other phases are still important, but they answer a different question: "How long does the system take to complete a benchmark request?"

Both views matter:

- Operation duration tells us about CPU/GPU compute performance.
- Total duration tells us about product experience and cloud orchestration overhead.

Without separating these phases, it is easy to reach the wrong conclusion. A GPU run may be much faster at the operation but slower end-to-end because boot, setup, warmup, or shutdown dominates the wall-clock time.

### 6. CUDA Warmup Makes The First Operation Fairer

The first CUDA call in a process often pays one-time startup costs. These can include CUDA context creation, driver initialization, memory allocator setup, and other runtime preparation.

If we include that cost in the first measured operation, the first GPU operation can look artificially slow. That is why KernelBench performs a tiny CUDA warmup before timing the requested operations.

The warmup does not make the GPU faster. It separates one-time runtime startup cost from the operation being benchmarked.

### 7. Fair Instance Comparison Is Subtle

Comparing `g6e.xlarge` to `c7i.8xlarge` is not a pure apples-to-apples hardware comparison. The instances differ in:

- vCPU count
- memory capacity
- GPU availability
- GPU generation
- hourly cost
- startup/shutdown behavior
- workload suitability

There are several valid comparison models:

- Same hourly budget
- Same vCPU count
- Same memory capacity
- Fastest result under a cost ceiling
- Best latency for a fixed workload
- Best throughput per dollar

No single model is universally correct. The benchmark should make the comparison criteria explicit so the result is interpreted correctly.

### 8. Benchmark Infrastructure Can Affect Benchmark Results

The orchestration layer is part of the benchmark system. Bugs in run state, locks, queues, finalizers, or instance shutdown behavior can invalidate results even when the C++ math code is correct.

One important lesson from this project: a previous run must never be allowed to stop a shared runner while a newer run is starting. That requires careful runner locking and queue dispatch behavior. Otherwise, the system can report a benchmark failure that has nothing to do with CPU or GPU performance.

Reliable benchmarking requires reliable orchestration.

### 9. Failure Reasons Are Data

A failed run should not just say `FAILED`. The reason matters.

Different failures imply different actions:

- out of memory means the input was too large for the instance
- timeout means the operation exceeded the allowed runtime
- instance stopped means orchestration or lifecycle policy interfered
- CUDA unavailable means the GPU environment is misconfigured
- nonzero process exit means the benchmark binary failed

Recording reason codes makes the historical data more useful. It also prevents failed runs from being misread as performance results.

### 10. Source Bundles And AMIs Solve Different Problems

The AMI should represent the machine environment: OS packages, CUDA, drivers, compilers, and baseline tooling.

The source bundle should represent the benchmark code: C++, CUDA kernels, scripts, and manifest metadata.

Keeping those separate is important. We should not need to bake a new AMI for every C++ change. Normal benchmark code changes should flow through the source bundle, while AMI changes should be reserved for environment/toolchain updates.

### 11. Historical Data Needs To Be Normalized For Charts

The live runs table is optimized for orchestration. It needs command IDs, instance IDs, locks, state transitions, and progress fields.

The historical table should be optimized for analysis. It should store normalized benchmark dimensions, runner type, operation duration, total duration, status, reason code, and instance type.

Those are different concerns. Separating them keeps the frontend charts simpler and avoids leaking infrastructure details into the UI.

### 12. Progress Reporting Is Part Of Correctness

For large matrix multiplication, convolution, and vector workloads, a run can be valid while appearing stuck. Progress reporting solves that ambiguity.

Progress updates are useful for humans, but they are also useful for the system:

- they show that the process is still alive
- they help distinguish slow compute from a stuck SSM command
- they make timeout decisions easier to interpret
- they give the frontend a way to preserve trust during long runs

Without progress reporting, long CPU runs and failed orchestration paths can look identical from the UI.

### 13. Queueing Is Better Than Rejecting Everything

The first version of runner protection was to reject a new run when the CPU or GPU runner was already busy. That is safe, but not very ergonomic.

A queue is a better model for this project because each runner is a single serialized resource. Users can submit work, the system can preserve order, and the runner can continue processing without requiring the user to manually wait and retry.

The queue also makes lifecycle management cleaner. Instead of "stop after every run," the system can ask:

- is there another queued run for this runner?
- if yes, dispatch it
- if no, hold the idle-stop lock and stop the instance safely

This avoids wasting warm runner state while still protecting against runaway EC2 cost.

### 14. Extensibility Needs A Registry, Not Hardcoded Assumptions

KernelBench began with vector operations, matrix multiplication, and convolution. But the architecture naturally wants to support more benchmark types.

A benchmark registry or manifest is the right abstraction because each benchmark has its own:

- parameter schema
- memory estimate
- result parser
- chart dimensions
- display labels
- operation list

Without a registry, every new benchmark requires scattered changes across the CLI, Lambda handlers, frontend forms, history normalization, and charts. With a registry, adding a benchmark becomes a controlled extension rather than a cross-codebase scavenger hunt.

## Benchmark-Specific Learnings

### Vector Operations

Vector operations are often memory-bound. Each element requires loading inputs, performing a small amount of math, and writing output.

For smaller vectors, the CPU can be faster because:

- there is no PCIe/device transfer overhead
- there is no CUDA launch overhead
- CPU caches and SIMD are effective
- the operation does not provide enough arithmetic work to fully exploit the GPU

The GPU becomes more interesting for vector workloads only when the vector is large enough and the transfer/setup costs are amortized.

### Matrix Multiplication

Matrix multiplication is where the GPU starts to shine.

Each output element is a dot product. For large matrices, the same input values can be reused many times across different output elements. Efficient implementations exploit that reuse through tiling and cache/shared-memory locality.

This makes matrix multiplication much more compute-dense than vector addition. The GPU has enough work to keep many cores busy, and the cost of moving data is spread across many arithmetic operations.

### Convolution

Convolution behaves more like matrix multiplication than vector addition. Each output value depends on a patch of input data and a filter. Across the full output tensor, the same input regions and filter values are reused repeatedly.

That reuse creates high arithmetic intensity and a large amount of parallel work, which is why convolution maps well to GPUs.

## The Short Version

The GPU is not simply "faster." It is faster when the workload has enough parallel work and enough arithmetic per byte moved to overcome GPU overhead.

The CPU is not simply "slower." It can be very strong for smaller, simpler, memory-bound operations, especially when data is already in host memory and the implementation uses good cache behavior.

The real benchmark lesson is this:

> Hardware performance only makes sense in the context of workload shape, memory footprint, algorithm design, and system overhead.
