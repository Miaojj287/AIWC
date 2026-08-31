@echo off
setlocal

set "APP_DIR=%~dp0"
set "EXE_PATH=%AIWC_DESKTOP_EXE%"
if not defined EXE_PATH (
  for %%F in ("%APP_DIR%*.exe") do (
    if /I not "%%~nxF"=="Uninstall.exe" if not defined EXE_PATH set "EXE_PATH=%%~fF"
  )
)
set "MCP_ARCHIVE=%APP_DIR%resources\app.asar"
set "MCP_ENTRY_UNPACKED=%APP_DIR%resources\app.asar.unpacked\dist-electron\mcp.js"
set "MCP_ENTRY=%MCP_ARCHIVE%\dist-electron\mcp.js"
set "MCP_BOOTSTRAP=%APP_DIR%aiwc-mcp-bootstrap.cjs"

if not exist "%EXE_PATH%" (
  >&2 echo [AIWC MCP Launcher] desktop executable not found; set AIWC_DESKTOP_EXE
  exit /b 1
)

if not exist "%MCP_BOOTSTRAP%" (
  >&2 echo [AIWC MCP Launcher] MCP bootstrap not found at "%MCP_BOOTSTRAP%"
  exit /b 1
)

if exist "%MCP_ENTRY_UNPACKED%" (
  set "MCP_ENTRY=%MCP_ENTRY_UNPACKED%"
) else if not exist "%MCP_ARCHIVE%" (
  >&2 echo [AIWC MCP Launcher] app.asar not found at "%MCP_ARCHIVE%"
  exit /b 1
)

set "ELECTRON_RUN_AS_NODE=1"
set "AIWC_MCP_LAUNCHER=packaged-launcher"
set "AIWC_MCP_ENTRY=%MCP_ENTRY%"

"%EXE_PATH%" "%MCP_BOOTSTRAP%" %*
