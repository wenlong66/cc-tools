[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
$repoRoot = (Resolve-Path (Join-Path $desktopDir '..')).Path

$targetTriple = 'x86_64-pc-windows-msvc'
$portableDirName = '.cc-tools'
$tauriTargetDir = Join-Path $desktopDir 'src-tauri\target'
$releaseDir = Join-Path $tauriTargetDir "$targetTriple\release"
$canonicalOutputDir = Join-Path $desktopDir 'build-artifacts\windows-x64-portable'

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

function Get-RustCargoBinDir {
  return Join-Path $env:USERPROFILE '.cargo\bin'
}

function Ensure-RustInPath {
  $cargoBinDir = Get-RustCargoBinDir
  if ((Test-Path $cargoBinDir) -and -not (($env:Path -split ';') -contains $cargoBinDir)) {
    $env:Path = "$cargoBinDir;$env:Path"
  }
}

function Resolve-OutputDirectory {
  param([string]$PreferredPath)

  New-Item -ItemType Directory -Force -Path $PreferredPath | Out-Null

  $existingArtifacts = Get-ChildItem -Path $PreferredPath -Force -ErrorAction SilentlyContinue
  foreach ($artifact in $existingArtifacts) {
    try {
      Remove-Item -LiteralPath $artifact.FullName -Force -Recurse
    } catch {
      $fallbackPath = "$PreferredPath-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      Write-Step "Could not clear locked artifact '$($artifact.FullName)'. Using fallback output directory: $fallbackPath"
      New-Item -ItemType Directory -Force -Path $fallbackPath | Out-Null
      return $fallbackPath
    }
  }

  return $PreferredPath
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

Ensure-RustInPath
Import-VsDevEnvironment

Assert-Command cargo
Assert-Command rustc

if ($env:SKIP_INSTALL -ne '1') {
  Invoke-BunInstall -WorkingDirectory $repoRoot -Label 'repo root'
  Invoke-BunInstall -WorkingDirectory $desktopDir -Label 'desktop'

  $adaptersDir = Join-Path $repoRoot 'adapters'
  if (Test-Path (Join-Path $adaptersDir 'package.json')) {
    Invoke-BunInstall -WorkingDirectory $adaptersDir -Label 'adapters'
  }
}

$env:TAURI_ENV_TARGET_TRIPLE = $targetTriple

$mainExe = Join-Path $releaseDir 'claude-code-desktop.exe'
$compiledSidecarSource = Join-Path $desktopDir "src-tauri\binaries\claude-sidecar-$targetTriple.exe"
$releaseSidecarSource = Join-Path $releaseDir 'claude-sidecar.exe'
$distSource = Join-Path $desktopDir 'dist'

Write-Step 'Building desktop frontend...'
Push-Location $desktopDir
try {
  & bun run build
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64-portable] bun run build failed (exit $LASTEXITCODE)"
  }

  Write-Step 'Building desktop sidecars...'
  & bun run build:sidecars
  if ($LASTEXITCODE -ne 0) {
    $sidecarBuildExitCode = $LASTEXITCODE
    if (Test-Path $compiledSidecarSource) {
      Write-Step "bun run build:sidecars failed (exit $sidecarBuildExitCode). Reusing existing sidecar: $compiledSidecarSource"
    } elseif (Test-Path $releaseSidecarSource) {
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $compiledSidecarSource) | Out-Null
      Copy-Item -LiteralPath $releaseSidecarSource -Destination $compiledSidecarSource -Force
      Write-Step "bun run build:sidecars failed (exit $sidecarBuildExitCode). Reused release sidecar fallback: $releaseSidecarSource"
    } else {
      throw "[build-windows-x64-portable] bun run build:sidecars failed (exit $sidecarBuildExitCode) and no reusable sidecar binary was found"
    }
  }
} finally {
  Pop-Location
}

Write-Step "Building Windows portable desktop app for $targetTriple"
$tempConfigPath = Join-Path ([System.IO.Path]::GetTempPath()) 'cc-tools.tauri.local.windows-portable.json'
$tempConfig = @{
  build = @{
    beforeBuildCommand = 'ver >nul'
  }
  bundle = @{
    createUpdaterArtifacts = $false
  }
} | ConvertTo-Json -Depth 10
Set-Content -Path $tempConfigPath -Value $tempConfig -Encoding UTF8

Push-Location $desktopDir
try {
  if (-not $env:CARGO_BUILD_JOBS) {
    $env:CARGO_BUILD_JOBS = '1'
    Write-Step 'CARGO_BUILD_JOBS not set. Using 1 job to reduce Windows page file pressure during tauri build'
  }

  $tauriBuildArgs = @(
    'tauri',
    'build',
    '--target',
    $targetTriple,
    '--no-bundle',
    '--ci',
    '--config',
    $tempConfigPath
  )

  if ($null -ne $TauriArgs) {
    $remainingArgs = @($TauriArgs)
    if ($remainingArgs.Count -gt 0) {
      $tauriBuildArgs += $remainingArgs
    }
  }

  & bun run @tauriBuildArgs
  if ($LASTEXITCODE -ne 0) {
    throw "[build-windows-x64-portable] tauri build failed (exit $LASTEXITCODE)"
  }
} finally {
  Pop-Location
  if (Test-Path $tempConfigPath) {
    Remove-Item -LiteralPath $tempConfigPath -Force
  }
}

$sidecarSource = if (Test-Path $releaseSidecarSource) {
  $releaseSidecarSource
} else {
  $compiledSidecarSource
}

if (-not (Test-Path $mainExe)) {
  throw "[build-windows-x64-portable] Missing portable app executable: $mainExe"
}
if (-not (Test-Path $sidecarSource)) {
  throw "[build-windows-x64-portable] Missing sidecar executable: $sidecarSource"
}
if (-not (Test-Path (Join-Path $distSource 'index.html'))) {
  throw "[build-windows-x64-portable] Missing built frontend assets under $distSource"
}

$activeOutputDir = Resolve-OutputDirectory -PreferredPath $canonicalOutputDir
$portableConfigDir = Join-Path $activeOutputDir $portableDirName
$portableCacheDir = Join-Path $portableConfigDir 'Cache'
$portableWebViewDir = Join-Path $portableConfigDir 'EBWebView'

Copy-Item -LiteralPath $mainExe -Destination (Join-Path $activeOutputDir 'claude-code-desktop.exe') -Force
Copy-Item -LiteralPath $sidecarSource -Destination (Join-Path $activeOutputDir 'claude-sidecar.exe') -Force
Copy-Item -LiteralPath $distSource -Destination (Join-Path $activeOutputDir 'dist') -Force -Recurse

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
set "CC_TOOLS_APP_PORTABLE_DIR=1"
"%~dp0claude-code-desktop.exe" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
'@
Set-Content -Path (Join-Path $activeOutputDir 'launch-cc-tools-portable.cmd') -Value $launchScript -Encoding ASCII

$portableReadme = @'
CC-Tools Portable (Windows x64)
================================

Run:
- preferred: double-click launch-cc-tools-portable.cmd
- fallback: run claude-code-desktop.exe directly

Directory layout:
- claude-code-desktop.exe : desktop app executable
- claude-sidecar.exe      : required Bun sidecar runtime
- dist/                   : bundled H5 assets used by the local desktop server
- .cc-tools/              : portable config, cache, WebView2 data, projects, skills

Notes:
- The launcher sets CLAUDE_CONFIG_DIR=%~dp0.cc-tools so the portable data directory stays beside the app.
- Without the launcher, the app falls back to its built-in default portable directory detection.
- If you move the whole folder to another machine, bring the full folder, not only the exe.
- WebView2 runtime still needs to be available on the host Windows system.
'@
Set-Content -Path (Join-Path $activeOutputDir 'PORTABLE_README.txt') -Value $portableReadme -Encoding UTF8

$buildInfo = @(
  'Artifact type: Windows portable export'
  'Build mode: tauri build --no-bundle'
  "Target triple: $targetTriple"
  "Portable output: $activeOutputDir"
  "App executable: $(Join-Path $activeOutputDir 'claude-code-desktop.exe')"
  "Sidecar executable: $(Join-Path $activeOutputDir 'claude-sidecar.exe')"
  "Frontend assets: $(Join-Path $activeOutputDir 'dist')"
  "Portable config dir: $portableConfigDir"
  "Built at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
)
Set-Content -Path (Join-Path $activeOutputDir 'BUILD_INFO.txt') -Value $buildInfo -Encoding UTF8

Write-Host ''
Write-Step 'Portable build finished.'
Write-Step "Portable output: $activeOutputDir"
Write-Step "Launch script: $(Join-Path $activeOutputDir 'launch-cc-tools-portable.cmd')"
Write-Step "Executable: $(Join-Path $activeOutputDir 'claude-code-desktop.exe')"

if ($env:OPEN_OUTPUT -eq '1') {
  Invoke-Item $activeOutputDir
}
