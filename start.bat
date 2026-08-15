@echo off
setlocal
cd /d "%~dp0"

if not defined LEARNMATH_API_PORT set "LEARNMATH_API_PORT=8001"

REM 一键启动 LearnMath 后端 API + 前端 dev server
REM 后端 app 与 frontend 都位于 D:\LearnMath 根目录

if exist "venv\Scripts\python.exe" (
    set "PY=venv\Scripts\python.exe"
) else (
    REM 没有 venv 时退回系统 python，提示先装依赖
    echo [LearnMath] 未找到 venv，使用系统 python。首次运行请先执行：
    echo   python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    set "PY=python"
)

echo [LearnMath] 1/2 启动后端 API: http://localhost:%LEARNMATH_API_PORT%
start "LearnMath-Backend" cmd /k "cd /d ""%~dp0"" && %PY% -m uvicorn app.main:app --host 0.0.0.0 --port %LEARNMATH_API_PORT%"

echo [LearnMath] 2/2 启动前端 Vite: http://localhost:5173
start "LearnMath-Frontend" cmd /k "cd /d ""%~dp0frontend"" && set ""VITE_BACKEND_ORIGIN=http://127.0.0.1:%LEARNMATH_API_PORT%"" && npm run dev"

endlocal
