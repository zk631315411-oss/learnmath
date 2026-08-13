@echo off
setlocal
cd /d "%~dp0"

REM 一键启动 LearnMath 后端 API + 前端 dev server
REM worktree 结构：frontend 就在本目录（backend）之下，故用 %~dp0frontend

if exist "venv\Scripts\python.exe" (
    set "PY=venv\Scripts\python.exe"
) else (
    REM 没有 venv 时退回系统 python，提示先装依赖
    echo [LearnMath] 未找到 venv，使用系统 python。首次运行请先执行：
    echo   python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    set "PY=python"
)

echo [LearnMath] 1/2 启动后端 API: http://localhost:8000
start "LearnMath-Backend" cmd /k "cd /d ""%~dp0"" && %PY% -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo [LearnMath] 2/2 启动前端 Vite: http://localhost:5173
start "LearnMath-Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"

endlocal
