function Stop-SmokeProcessTree([System.Diagnostics.Process] $Process) {
  # taskkill can return 1 when a descendant exits during /T, even after PASS.
  # Use the process handle rather than leaving a native exit code for Actions.
  try {
    if (-not $Process.HasExited) { $Process.Kill($true) }
  } catch [System.InvalidOperationException] {
    if (-not $Process.HasExited) { throw }
  }
  if (-not $Process.WaitForExit(10000)) { throw 'Smoke process did not terminate' }
}
