$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path
$SourceDir = Join-Path $env:TEMP 'aiwc-wcdb-open-v2.1.15'
$BuildDir = Join-Path $SourceDir 'build-aiwc-win64'
$ExpectedCommit = 'a62d7f12191843e1f095e3c37f46785ed04ebde8'
$OutputPath = Join-Path $ProjectRoot 'resources\wcdb_open.dll'
$CliOutputPath = Join-Path $ProjectRoot 'AIWC-CLI\native\win32-x64\wcdb_open.dll'

if (-not (Test-Path (Join-Path $SourceDir '.git'))) {
  git clone --filter=blob:none --no-checkout https://github.com/Tencent/wcdb.git $SourceDir
}

git -C $SourceDir fetch --depth 1 origin tag v2.1.15
git -C $SourceDir checkout --detach FETCH_HEAD
$ActualCommit = (git -C $SourceDir rev-parse HEAD).Trim()
if ($ActualCommit -ne $ExpectedCommit) {
  throw "WCDB source verification failed: expected $ExpectedCommit, got $ActualCommit"
}

cmake `
  -S (Join-Path $SourceDir 'src') `
  -B $BuildDir `
  -A x64 `
  -DBUILD_SHARED_LIBS=ON `
  -DWCDB_CPP=ON `
  -DWCDB_BRIDGE=ON `
  -DWCDB_ZSTD=ON `
  -DTARGET_NAME=wcdb_open
cmake --build $BuildDir --config Release --parallel

$BuiltLibrary = Get-ChildItem -Path $BuildDir -Filter 'wcdb_open.dll' -Recurse | Select-Object -First 1
if (-not $BuiltLibrary) {
  throw 'WCDB build completed but wcdb_open.dll was not found'
}

Copy-Item -Force $BuiltLibrary.FullName $OutputPath
New-Item -ItemType Directory -Force (Split-Path -Parent $CliOutputPath) | Out-Null
Copy-Item -Force $BuiltLibrary.FullName $CliOutputPath
Write-Host "Built $OutputPath"
Write-Host "Synced $CliOutputPath"
