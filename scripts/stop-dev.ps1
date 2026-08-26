$ErrorActionPreference = "Stop"
$RootDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$ComposeFile = Join-Path $RootDir "deploy\compose.dev.yml"
$docker = Get-Command docker.exe -ErrorAction SilentlyContinue
if (-not $docker) { $docker = Get-Command docker -ErrorAction SilentlyContinue }
if (-not $docker) { throw "Docker was not found." }
& $docker.Source compose -p learnmath-dev -f $ComposeFile down
if ($LASTEXITCODE -ne 0) { throw "Unable to stop LearnMath development dependencies." }
Write-Host "[LearnMath] Development Docker dependencies stopped. Host API/frontend windows must be closed separately." -ForegroundColor Green
