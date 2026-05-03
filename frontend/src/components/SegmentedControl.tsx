type SegmentedOption<T extends string> = {
  value: T
  label: string
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<SegmentedOption<T>>
}) {
  return (
    <div className="inline-flex rounded-full border border-zinc-300/80 bg-white/85 p-1 shadow-sm dark:border-white/10 dark:bg-zinc-900/60">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              active
                ? 'bg-cyan-600 text-white shadow-sm dark:bg-cyan-400 dark:text-zinc-950'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
