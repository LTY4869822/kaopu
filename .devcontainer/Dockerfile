FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk \
    && npx --yes playwright@1.64.1 install-deps chromium \
    && rm -rf /var/lib/apt/lists/*
