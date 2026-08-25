$ErrorActionPreference = "Stop"
$DeployDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $DeployDir
$EnvFile = Join-Path $DeployDir "runtime.env"
$ComposeFile = Join-Path $DeployDir "compose.yml"
$ImagesArchive = Join-Path $DeployDir "assets\images\learnmath-images.tar"
$TextbookDir = Join-Path $RootDir "data\textbooks"

function Write-Step([string]$Text) {
    Write-Host "`n[LearnMath] $Text" -ForegroundColor Cyan
}

function Get-RandomHex([int]$Bytes = 32) {
    $buffer = New-Object byte[] $Bytes
    [Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
    return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function Read-Secret([string]$Prompt) {
    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Get-DockerCommand {
    $command = Get-Command docker -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidate = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    return $null
}

function Test-DockerReady {
    try {
        & docker info *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Wait-Docker {
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if (Test-DockerReady) { return }
        Start-Sleep -Seconds 2
    }
    throw "Docker Desktop did not become ready. Restart Windows, then run this installer again."
}

function Read-EnvFile {
    $values = @{}
    if (-not (Test-Path -LiteralPath $EnvFile)) { return $values }
    foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding utf8) {
        if ($line -match '^\s*([^#=]+?)\s*=\s*(.*)$') {
            $values[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
    return $values
}

function Find-FreePort {
    for ($port = 8080; $port -le 8090; $port++) {
        $occupied = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $occupied) { return $port }
    }
    throw "No free local port was found between 8080 and 8090."
}

Write-Step "Checking packaged assets"
if (-not (Test-Path -LiteralPath $TextbookDir)) {
    throw "The offline package is missing the data/textbooks directory."
}
$textbookFiles = @(Get-ChildItem -LiteralPath $TextbookDir -File -Filter *.pdf)
if ($textbookFiles.Count -lt 4) {
    throw "The offline package must contain all four textbook PDF files."
}

Write-Step "Checking Docker Desktop"
$dockerPath = Get-DockerCommand
if (-not $dockerPath) {
    throw "Docker Desktop is not installed. Run the separate Docker setup package first, then run Install-LearnMath.bat again."
}
$dockerBin = Split-Path -Parent $dockerPath
if ($env:Path -notlike "*$dockerBin*") { $env:Path = "$dockerBin;$env:Path" }

if (-not (Test-DockerReady)) {
    $desktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (-not (Test-Path -LiteralPath $desktop)) {
        throw "Docker Desktop executable was not found. Install Docker Desktop, then retry."
    }
    Start-Process -FilePath $desktop -WindowStyle Hidden
}
Wait-Docker

if (Test-Path -LiteralPath $ImagesArchive) {
    Write-Step "Loading bundled container images"
    & docker load --input $ImagesArchive
    if ($LASTEXITCODE -ne 0) { throw "Unable to load the bundled container images." }
} else {
    Write-Host "[LearnMath] No offline image archive found; required images must already exist locally." -ForegroundColor Yellow
}

Write-Step "Preparing local configuration"
$values = Read-EnvFile
if (-not $values.ContainsKey("QA_LLM_API_KEY") -or -not $values["QA_LLM_API_KEY"]) {
    $apiKey = Read-Secret "Enter the QA model API key"
    if (-not $apiKey) { throw "A QA model API key is required." }
    $values["QA_LLM_API_KEY"] = $apiKey
}
if (-not $values.ContainsKey("NEO4J_URI") -or -not $values["NEO4J_URI"]) {
    $values["NEO4J_URI"] = Read-Host "Enter the Neo4j Aura URI (neo4j+s://...)"
}
if ($values["NEO4J_URI"] -notmatch '^neo4j\+s://') {
    throw "Neo4j Aura URI must start with neo4j+s://"
}
if (-not $values.ContainsKey("NEO4J_USER") -or -not $values["NEO4J_USER"]) {
    $neo4jUser = Read-Host "Enter the Neo4j Aura user [neo4j]"
    $values["NEO4J_USER"] = if ($neo4jUser) { $neo4jUser } else { "neo4j" }
}
if (-not $values.ContainsKey("NEO4J_PASSWORD") -or -not $values["NEO4J_PASSWORD"]) {
    $values["NEO4J_PASSWORD"] = Read-Secret "Enter the Neo4j Aura password"
}
if (-not $values["NEO4J_PASSWORD"]) { throw "Neo4j Aura password is required." }
if (-not $values.ContainsKey("LEARNMATH_PORT")) { $values["LEARNMATH_PORT"] = Find-FreePort }
if (-not $values.ContainsKey("LEARNMATH_VERSION")) { $values["LEARNMATH_VERSION"] = "local" }
if (-not $values.ContainsKey("JWT_SECRET")) { $values["JWT_SECRET"] = Get-RandomHex 48 }
if (-not $values.ContainsKey("QA_LLM_API_BASE")) { $values["QA_LLM_API_BASE"] = "https://dashscope.aliyuncs.com/compatible-mode/v1" }
if (-not $values.ContainsKey("QA_LLM_MODEL")) { $values["QA_LLM_MODEL"] = "qwen3.6-plus" }
if (-not $values.ContainsKey("FORMULA_API_KEY")) { $values["FORMULA_API_KEY"] = "" }
if (-not $values.ContainsKey("FORMULA_API_BASE")) { $values["FORMULA_API_BASE"] = "" }
if (-not $values.ContainsKey("FORMULA_MODEL")) { $values["FORMULA_MODEL"] = "" }
if (-not $values.ContainsKey("FORMULA_CONVERSION_TIMEOUT_SECONDS")) { $values["FORMULA_CONVERSION_TIMEOUT_SECONDS"] = "8" }
if (-not $values.ContainsKey("FORMULA_CONVERSION_TOTAL_TIMEOUT_SECONDS")) { $values["FORMULA_CONVERSION_TOTAL_TIMEOUT_SECONDS"] = "15" }
if (-not $values.ContainsKey("FORMULA_VISION_API_KEY")) { $values["FORMULA_VISION_API_KEY"] = "" }
if (-not $values.ContainsKey("FORMULA_VISION_API_BASE")) { $values["FORMULA_VISION_API_BASE"] = "https://open.bigmodel.cn/api/paas/v4" }
if (-not $values.ContainsKey("FORMULA_VISION_MODEL")) { $values["FORMULA_VISION_MODEL"] = "glm-4.1v-thinking-flash" }
if (-not $values.ContainsKey("FORMULA_VISION_THINKING")) { $values["FORMULA_VISION_THINKING"] = "disabled" }
if (-not $values.ContainsKey("FORMULA_VISION_TIMEOUT_SECONDS")) { $values["FORMULA_VISION_TIMEOUT_SECONDS"] = "25" }
if (-not $values.ContainsKey("FORMULA_FALLBACK_API_KEY")) { $values["FORMULA_FALLBACK_API_KEY"] = "" }
if (-not $values.ContainsKey("FORMULA_FALLBACK_API_BASE")) { $values["FORMULA_FALLBACK_API_BASE"] = "" }
if (-not $values.ContainsKey("FORMULA_FALLBACK_MODEL")) { $values["FORMULA_FALLBACK_MODEL"] = "" }
if (-not $values.ContainsKey("FORMULA_FALLBACK_TIMEOUT_SECONDS")) { $values["FORMULA_FALLBACK_TIMEOUT_SECONDS"] = "5" }
if (-not $values.ContainsKey("FORMULA_RECOGNIZE_TOTAL_TIMEOUT_SECONDS")) { $values["FORMULA_RECOGNIZE_TOTAL_TIMEOUT_SECONDS"] = "30" }
if (-not $values.ContainsKey("FORMULA_CONTENT_VISION_TIMEOUT_SECONDS")) { $values["FORMULA_CONTENT_VISION_TIMEOUT_SECONDS"] = "30" }
if (-not $values.ContainsKey("LEARNER_MODEL_ENABLED")) { $values["LEARNER_MODEL_ENABLED"] = "true" }
if (-not $values.ContainsKey("LEARNER_MODEL_DEBUG")) { $values["LEARNER_MODEL_DEBUG"] = "false" }
if (-not $values.ContainsKey("APP_ENV")) { $values["APP_ENV"] = "production" }
if (-not $values.ContainsKey("MANIM_MAX_DURATION_SECONDS")) { $values["MANIM_MAX_DURATION_SECONDS"] = "30" }
if (-not $values.ContainsKey("MANIM_RENDER_TIMEOUT_SECONDS")) { $values["MANIM_RENDER_TIMEOUT_SECONDS"] = "90" }

$order = @(
    "LEARNMATH_VERSION", "LEARNMATH_PORT", "JWT_SECRET", "NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD",
    "QA_LLM_API_KEY", "QA_LLM_API_BASE", "QA_LLM_MODEL", "FORMULA_API_KEY",
    "FORMULA_API_BASE", "FORMULA_MODEL", "FORMULA_CONVERSION_TIMEOUT_SECONDS",
    "FORMULA_CONVERSION_TOTAL_TIMEOUT_SECONDS", "FORMULA_VISION_API_KEY", "FORMULA_VISION_API_BASE",
    "FORMULA_VISION_MODEL", "FORMULA_VISION_THINKING", "FORMULA_VISION_TIMEOUT_SECONDS",
    "FORMULA_FALLBACK_API_KEY", "FORMULA_FALLBACK_API_BASE", "FORMULA_FALLBACK_MODEL",
    "FORMULA_FALLBACK_TIMEOUT_SECONDS", "FORMULA_RECOGNIZE_TOTAL_TIMEOUT_SECONDS",
    "FORMULA_CONTENT_VISION_TIMEOUT_SECONDS", "LEARNER_MODEL_ENABLED", "LEARNER_MODEL_DEBUG",
    "APP_ENV", "MANIM_MAX_DURATION_SECONDS", "MANIM_RENDER_TIMEOUT_SECONDS"
)
$content = $order | ForEach-Object { "$_=$($values[$_])" }
Set-Content -LiteralPath $EnvFile -Value $content -Encoding ascii

Write-Step "Starting LearnMath"
& docker compose --env-file $EnvFile -f $ComposeFile down --remove-orphans
if ($LASTEXITCODE -ne 0) { throw "Unable to stop the previous LearnMath containers." }
& docker compose --env-file $EnvFile -f $ComposeFile up -d --no-build
if ($LASTEXITCODE -ne 0) { throw "Unable to start LearnMath containers." }

$url = "http://127.0.0.1:$($values['LEARNMATH_PORT'])"
Write-Step "Waiting for the application health check"
$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/health" -TimeoutSec 3
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $ready) {
    & docker compose --env-file $EnvFile -f $ComposeFile logs --tail 100
    throw "LearnMath did not become healthy. The latest container logs are shown above."
}

Write-Host "`n[LearnMath] Installation completed: $url" -ForegroundColor Green
Start-Process $url
