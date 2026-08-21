# The local Manim image already contains a compatible Python runtime and is
# cached on offline machines. Override API_BASE_IMAGE with python:3.12-slim
# when a registry connection is available and a smaller API image is desired.
ARG API_BASE_IMAGE=manimcommunity/manim:v0.19.0
FROM ${API_BASE_IMAGE}

USER root

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY shared ./shared

RUN mkdir -p /app/data /app/manim-spool /app/manim-render && chown -R 1000:1000 /app
USER 1000:1000

EXPOSE 8001

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/ready', timeout=4)" || exit 1

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
