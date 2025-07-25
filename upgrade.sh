#!/bin/bash

# WhatsApp Web Control Panel - Automatic Upgrade Script
# This script safely upgrades the application while preserving user data

set -e  # Exit on any error

echo "=========================================="
echo "WhatsApp Web Control Panel - Upgrade Script"
echo "=========================================="

# Check if we're in the right directory
if [ ! -f "server.js" ] || [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the WhatsApp Web Control Panel directory"
    echo "   (where server.js and package.json are located)"
    exit 1
fi

# Create backup
BACKUP_DIR="backup-$(date +%Y%m%d-%H%M%S)"
echo "📦 Creating backup in: $BACKUP_DIR"

mkdir -p "$BACKUP_DIR"

# Backup critical data files
echo "💾 Backing up your data..."
cp *.json "$BACKUP_DIR/" 2>/dev/null || true
cp .env "$BACKUP_DIR/" 2>/dev/null || true
cp -r .wwebjs_auth "$BACKUP_DIR/" 2>/dev/null || true

echo "✅ Backup completed successfully!"

# Check if this is a git repository
if [ -d ".git" ]; then
    echo "🔄 Updating from git repository..."
    
    # Fetch latest changes
    git fetch origin
    
    # Check current branch
    CURRENT_BRANCH=$(git branch --show-current)
    echo "📍 Current branch: $CURRENT_BRANCH"
    
    # Pull latest changes
    git pull origin "$CURRENT_BRANCH"
    
    echo "✅ Git update completed!"
else
    echo "⚠️  Not a git repository. Manual upgrade required."
    echo "   Please follow the manual upgrade instructions in UPGRADE_GUIDE.md"
    exit 1
fi

# Update dependencies
echo "📦 Updating dependencies..."
npm install

echo "✅ Dependencies updated!"

# Check for new environment variables
if [ -f ".env.example" ]; then
    echo "📋 Checking for new environment variables..."
    echo "   Please review .env.example for any new required variables"
fi

echo ""
echo "🎉 Upgrade completed successfully!"
echo ""
echo "📁 Your data has been preserved in: $BACKUP_DIR"
echo "🔄 Please restart the application with: npm start"
echo ""
echo "📖 For detailed upgrade information, see: UPGRADE_GUIDE.md"
echo "🆘 If you encounter issues, you can rollback using the backup in: $BACKUP_DIR" 