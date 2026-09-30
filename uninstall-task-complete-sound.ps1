# ============================================================================
# uninstall-task-complete-sound.ps1
# Removes the plugin row from the web profile patch (hot-effective) and deletes
# the deployed package copy.
# ============================================================================
$ErrorActionPreference = 'Stop'

# Same home resolution as the install script: DSH_HOME env var first, then ~/.dsh.
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$dst     = Join-Path $dshHome 'profiles\web\node_modules\@local\dsh-task-complete-sound'
$patch   = Join-Path $dshHome 'profiles\web\cordis.patch.yml'

if (Test-Path $patch) {
  $content = [System.IO.File]::ReadAllText($patch)
  $pattern = '(?ms)^- insert:\s*\r?\n\s+- id: task-complete-sound\r?\n\s+name: ''@local/dsh-task-complete-sound''\r?\n?'
  $new = [regex]::Replace($content, $pattern, '')
  if ($new -notmatch '(?m)^\s*-\s') {
    $new = '# Your patch layer for this dsh profile, applied after every bundle layer:' + [Environment]::NewLine + '# a top-level YAML array of loader patch entries (id-targeted config' + [Environment]::NewLine + '# overrides, disables, and insert lists; !!js expressions allowed).' + [Environment]::NewLine + '[]' + [Environment]::NewLine
  }
  [System.IO.File]::WriteAllText($patch, $new, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ('[ok] plugin row removed from ' + $patch)
}
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst; Write-Host ('[ok] removed ' + $dst) }
$ghosts = Get-ChildItem (Join-Path $dshHome 'profiles\web\node_modules\@local') -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '.dsh-task-complete-sound-*' }
foreach ($g in $ghosts) { Remove-Item -Recurse -Force $g.FullName; Write-Host ('[ok] removed stale copy: ' + $g.Name) }
Write-Host 'Done. Refresh the GUI page to drop the client half.' -ForegroundColor Green