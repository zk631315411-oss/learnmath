# LearnMath 构建后冒烟测试包装脚本。
# 用法（仓库根目录）：
#   $env:SMOKE_PASSWORD = "<测试账号密码>"; .\scripts\smoke.ps1
#   .\scripts\smoke.ps1 -Password <密码> -SkipQA   # 快速跑（跳过问答主链路）
# 退出码：0 全过；1 有失败；2 环境/参数错误。可直接接在构建脚本后做部署闸门。
param(
    [string]$BaseUrl = "http://localhost:8090",
    [string]$Username = "kz",
    [string]$Password = $env:SMOKE_PASSWORD,
    [switch]$SkipQA,
    [int]$ReadyTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# 1. 等待 web 层就绪（容器可能刚重建）
Write-Host "[smoke] 等待 $BaseUrl 就绪（最多 $ReadyTimeoutSeconds 秒）..."
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $resp = Invoke-WebRequest -Uri "$BaseUrl/health" -TimeoutSec 5 -UseBasicParsing
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 3 }
}
if (-not $ready) {
    Write-Host "[smoke] 服务未就绪，请确认 docker 栈已启动（deploy/compose.yml）" -ForegroundColor Red
    exit 2
}

# 2. 选 Python：优先项目 venv（含 requests/Pillow）
$python = Join-Path $repoRoot "venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

# 3. 跑冒烟套件，透传退出码
$smokeArgs = @("$repoRoot\scripts\smoke_test.py", "--base-url", $BaseUrl, "--username", $Username)
if ($Password) { $smokeArgs += @("--password", $Password) }
if ($SkipQA) { $smokeArgs += "--skip-qa" }

& $python @smokeArgs
exit $LASTEXITCODE
