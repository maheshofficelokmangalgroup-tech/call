<#
  Start the backend on this PC WITHOUT Docker (SQLite + in-memory cache).
  First run: creates a virtualenv, installs packages, creates the database, loads demo data.

    .\scripts\dev-backend.ps1                 # start (loads demo data the first time)
    .\scripts\dev-backend.ps1 -NoSeed         # start with an empty database (no demo users!)
    .\scripts\dev-backend.ps1 -Port 8001
    .\scripts\dev-backend.ps1 -DatabaseUrl "mysql+pymysql://root:pw@127.0.0.1:3306/calling_app?charset=utf8mb4"

  Phones on the same Wi-Fi reach the API at  http://<this-PC-ip>:8000  (the script opens the firewall port when run as Administrator,
  otherwise it prints the one command to run).
  The Android emulator reaches it at         http://10.0.2.2:8000
  A USB-connected phone works with           adb reverse tcp:8000 tcp:8000   then use http://localhost:8000
#>
param(
    [switch]$NoSeed,
    [int]$Port = 8000,
    [string]$DatabaseUrl = ""
)

$ErrorActionPreference = "Stop"
$backend = Resolve-Path (Join-Path $PSScriptRoot "..\backend")
Set-Location $backend

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Cyan
    python -m venv .venv
}
$py = Join-Path $backend ".venv\Scripts\python.exe"
Write-Host "Installing/validating Python packages..." -ForegroundColor Cyan
& $py -m pip install -q -r requirements.txt

if ($DatabaseUrl -ne "") { $env:DATABASE_URL = $DatabaseUrl }
if (-not $env:DATABASE_URL) {
    $env:DATABASE_URL = "sqlite:///" + ((Join-Path $backend "var\dev.db") -replace "\\", "/")
}
if (-not $env:REDIS_URL) { $env:REDIS_URL = "" }   # empty = in-memory fallback, no Redis needed
$env:PYTHONIOENCODING = "utf-8"

& $py -m scripts.bootstrap
if (-not $NoSeed) { & $py -m scripts.seed_demo }

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch "^(127\.|169\.254\.)" -and $_.PrefixOrigin -ne "WellKnown" } |
    Select-Object -ExpandProperty IPAddress
Write-Host ""
Write-Host "API docs:   http://localhost:$Port/docs" -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "Phone (Wi-Fi) server URL:  http://${ip}:$Port" -ForegroundColor Green }
Write-Host "Emulator server URL:       http://10.0.2.2:$Port" -ForegroundColor Green
Write-Host ""

# A phone on the Wi-Fi can only reach this PC if Windows Firewall lets port $Port in (private networks only).
$ruleName = "Employee Calling API ($Port)"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    $ruleCommand = "New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private,Domain"
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        Invoke-Expression $ruleCommand | Out-Null
        Write-Host "Windows Firewall: opened port $Port for private networks." -ForegroundColor Green
    } else {
        Write-Host "Phones cannot reach this PC until Windows Firewall allows port $Port." -ForegroundColor Yellow
        Write-Host "Run this once in an Administrator PowerShell (and keep the Wi-Fi set to a *Private* network):" -ForegroundColor Yellow
        Write-Host "  $ruleCommand" -ForegroundColor Yellow
    }
    Write-Host ""
}

& $py -m uvicorn app.main:app --host 0.0.0.0 --port $Port --reload
