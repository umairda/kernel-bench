const GIB = 1024 * 1024 * 1024

const RUNNER_MEMORY_BUDGETS = [
  {
    label: 'CPU (c7i.8xlarge system RAM)',
    limitBytes: 32 * GIB,
    note: 'conservative 50% of 64 GiB',
  },
  {
    label: 'GPU (g6e.xlarge host RAM)',
    limitBytes: 16 * GIB,
    note: 'conservative 50% of 32 GiB',
  },
  {
    label: 'GPU (L40S VRAM)',
    limitBytes: 24 * GIB,
    note: 'conservative headroom for 48 GB',
  },
]

export function formatBytes(bytes: number) {
  const numberFormat = { minimumFractionDigits: 1, maximumFractionDigits: 1 }
  if (bytes >= GIB) {
    return `${(bytes / GIB).toLocaleString(undefined, numberFormat)} GiB`
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString(undefined, numberFormat)} MiB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toLocaleString(undefined, numberFormat)} KiB`
  }
  return `${bytes.toLocaleString(undefined, numberFormat)} B`
}

function warningClass(overLimit: boolean) {
  return overLimit ? 'text-red-700 dark:text-red-300' : ''
}

export function MemoryBudgetSummary({
  items,
  totalBytes,
}: {
  items: Array<{ label: string; bytes: number }>
  totalBytes: number
}) {
  const overAnyLimit = RUNNER_MEMORY_BUDGETS.some((budget) => totalBytes > budget.limitBytes)

  return (
    <div className="rounded-xl border border-zinc-300 bg-zinc-100 p-3 text-xs text-zinc-700 dark:border-white/10 dark:bg-zinc-950 dark:text-zinc-300">
      {items.map((item) => (
        <p key={item.label}><span className="font-semibold">{item.label}:</span> {formatBytes(item.bytes)}</p>
      ))}
      <p className={`mt-1 ${warningClass(overAnyLimit)}`}>
        <span className="font-semibold">Total:</span> {formatBytes(totalBytes)}
      </p>

      <div className="mt-3 space-y-1 text-zinc-600 dark:text-zinc-400">
        <p className="font-semibold text-zinc-700 dark:text-zinc-300">Runner memory budgets</p>
        {RUNNER_MEMORY_BUDGETS.map((budget) => {
          const overLimit = totalBytes > budget.limitBytes
          return (
            <p key={budget.label} className={warningClass(overLimit)}>
              {budget.label}: total should be less than {formatBytes(budget.limitBytes)} ({budget.note})
            </p>
          )
        })}
        <p>GPU runs need enough space in both host RAM and device VRAM.</p>
      </div>
    </div>
  )
}
