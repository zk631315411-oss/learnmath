param(
    [ValidateSet("start", "stop", "status", "logs")]
    [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $DeployDir "runtime.env"
$ComposeFile = Join-Path $DeployDir "compose.yml"

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Missing deploy/runtime.env. Run the installer first."
}

function Invoke-Compose {
    param([string[]]$Arguments)
    & docker compose --env-file $EnvFile -f $ComposeFile @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed with exit code $LASTEXITCODE"
    }
}

switch ($Action) {
    "start" { Invoke-Compose @("up", "-d", "--no-build") }
    "stop" { Invoke-Compose @("down") }
    "status" { Invoke-Compose @("ps") }
    "logs" { Invoke-Compose @("logs", "--tail", "200") }
}

