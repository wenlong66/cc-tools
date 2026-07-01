[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$BuilderArgs
)

# Environment:
#   SKIP_INSTALL=1        Skip root/desktop dependency installation.
#   REBUILD_NATIVE=1      Rebuild Electron native dependencies before packaging.
#   OPEN_OUTPUT=1         Open the portable output directory after a successful build.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
$repoRoot = (Resolve-Path (Join-Path $desktopDir '..')).Path

$targetTriple = 'x86_64-pc-windows-msvc'
$portableDirName = '.cc-tools'
$canonicalOutputDir = Join-Path $desktopDir 'build-artifacts\windows-x64-portable'
$electronOutputDir = Join-Path $desktopDir 'build-artifacts\electron'
$winUnpackedDir = Join-Path $electronOutputDir 'win-unpacked'

function Write-Step {
  param([string]$Message)
  Write-Host "[build-windows-x64-portable] $Message"
}

function Assert-WindowsHost {
  if ($env:OS -ne 'Windows_NT') {
    throw '[build-windows-x64-portable] This script must run on Windows.'
  }
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[build-windows-x64-portable] Missing required command: $Name"
  }
}

function Import-VsDevEnvironment {
  $vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
  if (-not (Test-Path $vswhere)) {
    throw '[build-windows-x64-portable] Could not find vswhere.exe. Install Visual Studio 2022 Build Tools with the C++ workload.'
  }

  $installationPath = & $vswhere `
    -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath |
    Select-Object -First 1

  if (-not $installationPath) {
    throw '[build-windows-x64-portable] Missing Visual C++ build tools. Install the "Desktop development with C++" / VC.Tools.x86.x64 workload first.'
  }

  $vsDevCmd = Join-Path $installationPath 'Common7\Tools\VsDevCmd.bat'
  if (-not (Test-Path $vsDevCmd)) {
    throw "[build-windows-x64-portable] Could not find VsDevCmd.bat under $installationPath"
  }

  Write-Step "Importing MSVC environment from $vsDevCmd"
  $env:VSCMD_SKIP_SENDTELEMETRY = '1'
  $envDump = & cmd.exe /d /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64-portable] Failed to initialize Visual Studio build environment (exit $LASTEXITCODE)"
  }

  foreach ($line in $envDump) {
    if ($line -match '^(.*?)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
  }
}

function Clear-Directory {
  param([string]$Path)
  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Invoke-BunInstall {
  param(
    [string]$WorkingDirectory,
    [string]$Label
  )

  Write-Step "Installing $Label dependencies..."
  Push-Location $WorkingDirectory
  try {
    & bun install
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows-x64-portable] bun install failed in $Label (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

Assert-WindowsHost
Assert-Command bun
Import-VsDevEnvironment

if ($env:SKIP_INSTALL -ne '1') {
  Invoke-BunInstall -WorkingDirectory $repoRoot -Label 'repo root'
  Invoke-BunInstall -WorkingDirectory $desktopDir -Label 'desktop'

  $adaptersDir = Join-Path $repoRoot 'adapters'
  if (Test-Path (Join-Path $adaptersDir 'package.json')) {
    Invoke-BunInstall -WorkingDirectory $adaptersDir -Label 'adapters'
  }
}

Write-Step 'Cleaning stale Electron outputs...'
Remove-Item -LiteralPath (Join-Path $desktopDir 'dist') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $desktopDir 'electron-dist') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $electronOutputDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $desktopDir 'src-tauri\binaries\claude-sidecar-*') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $desktopDir 'tsconfig.tsbuildinfo') -Force -ErrorAction SilentlyContinue

Push-Location $desktopDir
try {
  $env:SIDECAR_TARGET_TRIPLE = $targetTriple

  Write-Step "Building sidecars for $targetTriple..."
  & bun run build:sidecars
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64-portable] build:sidecars failed (exit $LASTEXITCODE)"
  }

  Write-Step 'Building renderer and Electron main/preload bundles...'
  & bun run build
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64-portable] renderer build failed (exit $LASTEXITCODE)"
  }
  & bun run build:electron
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64-portable] Electron build failed (exit $LASTEXITCODE)"
  }

  if ($env:REBUILD_NATIVE -eq '1') {
    Write-Step 'Rebuilding native dependencies for Electron ABI...'
    & bun x electron-builder install-app-deps
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows-x64-portable] electron-builder install-app-deps failed (exit $LASTEXITCODE)"
    }
    & bun run prepare:node-pty
    if ($LASTEXITCODE -ne 0) {
      throw "[build-windows-x64-portable] prepare:node-pty failed (exit $LASTEXITCODE)"
    }
  }

  $args = @('electron-builder', '--win', 'dir', '--x64', '--publish', 'never')
  $remainingArgs = @($BuilderArgs)
  if ($remainingArgs.Count -gt 0) {
    $args += $remainingArgs
  }

  Write-Step 'Packaging Electron portable app directory...'
  & bun x @args
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64-portable] electron-builder dir package failed (exit $LASTEXITCODE)"
  }
} finally {
  Pop-Location
}

if (-not (Test-Path (Join-Path $winUnpackedDir 'CC-Tools.exe'))) {
  throw "[build-windows-x64-portable] Missing Electron win-unpacked executable: $(Join-Path $winUnpackedDir 'CC-Tools.exe')"
}

Clear-Directory -Path $canonicalOutputDir
Get-ChildItem -LiteralPath $winUnpackedDir -Force |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $canonicalOutputDir -Recurse -Force }

$portableConfigDir = Join-Path $canonicalOutputDir $portableDirName
$portableCacheDir = Join-Path $portableConfigDir 'Cache'
$portableWebViewDir = Join-Path $portableConfigDir 'EBWebView'
New-Item -ItemType Directory -Force -Path $portableConfigDir | Out-Null
New-Item -ItemType Directory -Force -Path $portableCacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $portableWebViewDir | Out-Null

$portableMode = @{
  mode = 'portable'
} | ConvertTo-Json -Depth 5
Set-Content -Path (Join-Path $portableConfigDir 'app-mode.json') -Value $portableMode -Encoding UTF8

$launchScript = @'
@echo off
setlocal
cd /d "%~dp0" || exit /b 1
set "CLAUDE_CONFIG_DIR=%~dp0.cc-tools"
set "CC_HAHA_APP_PORTABLE_DIR=1"
set "CC_TOOLS_APP_PORTABLE_DIR=1"
set "WEBVIEW2_USER_DATA_FOLDER=%~dp0.cc-tools\EBWebView"
"%~dp0CC-Tools.exe" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
'@
Set-Content -Path (Join-Path $canonicalOutputDir 'launch-cc-tools-portable.cmd') -Value $launchScript -Encoding ASCII

$portableReadme = @'
CC-Tools Portable (Windows x64)
================================

Run:
- preferred: double-click launch-cc-tools-portable.cmd
- fallback: run CC-Tools.exe directly

Directory layout:
- CC-Tools.exe : Electron desktop app executable
- resources/   : bundled app, sidecar runtime, and native dependencies
- .cc-tools/   : portable config, cache, WebView2 data, projects, skills

Notes:
- The launcher sets CLAUDE_CONFIG_DIR=%~dp0.cc-tools so the portable data directory stays beside the app.
- The launcher sets WEBVIEW2_USER_DATA_FOLDER=%~dp0.cc-tools\EBWebView so WebView2 state stays portable.
- Without the launcher, the app falls back to its built-in default portable directory detection.
- If you move the whole folder to another machine, bring the full folder, not only the exe.
- WebView2 runtime still needs to be available on the host Windows system.
'@
Set-Content -Path (Join-Path $canonicalOutputDir 'PORTABLE_README.txt') -Value $portableReadme -Encoding UTF8

$buildInfo = @(
  'Artifact type: Windows Electron portable directory'
  'Build mode: electron-builder --win dir --x64 --publish never'
  "Target triple: $targetTriple"
  "Builder output: $electronOutputDir"
  "Portable output: $canonicalOutputDir"
  "App executable: $(Join-Path $canonicalOutputDir 'CC-Tools.exe')"
  "Portable config dir: $portableConfigDir"
  "Built at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
)
Set-Content -Path (Join-Path $canonicalOutputDir 'BUILD_INFO.txt') -Value $buildInfo -Encoding UTF8

Write-Host ''
Write-Step 'Portable build finished.'
Write-Step "Portable output: $canonicalOutputDir"
Write-Step "Launch script: $(Join-Path $canonicalOutputDir 'launch-cc-tools-portable.cmd')"
Write-Step "Executable: $(Join-Path $canonicalOutputDir 'CC-Tools.exe')"

if ($env:OPEN_OUTPUT -eq '1') {
  Invoke-Item $canonicalOutputDir
}
