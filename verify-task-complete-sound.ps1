# ============================================================================
# verify-task-complete-sound.ps1 - checks the live DSH web GUI for the plugin.
# Usage: .\verify-task-complete-sound.ps1 [-BaseUrl http://127.0.0.1:3080]
# ============================================================================
param(
  [string]$BaseUrl = 'http://127.0.0.1:3080'
)
$ErrorActionPreference = 'Stop'

try {
  $resp = Invoke-WebRequest -Uri ($BaseUrl + '/') -UseBasicParsing -TimeoutSec 10
  if ($resp.Content -match 'task-complete-sound') {
    Write-Host '[ok] boot manifest contains @local/dsh-task-complete-sound' -ForegroundColor Green
  } else {
    Write-Host '[pending] plugin not in boot manifest yet - refresh the GUI page and re-run' -ForegroundColor Yellow
  }
} catch { Write-Host ('[error] GUI not reachable: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }

try {
  $bundle = Invoke-WebRequest -Uri ($BaseUrl + '/plugins/@local/dsh-task-complete-sound/client.js') -UseBasicParsing -TimeoutSec 10
  if ($bundle.StatusCode -eq 200 -and $bundle.Content -match '__ModuleLoader__') {
    $fresh = $bundle.Content -match 'TCS_CSS'
    if ($fresh) {
      Write-Host ('[ok] client bundle served, NEW UI (' + $bundle.Content.Length + ' bytes)' ) -ForegroundColor Green
    } else {
      Write-Host ('[stale] client bundle served but looks OLD (' + $bundle.Content.Length + ' bytes) - re-run install-task-complete-sound.bat and refresh' ) -ForegroundColor Yellow
    }
  } else {
    Write-Host '[warn] client bundle responded but looks unexpected' -ForegroundColor Yellow
  }
} catch {
  Write-Host '[pending] client bundle not served yet (expected until the GUI page refresh triggers the scan)' -ForegroundColor Yellow
}