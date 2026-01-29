#!/usr/bin/env node
/**
 * WhatsApp Web Control Panel - Admin CLI
 * 
 * Usage:
 *   node admin-cli.js --help
 *   node admin-cli.js --clear-all-queues
 *   node admin-cli.js --clear-queue <userId>
 *   node admin-cli.js --queue-stats
 * 
 * This script is for admin operations that should NOT be accessible from the web interface.
 * It requires CLOUDFLARE_BASE_URL and CLOUDFLARE_API_KEY to be set in .env
 */

require('dotenv').config();

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('WhatsApp Web Control Panel - Admin CLI');
    console.log('');
    console.log('Usage: node admin-cli.js [command] [options]');
    console.log('');
    console.log('Commands:');
    console.log('  --clear-all-queues              Clear ALL queued messages from ALL app clients');
    console.log('                                  WARNING: This clears the entire Cloudflare queue!');
    console.log('  --clear-queue <userId>          Clear queued messages for a specific user');
    console.log('                                  Example: --clear-queue 919822218111@c.us');
    console.log('  --queue-stats                   Show queue statistics');
    console.log('  --help, -h                      Show this help message');
    console.log('');
    console.log('Environment Variables (set in .env):');
    console.log('  CLOUDFLARE_BASE_URL             Cloudflare Worker base URL (required)');
    console.log('  CLOUDFLARE_API_KEY              Cloudflare Worker API key (required)');
    console.log('  MESSAGE_EXPIRY_HOURS            Default message expiry in hours (default: 24)');
    console.log('');
    console.log('Examples:');
    console.log('  node admin-cli.js --queue-stats');
    console.log('  node admin-cli.js --clear-queue 919822218111@c.us');
    console.log('  node admin-cli.js --clear-all-queues');
    console.log('');
    process.exit(0);
}

const command = args[0];

// Check for required environment variables
const cloudflareBaseUrl = process.env.CLOUDFLARE_BASE_URL;
const cloudflareApiKey = process.env.CLOUDFLARE_API_KEY;

if (!cloudflareBaseUrl || !cloudflareApiKey) {
    console.error('[ADMIN] Error: Cloudflare configuration not found.');
    console.error('[ADMIN] Please set CLOUDFLARE_BASE_URL and CLOUDFLARE_API_KEY in .env');
    process.exit(1);
}

// Initialize Cloudflare client
const CloudflareClient = require('./cloudflare-client');
const adminClient = new CloudflareClient({
    baseUrl: cloudflareBaseUrl,
    apiKey: cloudflareApiKey
});

// Run admin command
(async () => {
    // Initialize the client first
    const connected = await adminClient.init();
    if (!connected) {
        console.error('[ADMIN] Error: Failed to connect to Cloudflare Worker');
        console.error('[ADMIN] Please check your CLOUDFLARE_BASE_URL and CLOUDFLARE_API_KEY');
        process.exit(1);
    }
    console.log('[ADMIN] Connected to Cloudflare Worker');
    console.log('');
    
    switch (command) {
        case '--clear-all-queues':
            console.log('[ADMIN] ============================================');
            console.log('[ADMIN] Clearing ALL queued messages from ALL users');
            console.log('[ADMIN] ============================================');
            console.log('[ADMIN] WARNING: This will clear the ENTIRE queue on the Cloudflare Worker!');
            console.log('[ADMIN] This affects ALL app clients, not just one user.');
            console.log('');
            
            try {
                // Call clearQueue without a userId to clear all
                const result = await adminClient.clearQueue(null, null);
                
                if (result && result.success !== false && !result.error) {
                    console.log(`[ADMIN] ✓ Successfully cleared ${result.cleared || 'all'} messages from queue`);
                } else {
                    console.error('[ADMIN] ✗ Failed to clear queue:', result?.error || 'Unknown error');
                    if (result?.error?.includes('404')) {
                        console.error('[ADMIN] Note: The Cloudflare Worker may not support the clear queue endpoint yet.');
                        console.error('[ADMIN] You may need to update your Cloudflare Worker to support /api/messages/queue/clear');
                    }
                }
            } catch (error) {
                console.error('[ADMIN] ✗ Error clearing queue:', error.message);
            }
            break;
            
        case '--clear-queue':
            const userId = args[1];
            if (!userId) {
                console.error('[ADMIN] Error: User ID is required');
                console.error('[ADMIN] Usage: node admin-cli.js --clear-queue <userId>');
                console.error('[ADMIN] Example: node admin-cli.js --clear-queue 919822218111@c.us');
                process.exit(1);
            }
            
            console.log('[ADMIN] ============================================');
            console.log(`[ADMIN] Clearing queued messages for user: ${userId}`);
            console.log('[ADMIN] ============================================');
            console.log('[ADMIN] This only clears messages for this specific user.');
            console.log('');
            
            try {
                const result = await adminClient.clearQueue(userId, null);
                
                if (result && result.success !== false && !result.error) {
                    console.log(`[ADMIN] ✓ Successfully cleared ${result.cleared || 'all'} messages for user ${userId}`);
                } else {
                    console.error('[ADMIN] ✗ Failed to clear queue:', result?.error || 'Unknown error');
                }
            } catch (error) {
                console.error('[ADMIN] ✗ Error clearing queue:', error.message);
            }
            break;
            
        case '--queue-stats':
            console.log('[ADMIN] ============================================');
            console.log('[ADMIN] Fetching queue statistics...');
            console.log('[ADMIN] ============================================');
            console.log('');
            
            try {
                const stats = await adminClient.getQueueStats(null);
                
                if (stats) {
                    console.log('[ADMIN] Queue Statistics:');
                    console.log(JSON.stringify(stats, null, 2));
                } else {
                    console.error('[ADMIN] ✗ Failed to get queue stats');
                }
            } catch (error) {
                console.error('[ADMIN] ✗ Error getting stats:', error.message);
            }
            break;
            
        default:
            console.error(`[ADMIN] Unknown command: ${command}`);
            console.error('[ADMIN] Use --help to see available commands');
            process.exit(1);
    }
    
    process.exit(0);
})();
