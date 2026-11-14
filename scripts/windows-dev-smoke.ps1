$ErrorActionPreference = 'Stop'
$profilePath = Join-Path $env:APPDATA 'app.tessera.personal.dev'
if (Test-Path $profilePath) { throw 'Smoke test requires a clean dev profile; refusing to remove existing data.' }
$process = Start-Process cmd.exe -ArgumentList '/c npm run dev:desktop -- --no-watch' -PassThru -RedirectStandardOutput 'windows-dev.stdout.log' -RedirectStandardError 'windows-dev.stderr.log'
try {
  $database = Join-Path $profilePath 'databases/app.sqlite'
  $ready = $false
  for ($i = 0; $i -lt 240; $i++) {
    if ($process.HasExited) { Get-Content windows-dev.stderr.log; throw 'tauri dev exited' }
    if (Test-Path $database) {
      $env:TESSERA_SMOKE_DB = $database
      node --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync(process.env.TESSERA_SMOKE_DB,{readOnly:true}); const n=db.prepare("SELECT count(*) AS n FROM app_meta WHERE key IN (?,?)").get("dataset_id","format_version").n;db.close();process.exit(n===2?0:1);' 2>$null
      if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { Get-Content windows-dev.stderr.log; throw 'Native UI did not initialize its SQLite database' }
  Write-Output 'PASS: Windows tauri dev launched, WebView executed TS migrations and opened native SQLite.'
} finally {
  taskkill /PID $process.Id /T /F 2>$null
  Remove-Item Env:TESSERA_SMOKE_DB -ErrorAction SilentlyContinue
}
