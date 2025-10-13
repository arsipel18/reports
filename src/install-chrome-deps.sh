#!/bin/bash

# Install Chrome dependencies for headless Linux server
# This script installs all required packages for Puppeteer to work on Ubuntu/Debian

echo "🔧 Installing Chrome dependencies for headless Linux server..."

# Update package list
sudo apt-get update

# Install Chrome dependencies
sudo apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils

# Install additional fonts for better rendering
sudo apt-get install -y \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-noto-cjk-extra \
    fonts-dejavu-core \
    fonts-liberation2

echo "✅ Chrome dependencies installed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Restart your Node.js application"
echo "2. Test PNG generation with: npm run test-png"
echo "3. If issues persist, check available memory and disk space"
echo ""
echo "🔍 Troubleshooting:"
echo "- If you get 'No space left on device', clean up /tmp directory"
echo "- If Chrome still fails, try running with: export DISPLAY=:99"
echo "- For memory issues, consider reducing image resolution"
