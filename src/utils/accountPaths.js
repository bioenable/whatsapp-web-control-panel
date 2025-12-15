const path = require('path');
const fs = require('fs');

// Account-specific path management
const PRIVATE_DATA_DIR = path.join(__dirname, '../../private-data');

// Module-level state (will be set by initializeAccountPaths)
let currentAccountNumber = null;
let accountPaths = null;

// Function to get account-specific paths
function getAccountPaths(phoneNumber) {
    if (!phoneNumber) {
        throw new Error('Phone number is required to get account paths');
    }
    
    // Sanitize phone number for folder name (remove special characters)
    const sanitizedNumber = phoneNumber.replace(/[^0-9]/g, '');
    const accountDir = path.join(PRIVATE_DATA_DIR, sanitizedNumber);
    const backupsDir = path.join(accountDir, 'backups');
    const logsDir = path.join(accountDir, 'logs');
    
    return {
        accountDir,
        backupsDir,
        logsDir,
        templatesFile: path.join(accountDir, 'templates.json'),
        bulkFile: path.join(accountDir, 'bulk_messages.json'),
        sentMessagesFile: path.join(accountDir, 'sent_messages.json'),
        detectedChannelsFile: path.join(accountDir, 'detected_channels.json'),
        leadsFile: path.join(accountDir, 'leads.json'),
        leadsConfigFile: path.join(accountDir, 'leads-config.json'),
        cloudflareLogsFile: path.join(logsDir, 'cloudflare_logs.json'),
        cloudflareMessagesFile: path.join(logsDir, 'cloudflare_messages.json'),
        backupListFile: path.join(accountDir, 'backup_list.json'),
        automationsFile: path.join(accountDir, 'automations.json'),
        contactsFile: path.join(accountDir, 'contacts.json')
    };
}

// Function to migrate legacy files from root to account-specific directory
function migrateLegacyFiles(phoneNumber, accountPaths) {
    const legacyFiles = [
        { old: path.join(__dirname, '../../templates.json'), new: accountPaths.templatesFile },
        { old: path.join(__dirname, '../../bulk_messages.json'), new: accountPaths.bulkFile },
        { old: path.join(__dirname, '../../sent_messages.json'), new: accountPaths.sentMessagesFile },
        { old: path.join(__dirname, '../../detected_channels.json'), new: accountPaths.detectedChannelsFile },
        { old: path.join(__dirname, '../../leads.json'), new: accountPaths.leadsFile },
        { old: path.join(__dirname, '../../leads-config.json'), new: accountPaths.leadsConfigFile },
        { old: path.join(__dirname, '../../backup_list.json'), new: accountPaths.backupListFile },
        { old: path.join(__dirname, '../../automations.json'), new: accountPaths.automationsFile }
    ];
    
    // Migrate backup files
    const legacyBackupDir = path.join(__dirname, '../../backups');
    if (fs.existsSync(legacyBackupDir)) {
        try {
            const backupFiles = fs.readdirSync(legacyBackupDir).filter(f => f.endsWith('.json'));
            backupFiles.forEach(file => {
                const oldPath = path.join(legacyBackupDir, file);
                const newPath = path.join(accountPaths.backupsDir, file);
                if (!fs.existsSync(newPath)) {
                    fs.copyFileSync(oldPath, newPath);
                    console.log(`[ACCOUNT] Migrated backup file: ${file}`);
                }
            });
        } catch (error) {
            console.error(`[ACCOUNT] Error migrating backup files:`, error);
        }
    }
    
    // Migrate automation log files
    try {
        const rootFiles = fs.readdirSync(__dirname + '/../..').filter(f => 
            f.startsWith('automation_log_') && f.endsWith('.json')
        );
        rootFiles.forEach(file => {
            const oldPath = path.join(__dirname + '/../..', file);
            const newPath = path.join(accountPaths.logsDir, file);
            if (!fs.existsSync(newPath)) {
                fs.copyFileSync(oldPath, newPath);
                console.log(`[ACCOUNT] Migrated log file: ${file}`);
            }
        });
    } catch (error) {
        console.error(`[ACCOUNT] Error migrating log files:`, error);
    }
    
    // Migrate cloudflare log files
    const legacyCloudflareFiles = [
        { old: path.join(__dirname, '../../cloudflare_logs.json'), new: accountPaths.cloudflareLogsFile },
        { old: path.join(__dirname, '../../cloudflare_messages.json'), new: accountPaths.cloudflareMessagesFile }
    ];
    
    legacyCloudflareFiles.forEach(({ old, new: newPath }) => {
        if (fs.existsSync(old) && !fs.existsSync(newPath)) {
            try {
                fs.copyFileSync(old, newPath);
                console.log(`[ACCOUNT] Migrated file: ${path.basename(old)}`);
            } catch (error) {
                console.error(`[ACCOUNT] Error migrating ${path.basename(old)}:`, error);
            }
        }
    });
    
    // Migrate other JSON files
    legacyFiles.forEach(({ old, new: newPath }) => {
        if (fs.existsSync(old) && !fs.existsSync(newPath)) {
            try {
                fs.copyFileSync(old, newPath);
                console.log(`[ACCOUNT] Migrated file: ${path.basename(old)}`);
            } catch (error) {
                console.error(`[ACCOUNT] Error migrating ${path.basename(old)}:`, error);
            }
        }
    });
}

// Function to initialize account directories and migrate files if needed
function initializeAccountPaths(phoneNumber) {
    if (!phoneNumber) {
        console.error('[ACCOUNT] Cannot initialize paths: phone number not provided');
        return null;
    }
    
    const paths = getAccountPaths(phoneNumber);
    currentAccountNumber = phoneNumber;
    accountPaths = paths;
    
    // Create directories
    try {
        if (!fs.existsSync(PRIVATE_DATA_DIR)) {
            fs.mkdirSync(PRIVATE_DATA_DIR, { recursive: true });
            console.log(`[ACCOUNT] Created private-data directory`);
        }
        
        if (!fs.existsSync(paths.accountDir)) {
            fs.mkdirSync(paths.accountDir, { recursive: true });
            console.log(`[ACCOUNT] Created account directory: ${paths.accountDir}`);
        }
        
        if (!fs.existsSync(paths.backupsDir)) {
            fs.mkdirSync(paths.backupsDir, { recursive: true });
            console.log(`[ACCOUNT] Created backups directory: ${paths.backupsDir}`);
        }
        
        if (!fs.existsSync(paths.logsDir)) {
            fs.mkdirSync(paths.logsDir, { recursive: true });
            console.log(`[ACCOUNT] Created logs directory: ${paths.logsDir}`);
        }
        
        // Migrate existing files from root directory if this is the first account
        migrateLegacyFiles(phoneNumber, paths);
        
        return paths;
    } catch (error) {
        console.error(`[ACCOUNT] Error initializing account paths:`, error);
        return null;
    }
}

// Get current account paths (returns null if not initialized)
function getCurrentAccountPaths() {
    return accountPaths;
}

// Get current account number
function getCurrentAccountNumber() {
    return currentAccountNumber;
}

module.exports = {
    getAccountPaths,
    initializeAccountPaths,
    getCurrentAccountPaths,
    getCurrentAccountNumber,
    PRIVATE_DATA_DIR
};

