[CmdletBinding()]
param(
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$RootDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$FrontendDir = Join-Path $RootDir "frontend"

function Get-EnvInt([string]$Name, [int]$Default) {
    $raw = [Environment]::GetEnvironmentVariable($Name)
    $value = 0
    if ([string]::IsNullOrWhiteSpace($raw) -or -not [int]::TryParse($raw, [ref]$value)) {
        return $Default
    }
    return $value
}

function Test-PortBusy([int]$Port) {
    return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-LearnMathHealth([int]$Port) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 1
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Find-FreePort([int]$Start, [int]$End) {
    for ($port = $Start; $port -le $End; $port++) {
        if (-not (Test-PortBusy $port)) {
            return $port
        }
    }
    throw "No free port was found in $Start-$End."
}

function Wait-Http([string]$Uri, [int]$Attempts = 45) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 1
            if ($response.StatusCode -eq 200) {
                return $true
            }
        } catch {
            # The child process may still be importing dependencies or binding its port.
        }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Resolve-Python {
    $venvPython = Join-Path $RootDir "venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        return $venvPython
    }
    $command = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    throw "Python was not found. Create venv and install requirements.txt first."
}

function Resolve-Npm {
    $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $command) {
        $command = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $command) {
        throw "npm was not found. Install Node.js and reopen the terminal."
    }
    return $command.Source
}

$python = Resolve-Python
& $python -c "import uvicorn" *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Python dependency uvicorn is missing. Install requirements.txt in the project venv."
}

$npm = Resolve-Npm
$packageLock = Join-Path $FrontendDir "package-lock.json"
if (-not (Test-Path -LiteralPath $packageLock)) {
    throw "frontend/package-lock.json is missing; cannot bootstrap deterministic frontend dependencies."
}

$viteEntry = Join-Path $FrontendDir "node_modules\.bin\vite.cmd"
if (-not (Test-Path -LiteralPath $viteEntry)) {
    Write-Host "[LearnMath] Frontend executable entry is missing; repairing dependencies with npm install..." -ForegroundColor Yellow
    Push-Location $FrontendDir
    try {
        & $npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed. If an old Vite process is running, close it and retry."
        }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path -LiteralPath $viteEntry)) {
        throw "npm install completed but frontend/node_modules/.bin/vite.cmd is still missing."
    }
}

$apiPort = Get-EnvInt "LEARNMATH_API_PORT" 8001
$frontendPort = Get-EnvInt "LEARNMATH_FRONTEND_PORT" 5173
$reuseBackend = Test-LearnMathHealth $apiPort
if (-not $reuseBackend -and (Test-PortBusy $apiPort)) {
    $apiPort = Find-FreePort $apiPort 8090
}
if (Test-PortBusy $frontendPort) {
    $frontendPort = Find-FreePort $frontendPort 5199
}

$env:LEARNMATH_API_PORT = [string]$apiPort
$env:LEARNMATH_FRONTEND_PORT = [string]$frontendPort

if ($NoLaunch) {
    Write-Host "[LearnMath] Checks passed." -ForegroundColor Green
    Write-Host "API:      http://127.0.0.1:$apiPort"
    Write-Host "Frontend: http://127.0.0.1:$frontendPort"
    exit 0
}

if ($reuseBackend) {
    Write-Host "[LearnMath] Reusing healthy backend: http://127.0.0.1:$apiPort" -ForegroundColor Green
} else {
    $backendCommand = "`"$python`" -m uvicorn app.main:app --host 0.0.0.0 --port $apiPort"
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", $backendCommand) -WorkingDirectory $RootDir | Out-Null
    if (-not (Wait-Http "http://127.0.0.1:$apiPort/health")) {
        throw "Backend did not become available at http://127.0.0.1:$apiPort. Check the LearnMath-Backend window."
    }
    Write-Host "[LearnMath] Backend is ready: http://127.0.0.1:$apiPort" -ForegroundColor Green
}

$frontendCommand = "set `"VITE_BACKEND_ORIGIN=http://127.0.0.1:$apiPort`" && `"$npm`" run dev -- --host 127.0.0.1 --strictPort --port $frontendPort"
Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", $frontendCommand) -WorkingDirectory $FrontendDir | Out-Null

if (-not (Wait-Http "http://127.0.0.1:$frontendPort/")) {
    throw "Frontend did not become available at http://127.0.0.1:$frontendPort. Check the LearnMath-Frontend window."
}
Write-Host "[LearnMath] Frontend is ready: http://127.0.0.1:$frontendPort" -ForegroundColor Green
Write-Host "[LearnMath] Open the URL above if the browser does not open automatically."
