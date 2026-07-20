# =============================================================================
#  F2 AssetHub — All-in-one Runner (Windows)  v1.0.0
#  F2 Co., Ltd. · f2.co.th
#
#  Confirms Windows, checks the server is reachable, fetches collect.ps1 and
#  inventories this machine. The LAN probe (discover.sh) is Linux/macOS only —
#  run it from a probe box; this runner covers the Windows collector.
#
#  USAGE (PowerShell)
#    $env:F2_SERVER_URL="https://assethub.f2.co.th"; $env:F2_TOKEN="<token>"
#    irm https://assethub.f2.co.th/api/assethub/collector/run.ps1 | iex
#
#  DAEMON: set $env:F2_DAEMON="1" to stay resident and poll the server, running
#  when an operator presses "Scan now" or the rescan interval elapses.
# =============================================================================
$ErrorActionPreference = "Stop"

$server = $env:F2_SERVER_URL
$token  = $env:F2_TOKEN
if (-not $server) { Write-Error "set `$env:F2_SERVER_URL"; exit 2 }
if (-not $token)  { Write-Error "set `$env:F2_TOKEN";      exit 2 }
if (-not ($IsWindows -ne $false)) { Write-Error "run.ps1 is for Windows — use run.sh on Linux/macOS."; exit 2 }

$root = $server.TrimEnd('/')
$base = "$root/api/assethub/collector"
$api  = "$root/api/assethub"
$hdr  = @{ Authorization = "Bearer $token" }

# server preflight
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri "$base/collect.ps1" -OutFile "$env:TEMP\f2-collect.ps1" }
catch { Write-Error "cannot reach $base/collect.ps1 — check F2_SERVER_URL / outbound access / module enabled."; exit 4 }
$tool = "$env:TEMP\f2-collect.ps1"

function Invoke-Once {
  Write-Host "[run] collecting this machine ..."
  try { & $tool -ServerUrl $server -Token $token } catch { Write-Warning "collector error: $_" }
}

if ($env:F2_DAEMON -ne "1") { Invoke-Once; Write-Host "[run] done (oneshot)."; exit 0 }

Write-Host "[run] daemon mode — polling $api/agent/poll"
while ($true) {
  $pollMin = 5
  try {
    $resp = Invoke-RestMethod -TimeoutSec 15 -Headers $hdr -Uri "$api/agent/poll"
    if ($resp.poll_min) { $pollMin = [int]$resp.poll_min }
    if ($resp.run) {
      Invoke-Once
      try { Invoke-RestMethod -TimeoutSec 15 -Method Post -Headers $hdr -Uri "$api/agent/ack" | Out-Null }
      catch { Write-Warning "ack failed" }
    }
  } catch { Write-Warning "poll failed: $_" }
  if ($pollMin -lt 1) { $pollMin = 5 }
  Start-Sleep -Seconds ($pollMin * 60)
}
