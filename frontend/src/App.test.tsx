import { describe, expect, it } from 'vitest'
import { pathnameForTab, tabFromPathname } from './App'

describe('App path helpers', () => {
  it('maps tabs to top-level paths', () => {
    expect(pathnameForTab('run')).toBe('/benchmark')
    expect(pathnameForTab('performance')).toBe('/performance')
    expect(pathnameForTab('history')).toBe('/history')
  })

  it('maps known paths back to tabs', () => {
    expect(tabFromPathname('/benchmark')).toBe('run')
    expect(tabFromPathname('/benchmark/')).toBe('run')
    expect(tabFromPathname('/performance')).toBe('performance')
    expect(tabFromPathname('/history')).toBe('history')
  })

  it('returns undefined for unknown paths', () => {
    expect(tabFromPathname('/')).toBeUndefined()
    expect(tabFromPathname('/nope')).toBeUndefined()
  })
})
