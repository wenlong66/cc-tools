#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

export type LaunchMode = 'web' | 'desktop'
export type InstallTarget = {
  dir: string
  name: 'root' | 'web' | 'desktop'
}

type LauncherAction = 'start' | 'stop'

type WindowLaunch = {
  title: string
  command: string
  cwd: string
}

type ManagedProcess = {
  pid: number
  title: string
  startedAtUtc: number
}

type LauncherState = {
  processes: ManagedProcess[]
}

type SpawnResult = {
  stdout: string
  stderr: string
  exitCode: number
}

type BunProcessLike = {
  stdout: ReadableStream<Uint8Array> | null
  stderr: ReadableStream<Uint8Array> | null
  exited: Promise<number>
}

type BunRuntimeLike = {
  spawn(command: string[], options: {
    cwd: string
    env?: Record<string, string | undefined>
    stdout: 'pipe'
    stderr: 'pipe'
  }): BunProcessLike
}

const currentFilePath = fileURLToPath(import.meta.url)
const ROOT_DIR = path.resolve(path.dirname(currentFilePath), '..', '..')
const LAUNCHER_STATE_PATH = path.join(ROOT_DIR, '.claude', 'dev-launcher-state.json')
const WEB_SERVER_TITLE = 'cc-tools-server'
const WINDOW_TITLES: Record<LaunchMode, string> = {
  web: 'cc-tools-web',
  desktop: 'cc-tools-desktop',
}

export function normalizeModeSelection(rawInput: string): LaunchMode | null {
  const normalized = rawInput.trim().toLowerCase()

  if (normalized === '1' || normalized === 'w' || normalized === 'web') {
    return 'web'
  }

  if (normalized === '2' || normalized === 'd' || normalized === 'desktop') {
    return 'desktop'
  }

  return null
}

export function getInstallTargets(rootDir: string, mode: LaunchMode): InstallTarget[] {
  if (mode === 'web') {
    return [
      { dir: rootDir, name: 'root' },
      { dir: path.join(rootDir, 'web'), name: 'web' },
    ]
  }

  return [
    { dir: rootDir, name: 'root' },
    { dir: path.join(rootDir, 'desktop'), name: 'desktop' },
  ]
}

export function toWindowsTitle(mode: LaunchMode): string {
  return WINDOW_TITLES[mode]
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function getBunRuntime(): BunRuntimeLike {
  const bunRuntime = (globalThis as typeof globalThis & { Bun?: BunRuntimeLike }).Bun
  if (!bunRuntime) {
    throw new Error('This launcher must run with Bun.')
  }

  return bunRuntime
}

function decode(output: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!output) {
    return Promise.resolve('')
  }

  return new Response(output).text()
}

async function run(
  command: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<SpawnResult> {
  const bunRuntime = getBunRuntime()
  const spawnedProcess = bunRuntime.spawn(command, {
    cwd: options.cwd ?? ROOT_DIR,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    decode(spawnedProcess.stdout),
    decode(spawnedProcess.stderr),
    spawnedProcess.exited,
  ])

  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  }
}

async function runOrThrow(
  command: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
) {
  const result = await run(command, options)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Command failed: ${command.join(' ')}`)
  }
  return result
}

function buildStartSpec(mode: LaunchMode): WindowLaunch[] {
  if (mode === 'web') {
    return [
      {
        title: WEB_SERVER_TITLE,
        command: `title ${WEB_SERVER_TITLE} && set SERVER_PORT=3456 && bun run dev:web:server`,
        cwd: ROOT_DIR,
      },
      {
        title: toWindowsTitle('web'),
        command: `title ${toWindowsTitle('web')} && bun run dev:web:client`,
        cwd: ROOT_DIR,
      },
    ]
  }

  return [
    {
      title: toWindowsTitle('desktop'),
      command: `title ${toWindowsTitle('desktop')} && bun run dev:desktop`,
      cwd: ROOT_DIR,
    },
  ]
}

async function promptForMode(): Promise<LaunchMode> {
  process.stdout.write('\n')
  process.stdout.write('========================================\n')
  process.stdout.write('CC-Tools launcher\n')
  process.stdout.write('========================================\n')
  process.stdout.write('  1. Web\n')
  process.stdout.write('  2. Desktop\n\n')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    while (true) {
      const answer = await rl.question('Choose mode [1]: ')
      if (answer.trim() === '') {
        return 'web'
      }

      const mode = normalizeModeSelection(answer)
      if (mode) {
        return mode
      }

      process.stdout.write('Invalid selection. Use 1/web or 2/desktop.\n')
    }
  } finally {
    rl.close()
  }
}

function isManagedProcess(value: unknown): value is ManagedProcess {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ManagedProcess>
  return typeof candidate.pid === 'number'
    && Number.isInteger(candidate.pid)
    && typeof candidate.title === 'string'
    && typeof candidate.startedAtUtc === 'number'
    && Number.isInteger(candidate.startedAtUtc)
}

export function parseLauncherState(raw: string): LauncherState {
  try {
    const parsed = JSON.parse(raw) as {
      processes?: unknown
      pids?: unknown
    }

    if (Array.isArray(parsed.processes)) {
      return {
        processes: parsed.processes.filter((value): value is ManagedProcess => isManagedProcess(value)),
      }
    }

    if (Array.isArray(parsed.pids)) {
      return { processes: [] }
    }
  } catch {
    return { processes: [] }
  }

  return { processes: [] }
}

function readLauncherState(): LauncherState {
  if (!existsSync(LAUNCHER_STATE_PATH)) {
    return { processes: [] }
  }

  return parseLauncherState(readFileSync(LAUNCHER_STATE_PATH, 'utf8'))
}

function writeLauncherState(state: LauncherState): void {
  mkdirSync(path.dirname(LAUNCHER_STATE_PATH), { recursive: true })
  writeFileSync(LAUNCHER_STATE_PATH, JSON.stringify(state, null, 2))
}

function clearLauncherState(): void {
  rmSync(LAUNCHER_STATE_PATH, { force: true })
}

function needsInstall(dir: string): boolean {
  return !existsSync(path.join(dir, 'node_modules'))
}

async function ensureInstall(target: InstallTarget): Promise<void> {
  if (!needsInstall(target.dir)) {
    process.stdout.write(`[ok] ${target.name} dependencies already installed.\n`)
    return
  }

  process.stdout.write(`[install] ${target.name} dependencies missing. Running bun install...\n`)
  await runOrThrow(['bun', 'install'], { cwd: target.dir, env: process.env })
  process.stdout.write(`[ok] ${target.name} dependencies installed.\n`)
}

async function getProcessStartTimeUtc(pid: number): Promise<number | null> {
  const psScript = [
    `try { $process = Get-Process -Id ${pid} -ErrorAction Stop;`,
    'Write-Output $process.StartTime.ToFileTimeUtc()',
    '} catch { exit 2 }',
  ].join(' ')

  const result = await run(['powershell', '-NoProfile', '-Command', psScript], {
    cwd: ROOT_DIR,
    env: process.env,
  })

  if (result.exitCode !== 0) {
    return null
  }

  const startedAtUtc = Number.parseInt(result.stdout, 10)
  return Number.isInteger(startedAtUtc) ? startedAtUtc : null
}

async function stopPid(processInfo: ManagedProcess): Promise<void> {
  if (processInfo.startedAtUtc !== 0) {
    const liveStartTime = await getProcessStartTimeUtc(processInfo.pid)
    if (liveStartTime === null || liveStartTime !== processInfo.startedAtUtc) {
      return
    }
  }

  const result = await run(['taskkill', '/PID', String(processInfo.pid), '/T', '/F'], {
    cwd: ROOT_DIR,
    env: process.env,
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Failed to stop PID ${processInfo.pid}`)
  }
}

async function hasWindowTitle(title: string): Promise<boolean> {
  const psScript = [
    '$found = Get-Process | Where-Object { $_.MainWindowTitle -eq',
    shellQuote(title),
    '};',
    'if ($found) { exit 0 }',
    'exit 1',
  ].join(' ')

  const result = await run(['powershell', '-NoProfile', '-Command', psScript], {
    cwd: ROOT_DIR,
    env: process.env,
  })

  return result.exitCode === 0
}

async function stopWindow(title: string): Promise<void> {
  if (!(await hasWindowTitle(title))) {
    return
  }

  const result = await run(['taskkill', '/FI', `WINDOWTITLE eq ${title}`, '/T', '/F'], {
    cwd: ROOT_DIR,
    env: process.env,
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Failed to stop window ${title}`)
  }
}

async function stopAll(): Promise<void> {
  const state = readLauncherState()

  for (const processInfo of state.processes) {
    await stopPid(processInfo)
  }

  await stopWindow(WEB_SERVER_TITLE)
  await stopWindow(toWindowsTitle('web'))
  await stopWindow(toWindowsTitle('desktop'))
  clearLauncherState()
}

export function parseLaunchedProcessOutput(raw: string, title: string): ManagedProcess {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Failed to parse process metadata for ${title}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Failed to parse process metadata for ${title}`)
  }

  const candidate = parsed as Partial<ManagedProcess>
  if (typeof candidate.pid !== 'number' || !Number.isInteger(candidate.pid)) {
    throw new Error(`Failed to capture PID for ${title}`)
  }

  if (typeof candidate.startedAtUtc !== 'number' || !Number.isInteger(candidate.startedAtUtc)) {
    throw new Error(`Failed to capture start time for ${title}`)
  }

  return {
    pid: candidate.pid,
    startedAtUtc: candidate.startedAtUtc,
    title,
  }
}

async function launchWindow(spec: WindowLaunch): Promise<ManagedProcess> {
  const psScript = [
    '$process = Start-Process',
    '-FilePath',
    shellQuote('cmd.exe'),
    '-WorkingDirectory',
    shellQuote(spec.cwd),
    '-ArgumentList',
    `${shellQuote('/k')}, ${shellQuote(spec.command)}`,
    '-PassThru;',
    '$liveProcess = Get-Process -Id $process.Id -ErrorAction Stop;',
    '$payload = @{ pid = $process.Id; startedAtUtc = $liveProcess.StartTime.ToFileTimeUtc() } | ConvertTo-Json -Compress;',
    'Write-Output $payload',
  ].join(' ')

  const result = await runOrThrow(['powershell', '-NoProfile', '-Command', psScript], {
    cwd: ROOT_DIR,
    env: process.env,
  })

  return parseLaunchedProcessOutput(result.stdout, spec.title)
}

async function startMode(mode: LaunchMode): Promise<void> {
  await stopAll()

  for (const target of getInstallTargets(ROOT_DIR, mode)) {
    await ensureInstall(target)
  }

  const launchedProcesses: ManagedProcess[] = []

  try {
    for (const spec of buildStartSpec(mode)) {
      process.stdout.write(`[start] Launching ${spec.title}...\n`)
      launchedProcesses.push(await launchWindow(spec))
    }
  } catch (error) {
    for (const processInfo of launchedProcesses) {
      await stopPid(processInfo)
    }
    throw error
  }

  writeLauncherState({ processes: launchedProcesses })

  process.stdout.write(`[info] ${mode} startup commands were sent.\n`)
  if (mode === 'web') {
    process.stdout.write(`[info] Check the ${WEB_SERVER_TITLE} and ${toWindowsTitle('web')} windows for readiness.\n`)
    return
  }

  process.stdout.write(`[info] Check the ${toWindowsTitle('desktop')} window for readiness.\n`)
}

function parseAction(rawAction: string | undefined): LauncherAction {
  return rawAction === 'stop' ? 'stop' : 'start'
}

async function main(): Promise<void> {
  const [, , rawAction, rawMode] = process.argv
  const action = parseAction(rawAction)

  if (action === 'stop') {
    await stopAll()
    process.stdout.write('[ok] Stop commands were sent.\n')
    return
  }

  const firstMode = rawAction && rawAction !== 'start' ? normalizeModeSelection(rawAction) : null
  const secondMode = rawMode ? normalizeModeSelection(rawMode) : null

  if ((rawAction && rawAction !== 'start' && !firstMode) || (rawMode && !secondMode)) {
    throw new Error(`Invalid mode. Use web or desktop.`)
  }

  const mode = firstMode ?? secondMode ?? await promptForMode()
  await startMode(mode)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
