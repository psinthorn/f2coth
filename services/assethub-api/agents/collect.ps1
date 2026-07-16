<#
=============================================================================
 F2 AssetHub — Computer Inventory Collector (Windows)  v1.0.0
 F2 Co., Ltd. · f2.co.th

 Collects: brand, model, serial, CPU, RAM, disks, OS, NICs (MAC/IP),
 installed software (32+64-bit registry, fast & safe), and network role:
 DOMAIN / WORKGROUP / STANDALONE (via Win32_ComputerSystem.PartOfDomain
 and DomainRole). Pushes JSON to the AssetHub server over outbound HTTPS
 only — works with a cloud server, no VPN or inbound firewall rules.

 Works on Windows 10/11 and Server 2016+ with built-in PowerShell 5.1.
 No admin rights required for the standard data set.

 USAGE (from an elevated or normal prompt):
   powershell -ExecutionPolicy Bypass -File collect.ps1 `
     -ServerUrl "https://assethub.f2.co.th" -Token "<enrollment token>"
   powershell -ExecutionPolicy Bypass -File collect.ps1 -DryRun

 SCHEDULING (daily 09:00, run once as admin):
   schtasks /Create /TN "F2 AssetHub Inventory" /SC DAILY /ST 09:00 ^
     /TR "powershell -ExecutionPolicy Bypass -File C:\F2\collect.ps1 -ServerUrl https://assethub.f2.co.th -Token XXXX" ^
     /RU SYSTEM
=============================================================================
#>
[CmdletBinding()]
param(
    [string]$ServerUrl = $env:F2_SERVER_URL,
    [string]$Token     = $env:F2_TOKEN,
    [switch]$DryRun
)
$ErrorActionPreference = "SilentlyContinue"
$Version  = "1.0.0"
$SpoolDir = Join-Path $env:ProgramData "F2AssetHub\spool"
New-Item -ItemType Directory -Force -Path $SpoolDir | Out-Null

# ---------- hardware / OS ----------
$cs   = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$csp  = Get-CimInstance Win32_ComputerSystemProduct
$os   = Get-CimInstance Win32_OperatingSystem
$cpu  = Get-CimInstance Win32_Processor | Select-Object -First 1

# ---------- network role: domain / workgroup / standalone ----------
# DomainRole: 0=Standalone WS, 1=Member WS, 2=Standalone Server,
#             3=Member Server, 4=Backup DC, 5=Primary DC
$netRole = "standalone"; $netName = ""
if ($cs.PartOfDomain) {
    $netRole = "domain";  $netName = $cs.Domain
    $devType = if ($cs.DomainRole -ge 4) { "server" } else { "computer" }
} else {
    if ($cs.Workgroup -and $cs.Workgroup -ne "WORKGROUP") { $netRole = "workgroup" }
    elseif ($cs.Workgroup) { $netRole = "workgroup" }  # default WORKGROUP still counts
    $netName = $cs.Workgroup
    $devType = if ($cs.DomainRole -eq 2) { "server" } else { "computer" }
}
if ($os.ProductType -gt 1) { $devType = "server" }   # 2=DC, 3=Server

# ---------- interfaces ----------
$ifaces = @()
Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled=TRUE" | ForEach-Object {
    $ipv4 = @($_.IPAddress | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' })
    $type = if ($_.Description -match 'Wi-?Fi|Wireless|802\.11') { "wifi" } else { "ethernet" }
    $ifaces += [ordered]@{ name = $_.Description; mac = $_.MACAddress; ipv4 = $ipv4; type = $type }
}

# ---------- disks ----------
$disks = @()
Get-CimInstance Win32_DiskDrive | ForEach-Object {
    $disks += [ordered]@{ model = $_.Model; size_gb = [math]::Round($_.Size/1GB); free_gb = 0 }
}
$sys = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
if ($sys -and $disks.Count -gt 0) { $disks[0].free_gb = [math]::Round($sys.FreeSpace/1GB) }

# ---------- software (registry — fast, no Win32_Product side effects) ----------
$sw = @()
$paths = @(
 "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
 "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
 "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
Get-ItemProperty $paths | Where-Object { $_.DisplayName } | ForEach-Object {
    $sw += [ordered]@{ name = $_.DisplayName; version = "$($_.DisplayVersion)"; vendor = "$($_.Publisher)" }
}
$sw = $sw | Sort-Object name -Unique

# ---------- assemble ----------
$payload = [ordered]@{
    schema       = "f2.assethub.v1"
    collected_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
    collector    = [ordered]@{ name = "collect.ps1"; version = $Version }
    device       = [ordered]@{
        hostname                 = $env:COMPUTERNAME
        device_type              = $devType
        brand                    = "$($cs.Manufacturer)".Trim()
        model                    = "$($cs.Model)".Trim()
        serial_number            = "$($bios.SerialNumber)".Trim()
        os  = [ordered]@{ name = $os.Caption; version = "$($os.Version) (build $($os.BuildNumber))";
                          kernel = $os.Version; arch = $os.OSArchitecture }
        cpu                      = "$($cpu.Name)".Trim()
        ram_mb                   = [math]::Round($cs.TotalPhysicalMemory/1MB)
        network_role             = $netRole
        domain_or_workgroup_name = "$netName"
        interfaces               = $ifaces
        disks                    = $disks
        software                 = $sw
        logged_in_user           = "$($cs.UserName)"
        uptime_hours             = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours)
    }
}
$json = $payload | ConvertTo-Json -Depth 6 -Compress

if ($DryRun) {
    $json
    Write-Host "`n--dry-run: not sent. host=$($env:COMPUTERNAME) serial=$($bios.SerialNumber) role=$netRole ($netName)" -ForegroundColor Yellow
    return
}
if (-not $ServerUrl -or -not $Token) {
    Write-Error "Set -ServerUrl and -Token (or F2_SERVER_URL / F2_TOKEN env vars), or use -DryRun."
    exit 1
}

# ---------- send / spool (flush older spooled payloads first) ----------
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" }
function Send-Payload([string]$body) {
    try {
        Invoke-RestMethod -Uri "$ServerUrl/api/assethub/ingest" -Method Post -Headers $headers `
            -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30 | Out-Null
        return $true
    } catch { return $false }
}
Get-ChildItem $SpoolDir -Filter *.json | ForEach-Object {
    if (Send-Payload (Get-Content $_.FullName -Raw)) { Remove-Item $_.FullName -Force }
}
if (Send-Payload $json) {
    Write-Host "OK: inventory sent for $($env:COMPUTERNAME) (role=$netRole, $netName)" -ForegroundColor Green
} else {
    $f = Join-Path $SpoolDir ("{0}-{1}.json" -f (Get-Date -Format yyyyMMddHHmmss), $PID)
    $json | Out-File -FilePath $f -Encoding utf8
    Write-Warning "Server unreachable — spooled to $f (will retry on next run)"
}
