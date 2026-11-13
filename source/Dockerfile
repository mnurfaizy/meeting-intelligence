# Meeting Intelligence — production image with ffmpeg (seek indexes, WMA/AMR playback copies).
FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production \
    PORT=3000 \
    AUDIO_DIR=/app/recordings
EXPOSE 3000

# Render (and most hosts) set PORT; listen on all interfaces.
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT}"]
