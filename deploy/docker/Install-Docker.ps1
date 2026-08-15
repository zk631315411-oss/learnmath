$ErrorActionPreference = "Stop"
$SetupDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $SetupDir "Docker Desktop Installer.exe"

function Test-DockerReady {
    try {
        & docker info *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

if (Test-DockerReady) {
    Write-Host "[LearnMath] Docker Desktop is already ready." -ForegroundColor Green
    exit 0
}

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCommand -and -not (Test-Path -LiteralPath $Installer)) {
    throw "Docker Desktop installer is missing from this setup package."
}

if (-not $dockerCommand) {
    Write-Host "Windows will request administrator permission to install Docker Desktop."
    $process = Start-Process -FilePath $Installer -Verb RunAs -Wait -PassThru -ArgumentList @(
        "install", "--accept-license", "--backend=wsl-2", "--always-run-service"
    )
    if ($process.ExitCode -ne 0) {
        throw "Docker Desktop installer failed with exit code $($process.ExitCode)."
    }
}

$dockerBin = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin"
if ($env:Path -notlike "*$dockerBin*") { $env:Path = "$dockerBin;$env:Path" }
if (-not (Test-DockerReady)) {
    $desktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (-not (Test-Path -LiteralPath $desktop)) {
        throw "Docker Desktop was installed but its executable was not found. Restart Windows and retry."
    }
    Start-Process -FilePath $desktop -WindowStyle Hidden
}

for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if (Test-DockerReady) {
        Write-Host "[LearnMath] Docker Desktop is ready." -ForegroundColor Green
        exit 0
    }
    Start-Sleep -Seconds 2
}
throw "Docker Desktop did not become ready. Restart Windows, then run this setup again."

