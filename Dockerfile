# =============================================================================
# Heali Connect — Multi-Stage Docker Build
# Stage 1 (builder): Node 20 → compiles React/TypeScript frontend
# Stage 2 (runtime): Python 3.11 → runs FastAPI + serves compiled frontend
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — Frontend Build
# -----------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /build

# Firebase config — passed as build args (embedded into JS bundle by Vite at build time)
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_BACKEND_HOST

# Make ARGs visible as ENV vars so Vite picks them up via import.meta.env.*
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_BACKEND_HOST=$VITE_BACKEND_HOST

COPY package.json package-lock.json* ./
# Use npm ci for reproducible installs; fall back to npm install if lock missing
RUN npm ci --prefer-offline 2>/dev/null || npm install

# Copy source files — all paths that tailwind.config.ts scans for class names
COPY index.html ./
COPY vite.config.ts ./
COPY postcss.config.js ./
COPY tailwind.config.* ./
COPY components.json ./
COPY tsconfig*.json ./
COPY public/ public/
COPY src/ src/

# CACHEBUST forces Docker to invalidate the layer cache for npm run build
# Pass a unique value (e.g. timestamp) via --build-arg CACHEBUST=$(date +%s)
ARG CACHEBUST=1
RUN echo "Cache bust: $CACHEBUST" && npm run build

# -----------------------------------------------------------------------------
# Stage 2 — Python Runtime
# -----------------------------------------------------------------------------
FROM python:3.11-slim

# Install uv (fast Python package manager)
RUN pip install --no-cache-dir uv

WORKDIR /app

# Python dependency layer — cached until pyproject.toml or uv.lock changes
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Application code
COPY agents/ agents/
COPY app/ app/

# Avatar assets — backend reads preset PNGs to send via WebSocket
COPY src/assets/ src/assets/

# React build output from Stage 1 — FastAPI serves this via catch-all route
COPY --from=frontend-builder /build/dist ./dist

# Cloud Run injects PORT; use it directly (default 8080 on Cloud Run)
EXPOSE 8080

# Shell form (not exec form) so $PORT is expanded at container start
CMD uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
