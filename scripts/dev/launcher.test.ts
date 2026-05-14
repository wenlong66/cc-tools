import { describe, expect, it } from 'bun:test'
import path from 'node:path'

import {
  getInstallTargets,
  normalizeModeSelection,
  parseLaunchedProcessOutput,
  parseLauncherState,
  toWindowsTitle,
} from './launcher'

describe('normalizeModeSelection', () => {
  it('returns null for empty input so the prompt layer can apply the default', () => {
    expect(normalizeModeSelection('')).toBeNull()
    expect(normalizeModeSelection('   ')).toBeNull()
  })

  it('accepts web aliases', () => {
    expect(normalizeModeSelection('1')).toBe('web')
    expect(normalizeModeSelection('w')).toBe('web')
    expect(normalizeModeSelection('web')).toBe('web')
  })

  it('accepts desktop aliases', () => {
    expect(normalizeModeSelection('2')).toBe('desktop')
    expect(normalizeModeSelection('d')).toBe('desktop')
    expect(normalizeModeSelection('desktop')).toBe('desktop')
  })

  it('returns null for unsupported selections', () => {
    expect(normalizeModeSelection('3')).toBeNull()
    expect(normalizeModeSelection('server')).toBeNull()
  })
})

describe('getInstallTargets', () => {
  const root = 'E:/work/cc-tools'

  it('returns root and web targets for web mode', () => {
    expect(getInstallTargets(root, 'web')).toEqual([
      { dir: root, name: 'root' },
      { dir: path.join(root, 'web'), name: 'web' },
    ])
  })

  it('returns root and desktop targets for desktop mode', () => {
    expect(getInstallTargets(root, 'desktop')).toEqual([
      { dir: root, name: 'root' },
      { dir: path.join(root, 'desktop'), name: 'desktop' },
    ])
  })
})

describe('toWindowsTitle', () => {
  it('maps modes to the expected window title', () => {
    expect(toWindowsTitle('web')).toBe('cc-tools-web')
    expect(toWindowsTitle('desktop')).toBe('cc-tools-desktop')
  })
})

describe('parseLauncherState', () => {
  it('ignores legacy pid-only state instead of reusing unsafe raw pids', () => {
    expect(parseLauncherState('{"pids":[12,34]}')).toEqual({
      processes: [],
    })
  })

  it('returns an empty state for malformed input', () => {
    expect(parseLauncherState('not-json')).toEqual({ processes: [] })
  })
})

describe('parseLaunchedProcessOutput', () => {
  it('parses valid PowerShell JSON output', () => {
    expect(parseLaunchedProcessOutput('{"pid":123,"startedAtUtc":456}', 'cc-tools-web')).toEqual({
      pid: 123,
      startedAtUtc: 456,
      title: 'cc-tools-web',
    })
  })

  it('throws on malformed PowerShell JSON output', () => {
    expect(() => parseLaunchedProcessOutput('warning text', 'cc-tools-web')).toThrow(
      'Failed to parse process metadata for cc-tools-web',
    )
  })
})
