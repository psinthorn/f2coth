# =============================================================================
#  F2 AssetHub — Uninstall / Cleanup (Windows)  v1.0.0
#  F2 Co., Ltd. · f2.co.th
#
#  Removes what the Windows collector created: the spool/state folder under
#  %ProgramData%\F2AssetHub and the temp copy the installer dropped. collect.ps1
#  uses only built-in CIM/WMI and installs no packages, so there are no deps to
#  remove and no scheduled tasks are created automatically.
#
#  USAGE (PowerShell)
#    irm https://assethub.f2.co.th/api/assethub/collector/uninstall.ps1 | iex
# =============================================================================
$ErrorActionPreference = "SilentlyContinue"

$dir = Join-Path $env:ProgramData "F2AssetHub"
if (Test-Path $dir) {
  Write-Host "[uninstall] removing $dir"
  Remove-Item -Recurse -Force $dir
} else {
  Write-Host "[uninstall] no F2AssetHub folder found — nothing to remove."
}

Remove-Item (Join-Path $env:TEMP "f2-collect.ps1") -Force -ErrorAction SilentlyContinue

Write-Host "[uninstall] done. (A collect.ps1 you saved in your working dir, if any, was left for you to delete.)"
