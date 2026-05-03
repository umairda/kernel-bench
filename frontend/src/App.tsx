import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Moon, Sun } from 'lucide-react'
import { BENCHMARK_IDS, BENCHMARK_TABS, benchmarkKey, benchmarkToTab, type BenchmarkTab } from './benchmarks/benchmarkRegistry'
import { ConvolutionSection } from './components/ConvolutionSection'
import { HistoryTabButton } from './components/HistoryTabButton'
import { InProgressRunsCard } from './components/InProgressRunsCard'
import { MatmulSection } from './components/MatmulSection'
import { SegmentedControl } from './components/SegmentedControl'
import { VectorSection } from './components/VectorSection'
import { GlowCard } from './components/aceternity/glow-card'
import { Spotlight } from './components/aceternity/spotlight'
import {
  type Runner,
  type RunRecord,
  useGetInstanceStatesQuery,
  useGetRunHistoryQuery,
  useGetRunStatusQuery,
  useListInProgressRunsQuery,
} from './lib/api'

type CompareRunState = {
  cpuRunId: string | null
  gpuRunId: string | null
  cpuStartError: string | null
  gpuStartError: string | null
}

type Theme = 'light' | 'dark'
type AppTab = 'run' | 'performance' | 'history'
const HistoricalView = lazy(() => import('./HistoricalView'))
const RunHistoryView = lazy(() => import('./RunHistoryView'))

const initialCompareState: CompareRunState = {
  cpuRunId: null,
  gpuRunId: null,
  cpuStartError: null,
  gpuStartError: null,
}

function formatInstanceStateTitle(state: string) {
  return state !== 'stopped' ? `Instance state is ${state.toUpperCase()}` : undefined
}

function resolveInstanceState(value: string | undefined, isPending: boolean, isError: boolean) {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (isPending) {
    return 'loading'
  }
  if (isError) {
    return 'error'
  }
  return 'unknown'
}

function sectionExecuting(runCpu?: RunRecord, runGpu?: RunRecord, cpuLaunching?: boolean, gpuLaunching?: boolean) {
  return (
    cpuLaunching ||
    gpuLaunching ||
    runCpu?.status === 'STARTING' ||
    runCpu?.status === 'RUNNING' ||
    runGpu?.status === 'STARTING' ||
    runGpu?.status === 'RUNNING'
  )
}

function latestRunByKey(items: RunRecord[]) {
  const latestByKey = new Map<string, RunRecord>()

  for (const item of items) {
    const key = `${item.benchmark}:${item.runner}`
    const current = latestByKey.get(key)
    if (!current || String(item.createdAt ?? '') > String(current.createdAt ?? '')) {
      latestByKey.set(key, item)
    }
  }

  return latestByKey
}

function pickDisplayedRun(current: RunRecord | undefined, latest: RunRecord | undefined, expectedRunId: string | null) {
  if (current) {
    return current
  }
  if (!latest) {
    return undefined
  }
  if (!expectedRunId || latest.runId === expectedRunId) {
    return latest
  }
  return undefined
}

function useStickyDisplayedRun(current: RunRecord | undefined, latest: RunRecord | undefined, expectedRunId: string | null) {
  const preferred = pickDisplayedRun(current, latest, expectedRunId)
  const [stickyRun, setStickyRun] = useState<RunRecord | undefined>(preferred)

  useEffect(() => {
    if (preferred) {
      setStickyRun(preferred)
    }
  }, [preferred])

  return preferred ?? stickyRun
}

function shouldAdoptRun(candidate: RunRecord | undefined, current: RunRecord | undefined) {
  if (!candidate) {
    return false
  }
  if (!current) {
    return true
  }
  if (candidate.runId === current.runId) {
    return false
  }
  return String(candidate.createdAt ?? '') > String(current.createdAt ?? '')
}

function formatBuildDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (part: number) => String(part).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('kernelbench-theme')
    if (saved === 'light' || saved === 'dark') {
      return saved
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [appTab, setAppTab] = useState<AppTab>('run')
  const [activeRunTab, setActiveRunTab] = useState<BenchmarkTab>('vector')
  const [hasHydratedInitialRunTab, setHasHydratedInitialRunTab] = useState(false)
  const lastFocusedActiveRunKey = useRef<string | null>(null)
  const [historyRunner, setHistoryRunner] = useState<Runner | 'all'>('all')

  const [vectorRuns, setVectorRuns] = useState<CompareRunState>(initialCompareState)
  const [matmulRuns, setMatmulRuns] = useState<CompareRunState>(initialCompareState)
  const [convRuns, setConvRuns] = useState<CompareRunState>(initialCompareState)

  const vectorCpu = useGetRunStatusQuery(vectorRuns.cpuRunId)
  const vectorGpu = useGetRunStatusQuery(vectorRuns.gpuRunId)
  const matmulCpu = useGetRunStatusQuery(matmulRuns.cpuRunId)
  const matmulGpu = useGetRunStatusQuery(matmulRuns.gpuRunId)
  const convCpu = useGetRunStatusQuery(convRuns.cpuRunId)
  const convGpu = useGetRunStatusQuery(convRuns.gpuRunId)

  const inProgressRuns = useListInProgressRunsQuery()
  const runHistory = useGetRunHistoryQuery()
  const instanceStates = useGetInstanceStatesQuery()
  const latestKnownRuns = useMemo(() => latestRunByKey([
    ...(inProgressRuns.data?.items ?? []),
    ...(runHistory.data?.items ?? []),
  ]), [inProgressRuns.data?.items, runHistory.data?.items])
  const latestKnownRun = useMemo(() => {
    return [...latestKnownRuns.values()].sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0]
  }, [latestKnownRuns])
  const latestBenchmarkRuns = useMemo(() => {
    const byTab = new Map<BenchmarkTab, RunRecord>()
    for (const run of latestKnownRuns.values()) {
      const tab = benchmarkToTab(run.benchmark)
      const current = byTab.get(tab)
      if (!current || String(run.createdAt ?? '') > String(current.createdAt ?? '')) {
        byTab.set(tab, run)
      }
    }
    return byTab
  }, [latestKnownRuns])

  useEffect(() => {
    const activeItems = inProgressRuns.data?.items ?? []
    if (activeItems.length === 0) {
      lastFocusedActiveRunKey.current = null
      return
    }

    const activeRunKey = activeItems.map((run) => run.runId).sort().join('|')
    if (lastFocusedActiveRunKey.current === activeRunKey) {
      return
    }
    lastFocusedActiveRunKey.current = activeRunKey

    setHasHydratedInitialRunTab(true)
    const selectedTabHasActiveRun = activeItems.some((run) => benchmarkToTab(run.benchmark) === activeRunTab)
    if (!selectedTabHasActiveRun) {
      setActiveRunTab(benchmarkToTab(activeItems[0].benchmark))
    }
  }, [activeRunTab, inProgressRuns.data?.items])

  useEffect(() => {
    if (hasHydratedInitialRunTab || !latestKnownRun || (inProgressRuns.data?.items ?? []).length > 0) {
      return
    }

    setActiveRunTab(benchmarkToTab(latestKnownRun.benchmark))
    setHasHydratedInitialRunTab(true)
  }, [hasHydratedInitialRunTab, inProgressRuns.data?.items, latestKnownRun])

  useEffect(() => {
    if (latestKnownRuns.size === 0) {
      return
    }

    const latestVectorCpu = latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.vector, 'cpu'))
    const latestVectorGpu = latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.vector, 'gpu'))
    const latestMatmulCpu = latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.matmul, 'cpu'))
    const latestMatmulGpu = latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.matmul, 'gpu'))
    const latestConvCpu = latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.convolution, 'cpu'))
    const latestConvGpu = latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.convolution, 'gpu'))

    setVectorRuns((s) => {
      const nextCpuRunId = shouldAdoptRun(latestVectorCpu, vectorCpu.data) ? latestVectorCpu!.runId : s.cpuRunId
      const nextGpuRunId = shouldAdoptRun(latestVectorGpu, vectorGpu.data) ? latestVectorGpu!.runId : s.gpuRunId
      return nextCpuRunId !== s.cpuRunId || nextGpuRunId !== s.gpuRunId
        ? { ...s, cpuRunId: nextCpuRunId, gpuRunId: nextGpuRunId, cpuStartError: null, gpuStartError: null }
        : s
    })
    setMatmulRuns((s) => {
      const nextCpuRunId = shouldAdoptRun(latestMatmulCpu, matmulCpu.data) ? latestMatmulCpu!.runId : s.cpuRunId
      const nextGpuRunId = shouldAdoptRun(latestMatmulGpu, matmulGpu.data) ? latestMatmulGpu!.runId : s.gpuRunId
      return nextCpuRunId !== s.cpuRunId || nextGpuRunId !== s.gpuRunId
        ? { ...s, cpuRunId: nextCpuRunId, gpuRunId: nextGpuRunId, cpuStartError: null, gpuStartError: null }
        : s
    })
    setConvRuns((s) => {
      const nextCpuRunId = shouldAdoptRun(latestConvCpu, convCpu.data) ? latestConvCpu!.runId : s.cpuRunId
      const nextGpuRunId = shouldAdoptRun(latestConvGpu, convGpu.data) ? latestConvGpu!.runId : s.gpuRunId
      return nextCpuRunId !== s.cpuRunId || nextGpuRunId !== s.gpuRunId
        ? { ...s, cpuRunId: nextCpuRunId, gpuRunId: nextGpuRunId, cpuStartError: null, gpuStartError: null }
        : s
    })
  }, [
    convCpu.data,
    convGpu.data,
    inProgressRuns.data?.items,
    matmulCpu.data,
    matmulGpu.data,
    latestKnownRuns,
    vectorCpu.data,
    vectorGpu.data,
  ])

  const displayedVectorCpu = useStickyDisplayedRun(vectorCpu.data, latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.vector, 'cpu')), vectorRuns.cpuRunId)
  const displayedVectorGpu = useStickyDisplayedRun(vectorGpu.data, latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.vector, 'gpu')), vectorRuns.gpuRunId)
  const displayedMatmulCpu = useStickyDisplayedRun(matmulCpu.data, latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.matmul, 'cpu')), matmulRuns.cpuRunId)
  const displayedMatmulGpu = useStickyDisplayedRun(matmulGpu.data, latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.matmul, 'gpu')), matmulRuns.gpuRunId)
  const displayedConvCpu = useStickyDisplayedRun(convCpu.data, latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.convolution, 'cpu')), convRuns.cpuRunId)
  const displayedConvGpu = useStickyDisplayedRun(convGpu.data, latestKnownRuns.get(benchmarkKey(BENCHMARK_IDS.convolution, 'gpu')), convRuns.gpuRunId)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('kernelbench-theme', theme)
  }, [theme])

  const isAnyExecuting = useMemo(() => {
    return (
      sectionExecuting(vectorCpu.data, vectorGpu.data) ||
      sectionExecuting(matmulCpu.data, matmulGpu.data) ||
      sectionExecuting(convCpu.data, convGpu.data)
    )
  }, [
    vectorCpu.data,
    vectorGpu.data,
    matmulCpu.data,
    matmulGpu.data,
    convCpu.data,
    convGpu.data,
  ])

  const cpuState = resolveInstanceState(instanceStates.data?.cpu, instanceStates.isPending, instanceStates.isError)
  const gpuState = resolveInstanceState(instanceStates.data?.gpu, instanceStates.isPending, instanceStates.isError)

  const renderRunTab = () => (
    <div className="space-y-4">
      <div className="flex justify-start">
        <SegmentedControl
          value={activeRunTab}
          onChange={setActiveRunTab}
          options={BENCHMARK_TABS}
        />
      </div>

      {activeRunTab === 'vector' ? (
        <VectorSection
          cpuState={cpuState}
          gpuState={gpuState}
          lastRun={latestBenchmarkRuns.get('vector')}
          cpuRun={displayedVectorCpu}
          gpuRun={displayedVectorGpu}
          cpuStartError={vectorRuns.cpuStartError}
          gpuStartError={vectorRuns.gpuStartError}
          cpuTitle={formatInstanceStateTitle(cpuState)}
          gpuTitle={formatInstanceStateTitle(gpuState)}
          onCpuRunStarted={(runId) => setVectorRuns((s) => ({ ...s, cpuRunId: runId }))}
          onGpuRunStarted={(runId) => setVectorRuns((s) => ({ ...s, gpuRunId: runId }))}
          onCpuStartError={(message) => setVectorRuns((s) => ({ ...s, cpuStartError: message }))}
          onGpuStartError={(message) => setVectorRuns((s) => ({ ...s, gpuStartError: message }))}
        />
      ) : null}

      {activeRunTab === 'matmul' ? (
        <MatmulSection
          cpuState={cpuState}
          gpuState={gpuState}
          lastRun={latestBenchmarkRuns.get('matmul')}
          cpuRun={displayedMatmulCpu}
          gpuRun={displayedMatmulGpu}
          cpuStartError={matmulRuns.cpuStartError}
          gpuStartError={matmulRuns.gpuStartError}
          cpuTitle={formatInstanceStateTitle(cpuState)}
          gpuTitle={formatInstanceStateTitle(gpuState)}
          onCpuRunStarted={(runId) => setMatmulRuns((s) => ({ ...s, cpuRunId: runId }))}
          onGpuRunStarted={(runId) => setMatmulRuns((s) => ({ ...s, gpuRunId: runId }))}
          onCpuStartError={(message) => setMatmulRuns((s) => ({ ...s, cpuStartError: message }))}
          onGpuStartError={(message) => setMatmulRuns((s) => ({ ...s, gpuStartError: message }))}
        />
      ) : null}

      {activeRunTab === 'conv' ? (
        <ConvolutionSection
          cpuState={cpuState}
          gpuState={gpuState}
          lastRun={latestBenchmarkRuns.get('conv')}
          cpuRun={displayedConvCpu}
          gpuRun={displayedConvGpu}
          cpuStartError={convRuns.cpuStartError}
          gpuStartError={convRuns.gpuStartError}
          cpuTitle={formatInstanceStateTitle(cpuState)}
          gpuTitle={formatInstanceStateTitle(gpuState)}
          onCpuRunStarted={(runId) => setConvRuns((s) => ({ ...s, cpuRunId: runId }))}
          onGpuRunStarted={(runId) => setConvRuns((s) => ({ ...s, gpuRunId: runId }))}
          onCpuStartError={(message) => setConvRuns((s) => ({ ...s, cpuStartError: message }))}
          onGpuStartError={(message) => setConvRuns((s) => ({ ...s, gpuStartError: message }))}
        />
      ) : null}

      <InProgressRunsCard items={inProgressRuns.data?.items ?? []} />
    </div>
  )

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-100 px-4 py-8 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <Spotlight className="-top-8 hidden dark:block" />
      <Spotlight className="left-1/2 top-40 hidden dark:block" fill="rgba(129,140,248,0.2)" />
      <div className="relative z-10 mx-auto max-w-6xl space-y-6">
        <header className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <h1 className="bg-gradient-to-r from-cyan-700 via-zinc-900 to-indigo-700 bg-clip-text text-4xl font-bold tracking-tight text-transparent dark:from-cyan-300 dark:via-white dark:to-indigo-300">
              KernelBench
            </h1>
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-cyan-400 dark:border-white/20 dark:bg-zinc-900 dark:text-zinc-200"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Binary test runner for comparing CPU (c7i.8xlarge) and GPU (g6e.xlarge) benchmarks.
          </p>
        </header>

        <div className="rounded-2xl border border-zinc-300/70 bg-white/80 p-2 dark:border-white/10 dark:bg-zinc-900/50">
          <div className="grid gap-2 md:grid-cols-3">
            <HistoryTabButton active={appTab === 'run'} onClick={() => setAppTab('run')}>Benchmark</HistoryTabButton>
            <HistoryTabButton active={appTab === 'performance'} onClick={() => setAppTab('performance')}>Performance</HistoryTabButton>
            <HistoryTabButton active={appTab === 'history'} onClick={() => setAppTab('history')}>History</HistoryTabButton>
          </div>
        </div>

        {appTab === 'run' ? renderRunTab() : null}

        {appTab === 'performance' ? (
          <Suspense
            fallback={
              <GlowCard>
                <div className="flex h-72 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading performance charts
                </div>
              </GlowCard>
            }
          >
            <HistoricalView historyRunner={historyRunner} onRunnerChange={setHistoryRunner} />
          </Suspense>
        ) : null}

        {appTab === 'history' ? (
          <Suspense
            fallback={
              <GlowCard>
                <div className="flex h-72 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading run history
                </div>
              </GlowCard>
            }
          >
            <RunHistoryView />
          </Suspense>
        ) : null}

        {isAnyExecuting ? (
          <div className="fixed bottom-6 right-6 inline-flex items-center rounded-full border border-cyan-500/40 bg-white px-4 py-2 text-sm font-semibold text-cyan-800 shadow-lg dark:border-cyan-400/40 dark:bg-zinc-950 dark:text-cyan-100 dark:shadow-none">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Test Executing
          </div>
        ) : null}

        <footer className="pb-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Build: {__APP_BUILD_SHA__}, {formatBuildDate(__APP_BUILD_DATE__)}
        </footer>
      </div>
    </main>
  )
}

export default App
