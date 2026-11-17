# Production-ready Docker container for Playwright + FastAPI Automation
FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    PORT=8000

WORKDIR /app

# Install Xvfb (Virtual Framebuffer) so headed Chromium runs natively in the cloud
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir fastapi uvicorn websockets

# Copy application source code
COPY . .

# Ensure entrypoint is executable
RUN chmod +x entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
