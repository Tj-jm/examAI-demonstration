# Stage 1: build both web apps
FROM node:20-alpine AS web
WORKDIR /src
COPY admin-panel/package*.json admin-panel/
COPY student-app/package*.json student-app/
RUN npm ci --prefix admin-panel && npm ci --prefix student-app
COPY admin-panel admin-panel
COPY student-app student-app
RUN npm run build --prefix admin-panel && npm run build --prefix student-app

# Stage 2: the server image. Debian, not Alpine: the built-in models run
# llama.cpp's prebuilt Linux binary, which needs glibc.
FROM node:20-bookworm-slim
ENV NODE_ENV=production SERVE_STATIC=true PORT=5000 STORAGE_LOCAL_PATH=/data/uploads
# ffmpeg: makes the HD lecture export into a course MP4 (videoLessonController toCourseMp4).
# chromium + fonts: prints slides and records lesson videos (utils/slidePrint.js, lessonRender.js),
# Noto for Bangla and English.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgomp1 libcurl4 ffmpeg \
  chromium fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY backend ./
COPY --from=web /src/admin-panel/dist /app/admin-panel/dist
COPY --from=web /src/student-app/dist /app/student-app/dist
# Built-in model downloads and the llama.cpp binary are written at runtime,
# onto the data volume so an image update keeps them (several GB each).
RUN mkdir -p /data/uploads /data/snapshot /data/embedded-models /data/llama-bin geo-data \
  && chown -R node:node /data geo-data
ENV EMBEDDED_MODELS_DIR=/data/embedded-models LLAMA_BIN_DIR=/data/llama-bin
# The city lookup's database (backend/utils/geo.js) lives on the data volume.
ENV GEO_DATA_DIR=/data/geo
# Uploads, built-in models and the city database. Mount a named volume here
# (-v examai-data:/data) to keep them across updates.
VOLUME ["/data"]
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]