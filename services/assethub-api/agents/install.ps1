# =============================================================================
#  F2 AssetHub — Universal Installer (Windows)  v1.0.0
#  F2 Co., Ltd. · f2.co.th
#
#  ONE command: confirms this is Windows, downloads collect.ps1, and runs it.
#  (Linux/macOS use install.sh instead.) collect.ps1 uses built-in CIM/WMI —
#  no extra dependencies to install.
#
#  USAGE (PowerShell)
#    $env:F2_SERVER_URL = "https://assethub.f2.co.th"
#    $env:F2_TOKEN      = "<token>"
#    irm https://assethub.f2.co.th/api/assethub/collector/install.ps1 | iex
# =============================================================================
$ErrorActionPreference = "Stop"

$server = $env:F2_SERVER_URL
$token  = $env:F2_TOKEN
if (-not $server) { Write-Error "set `$env:F2_SERVER_URL"; exit 2 }
if (-not $token)  { Write-Error "set `$env:F2_TOKEN";      exit 2 }

if (-not ($IsWindows -ne $false)) {
  Write-Error "install.ps1 is for Windows — on Linux/macOS use install.sh instead."
  exit 2
}

$base = ($server.TrimEnd('/')) + "/api/assethub/collector"
$tmp  = Join-Path $env:TEMP "f2-collect.ps1"

Write-Host "[install] os=windows  mode=collector  tool=collect.ps1"
Write-Host "[install] downloading collect.ps1 ..."
Invoke-WebRequest -UseBasicParsing -Uri "$base/collect.ps1" -OutFile $tmp

Write-Host "[install] running collect.ps1 ..."
& $tmp -ServerUrl $server -Token $token
