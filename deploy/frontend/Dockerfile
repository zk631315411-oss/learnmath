FROM node:22-alpine AS build

ARG VITE_PV_BILIBILI_URL=
ENV VITE_PV_BILIBILI_URL=${VITE_PV_BILIBILI_URL}

WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./
COPY shared /workspace/shared
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=12 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
