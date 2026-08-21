FROM manimcommunity/manim:v0.19.0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONNOUSERSITE=1 \
    MANIM_SPOOL_DIR=/var/lib/learnmath/spool \
    MANIM_RENDER_DIR=/var/lib/learnmath/render

WORKDIR /opt/learnmath

COPY app ./app

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/learnmath/spool /var/lib/learnmath/render /tmp/manim \
    && chown -R manimuser:manimuser /var/lib/learnmath /tmp/manim
USER manimuser

CMD ["python", "-m", "app.workers.manim_worker"]
