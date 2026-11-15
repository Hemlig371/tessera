$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../scripts/stop-smoke-process.ps1')
$fixture = (Resolve-Path (Join-Path $PSScriptRoot '../support/smoke-process-tree.mjs')).Path
$pidFile = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '.pid')
$process = Start-Process node -ArgumentList "`"$fixture`" `"$pidFile`"" -PassThru
$child = $null
try {
  for ($i = 0; $i -lt 100 -and -not (Test-Path $pidFile); $i++) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path $pidFile)) { throw 'Child did not start' }
  $child = [System.Diagnostics.Process]::GetProcessById([int](Get-Content $pidFile))
  $global:LASTEXITCODE = 0
  Stop-SmokeProcessTree $process
  if (-not $child.WaitForExit(10000)) {
    # Minimal Linux containers may not reap an orphan zombie; it has no live code.
    $zombie = $IsLinux -and (Test-Path "/proc/$($child.Id)/stat") -and
      ((Get-Content "/proc/$($child.Id)/stat") -match '\) Z ')
    if (-not $zombie) { throw 'Orphan child survived cleanup' }
  }
  Stop-SmokeProcessTree $process
  if ($LASTEXITCODE -ne 0) { throw 'Cleanup changed native exit code' }
  $failed = $false
  try { try { throw 'injected smoke failure' } finally { Stop-SmokeProcessTree $process } }
  catch { $failed = $_.Exception.Message -eq 'injected smoke failure' }
  if (-not $failed) { throw 'Cleanup masked smoke failure' }
  Write-Output 'PASS: process tree stopped, repeated cleanup safe, smoke failure preserved'
} finally {
  Stop-SmokeProcessTree $process
  if ($null -ne $child -and -not $child.HasExited) { $child.Kill() }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}
