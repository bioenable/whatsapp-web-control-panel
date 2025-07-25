# Upgrade Guide for Existing Users

## Overview

This guide helps existing users upgrade to new versions while preserving their data (JSON files, configurations, and settings).

## ⚠️ **Important: Data Preservation**

Your data is stored in JSON files in the project root directory. These files are **automatically preserved** during upgrades if you follow the correct procedures.

### Critical Data Files (Preserved):
- `templates.json` - Message templates
- `bulk_messages.json` - Bulk message queue
- `sent_messages.json` - Sent message logs
- `automations.json` - Automation rules
- `detected_channels.json` - Channel information
- `leads.json` - Leads data
- `leads-config.json` - Auto chat configuration
- `.env` - Environment variables
- `.wwebjs_auth/` - WhatsApp authentication data

## Upgrade Methods

### Method 1: Git-Based Upgrade (Recommended for Existing Users)

#### Step 1: Backup Your Data (Optional but Recommended)
```bash
# Create a backup folder
mkdir whatsapp-backup-$(date +%Y%m%d)
cp *.json whatsapp-backup-$(date +%Y%m%d)/
cp .env whatsapp-backup-$(date +%Y%m%d)/
cp -r .wwebjs_auth whatsapp-backup-$(date +%Y%m%d)/
```

#### Step 2: Update from Git
```bash
# If you installed via git clone
cd whatsapp-web-control-panel

# Fetch latest changes
git fetch origin

# Check current version
git tag --list | tail -5

# Upgrade to latest development version (main branch)
git pull origin main

# OR upgrade to specific release version
git checkout v1.32.0  # Replace with desired version
```

#### Step 3: Update Dependencies
```bash
# Install/update npm dependencies
npm install

# Check for any new environment variables
cat .env.example  # If this file exists
```

#### Step 4: Restart the Application
```bash
# Stop the current server (Ctrl+C)
# Then restart
npm start
```

### Method 2: Release-Based Upgrade

#### Step 1: Backup Your Data
```bash
# Create backup
mkdir whatsapp-backup-$(date +%Y%m%d)
cp *.json whatsapp-backup-$(date +%Y%m%d)/
cp .env whatsapp-backup-$(date +%Y%m%d)/
cp -r .wwebjs_auth whatsapp-backup-$(date +%Y%m%d)/
```

#### Step 2: Download New Release
```bash
# Go to parent directory
cd ..

# Rename current installation
mv whatsapp-web-control-panel whatsapp-web-control-panel-old

# Download new release
wget https://github.com/bioenable/whatsapp-web-control-panel/archive/refs/tags/v1.32.0.zip
unzip v1.32.0.zip
cd whatsapp-web-control-panel-1.32.0
```

#### Step 3: Restore Your Data
```bash
# Copy your data files from backup
cp ../whatsapp-web-control-panel-old/*.json .
cp ../whatsapp-web-control-panel-old/.env .
cp -r ../whatsapp-web-control-panel-old/.wwebjs_auth .

# Install dependencies
npm install
```

#### Step 4: Start the Application
```bash
npm start
```

### Method 3: In-Place File Replacement (Advanced)

#### Step 1: Backup Current Installation
```bash
# Create backup
mkdir backup-$(date +%Y%m%d)
cp -r * backup-$(date +%Y%m%d)/
cp .env backup-$(date +%Y%m%d)/
cp -r .wwebjs_auth backup-$(date +%Y%m%d)/
```

#### Step 2: Download and Extract New Version
```bash
# Download new version to temporary location
wget https://github.com/bioenable/whatsapp-web-control-panel/archive/refs/tags/v1.32.0.zip
unzip v1.32.0.zip
```

#### Step 3: Replace Application Files (Preserve Data)
```bash
# Copy new application files (excluding data files)
cp -r whatsapp-web-control-panel-1.32.0/server.js .
cp -r whatsapp-web-control-panel-1.32.0/package.json .
cp -r whatsapp-web-control-panel-1.32.0/public .
cp -r whatsapp-web-control-panel-1.32.0/whatsapp-web .

# DO NOT copy these files (preserve your data):
# - *.json files
# - .env file
# - .wwebjs_auth directory
```

#### Step 4: Update Dependencies and Start
```bash
npm install
npm start
```

## Version-Specific Upgrade Notes

### Upgrading to v1.32.0 (Auto-Reply Enhancements)

#### New Features:
- Enhanced auto-reply system for leads
- Improved logging with prompts and responses
- Better mobile number matching

#### Data Migration:
- **No data migration required** - existing data is compatible
- New `leads-config.json` file will be created automatically if not exists
- Existing leads data in `leads.json` remains intact

#### Configuration Updates:
- Auto chat configuration is preserved
- System prompts remain unchanged
- New logging features are automatically enabled

### Upgrading to v1.31.0 (Leads Management)

#### New Features:
- Complete leads management system
- Auto chat configuration
- CSV import/export functionality

#### Data Migration:
- **No data migration required** - existing data is compatible
- New leads-related JSON files created automatically
- Existing templates, automations, and other data preserved

## Troubleshooting Upgrades

### Common Issues and Solutions

#### Issue 1: "Module not found" errors
```bash
# Solution: Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

#### Issue 2: WhatsApp authentication lost
```bash
# Solution: Restore authentication data
cp -r backup-*/wwebjs_auth .wwebjs_auth
# OR re-authenticate by scanning QR code
```

#### Issue 3: Configuration files missing
```bash
# Solution: Restore from backup
cp backup-*/*.json .
cp backup-*/.env .
```

#### Issue 4: Permission errors
```bash
# Solution: Fix file permissions
chmod 644 *.json
chmod 600 .env
chmod -R 755 .wwebjs_auth
```

### Rollback Procedure

If upgrade fails, you can rollback:

```bash
# Stop the application
# Restore from backup
cp -r backup-$(date +%Y%m%d)/* .
cp backup-$(date +%Y%m%d)/.env .
cp -r backup-$(date +%Y%m%d)/.wwebjs_auth .

# Reinstall dependencies
npm install

# Restart
npm start
```

## Best Practices

### Before Upgrading:
1. **Always backup your data** before any upgrade
2. **Check the changelog** for breaking changes
3. **Test in a separate environment** if possible
4. **Read version-specific notes** for the target version

### During Upgrade:
1. **Follow the exact steps** in the upgrade guide
2. **Don't skip dependency updates** (`npm install`)
3. **Preserve your data files** (JSON files, .env, .wwebjs_auth)
4. **Check for new environment variables** that might be required

### After Upgrade:
1. **Test all major functionality**
2. **Verify your data is intact**
3. **Check logs for any errors**
4. **Update any custom configurations** if needed

## Automatic Upgrade Script

For convenience, you can create an upgrade script:

```bash
#!/bin/bash
# upgrade.sh - Automatic upgrade script

echo "Starting upgrade process..."

# Create backup
BACKUP_DIR="backup-$(date +%Y%m%d)"
mkdir $BACKUP_DIR
cp *.json $BACKUP_DIR/
cp .env $BACKUP_DIR/
cp -r .wwebjs_auth $BACKUP_DIR/

echo "Backup created in $BACKUP_DIR"

# Fetch latest changes
git fetch origin
git pull origin main

# Update dependencies
npm install

echo "Upgrade completed successfully!"
echo "Your data has been preserved in $BACKUP_DIR"
echo "Restart the application with: npm start"
```

Make it executable:
```bash
chmod +x upgrade.sh
./upgrade.sh
```

## Summary

- ✅ **Your data is automatically preserved** during upgrades
- ✅ **Multiple upgrade methods** available for different scenarios
- ✅ **Backup procedures** ensure data safety
- ✅ **Rollback options** available if issues occur
- ✅ **Version-specific guidance** for each release

Choose the upgrade method that best fits your situation, and always backup your data before upgrading! 