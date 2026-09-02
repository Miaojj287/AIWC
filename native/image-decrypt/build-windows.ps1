$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptDir '..\..')
$Manifest = Join-Path $ScriptDir 'Cargo.toml'

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw 'cargo not found; install the stable Rust MSVC toolchain first'
}

cargo test --manifest-path $Manifest
cargo build --manifest-path $Manifest --release

$Source = Join-Path $ScriptDir 'target\release\aiwc_image_native.dll'
$DesktopOutput = Join-Path $ProjectRoot 'resources\wedecrypt\aiwc-image-native-win32-x64.node'
$CliOutput = Join-Path $ProjectRoot 'AIWC-CLI\native\win32-x64\aiwc-image-native-win32-x64.node'
node (Join-Path $ProjectRoot 'scripts\sync-image-native.cjs') --platform win32 --arch x64 --lib $Source
New-Item -ItemType Directory -Force (Split-Path -Parent $CliOutput) | Out-Null
Copy-Item -Force $Source $CliOutput
Write-Host "Synced $DesktopOutput"
Write-Host "Synced $CliOutput"
