const path = require('path');
const fs = require('fs');
const { getCurrentAccountPaths } = require('./accountPaths');

// Initialize required JSON files with proper structure (account-specific)
function initializeJsonFiles() {
    const accountPaths = getCurrentAccountPaths();
    if (!accountPaths) {
        console.log('[INIT] Skipping JSON file initialization: account paths not initialized yet');
        return;
    }
    
    console.log('[INIT] Checking and initializing required JSON files...');
    
    const filesToInitialize = [
        {
            path: accountPaths.templatesFile,
            defaultContent: []
        },
        {
            path: accountPaths.bulkFile,
            defaultContent: []
        },
        {
            path: accountPaths.sentMessagesFile,
            defaultContent: []
        },
        {
            path: accountPaths.automationsFile,
            defaultContent: []
        },
        {
            path: accountPaths.detectedChannelsFile,
            defaultContent: []
        },
        {
            path: accountPaths.leadsFile,
            defaultContent: { leads: [] }
        },
        {
            path: accountPaths.leadsConfigFile,
            defaultContent: {
                enabled: false,
                systemPrompt: '',
                includeJsonContext: true,
                autoReply: false,
                autoReplyPrompt: ''
            }
        },
        {
            path: accountPaths.cloudflareLogsFile,
            defaultContent: []
        },
        {
            path: accountPaths.cloudflareMessagesFile,
            defaultContent: []
        },
        {
            path: accountPaths.backupListFile,
            defaultContent: { backups: [] }
        }
    ];
    
    filesToInitialize.forEach(file => {
        try {
            if (!fs.existsSync(file.path)) {
                // Ensure directory exists
                const dir = path.dirname(file.path);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(file.path, JSON.stringify(file.defaultContent, null, 2));
                console.log(`[INIT] Created: ${path.basename(file.path)}`);
            } else {
                console.log(`[INIT] File exists: ${path.basename(file.path)}`);
            }
        } catch (error) {
            console.error(`[INIT] Error initializing ${path.basename(file.path)}:`, error.message);
        }
    });
    
    console.log('[INIT] JSON files initialization completed');
}

function readJson(file, fallback = []) {
    try {
        if (!fs.existsSync(file)) {
            // Ensure directory exists before creating file
            const dir = path.dirname(file);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            // Create file with fallback content if it doesn't exist
            fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
            console.log(`[INIT] Auto-created missing file: ${path.basename(file)}`);
            return fallback;
        }
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.error(`[ERROR] Failed to read ${path.basename(file)}:`, e.message);
        // Try to create file with fallback content
        try {
            // Ensure directory exists before creating file
            const dir = path.dirname(file);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
            console.log(`[INIT] Recreated corrupted file: ${path.basename(file)}`);
        } catch (writeError) {
            console.error(`[ERROR] Failed to recreate ${path.basename(file)}:`, writeError.message);
        }
        return fallback;
    }
}

function writeJson(file, data) {
    try {
        // Ensure directory exists
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`[ERROR] Failed to write ${path.basename(file)}:`, error.message);
        
        // Handle disk space errors gracefully
        if (error.code === 'ENOSPC') {
            console.error(`[ERROR] Disk space full! Cannot write ${path.basename(file)}`);
            console.error(`[ERROR] Please free up disk space to continue normal operation`);
            
            // Don't throw error for disk space issues - just log and continue
            // This prevents the app from crashing
            return false;
        }
        
        // For other errors, still throw to maintain existing behavior
        throw error;
    }
    return true;
}

// Check disk space and cleanup if needed
function checkDiskSpace() {
    try {
        const stats = fs.statSync(__dirname + '/../..');
        const freeSpace = require('child_process').execSync('df -h . | tail -1 | awk \'{print $4}\'').toString().trim();
        console.log(`[DISK] Free space: ${freeSpace}`);
        
        // If free space is less than 1GB, trigger cleanup
        if (freeSpace.includes('G') && parseFloat(freeSpace) < 1) {
            console.log(`[DISK] Low disk space detected, cleaning up old logs and temp files...`);
            cleanupOldLogs();
            cleanupTempFiles();
        }
    } catch (error) {
        console.error(`[ERROR] Failed to check disk space:`, error.message);
    }
}

// Clean up old log files to free disk space
function cleanupOldLogs() {
    const accountPaths = getCurrentAccountPaths();
    if (!accountPaths) return; // Skip if account not initialized
    
    try {
        const logDir = accountPaths.logsDir;
        const files = fs.readdirSync(logDir);
        const logFiles = files.filter(file => 
            file.startsWith('automation_log_') && file.endsWith('.json')
        );
        
        // Sort by modification time (oldest first)
        logFiles.sort((a, b) => {
            const statA = fs.statSync(path.join(logDir, a));
            const statB = fs.statSync(path.join(logDir, b));
            return statA.mtime.getTime() - statB.mtime.getTime();
        });
        
        // Keep only the 10 most recent log files
        const filesToDelete = logFiles.slice(0, -10);
        
        filesToDelete.forEach(file => {
            try {
                fs.unlinkSync(path.join(logDir, file));
                console.log(`[CLEANUP] Deleted old log file: ${file}`);
            } catch (error) {
                console.error(`[ERROR] Failed to delete ${file}:`, error.message);
            }
        });
        
        console.log(`[CLEANUP] Cleaned up ${filesToDelete.length} old log files`);
    } catch (error) {
        console.error(`[ERROR] Failed to cleanup old logs:`, error.message);
    }
}

// Clean up old temporary files
function cleanupTempFiles() {
    try {
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) return;
        
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtime.getTime() > maxAge) {
                fs.unlinkSync(filePath);
                console.log(`[CLEANUP] Removed old temp file: ${file}`);
            }
        });
    } catch (err) {
        console.error('[CLEANUP] Error cleaning temp files:', err);
    }
}

module.exports = {
    initializeJsonFiles,
    readJson,
    writeJson,
    checkDiskSpace,
    cleanupOldLogs,
    cleanupTempFiles
};

