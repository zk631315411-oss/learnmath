# LearnMath one-click deployment

The LearnMath application package contains five services:

- `web`: the built React application, Nginx reverse proxy, and textbook PDF serving;
- `api`: FastAPI, SQLite persistence, the teaching Agent, and the Aura connection.
- `redis`: internal-only bounded animation queue;
- `manim-dispatcher`: trusted Redis-to-file-spool bridge with no model or database secrets;
- `manim-renderer`: network-disabled, resource-limited Manim renderer and the only writer of video artifacts.

Renderer 镜像内置 `fonts-noto-cjk`，不依赖宿主机字体。当前交付包支持二维教学动画和复杂二维函数的有限近似；三维场景暂未开放。能力边界、限制原因和三维放开前的验收条件见项目文档 `docs/07-decisions/MANIM_SCOPE_AND_SECURITY.md`。

## Build the application package

Build the release package with:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\prepare-offline-package.ps1 -Version 0.1.0
```

The script builds and saves the API, web, pinned Redis, and pinned Manim images and copies the four textbook PDFs into `release\LearnMath`. Docker Desktop is deliberately excluded from this package.

Build the separate Docker setup package with:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\prepare-docker-package.ps1
```

The Docker setup package is written to `release\LearnMath-DockerSetup`. If the official download is inaccessible, download the installer through another network and pass its local path with `-DockerInstaller`.

For internal distribution, review the Docker Desktop subscription and redistribution terms that apply to your organization before shipping its installer.

## End-user workflow

1. Install Docker Desktop from the separate Docker setup package.
2. Extract the LearnMath application package.
3. Double-click `Install-LearnMath.bat`.
4. Enter the LLM API key and Aura credentials once.
5. Wait for the browser to open at `http://127.0.0.1:8080`.

Configuration and user data remain under Docker volumes. `deploy/runtime.env` stores local secrets and must not be shared. Re-running the installer is idempotent.

Use `Start-LearnMath.bat` and `Stop-LearnMath.bat` after the first installation.
