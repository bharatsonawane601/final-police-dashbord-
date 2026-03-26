#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "=========================================="
echo "🚔 Zone 1 Crime Intelligence System Setup"
echo "=========================================="

# Check if Node.js is installed
if ! command -v node > /dev/null 2>&1; then
    echo "[ERROR] Node.js is required but not installed."
    echo "Please install Node.js from https://nodejs.org (v18 or higher) before running this script."
    exit 1
fi

# Check Node.js version (must be >= 18 for built-in fetch support)
NODE_VER=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VER" -lt 18 ]; then
    echo "[ERROR] Node.js v18 or higher is required. You have v${NODE_VER}."
    echo "Please upgrade Node.js from https://nodejs.org"
    exit 1
fi

# Check if npm is installed
if ! command -v npm > /dev/null 2>&1; then
    echo "[ERROR] npm is required but not installed."
    echo "Please install npm before running this script."
    exit 1
fi

echo "[INFO] Node.js v${NODE_VER} and npm are installed. Proceeding..."

# Navigate to project root (where this script lives)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Install backend dependencies
if [ -d "backend" ]; then
    echo "[INFO] Installing backend dependencies..."
    cd backend
    npm install
    cd "$DIR"
else
    echo "[ERROR] 'backend' directory not found. Run this script from the project root."
    exit 1
fi

# Check if data directory exists and has an Excel file
if [ ! -d "backend/data" ]; then
    mkdir -p backend/data
    echo "[INFO] Created backend/data directory. Please place your Excel data file there."
fi

DATA_FILES=$(ls backend/data/*.xlsx 2>/dev/null | wc -l | tr -d ' ')
if [ "$DATA_FILES" -eq 0 ]; then
    echo "[WARN] No Excel (.xlsx) file found in backend/data/."
    echo "       Please add your data file and use the Data page in the app to connect it."
else
    echo "[INFO] Found Excel data file(s) in backend/data/."
fi

echo ""
echo "=========================================="
echo "✅ Setup complete!"
echo "=========================================="
echo ""
echo "Starting the server..."
echo "Dashboard will be available at: http://localhost:3000"
echo ""

# Start the server
cd backend
npm start
