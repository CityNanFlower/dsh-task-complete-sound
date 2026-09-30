# ============================================================================
# install-task-complete-sound.ps1
# Installs the '@local/dsh-task-complete-sound' plugin into the DSH web profile
# (idempotent - safe to re-run). No DSH restart needed: the profile
# cordis.patch.yml is hot-reloaded by the running instance, and the row's
# `config.deploy` timestamp changes on every run so the host re-scans the
# client bundle (picks up the freshly deployed file + new rev). Refresh the
# GUI page afterwards to load the browser half.
# ============================================================================
$ErrorActionPreference = 'Stop'

# Plugin source = the directory this script lives in (clone the repo anywhere).
$src = $PSScriptRoot

# DSH home: respects the DSH_HOME env var (custom installs), falls back to
# the default ~/.dsh used by a standard DSH installation.
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dstRoot = Join-Path $dshHome 'profiles\web\node_modules\@local'
$dst     = Join-Path $dstRoot 'dsh-task-complete-sound'
$patch   = Join-Path $dshHome 'profiles\web\cordis.patch.yml'
$rowId   = 'task-complete-sound'
$nl      = [Environment]::NewLine

if (-not (Test-Path (Join-Path $src 'package.json'))) {
  Write-Host ('[error] plugin source not found: ' + $src) -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $patch)) {
  Write-Host ('[error] profile patch not found: ' + $patch) -ForegroundColor Red
  exit 1
}

# --- 0. remove stale temp/ghost copies the host may be serving ------------
$ghosts = Get-ChildItem $dstRoot -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '.dsh-task-complete-sound-*' }
foreach ($g in $ghosts) { Remove-Item -Recurse -Force $g.FullName; Write-Host ('[ok] removed stale copy: ' + $g.Name) }

# --- 1. deploy the package copy -------------------------------------------
New-Item -ItemType Directory -Force -Path $dstRoot | Out-Null
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
Copy-Item -Recurse -Force $src $dst
Write-Host ('[ok] deployed package -> ' + $dst)

# --- 2. register/refresh the plugin row (idempotent) ----------------------
# The row carries a `config.deploy` timestamp that changes on every run.
# The HMR include re-applies the patch, the entry fiber restarts, the
# client-modules registry re-scans, and the served bundle/rev update.
$block = '- insert:' + $nl + '    - id: ' + $rowId + $nl + "      name: '@local/dsh-task-complete-sound'" + $nl + '      config:' + $nl + '        deploy: ' + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
$content = [System.IO.File]::ReadAllText($patch)
$pattern = '(?ms)^- insert:\r?\n    - id: ' + [regex]::Escape($rowId) + '\r?\n(?:      [^\r\n]+\r?\n)*'
$content = [regex]::Replace($content, $pattern, '')
if ($content -match '(?m)^\s*\[\]\s*$') {
  $content = $content -replace '(?m)^\s*\[\]\s*$', $block
} else {
  if ($content.Trim().Length -gt 0) { $content = $content.TrimEnd() + $nl + $nl }
  $content += $block + $nl
}
[System.IO.File]::WriteAllText($patch, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ('[ok] plugin row refreshed in ' + $patch)

# --- 3. verify resolution ---------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
$resolved = $null
$ok = $false
if ($node) {
  $profileDir = Join-Path $dshHome 'profiles\web'
  $resolved = & node -e "try { console.log(require.resolve('@local/dsh-task-complete-sound/package.json', { paths: [process.argv[1]] })) } catch (e) { process.exit(1) }" $profileDir 2>$null
  $ok = ($LASTEXITCODE -eq 0 -and $resolved)
}
if ($ok) {
  Write-Host ('[ok] resolution OK: ' + $resolved)
} else {
  Write-Host '[warn] could not verify resolution (node not on PATH?)' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Done. Next steps:' -ForegroundColor Green
Write-Host '  1. Wait ~2 seconds for the host to re-scan, then refresh the GUI page (F5).'
Write-Host '  2. Settings -> Web UI plugins -> [任务完成提示音] to tune sound / volume, or press 试听.'
Write-Host '  3. Sanity check: run verify-task-complete-sound.ps1 (it now also checks the served bundle).'
