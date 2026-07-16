# syntax=docker/dockerfile:1.7
# docgen — Node 20 + LibreOffice headless (docx -> PDF). Internal only.
FROM node:20-bookworm-slim

# LibreOffice core + Writer for PDF export. --no-install-recommends keeps the
# image lean; fontconfig lets soffice find fonts if ever needed (the docx
# already carries embedded Noto Sans Thai, so rendering is self-contained).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-core \
        libreoffice-writer \
        fontconfig \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# The skeleton assets ship as mode 0600; make them world-readable so the
# non-root `node` runtime user can load fonts + brand images.
RUN chmod -R a+rX /app/assets

ENV SERVICE_PORT=8080
EXPOSE 8080

# Run as the built-in non-root node user.
USER node

CMD ["node", "server.js"]
