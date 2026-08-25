param(
    [ValidateSet("start", "stop", "status", "logs")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $DeployDir "runtime.env"
$ComposeFile = Join-Path $DeployDir "compose.yml"
$DefaultPort = 8080

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Missing deploy/runtime.env. Run the installer first."
}

function Resolve-DockerCommand {
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        $command = Get-Command docker -ErrorAction SilentlyContinue
    }
    if ($command) {
        return $command.Source
    }
    $candidate = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
    if (Test-Path -LiteralPath $candidate) {
        return $candidate
    }
    throw "Docker Desktop was not found. Start Docker Desktop, then retry."
}

$DockerCommand = Resolve-DockerCommand

function Invoke-Compose {
    param([string[]]$Arguments)
    & $DockerCommand compose --env-file $EnvFile -f $ComposeFile @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed with exit code $LASTEXITCODE"
    }
}

function Read-EnvValue {
    param([string]$Name, [string]$Default = "")
    foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding utf8) {
        if ($line -match '^\s*([^#=]+?)\s*=\s*(.*)$' -and $matches[1].Trim() -eq $Name) {
            return $matches[2].Trim()
        }
    }
    return $Default
}

function Get-AppPort {
    $raw = Read-EnvValue "LEARNMATH_PORT" ([string]$DefaultPort)
    $port = 0
    if (-not [int]::TryParse($raw, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        throw "deploy/runtime.env contains an invalid LEARNMATH_PORT: '$raw'."
    }
    return $port
}

function Wait-ForApplication {
    param([int]$Port)

    $url = "http://127.0.0.1:$Port/health"
    Write-Host "[LearnMath] Waiting for the application: $url" -ForegroundColor Cyan
    for ($attempt = 1; $attempt -le 120; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                Write-Host "[LearnMath] LearnMath is ready: http://127.0.0.1:$Port" -ForegroundColor Green
                return
            }
        } catch {
            # Compose services may need several seconds to pass their health checks.
        }
        if ($attempt -eq 1 -or $attempt % 10 -eq 0) {
            Write-Host "[LearnMath] Still starting ($attempt/120)..." -ForegroundColor DarkGray
        }
        Start-Sleep -Seconds 2
    }

    Write-Host "[LearnMath] Startup timed out. Recent container logs:" -ForegroundColor Red
    & $DockerCommand compose --env-file $EnvFile -f $ComposeFile logs --tail 100
    throw "LearnMath did not become healthy within 4 minutes."
}

switch ($Action) {
    "start" {
        $port = Get-AppPort
        Invoke-Compose @("up", "-d", "--no-build")
        Wait-ForApplication $port
    }
    "stop" { Invoke-Compose @("down") }
    "status" { Invoke-Compose @("ps") }
    "logs" { Invoke-Compose @("logs", "--tail", "200") }
}
