param(
    [string]$OutputDirectory = "",
    [string]$DockerInstaller = ""
)

$ErrorActionPreference = "Stop"
$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $DeployDir
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $RootDir "release\LearnMath-DockerSetup"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $RootDir "release"))
if (-not $OutputDirectory.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Docker setup output must remain under the repository release folder."
}

if (Test-Path -LiteralPath $OutputDirectory) {
    Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

if (-not $DockerInstaller) {
    $dockerArchitecture = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
    $dockerInstallerUrl = "https://desktop.docker.com/win/main/$dockerArchitecture/Docker%20Desktop%20Installer.exe"
    $DockerInstaller = Join-Path $OutputDirectory "Docker Desktop Installer.exe"
    Write-Host "[LearnMath] Downloading the official Docker Desktop installer..." -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri $dockerInstallerUrl -OutFile $DockerInstaller
} else {
    Copy-Item -LiteralPath ([IO.Path]::GetFullPath($DockerInstaller)) -Destination (Join-Path $OutputDirectory "Docker Desktop Installer.exe")
}

Copy-Item -LiteralPath (Join-Path $DeployDir "docker\Install-Docker.ps1") -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $DeployDir "docker\Install-Docker.bat") -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $DeployDir "docker\README.md") -Destination $OutputDirectory
Write-Host "[LearnMath] Docker setup package ready: $OutputDirectory" -ForegroundColor Green

