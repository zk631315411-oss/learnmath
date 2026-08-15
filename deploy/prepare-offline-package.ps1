param(
    [string]$OutputDirectory = "",
    [string]$Version = "local"
)

$ErrorActionPreference = "Stop"
$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $DeployDir
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $RootDir "release\LearnMath"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) { throw "Docker is required to build the offline package." }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not running." }

$env:LEARNMATH_VERSION = $Version

Write-Host "[LearnMath] Building application images..." -ForegroundColor Cyan
& docker compose -f (Join-Path $DeployDir "compose.yml") -f (Join-Path $DeployDir "compose.build.yml") build api web
if ($LASTEXITCODE -ne 0) { throw "Container image build failed." }

if (Test-Path -LiteralPath $OutputDirectory) {
    $resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
    $resolvedReleaseRoot = [IO.Path]::GetFullPath((Join-Path $RootDir "release"))
    if (-not $resolvedOutput.StartsWith($resolvedReleaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace an output directory outside the repository release folder."
    }
    Remove-Item -LiteralPath $OutputDirectory -Recurse -Force
}

$assetImages = Join-Path $OutputDirectory "deploy\assets\images"
$outputTextbooks = Join-Path $OutputDirectory "data\textbooks"
New-Item -ItemType Directory -Force -Path $assetImages, $outputTextbooks | Out-Null

Copy-Item -LiteralPath (Join-Path $RootDir "Install-LearnMath.bat") -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $RootDir "Start-LearnMath.bat") -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $RootDir "Stop-LearnMath.bat") -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $DeployDir "compose.yml") -Destination (Join-Path $OutputDirectory "deploy")
Copy-Item -LiteralPath (Join-Path $DeployDir "install.ps1") -Destination (Join-Path $OutputDirectory "deploy")
Copy-Item -LiteralPath (Join-Path $DeployDir "manage.ps1") -Destination (Join-Path $OutputDirectory "deploy")
Copy-Item -LiteralPath (Join-Path $DeployDir "runtime.env.example") -Destination (Join-Path $OutputDirectory "deploy")
Copy-Item -LiteralPath (Join-Path $DeployDir "README.md") -Destination (Join-Path $OutputDirectory "deploy")

Get-ChildItem -LiteralPath (Join-Path $RootDir "data\textbooks") -Filter *.pdf | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $outputTextbooks
}

$imagesArchive = Join-Path $assetImages "learnmath-images.tar"
Write-Host "[LearnMath] Saving container images. This can take several minutes..." -ForegroundColor Cyan
& docker save --output $imagesArchive "learnmath-api:$Version" "learnmath-web:$Version"
if ($LASTEXITCODE -ne 0) { throw "Unable to create the offline image archive." }

Write-Host "[LearnMath] Offline package ready: $OutputDirectory" -ForegroundColor Green
