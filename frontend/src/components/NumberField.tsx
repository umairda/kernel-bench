import { useEffect, useState } from 'react'

const integerFormatter = new Intl.NumberFormat()

function sanitizeNumberInput(raw: string) {
  return raw.replace(/,/g, '').replace(/[^\d]/g, '')
}

function formatInteger(value: number) {
  if (!Number.isFinite(value)) {
    return ''
  }
  return integerFormatter.format(Math.trunc(value))
}

export function NumberField({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: React.ReactNode
  value: number
  min?: number
  onChange: (value: number) => void
}) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState(() => (Number.isNaN(value) ? '' : sanitizeNumberInput(String(value))))

  useEffect(() => {
    if (!focused) {
      setDraft(Number.isNaN(value) ? '' : sanitizeNumberInput(String(value)))
    }
  }, [focused, value])

  return (
    <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={focused ? draft : (Number.isNaN(value) ? '' : formatInteger(value))}
        onFocus={() => {
          setFocused(true)
          setDraft(Number.isNaN(value) ? '' : sanitizeNumberInput(String(value)))
        }}
        onChange={(e) => {
          const sanitized = sanitizeNumberInput(e.target.value)
          setDraft(sanitized)
          if (sanitized.length === 0) {
            onChange(Number.NaN)
            return
          }
          onChange(Number(sanitized))
        }}
        onBlur={() => {
          setFocused(false)
          if (draft.length === 0) {
            return
          }
          const numeric = Number(draft)
          if (numeric < min) {
            onChange(min)
            setDraft(String(min))
          }
        }}
        className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-cyan-500 dark:border-white/20 dark:bg-zinc-900/70 dark:text-zinc-100 dark:focus:border-cyan-300"
      />
    </label>
  )
}
