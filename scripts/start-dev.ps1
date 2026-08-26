[CmdletBinding()]
param(
    [switch]$NoLaunch,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$RootDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$FrontendDir = Join-Path $RootDir "frontend"
$DeployDir = Join-Path $RootDir "deploy"
$DevCompose = Join-Path $DeployDir "compose.dev.yml"
$ProdCompose = Join-Path $DeployDir "compose.yml"
$BuildCompose = Join-Path $DeployDir "compose.build.yml"
$DevProject = "learnmath-dev"
$RuntimeDir = Join-Path $RootDir ".runtime-dev"
$SpoolDir = Join-Path $RuntimeDir "manim-spool"
$RenderDir = Join-Path $RuntimeDir "manim-render"

function Get-EnvInt([string]$Name, [int]$Default) {
    $raw = [Environment]::GetEnvironmentVariable($Name)
    $value = 0
    if ([string]::IsNullOrWhiteSpace($raw) -or -not [int]::TryParse($raw, [ref]$value)) { return $Default }
    return $value
}

function Test-PortBusy([int]$Port) {
    return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Find-FreePort([int]$Start, [int]$End) {
    for ($port = $Start; $port -le $End; $port++) {
        if (-not (Test-PortBusy $port)) { return $port }
    }
    throw "No free port was found in $Start-$End."
}

function Test-Http([string]$Uri) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 1
        return $response.StatusCode -eq 200
    } catch { return $false }
}

function Wait-Http([string]$Uri, [int]$Attempts = 60) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        if (Test-Http $Uri) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Resolve-Python {
    $venvPython = Join-Path $RootDir "venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) { return $venvPython }
    $command = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "Python was not found. Create venv and install requirements.txt first."
}

function Resolve-Npm {
    $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $command) { $command = Get-Command npm -ErrorAction SilentlyContinue }
    if (-not $command) { throw "npm was not found. Install Node.js and reopen the terminal." }
    return $command.Source
}

function Resolve-Docker {
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if (-not $command) { $command = Get-Command docker -ErrorAction SilentlyContinue }
    if (-not $command) { throw "Docker was not found. Install Docker Desktop before starting the full development environment." }
    & $command.Source info *> $null
    if ($LASTEXITCODE -ne 0) { throw "Docker is installed but not ready. Start Docker Desktop and retry." }
    return $command.Source
}

function Invoke-DockerCompose([string[]]$Arguments) {
    & $script:Docker compose "-p" $DevProject "-f" $DevCompose @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose failed with exit code $LASTEXITCODE." }
}

function Test-DevServiceRunning([string]$Service) {
    $running = @(& $script:Docker compose "-p" $DevProject "-f" $DevCompose ps --services --filter "status=running" 2>$null)
    return $running -contains $Service
}

function Test-Image([string]$Image) {
    & $script:Docker image inspect $Image *> $null
    return $LASTEXITCODE -eq 0
}

function Ensure-DevImages {
    $apiImage = if ($env:LEARNMATH_DEV_API_IMAGE) { $env:LEARNMATH_DEV_API_IMAGE } else { "learnmath-api:team-demo-1" }
    $manimImage = if ($env:LEARNMATH_DEV_MANIM_IMAGE) { $env:LEARNMATH_DEV_MANIM_IMAGE } else { "learnmath-manim:team-demo-1" }
    $missing = @()
    if (-not (Test-Image $apiImage)) { $missing += "api" }
    if (-not (Test-Image $manimImage)) { $missing += "manim-renderer" }
    if ($missing.Count -gt 0) {
        Write-Host "[LearnMath] Building missing development images once: $($missing -join ', ')" -ForegroundColor Yellow
        $version = if ($apiImage -match '^learnmath-api:(.+)$') { $Matches[1] } else { "team-demo-1" }
        $env:LEARNMATH_VERSION = $version
        $args = @("compose", "-f", $ProdCompose, "-f", $BuildCompose, "build") + $missing
        & $script:Docker @args
        if ($LASTEXITCODE -ne 0) { throw "Unable to build the development runtime images." }
    }
    $env:LEARNMATH_DEV_API_IMAGE = $apiImage
    $env:LEARNMATH_DEV_MANIM_IMAGE = $manimImage
}

$script:Docker = Resolve-Docker
$python = Resolve-Python
$npm = Resolve-Npm

& $python -c "import uvicorn, redis" *> $null
if ($LASTEXITCODE -ne 0) { throw "Python dependencies are incomplete. Run: venv\Scripts\pip install -r requirements.txt" }

$packageLock = Join-Path $FrontendDir "package-lock.json"
if (-not (Test-Path -LiteralPath $packageLock)) { throw "frontend/package-lock.json is missing." }
$viteEntry = Join-Path $FrontendDir "node_modules\.bin\vite.cmd"
if (-not (Test-Path -LiteralPath $viteEntry)) {
    Write-Host "[LearnMath] Frontend dependencies are missing; running npm install..." -ForegroundColor Yellow
    Push-Location $FrontendDir
    try {
        & $npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    } finally { Pop-Location }
}

$apiPort = Get-EnvInt "LEARNMATH_API_PORT" 8001
$frontendPort = Get-EnvInt "LEARNMATH_FRONTEND_PORT" 5173
$redisPort = Get-EnvInt "LEARNMATH_DEV_REDIS_PORT" 6379
if ((Test-PortBusy $redisPort) -and -not (Test-DevServiceRunning "redis")) {
    $redisPort = Find-FreePort ($redisPort + 1) 6399
    Write-Host "[LearnMath] Redis port was occupied; using $redisPort." -ForegroundColor Yellow
}
if ((Test-PortBusy $apiPort) -and -not (Test-Http "http://127.0.0.1:$apiPort/health")) {
    $apiPort = Find-FreePort ($apiPort + 1) 8090
    Write-Host "[LearnMath] API port was occupied; using $apiPort." -ForegroundColor Yellow
}
$frontendReady = Test-Http "http://127.0.0.1:$frontendPort/"
if ((Test-PortBusy $frontendPort) -and -not $frontendReady) {
    $frontendPort = Find-FreePort ($frontendPort + 1) 5199
    Write-Host "[LearnMath] Frontend port was occupied; using $frontendPort." -ForegroundColor Yellow
    $frontendReady = $false
}

New-Item -ItemType Directory -Force -Path $SpoolDir, $RenderDir | Out-Null
Ensure-DevImages

$env:LEARNMATH_DEV_REDIS_PORT = [string]$redisPort
$env:MANIM_REDIS_URL = "redis://127.0.0.1:$redisPort/0"
$env:MANIM_SPOOL_DIR = $SpoolDir
$env:MANIM_RENDER_DIR = $RenderDir
$env:MANIM_QUEUE = "learnmath-manim"
$env:LEARNMATH_API_PORT = [string]$apiPort
$env:LEARNMATH_FRONTEND_PORT = [string]$frontendPort

if ($NoLaunch) {
    Write-Host "[LearnMath] Checks passed." -ForegroundColor Green
    Write-Host "Development dependencies: Redis + Manim Dispatcher + Manim Renderer"
    Write-Host "API:      http://127.0.0.1:$apiPort"
    Write-Host "Frontend: http://127.0.0.1:$frontendPort"
    exit 0
}

Write-Host "[LearnMath] Starting Docker development dependencies..." -ForegroundColor Cyan
Invoke-DockerCompose @("up", "-d")

if (-not (Test-Http "http://127.0.0.1:$apiPort/health")) {
    $backendCommand = "`"$python`" -m uvicorn app.main:app --host 127.0.0.1 --port $apiPort --reload"
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", $backendCommand) -WorkingDirectory $RootDir | Out-Null
    if (-not (Wait-Http "http://127.0.0.1:$apiPort/health")) { throw "Backend did not become available at http://127.0.0.1:$apiPort." }
} else {
    Write-Host "[LearnMath] Reusing healthy backend: http://127.0.0.1:$apiPort" -ForegroundColor Green
}

if (-not $frontendReady) {
    $frontendCommand = "set VITE_BACKEND_ORIGIN=http://127.0.0.1:$apiPort && `"$npm`" run dev -- --host 127.0.0.1 --strictPort --port $frontendPort"
    Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", $frontendCommand) -WorkingDirectory $FrontendDir | Out-Null
    if (-not (Wait-Http "http://127.0.0.1:$frontendPort/")) { throw "Frontend did not become available at http://127.0.0.1:$frontendPort." }
} else {
    Write-Host "[LearnMath] Reusing healthy frontend: http://127.0.0.1:$frontendPort" -ForegroundColor Green
}

Write-Host "[LearnMath] Full development environment is ready." -ForegroundColor Green
Write-Host "[LearnMath] Frontend: http://127.0.0.1:$frontendPort" -ForegroundColor Green
Write-Host "[LearnMath] API:      http://127.0.0.1:$apiPort" -ForegroundColor Green
Write-Host "[LearnMath] Formula editor/recognition uses the root .env; animation uses Docker Redis + Renderer." -ForegroundColor DarkGray
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$frontendPort" }
