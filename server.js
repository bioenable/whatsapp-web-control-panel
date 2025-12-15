const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
// Use local whatsapp-web.js source (with custom fixes) instead of npm package
const Client = require('./src/Client.js');
const LocalAuth = require('./src/authStrategies/LocalAuth.js');
const { MessageMedia } = require('./src/structures');
const multer = require('multer');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const CloudflareClient = require('./cloudflare-client.js');
// Account-specific path management
const accountPathsModule = require('./src/utils/accountPaths');
const { initializeJsonFiles, readJson, writeJson, checkDiskSpace, cleanupOldLogs, cleanupTempFiles } = require('./src/utils/fileManager');
let accountPaths = null; // Keep for backward compatibility during transition

// Legacy file paths - DEPRECATED (now use accountPaths from private-data folder)
// These constants are kept only for reference - DO NOT use them for file operations
const TEMPLATES_FILE = null; // DEPRECATED: Use accountPaths.templatesFile
const BULK_FILE = null; // DEPRECATED: Use accountPaths.bulkFile
const SENT_MESSAGES_FILE = null; // DEPRECATED: Use accountPaths.sentMessagesFile
const DETECTED_CHANNELS_FILE = null; // DEPRECATED: Use accountPaths.detectedChannelsFile
const LEADS_FILE = null; // DEPRECATED: Use accountPaths.leadsFile
const LEADS_CONFIG_FILE = null; // DEPRECATED: Use accountPaths.leadsConfigFile
const CLOUDFLARE_LOGS_FILE = null; // DEPRECATED: Use accountPaths.cloudflareLogsFile
const CLOUDFLARE_MESSAGES_FILE = null; // DEPRECATED: Use accountPaths.cloudflareMessagesFile
const BACKUP_DIR = null; // DEPRECATED: Use accountPaths.backupsDir
const BACKUP_LIST_FILE = null; // DEPRECATED: Use accountPaths.backupListFile
const { setupBackupRoutes } = require('./backup.js');
const { setupTemplatesRoutes } = require('./src/routes/templates.js');
const { setupLeadsRoutes } = require('./src/routes/leads.js');
const { setupContactsRoutes } = require('./src/routes/contacts.js');
const { setupAutomationRoutes } = require('./src/routes/automations.js');
const { setupChannelsRoutes } = require('./src/routes/channels.js');
const { setupBulkRoutes } = require('./src/routes/bulk.js');
const { setupMediaRoutes } = require('./src/routes/media.js');
const fetch = require('node-fetch'); // Add at the top with other requires
const TEMPLATE_MEDIA_DIR = path.join(__dirname, 'public', 'message-templates');
if (!fs.existsSync(TEMPLATE_MEDIA_DIR)) fs.mkdirSync(TEMPLATE_MEDIA_DIR, { recursive: true });
// BACKUP_DIR is now created per-account in private-data folder via accountPaths
const templateMediaUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, TEMPLATE_MEDIA_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, uuidv4() + ext);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/', 'video/', 'application/pdf'];
        if (allowed.some(t => file.mimetype.startsWith(t))) cb(null, true);
        else cb(new Error('Only image, video, or PDF allowed'));
    }
});
const parse = require('csv-parse/sync').parse;
const os = require('os');
require('dotenv').config();
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Log environment configuration status
console.log('[CONFIG] Environment variables loaded:');
console.log(`[CONFIG] GOOGLE_API_KEY: ${GOOGLE_API_KEY ? 'Set' : 'Not set'}`);
console.log(`[CONFIG] CLOUDFLARE_BASE_URL: ${process.env.CLOUDFLARE_BASE_URL ? 'Set' : 'Not set'}`);
console.log(`[CONFIG] CLOUDFLARE_API_KEY: ${process.env.CLOUDFLARE_API_KEY ? 'Set' : 'Not set'}`);
console.log(`[CONFIG] LEADS_API_URL: ${process.env.LEADS_API_URL ? 'Set' : 'Not set'}`);
console.log(`[CONFIG] LEADS_API_KEY: ${process.env.LEADS_API_KEY ? 'Set' : 'Not set'}`);
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-2.0-flash';
const AUTOMATIONS_FILE = path.join(__dirname, 'automations.json');
const cron = require('node-cron');
const { GoogleGenAI } = require('@google/genai');
const mime = require('mime-types');

// Initialize Cloudflare client
let cloudflareClient = null;
let standaloneMode = false;

// Cloudflare log management constants
const CLOUDFLARE_LOG_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const CLOUDFLARE_LOG_MAX_ENTRIES = 5000;

// Append Cloudflare sync log entry
function appendCloudflareLog(entry) {
    if (!accountPaths) {
        console.error('[CLOUDFLARE-LOG] Cannot append log: account paths not initialized');
        return;
    }
    
    try {
        let logs = [];
        let currentLogFile = accountPaths.cloudflareLogsFile;
        let fileIndex = 0;

        // Find the current log file (handle rotation)
        while (fs.existsSync(currentLogFile)) {
            const stats = fs.statSync(currentLogFile);
            if (stats.size < CLOUDFLARE_LOG_MAX_SIZE) {
                break;
            }
            fileIndex++;
            const baseName = accountPaths.cloudflareLogsFile.replace('.json', '');
            currentLogFile = path.join(accountPaths.logsDir, `${path.basename(baseName)}_${fileIndex}.json`);
        }

        // Read existing logs from the current file
        if (fs.existsSync(currentLogFile)) {
            try {
                const fileContent = fs.readFileSync(currentLogFile, 'utf8');
                if (fileContent.trim()) {
                    logs = JSON.parse(fileContent);
                }
            } catch (e) {
                console.error(`[CLOUDFLARE-LOG] Corrupted log file ${currentLogFile}, backing up and creating new:`, e.message);
                const backupPath = currentLogFile.replace('.json', `_corrupted_${Date.now()}.json`);
                try {
                    fs.renameSync(currentLogFile, backupPath);
                } catch (backupErr) {
                    console.error(`[CLOUDFLARE-LOG] Failed to backup corrupted log:`, backupErr.message);
                }
                logs = [];
            }
        }

        // Ensure logs is an array
        if (!Array.isArray(logs)) {
            logs = [];
        }

        // Add new entry at the beginning (most recent first)
        logs.unshift({ id: uuidv4(), ...entry, timestamp: new Date().toISOString() });

        // Keep only last CLOUDFLARE_LOG_MAX_ENTRIES log entries
        if (logs.length > CLOUDFLARE_LOG_MAX_ENTRIES) {
            logs = logs.slice(0, CLOUDFLARE_LOG_MAX_ENTRIES);
        }

        const writeSuccess = writeJson(currentLogFile, logs);
        if (!writeSuccess) {
            console.log(`[CLOUDFLARE-LOG] Failed to save log due to disk space: ${currentLogFile}`);
        }
    } catch (error) {
        console.error(`[ERROR] Failed to append Cloudflare log:`, error.message);
    }
}

// Append Cloudflare message entry
function appendCloudflareMessage(entry) {
    if (!accountPaths) {
        console.error('[CLOUDFLARE-MESSAGE] Cannot append message: account paths not initialized');
        return;
    }
    
    try {
        let messages = [];
        let currentMessageFile = accountPaths.cloudflareMessagesFile;
        let fileIndex = 0;

        // Find the current message file (handle rotation)
        while (fs.existsSync(currentMessageFile)) {
            const stats = fs.statSync(currentMessageFile);
            if (stats.size < CLOUDFLARE_LOG_MAX_SIZE) {
                break;
            }
            fileIndex++;
            const baseName = accountPaths.cloudflareMessagesFile.replace('.json', '');
            currentMessageFile = path.join(accountPaths.logsDir, `${path.basename(baseName)}_${fileIndex}.json`);
        }

        // Read existing messages from the current file
        if (fs.existsSync(currentMessageFile)) {
            try {
                const fileContent = fs.readFileSync(currentMessageFile, 'utf8');
                if (fileContent.trim()) {
                    messages = JSON.parse(fileContent);
                }
            } catch (e) {
                console.error(`[CLOUDFLARE-MESSAGE] Corrupted message file ${currentMessageFile}, backing up and creating new:`, e.message);
                const backupPath = currentMessageFile.replace('.json', `_corrupted_${Date.now()}.json`);
                try {
                    fs.renameSync(currentMessageFile, backupPath);
                } catch (backupErr) {
                    console.error(`[CLOUDFLARE-MESSAGE] Failed to backup corrupted file:`, backupErr.message);
                }
                messages = [];
            }
        }

        // Ensure messages is an array
        if (!Array.isArray(messages)) {
            messages = [];
        }

        // Add new entry at the beginning (most recent first)
        messages.unshift({ id: uuidv4(), ...entry, timestamp: new Date().toISOString() });

        // Keep only last CLOUDFLARE_LOG_MAX_ENTRIES message entries
        if (messages.length > CLOUDFLARE_LOG_MAX_ENTRIES) {
            messages = messages.slice(0, CLOUDFLARE_LOG_MAX_ENTRIES);
        }

        const writeSuccess = writeJson(currentMessageFile, messages);
        if (!writeSuccess) {
            console.log(`[CLOUDFLARE-MESSAGE] Failed to save message due to disk space: ${currentMessageFile}`);
        }
    } catch (error) {
        console.error(`[ERROR] Failed to append Cloudflare message:`, error.message);
    }
}

// Initialize Cloudflare sync
async function initializeCloudflareSync() {
  // Check if Cloudflare configuration is available
  const cloudflareBaseUrl = process.env.CLOUDFLARE_BASE_URL;
  const cloudflareApiKey = process.env.CLOUDFLARE_API_KEY;
  
  if (!cloudflareBaseUrl || !cloudflareApiKey) {
    console.log('[CLOUDFLARE] Cloudflare configuration not found. Running in standalone mode.');
    console.log('[CLOUDFLARE] To enable Cloudflare sync, add CLOUDFLARE_BASE_URL and CLOUDFLARE_API_KEY to your .env file');
    standaloneMode = true;
    return;
  }
  
  try {
    cloudflareClient = new CloudflareClient({
      baseUrl: cloudflareBaseUrl,
      apiKey: cloudflareApiKey,
      syncInterval: parseInt(process.env.CLOUDFLARE_SYNC_INTERVAL) || 600000, // 10 minutes for chat/channel list
      queueProcessInterval: parseInt(process.env.CLOUDFLARE_QUEUE_INTERVAL) || 60000
    });

    const connected = await cloudflareClient.init();
    if (connected) {
      console.log('[CLOUDFLARE] Connected to Cloudflare Workers');
      appendCloudflareLog({
        type: 'connection',
        status: 'connected',
        message: 'Successfully connected to Cloudflare Workers',
        baseUrl: cloudflareBaseUrl
      });
      
      // Start auto sync with optimized intervals
      cloudflareClient.startAutoSync(async () => {
        try {
          appendCloudflareLog({
            type: 'sync',
            status: 'started',
            message: 'Starting auto sync'
          });
          await syncWhatsAppDataToCloudflare();
          appendCloudflareLog({
            type: 'sync',
            status: 'completed',
            message: 'Auto sync completed successfully'
          });
        } catch (error) {
          console.error('[CLOUDFLARE] Sync error:', error);
          appendCloudflareLog({
            type: 'sync',
            status: 'error',
            message: 'Auto sync failed',
            error: error.message
          });
        }
      });
      
      // Start fallback queue processing (every 30 seconds) in case webhooks fail
      cloudflareClient.startQueueProcessing(async () => {
        try {
          await processQueuedMessages();
        } catch (error) {
          console.log('[CLOUDFLARE] Queue processing error:', error.message);
          appendCloudflareLog({
            type: 'queue',
            status: 'error',
            message: 'Queue processing error',
            error: error.message
          });
        }
      });
      
      // Register webhook endpoint for immediate processing
      await registerWebhookEndpoint();
      
      // Start event-driven listening (no polling)
      await startEventDrivenListening();
    } else {
      console.log('[CLOUDFLARE] Failed to connect to Cloudflare Workers. Cloudflare sync will be disabled.');
      appendCloudflareLog({
        type: 'connection',
        status: 'failed',
        message: 'Failed to connect to Cloudflare Workers',
        baseUrl: cloudflareBaseUrl
      });
    }
  } catch (error) {
    console.log('[CLOUDFLARE] Initialization failed. Cloudflare sync will be disabled.');
    console.log('[CLOUDFLARE] Error details:', error.message);
  }
}

// Register webhook endpoint with Cloudflare
async function registerWebhookEndpoint() {
  if (!cloudflareClient || !cloudflareClient.isConnected) {
    console.log('[WEBHOOK] Cloudflare client not available, skipping webhook registration');
    return;
  }
  
  try {
    const webhookUrl = 'http://localhost:5014/api/webhook/cloudflare';
    const result = await cloudflareClient.registerWebhook(webhookUrl);
    
    if (result && result.success) {
      console.log('[WEBHOOK] Successfully registered webhook endpoint:', webhookUrl);
    } else {
      console.log('[WEBHOOK] Failed to register webhook endpoint');
    }
  } catch (error) {
    console.log('[WEBHOOK] Error registering webhook:', error.message);
  }
}

// Event-driven listening for Cloudflare requests (no polling)
async function startEventDrivenListening() {
  if (!cloudflareClient || !cloudflareClient.isConnected) {
    console.log('[EVENT-DRIVEN] Cloudflare client not available, skipping event-driven listening');
    return;
  }
  
  console.log('[EVENT-DRIVEN] Starting webhook-based event listening for immediate responses');
  
  // Only check queue once at startup to process any pending messages
  try {
    const queuedMessages = await cloudflareClient.getQueuedMessages();
    if (queuedMessages && queuedMessages.length > 0) {
      console.log(`[EVENT-DRIVEN] Found ${queuedMessages.length} pending messages at startup - processing now`);
      await processQueuedMessages();
    }
  } catch (error) {
    console.log('[EVENT-DRIVEN] Startup queue check error:', error.message);
  }
  
  console.log('[EVENT-DRIVEN] Now listening for webhook events - no more polling!');
  console.log('[EVENT-DRIVEN] External apps can trigger immediate responses via webhooks');
}

// Store last sync state for incremental sync
let lastSyncState = {
  chatIds: new Set(),
  contactIds: new Set(),
  lastSyncTime: null
};

// Sync WhatsApp data to Cloudflare (incremental)
async function syncWhatsAppDataToCloudflare() {
  if (!cloudflareClient || !cloudflareClient.isConnected || !client) {
    // Silently return if Cloudflare is not available
    return;
  }
  
  // Check if WhatsApp client is available and ready
  console.log('[CLOUDFLARE] Checking client status...');
  console.log('[CLOUDFLARE] Client exists:', !!client);
  console.log('[CLOUDFLARE] Client isReady:', client ? client.isReady : 'N/A');
  console.log('[CLOUDFLARE] Client state:', client ? client.state : 'N/A');
  
  // Use a more comprehensive ready check
  const isClientReady = client && (
    client.state === 'CONNECTED' || 
    client.state === 'READY' || 
    client.isReady === true ||
    (client.info && client.info.me)
  );
  
  if (!isClientReady) {
    console.log('[CLOUDFLARE] WhatsApp client not ready, skipping sync');
    return;
  }
  
  const isFirstSync = lastSyncState.lastSyncTime === null;
  console.log(`[CLOUDFLARE] Client is ready, proceeding with ${isFirstSync ? 'full' : 'incremental'} sync...`);
  
  try {
    // Get chats - ensure we get an array
    let chats = [];
    try {
      // Try different methods to get chats
      console.log('[CLOUDFLARE] Attempting to get chats...');
      
      let chatsResult;
      let chatsSource = 'unknown';
      
      // Method 1: Use getChats() - this should be awaited
      try {
        chatsResult = await client.getChats();
        chatsSource = 'client.getChats()';
        console.log('[CLOUDFLARE] Method 1 - client.getChats() result:', {
          type: typeof chatsResult,
          isArray: Array.isArray(chatsResult),
          size: chatsResult ? chatsResult.size : 'N/A',
          length: chatsResult ? chatsResult.length : 'N/A'
        });
      } catch (error) {
        console.log('[CLOUDFLARE] Method 1 failed:', error.message);
        chatsResult = null;
      }
      
      // Method 2: Try accessing store directly if getChats() fails
      if (!chatsResult || (chatsResult.size === 0 && chatsResult.length === 0)) {
        console.log('[CLOUDFLARE] Trying alternative chat access methods...');
        
        if (client.store && client.store.chats) {
          chatsResult = client.store.chats;
          chatsSource = 'client.store.chats';
          console.log('[CLOUDFLARE] Method 2 - client.store.chats:', {
            type: typeof chatsResult,
            size: chatsResult ? chatsResult.size : 'N/A'
          });
        }
      }
      
      // Method 3: Try accessing chats property directly
      if (!chatsResult || (chatsResult.size === 0 && chatsResult.length === 0)) {
        if (client.chats) {
          chatsResult = client.chats;
          chatsSource = 'client.chats';
          console.log('[CLOUDFLARE] Method 3 - client.chats:', {
            type: typeof chatsResult,
            size: chatsResult ? chatsResult.size : 'N/A'
          });
        }
      }
      
      console.log('[CLOUDFLARE] Using chats from:', chatsSource);
      
      // Handle different return types
      if (Array.isArray(chatsResult)) {
        chats = chatsResult;
      } else if (chatsResult && typeof chatsResult === 'object') {
        // If it's a Map or other collection, convert to array
        if (chatsResult.values && typeof chatsResult.values === 'function') {
          chats = Array.from(chatsResult.values());
        } else if (chatsResult.size !== undefined && chatsResult.size > 0) {
          // It's a Map-like object
          chats = Array.from(chatsResult.values());
        } else if (chatsResult.size === 0) {
          // Empty Map
          chats = [];
        } else {
          // Try to convert object to array
          chats = Object.values(chatsResult);
        }
      } else {
        console.log('[CLOUDFLARE] No chats available or unexpected format');
        chats = [];
      }
      
      console.log('[CLOUDFLARE] Final chats array length:', chats.length);
    if (chats.length > 0) {
      console.log('[CLOUDFLARE] First chat sample:', {
        id: chats[0].id._serialized || chats[0].id,
        name: chats[0].name,
        type: chats[0].type,
        unreadCount: chats[0].unreadCount
      });
    }
    
    // Log chat data for debugging
    console.log('[CLOUDFLARE] Sample chat data:');
    if (chats.length > 0) {
      const sampleChats = chats.slice(0, 3);
      sampleChats.forEach((chat, index) => {
        console.log(`  ${index + 1}. ID: ${chat.id._serialized || chat.id || 'No ID'}`);
        console.log(`     Name: ${chat.name || 'No name'}`);
        console.log(`     Type: ${chat.type || 'No type'}`);
        console.log(`     Unread: ${chat.unreadCount || 0}`);
      });
    }
    } catch (chatError) {
      console.error('[CLOUDFLARE] Error getting chats:', chatError);
      chats = [];
    }

    // Filter chats for TODAY ONLY - only sync chats with recent activity
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    const todayTimestamp = today.getTime() / 1000; // Convert to Unix timestamp (seconds)
    
    const todayChats = chats.filter(chat => {
      if (!chat.lastMessage || !chat.lastMessage.timestamp) return false;
      
      // Check if last message is from today
      const messageTimestamp = chat.lastMessage.timestamp;
      return messageTimestamp >= todayTimestamp;
    });
    
    // Further filter for incremental sync (new or changed from today's chats)
    const newOrChangedTodayChats = todayChats.filter(chat => {
      const chatId = chat.id._serialized || chat.id;
      return !lastSyncState.chatIds.has(chatId);
    });
    
    console.log(`[CLOUDFLARE] Total chats: ${chats.length}, Today's chats: ${todayChats.length}, New/Changed today: ${newOrChangedTodayChats.length}`);
    
    const chatData = newOrChangedTodayChats.map(chat => ({
      id: chat.id._serialized || chat.id,
      name: chat.name || 'Unknown',
      type: chat.type || 'unknown',
      lastMessage: chat.lastMessage ? {
        id: chat.lastMessage.id._serialized || chat.lastMessage.id,
        text: chat.lastMessage.body || '',
        timestamp: chat.lastMessage.timestamp,
        author: chat.lastMessage.from._serialized || chat.lastMessage.from
      } : null,
      unreadCount: chat.unreadCount || 0,
      lastSync: new Date().toISOString()
    }));
    
    // Update sync state with today's chat IDs only
    todayChats.forEach(chat => {
      const chatId = chat.id._serialized || chat.id;
      lastSyncState.chatIds.add(chatId);
    });

    // Contact sync is handled individually when needed
    const contactData = []; // No bulk contact sync

    // Only sync if there's actual new/changed data to sync
    if (chatData.length > 0 || contactData.length > 0) {
      try {
        // For large datasets, sync in smaller batches to avoid Cloudflare Workers limits
        const BATCH_SIZE = 25; // Sync 25 items at a time to stay within payload limits
        
        if (chatData.length > BATCH_SIZE || contactData.length > BATCH_SIZE) {
          console.log(`[CLOUDFLARE] Large dataset detected. Syncing in batches of ${BATCH_SIZE}...`);
          
          // Sync chats in batches
          if (chatData.length > 0) {
            for (let i = 0; i < chatData.length; i += BATCH_SIZE) {
              const chatBatch = chatData.slice(i, i + BATCH_SIZE);
              const batchNumber = Math.floor(i/BATCH_SIZE) + 1;
              const totalBatches = Math.ceil(chatData.length/BATCH_SIZE);
              
              try {
                await cloudflareClient.syncAllData({
                  chats: chatBatch,
                  contacts: []
                });
                console.log(`[CLOUDFLARE] Synced chat batch ${batchNumber}/${totalBatches} (${chatBatch.length} chats)`);
              } catch (batchError) {
                console.error(`[CLOUDFLARE] Failed to sync chat batch ${batchNumber}/${totalBatches}:`, batchError.message);
                // Continue with next batch instead of failing completely
              }
              
              // Small delay between batches to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
          
          // Contact sync is handled individually when needed
          
          console.log(`[CLOUDFLARE] Batch sync completed: ${chatData.length} chats, ${contactData.length} contacts`);
        } else {
          // For small datasets, sync all at once
          await cloudflareClient.syncAllData({
            chats: chatData,
            contacts: contactData
          });
          console.log(`[CLOUDFLARE] Synced ${chatData.length} chats, ${contactData.length} contacts`);
        }
        
        // Update last sync time
        lastSyncState.lastSyncTime = new Date().toISOString();
        console.log('[CLOUDFLARE] Sync state updated for incremental sync');
      } catch (syncError) {
        console.error('[CLOUDFLARE] Sync error:', syncError.message);
        throw syncError;
      }
    } else {
      console.log('[CLOUDFLARE] No new/changed data to sync, skipping...');
      // Still update sync time even if no data to sync
      lastSyncState.lastSyncTime = new Date().toISOString();
    }
    
  } catch (error) {
    console.error('[CLOUDFLARE] Sync error:', error);
  }
}

// Immediate channel sync when message is received (event-driven)
async function syncChannelMessageImmediately(channelId, channelName, messageData) {
  if (!cloudflareClient || !cloudflareClient.isConnected) {
    return;
  }

  try {
    console.log(`[CHANNEL-EVENT-SYNC] Immediate sync for channel: ${channelName} (${channelId})`);
    
    // Get channel information
    const channelInfo = {
      id: channelId,
      name: channelName,
      type: messageData.channelType || 'channel',
      lastMessage: messageData.body.substring(0, 100),
      lastSeen: new Date().toISOString()
    };

    // Sync to Cloudflare immediately
    await cloudflareClient.syncAllData({
      chats: [],
      contacts: [],
      messages: [],
      channels: [channelInfo],
      channelMessages: [messageData]
    });

    console.log(`[CHANNEL-EVENT-SYNC] Immediately synced message for ${channelName}`);
    
  } catch (error) {
    console.error(`[CHANNEL-EVENT-SYNC] Error syncing channel ${channelId}:`, error.message);
  }
}


// Handle immediate contact lookup requests
async function handleContactLookup(contactId, requestId) {
    if (!ready || !client) {
        console.log(`[CONTACT-LOOKUP] WhatsApp client not ready for contact: ${contactId}`);
        return;
    }

    try {
        console.log(`[CONTACT-LOOKUP] Processing immediate lookup for: ${contactId}`);
        
        // Get contact information
        const contact = await client.getContactById(contactId);
        const contactData = {
            id: contactId,
            name: contact.name || contact.pushname || contactId,
            isWAContact: contact.isWAContact,
            profilePicUrl: await contact.getProfilePicUrl().catch(() => null),
            requestId: requestId,
            foundAt: new Date().toISOString()
        };

        // Send result back to Cloudflare
        await cloudflareClient.syncAllData({
            chats: [],
            contacts: [contactData],
            messages: [],
            channels: [],
            channelMessages: []
        });

        console.log(`[CONTACT-LOOKUP] Contact lookup completed: ${contactData.name}`);
    } catch (error) {
        console.error(`[CONTACT-LOOKUP] Error looking up contact ${contactId}:`, error);
    }
}

// Handle immediate fresh data requests
async function handleFreshDataRequest(channelId, requestId) {
    if (!ready || !client) {
        console.log(`[FRESH-DATA] WhatsApp client not ready for channel: ${channelId}`);
        return;
    }

    try {
        console.log(`[FRESH-DATA] Processing immediate fresh data for: ${channelId}`);
        
        // Get today's timestamp
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = today.getTime() / 1000;

        // Get the chat and its messages
        const chat = await client.getChatById(channelId);
        const messages = await chat.fetchMessages({ limit: 100 });
        
        // Filter only today's messages and format them
        const todayMessages = messages
            .filter(msg => msg.timestamp >= todayTimestamp)
            .map(msg => ({
                id: msg.id._serialized || msg.id,
                chatId: channelId,
                body: msg.body || '',
                timestamp: msg.timestamp,
                type: msg.type || 'text',
                author: msg.author || channelId,
                isChannelMessage: true,
                channelType: channelId.endsWith('@newsletter') ? 'newsletter' : 
                            (channelId === 'status@broadcast' ? 'broadcast' : 'channel'),
                requestId: requestId
            }))
            .sort((a, b) => b.timestamp - a.timestamp);

        // Get channel information
        const channelInfo = {
            id: channelId,
            name: chat.name || channelId,
            type: todayMessages.length > 0 ? todayMessages[0].channelType : 'channel',
            lastMessage: todayMessages.length > 0 ? todayMessages[0].body.substring(0, 100) : '',
            lastSeen: new Date().toISOString(),
            requestId: requestId
        };

        // Send fresh data to Cloudflare
        await cloudflareClient.syncAllData({
            chats: [],
            contacts: [],
            messages: [],
            channels: [channelInfo],
            channelMessages: todayMessages
        });

        console.log(`[FRESH-DATA] Fresh data sync completed: ${todayMessages.length} messages for ${channelInfo.name}`);
    } catch (error) {
        console.error(`[FRESH-DATA] Error syncing fresh data for ${channelId}:`, error);
    }
}

// Ensure contact exists before sending message (fast, non-blocking, no verification)
async function ensureContactExists(chatId, contactName) {
  if (!client || !ready) {
    return; // Silently skip if not ready
  }

  try {
    // Extract phone number from chatId (remove @c.us suffix)
    const phoneNumber = chatId.replace('@c.us', '');
    
    // Create contact using WhatsApp's contact creation method
    // Note: WhatsApp Web.js has limitations - names may not persist, only numbers sync
    // v1.34.2+ fix: firstName must never be empty, use number as fallback if needed
    const firstName = contactName && contactName.trim() ? contactName.trim() : phoneNumber;
    
    // Attempt to add contact (non-blocking, ignore errors)
    // Don't verify - WhatsApp Web.js contact addition is unreliable
    await client.saveOrEditAddressbookContact(phoneNumber, firstName, '', true)
      .catch(() => {
        // Silently ignore errors - WhatsApp Web.js contact addition has known limitations
      });
    
  } catch (error) {
    // Silently ignore all errors - continue with message sending
    // WhatsApp Web.js contact addition is unreliable, so we don't block on it
  }
}

// Process queued messages from Cloudflare
async function processQueuedMessages() {
  if (!cloudflareClient || !cloudflareClient.isConnected || !client) {
    // Silently return if Cloudflare is not available
    return;
  }
  
  try {
    const userInfo = getUserIdentifier();
    if (!userInfo) {
      console.log('[CLOUDFLARE] No user info available, skipping message processing');
      return;
    }
    
    const queuedMessages = await cloudflareClient.getQueuedMessages(userInfo.id);
    
    // Only process if there are actually queued messages
    if (!queuedMessages || queuedMessages.length === 0) {
      return; // Skip processing if no messages
    }
    
    const processedMessages = [];

    for (const queuedMsg of queuedMessages) {
      try {
        console.log(`[CLOUDFLARE] Processing queued message: ${queuedMsg.id} for user: ${userInfo.id}`);
        
        // SECURITY VALIDATION: Check if the from field matches the logged-in user
        if (queuedMsg.from && queuedMsg.from !== userInfo.id) {
          console.log(`[CLOUDFLARE] SECURITY REJECTION: Message ${queuedMsg.id} from ${queuedMsg.from} does not match logged-in user ${userInfo.id}`);
          
          // Mark message as rejected
          processedMessages.push({
            id: queuedMsg.id,
            status: 'rejected',
            rejectedAt: new Date().toISOString(),
            error: 'Security validation failed: from field does not match logged-in user'
          });
          continue; // Skip processing this message
        }
        
        // Check and create contact if needed
        const chatId = queuedMsg.to;
        const contactName = queuedMsg.contactName || queuedMsg.name || chatId;
        
        // Ensure contact exists before sending message
        await ensureContactExists(chatId, contactName);
        
        // Send the message
        let media = null;
        
        if (queuedMsg.media) {
          // Handle both URL strings (backward compatibility) and base64 objects (new format)
          try {
            if (typeof queuedMsg.media === 'string') {
              // Legacy format: media is a URL string
              media = await MessageMedia.fromUrl(queuedMsg.media);
            } else if (queuedMsg.media && typeof queuedMsg.media === 'object' && queuedMsg.media.mimetype && queuedMsg.media.data) {
              // New format: media is an object with {mimetype, data, filename}
              media = new MessageMedia(
                queuedMsg.media.mimetype,
                queuedMsg.media.data,
                queuedMsg.media.filename || null
              );
            } else {
              console.warn(`[CLOUDFLARE] Invalid media format for message ${queuedMsg.id}:`, queuedMsg.media);
            }
          } catch (mediaError) {
            // Gracefully handle media processing errors (backward compatibility)
            console.error(`[CLOUDFLARE] Failed to process media for message ${queuedMsg.id}:`, mediaError.message);
            // Continue without media - send text message only
            media = null;
          }
        }
        
        const message = await client.sendMessage(chatId, queuedMsg.message, { media });
        
        processedMessages.push({
          id: queuedMsg.id,
          status: 'sent',
          sentAt: new Date().toISOString(),
          messageId: message.id._serialized
        });
        
        // Track message in Cloudflare messages log
        appendCloudflareMessage({
          queueId: queuedMsg.id,
          messageId: message.id._serialized,
          to: chatId,
          message: queuedMsg.message,
          hasMedia: !!media,
          status: 'sent',
          sentAt: new Date().toISOString()
        });
        
        console.log(`[CLOUDFLARE] Message sent successfully: ${queuedMsg.id}`);
      } catch (error) {
        console.error(`[CLOUDFLARE] Failed to send queued message ${queuedMsg.id}:`, error);
        
        processedMessages.push({
          id: queuedMsg.id,
          status: 'failed',
          error: error.message
        });
        
        // Track failed message
        appendCloudflareMessage({
          queueId: queuedMsg.id,
          to: queuedMsg.to,
          message: queuedMsg.message,
          status: 'failed',
          error: error.message,
          failedAt: new Date().toISOString()
        });
      }
    }

    if (processedMessages.length > 0) {
      await cloudflareClient.processMessages(processedMessages, userInfo.id);
        console.log(`[CLOUDFLARE] Processed ${processedMessages.length} queued messages for user: ${userInfo.id}`);
    }
  } catch (error) {
    console.error('[CLOUDFLARE] Queue processing error:', error);
  }
}

// initializeJsonFiles is now imported from fileManager module
const genAI = new GoogleGenAI({});
const groundingTool = { googleSearch: {} };
// INCREASED maxOutputTokens from 512 to 2048 for full message content
const genAIConfig = { tools: [groundingTool], maxOutputTokens: 2048 };

/**
 * Step 2: Parse the response from step 1 into structured JSON format
 * Uses gemini-2.5-flash-lite model without tools to reduce cost
 */
async function parseResponseToJson(step1Response) {
  const parsePrompt = `You are extracting the FINAL WhatsApp message from an AI response.

AI Response:
---
${step1Response}
---

TASK: Determine if there is a VALID message to send, and extract it if so.

SET hasNewMessage = FALSE if the response contains ANY of these:
- The exact text "NO_NEW_CONTENT" (this is a special signal meaning no news found)
- "no new content found" or similar phrases
- "all content has been covered" or similar
- Only a list of previously sent titles without new news
- Commentary about lack of new information
- Error messages or system responses
- Internal thinking without a final message
- Meta-commentary like "I checked all sources..."
- Any text that is NOT a proper subscriber-facing message

SET hasNewMessage = TRUE only if there is a CLEAR, POLISHED message with:
- An emoji-decorated title
- Substantive news/update body text (not just a list of old titles)
- A call-to-action URL at the end
- Content that is clearly meant for subscribers (not admin/system notes)

EXTRACT the message ONLY if hasNewMessage = TRUE:
- The FINAL formatted message with emoji title, body text, and URL
- Usually appears at the END of the response
- Starts with emojis and a title
- Ends with "For more updates visit https://..."

Return JSON:
{
  "message": "The clean message to send (empty string if hasNewMessage is false)",
  "hasNewMessage": true/false,
  "notes": "Reason for decision (e.g., 'No new content found' or 'Valid news message extracted')"
}

CRITICAL: 
- When in doubt, set hasNewMessage = FALSE (better to skip than send garbage)
- The "message" field should be EMPTY ("") if hasNewMessage is false
Return ONLY the JSON object.`;

  try {
    const config = {
      responseMimeType: 'application/json',
      // INCREASED maxOutputTokens from 512 to 2048 to preserve full message content
      maxOutputTokens: 2048
    };

    const response = await genAI.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: parsePrompt,
      config
    });

    const responseText = response.text.trim();
    
    // Parse the JSON response
    let jsonText = responseText;
    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(jsonText);
    // Only send if hasNewMessage is explicitly true AND message is not empty
    const hasValidMessage = parsed.hasNewMessage === true && parsed.message && parsed.message.trim().length > 50;
    return {
      message: hasValidMessage ? parsed.message : '',
      hasNewMessage: hasValidMessage,
      notes: parsed.notes || ''
    };
  } catch (err) {
    console.error('[GenAI] Step 2 (JSON parsing) failed:', err.message);
    if (err.status) {
      console.error('[GenAI] Step 2 error status:', err.status);
    }
    if (err.response) {
      console.error('[GenAI] Step 2 error response:', JSON.stringify(err.response, null, 2));
    }
    // Return null to indicate failure, so we can fall back to step 1 response
    return null;
  }
}

async function callGenAI({ systemPrompt, autoReplyPrompt, chatHistory, userMessage, useJsonMode = false }) {
  // Compose prompt for grounding
  let contents = `${systemPrompt}\n\nChat history:\n${chatHistory}\n\nUser: ${userMessage}\n\n${autoReplyPrompt}`;
  
  try {
    const config = { ...genAIConfig };
    
    // For JSON mode: Step 1 - Call with tools enabled but WITHOUT responseMimeType
    // This avoids the error: "Tool use with a response mime type: 'application/json' is unsupported"
    if (useJsonMode) {
      // DO NOT set responseMimeType here when tools are enabled
      // We'll parse the response in step 2
      console.log('[GenAI] Step 1: Calling with tools enabled (no JSON forcing)');
    }
    
    // Step 1: Call with tools (Google Search) enabled
    const response = await genAI.models.generateContent({
      model: process.env.GOOGLE_MODEL || 'gemini-2.5-flash',
      contents,
      config
    });
    
    const responseText = response.text;
    
    // If JSON mode, proceed to step 2: Parse response to JSON
    if (useJsonMode) {
      console.log('[GenAI] Step 2: Parsing response to JSON using gemini-2.5-flash-lite');
      const parsedResult = await parseResponseToJson(responseText);
      
      if (parsedResult) {
        // Step 2 succeeded
        console.log('[GenAI] Step 2 succeeded: JSON parsed successfully');
        return parsedResult;
      } else {
        // Step 2 failed - default to NOT sending (safer than sending garbage)
        console.log('[GenAI] Step 2 failed, defaulting to hasNewMessage: false for safety');
        return {
          message: '',
          hasNewMessage: false,
          notes: 'Step 2 JSON parsing failed - skipping message for safety'
        };
      }
    }
    
    // Non-JSON mode: return plain text
    return responseText;
  } catch (err) {
    console.error('[GenAI] Error:', err);
    return null;
  }
}
function appendAutomationLog(automation, entry) {
  if (!accountPaths) {
    console.error('[AUTOMATION] Cannot append log: account paths not initialized');
    return;
  }
  
  try {
    // Ensure entry has timestamp
    if (!entry.timestamp) {
      entry.timestamp = new Date().toISOString();
    }
    
    // Get current log file path (in logs directory)
    let logPath = path.join(accountPaths.logsDir, automation.logFile);
    let logFileIndex = 0;
    
    // Check if current log file exists and is too large (10MB limit)
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB >= 10) {
        // Find the next available log file number
        const baseName = automation.logFile.replace('.json', '');
        let nextIndex = 1;
        let nextLogPath;
        
        do {
          nextLogPath = path.join(accountPaths.logsDir, `${baseName}_${nextIndex}.json`);
          nextIndex++;
        } while (fs.existsSync(nextLogPath) && nextIndex < 1000); // Safety limit
        
        // Create new log file
        logPath = nextLogPath;
        automation.logFile = path.basename(nextLogPath);
        
        // Update automation record with new log file name
        const automations = readAutomations();
        const automationIndex = automations.findIndex(a => a.id === automation.id);
        if (automationIndex !== -1) {
          automations[automationIndex].logFile = automation.logFile;
          writeAutomations(automations);
        }
        
        console.log(`[AUTOMATION] Rotated log file for ${automation.chatName} to ${automation.logFile}`);
      }
    }
    
    // Read existing logs
    let logs = [];
    if (fs.existsSync(logPath)) {
      try { 
        const fileContent = fs.readFileSync(logPath, 'utf8');
        if (fileContent.trim()) {
          logs = JSON.parse(fileContent);
        }
      } catch (parseErr) {
        console.error(`[AUTOMATION] Failed to parse log file ${logPath}:`, parseErr.message);
        // Create backup of corrupted file
        const backupPath = logPath.replace('.json', '_corrupted_' + Date.now() + '.json');
        try {
          fs.copyFileSync(logPath, backupPath);
          console.log(`[AUTOMATION] Created backup of corrupted log: ${backupPath}`);
        } catch (backupErr) {
          console.error(`[AUTOMATION] Failed to backup corrupted log:`, backupErr.message);
        }
        logs = [];
      }
    }
    
    // Ensure logs is an array
    if (!Array.isArray(logs)) {
      logs = [];
    }
    
    // Add new entry at the beginning (most recent first)
    logs.unshift({
      id: require('crypto').randomBytes(8).toString('hex'), // Unique ID for each log entry
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    });
    
    // Keep only last 5000 log entries per file to prevent excessive memory usage
    // With rotation, this gives us ~50MB total per automation (10 files * 5MB each)
    if (logs.length > 5000) {
      logs = logs.slice(0, 5000);
    }
    
    // Write logs with proper formatting
    const writeSuccess = writeJson(logPath, logs);
    if (!writeSuccess) {
      console.log(`[AUTOMATION] Failed to save log due to disk space: ${automation.chatName}`);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to append automation log:`, error.message);
    console.error(`[ERROR] Stack:`, error.stack);
    // Don't let log errors crash the app
  }
}
function readAutomations() {
  if (!accountPaths) {
    console.error('[AUTOMATIONS] Cannot read automations: account paths not initialized');
    return [];
  }
  if (!fs.existsSync(accountPaths.automationsFile)) return [];
  return JSON.parse(fs.readFileSync(accountPaths.automationsFile, 'utf8'));
}
function writeAutomations(data) {
  if (!accountPaths) {
    console.error('[AUTOMATIONS] Cannot write automations: account paths not initialized');
    return;
  }
  fs.writeFileSync(accountPaths.automationsFile, JSON.stringify(data, null, 2));
}

// readJson, writeJson, checkDiskSpace, cleanupOldLogs, cleanupTempFiles are now imported from fileManager module

// Configure multer for different upload types
const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, TEMPLATE_MEDIA_DIR);
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
        }
    }),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        fieldSize: 50 * 1024 * 1024 // 50MB limit for fields
    }
});

// Configure multer for template uploads (uses memory storage for buffer access)
const templateUpload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB max for templates
});

// Configure multer for message media uploads (uses memory storage for buffer access)
const messageUpload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB max for messages
});

// Configure multer for CSV uploads (uses memory storage for buffer access)
const csvUpload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB max for CSV files
});

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5014;

// Function to check and kill process on port
async function checkAndKillPort(port) {
  try {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    const { stdout } = await execAsync(`lsof -t -i:${port}`);
    if (stdout.trim()) {
      console.log(`[PORT] Process found on port ${port}, killing it...`);
      await execAsync(`kill -9 ${stdout.trim()}`);
      console.log(`[PORT] Process killed successfully`);
      // Wait a moment for the port to be released
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    // Port is free or no process found
    console.log(`[PORT] Port ${port} is available`);
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/message-templates', express.static(TEMPLATE_MEDIA_DIR));

// Webhook endpoint for immediate Cloudflare request processing
app.post('/api/webhook/cloudflare', async (req, res) => {
    try {
        const { event, data, timestamp } = req.body;
        const webhookEvent = req.headers['x-webhook-event'];
        
        console.log(`[WEBHOOK] Received event: ${webhookEvent || event} at ${timestamp}`);
        
        switch (event) {
            case 'message_queued':
                console.log(`[WEBHOOK] New message queued: ${data.messageId} for ${data.to} - Processing IMMEDIATELY`);
                // Immediately process queued messages
                await processQueuedMessages();
                break;
                
            case 'contact_lookup_requested':
                console.log(`[WEBHOOK] Contact lookup requested: ${data.contactId} - Processing IMMEDIATELY`);
                // Handle immediate contact lookup
                await handleContactLookup(data.contactId, data.requestId);
                break;
                
            case 'fresh_data_requested':
                console.log(`[WEBHOOK] Fresh data requested for: ${data.channelId} - Processing IMMEDIATELY`);
                // Handle immediate fresh data sync
                await handleFreshDataRequest(data.channelId, data.requestId);
                break;
                
            case 'data_synced':
                console.log(`[WEBHOOK] Data synced to Cloudflare: ${JSON.stringify(data.syncResults)}`);
                break;
                
            default:
                console.log(`[WEBHOOK] Unknown event: ${event}`);
        }
        
        res.json({ 
            success: true, 
            message: 'Webhook processed immediately',
            event: event,
            processedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[WEBHOOK] Error processing webhook:', error);
        res.status(500).json({ 
            error: 'Webhook processing failed',
            message: error.message 
        });
    }
});

// Global user info storage
let currentUserInfo = null;

// Function to get user identifier from WhatsApp client
function getUserIdentifier() {
    if (!currentUserInfo || !currentUserInfo.wid) {
        return null;
    }
    
    // Use WhatsApp ID as unique identifier - simplified to only essential field
    const userId = currentUserInfo.wid._serialized || currentUserInfo.wid;
    
    return {
        id: userId
    };
}

// Initialize WhatsApp client with improved configuration
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-blink-features=AutomationControlled',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-default-apps'
        ],
        timeout: 120000, // Increase timeout to 2 minutes
        defaultViewport: { width: 1280, height: 720 }
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

// State variables
let waStatus = 'initializing';
let qrCode = null;
let chatsCache = [];
let ready = false;

// WhatsApp client event handlers
client.on('qr', (qr) => {
    waStatus = 'qr';
    qrCode = qr;
    console.log('QR Code received, scan with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    waStatus = 'ready';
    qrCode = null;
    ready = true;
    console.log('WhatsApp client is ready!');
    
    // Store user information for session management
    currentUserInfo = client.info;
    const userInfo = getUserIdentifier();
    if (userInfo) {
        const phoneNumber = userInfo.id.replace('@c.us', '');
        const userName = currentUserInfo.pushname || 'Unknown User';
        console.log(`[USER] Logged in as: ${userName} (${phoneNumber})`);
        console.log(`[USER] User ID: ${userInfo.id}`);
        
        // Initialize account-specific paths
        console.log(`[ACCOUNT] Initializing paths for account: ${phoneNumber}`);
        const initializedPaths = accountPathsModule.initializeAccountPaths(phoneNumber);
        if (initializedPaths) {
            accountPaths = initializedPaths; // Sync local variable
            console.log(`[ACCOUNT] Account paths initialized successfully`);
            // Initialize JSON files for this account
            initializeJsonFiles();
            // Setup backup routes for this account (this will use account-specific paths)
            backupRoutesSetup = false; // Reset to allow re-setup
            setupBackupRoutesForAccount();
        } else {
            console.error(`[ACCOUNT] Failed to initialize account paths`);
        }
    } else {
        console.log('[USER] Warning: Could not detect user information');
    }
    try {
        chatsCache = await client.getChats();
        console.log(`Loaded ${chatsCache.length} chats`);
    } catch (err) {
        console.error('Failed to load chats:', err.message);
        chatsCache = [];
    }
    
    // Run initial channel discovery
    discoverChannels();
    
    // Set up periodic channel discovery (every 5 minutes)
    setInterval(discoverChannels, 5 * 60 * 1000);
});

client.on('authenticated', () => {
    waStatus = 'authenticated';
    console.log('WhatsApp client authenticated');
});

client.on('auth_failure', (err) => {
    waStatus = 'auth_failure';
    ready = false;
    console.error('Authentication failure:', err);
});

client.on('disconnected', (reason) => {
    waStatus = 'disconnected';
    ready = false;
    console.log('WhatsApp client disconnected:', reason);
    
    // Attempt to reconnect after a delay
    setTimeout(async () => {
        try {
            console.log('[RECONNECT] Attempting to reconnect WhatsApp client...');
            await client.initialize();
        } catch (err) {
            console.error('[RECONNECT] Failed to reconnect:', err.message);
        }
    }, 10000); // Wait 10 seconds before reconnecting
});

client.on('loading_screen', (percent, message) => {
    console.log(`[LOADING] WhatsApp Web loading: ${percent}% - ${message}`);
});

client.on('message', async (msg) => {
    console.log('New message received:', msg.body);
    console.log('Message from:', msg.from, 'Type:', msg.type, 'Author:', msg.author);
    
    // Enhanced channel detection logic
    const from = msg.from || msg.author;
    const isChannelMessage = from && (
        from.endsWith('@newsletter') || 
        from.endsWith('@broadcast') || 
        from === 'status@broadcast' ||
        (!from.endsWith('@c.us') && !from.endsWith('@g.us') && from.includes('@'))
    );
    
    if (isChannelMessage) {
        console.log('Channel message detected from:', from);
        
        // Determine channel type more accurately
        let channelType = 'channel';
        if (from.endsWith('@newsletter')) {
            channelType = 'newsletter';
        } else if (from.endsWith('@broadcast') || from === 'status@broadcast') {
            channelType = 'broadcast';
        } else if (from.includes('@')) {
            channelType = 'channel';
        }
        
        const messageData = {
            id: msg.id._serialized || msg.id,
            chatId: from,
            body: msg.body || '',
            timestamp: msg.timestamp || Math.floor(Date.now() / 1000),
            type: msg.type || 'text',
            author: msg.author || from,
            isChannelMessage: true,
            channelType: channelType
        };
        
        // Try to get channel name from the chat if available
        let channelName = from;
        try {
            const chat = await client.getChatById(from);
            if (chat && chat.name) {
                channelName = chat.name;
            }
        } catch (error) {
            console.log(`Could not get chat name for ${from}:`, error.message);
        }
        
        // Store in detected channels file with enhanced information
        addDetectedChannel(from, {
            name: channelName,
            lastMessage: msg.body ? msg.body.substring(0, 100) : '',
            lastSeen: new Date().toISOString(),
            type: channelType,
            isNewsletter: channelType === 'newsletter',
            isBroadcast: channelType === 'broadcast'
        });
        
        // Immediate sync for channel messages (event-driven)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = today.getTime() / 1000;
        
        if (cloudflareClient && cloudflareClient.isConnected && messageData.timestamp >= todayTimestamp) {
            console.log(`[CHANNEL-EVENT] Triggering immediate sync for channel: ${from}`);
            try {
                // Get channel information
                const chat = await client.getChatById(from);
                const channelName = chat.name || from;
                
                // Use the new immediate sync function
                await syncChannelMessageImmediately(from, channelName, messageData);
                
            } catch (syncError) {
                console.log(`[CHANNEL-EVENT] Failed to sync channel message: ${syncError.message}`);
            }
        } else if (messageData.timestamp < todayTimestamp) {
            console.log(`[CHANNEL-EVENT] Skipping old channel message: ${from}`);
        }
    }
    
    // Optionally update chats cache on new message
    if (ready) {
        try {
            chatsCache = await client.getChats();
        } catch (err) {
            // Ignore errors
        }
    }
    // Auto-reply logic (only for chats, not channels)
    if (!msg.fromMe) {
        let processed = false;
        
        // 1. Check regular automations first (auto-reply functionality removed)
        const automations = readAutomations().filter(a => a.status === 'active' && a.chatId === msg.from);
        for (const a of automations) {
            // Skip channel automations for auto-reply (channels only support scheduled messages)
            const isChannel = a.automationType === 'channel' || a.chatId.endsWith('@newsletter') || a.chatId.endsWith('@broadcast');
            if (isChannel) continue;
            
            // Auto-reply functionality has been removed - skip processing
            continue;
        }
        
        // 2. Check leads auto-reply if no automation handled it
        if (!processed) {
            await handleLeadsAutoReply(msg);
        }
    }
});

// Handle leads auto-reply functionality
async function handleLeadsAutoReply(msg) {
    try {
        // Extract mobile number from WhatsApp chat ID
        const chatId = msg.from;
        if (!chatId.endsWith('@c.us')) return; // Only handle individual chats
        
        const mobileNumber = chatId.replace('@c.us', '');
        
        // Load leads data
        if (!accountPaths || !accountPaths.leadsFile) return;
        const leadsData = readJson(accountPaths.leadsFile, { leads: [] });
        if (!leadsData.leads || !Array.isArray(leadsData.leads)) return;
        
        // Find lead with auto chat enabled for this mobile number
        const lead = leadsData.leads.find(l => {
            const leadMobile = l.mobile?.replace(/[^\d]/g, ''); // Remove non-digits
            const msgMobile = mobileNumber.replace(/[^\d]/g, ''); // Remove non-digits
            return l.auto_chat_enabled && (
                leadMobile === msgMobile ||
                leadMobile === msgMobile.slice(-10) || // Compare last 10 digits
                msgMobile === leadMobile.slice(-10) ||
                leadMobile.endsWith(msgMobile.slice(-10)) ||
                msgMobile.endsWith(leadMobile.slice(-10))
            );
        });
        
        if (!lead) {
            console.log(`[LEADS AUTO-REPLY] No lead found with auto chat enabled for mobile: ${mobileNumber}`);
            return;
        }
        
        console.log(`[LEADS AUTO-REPLY] Processing auto-reply for lead: ${lead.name} (${lead.mobile})`);
        
        // Load leads auto chat configuration
        if (!accountPaths || !accountPaths.leadsConfigFile) return;
        const config = readJson(accountPaths.leadsConfigFile, {
            enabled: false,
            systemPrompt: '',
            includeJsonContext: true,
            autoReply: false,
            autoReplyPrompt: ''
        });
        
        // Check if auto reply is enabled in config
        if (!config.autoReply || !config.systemPrompt || !config.autoReplyPrompt) {
            console.log(`[LEADS AUTO-REPLY] Auto reply not configured for leads`);
            return;
        }
        
        // Get chat history
        let chatHistory = '';
        try {
            const chat = await client.getChatById(chatId);
            const msgs = await chat.fetchMessages({ limit: 100 });
            chatHistory = msgs.map(m => `${m.fromMe ? 'Me' : 'User'}: ${m.body || '[Media]'}`).join('\n');
        } catch (err) {
            console.error(`[LEADS AUTO-REPLY] Failed to get chat history:`, err.message);
        }
        
        // Build full prompt
        let fullPrompt = config.systemPrompt;
        
        if (config.includeJsonContext) {
            fullPrompt += `\n\nLead Context:\n${JSON.stringify(lead, null, 2)}`;
        }
        
        if (chatHistory) {
            fullPrompt += `\n\nChat History:\n${chatHistory}`;
        }
        
        fullPrompt += `\n\nAuto Reply Instructions:\n${config.autoReplyPrompt}`;
        fullPrompt += `\n\nUser's latest message: ${msg.body}`;
        
        // Call GenAI
        const aiReply = await callGenAI({
            systemPrompt: fullPrompt,
            autoReplyPrompt: config.autoReplyPrompt,
            chatHistory,
            userMessage: msg.body
        });
        
        if (!aiReply) {
            console.error(`[LEADS AUTO-REPLY] GenAI failed for lead: ${lead.name}`);
            // Log error to lead's auto chat logs
            await logLeadAutoChatMessage(lead.id, 'error', 'GenAI failed to generate response', fullPrompt);
            return;
        }
        
        // Send reply
        try {
            await msg.reply(aiReply);
            console.log(`[LEADS AUTO-REPLY] Successfully sent reply to ${lead.name}: ${aiReply.substring(0, 100)}...`);
            
            // Log successful auto-reply to lead's auto chat logs
            await logLeadAutoChatMessage(lead.id, 'auto-reply', aiReply, fullPrompt);
            
        } catch (err) {
            console.error(`[LEADS AUTO-REPLY] Failed to send reply to ${lead.name}:`, err.message);
            // Log error to lead's auto chat logs
            await logLeadAutoChatMessage(lead.id, 'error', `Failed to send reply: ${err.message}`, fullPrompt);
        }
        
    } catch (err) {
        console.error(`[LEADS AUTO-REPLY] Error in handleLeadsAutoReply:`, err.message);
    }
}

// Log message to lead's auto chat logs
async function logLeadAutoChatMessage(leadId, type, message, prompt = '') {
    try {
        if (!accountPaths || !accountPaths.leadsFile) return;
        const leadsData = readJson(accountPaths.leadsFile, { leads: [] });
        if (!leadsData.leads || !Array.isArray(leadsData.leads)) return;
        
        const leadIndex = leadsData.leads.findIndex(l => l.id === leadId);
        if (leadIndex === -1) return;
        
        if (!leadsData.leads[leadIndex].auto_chat_logs) {
            leadsData.leads[leadIndex].auto_chat_logs = [];
        }
        
        leadsData.leads[leadIndex].auto_chat_logs.push({
            timestamp: new Date().toISOString(),
            type: type,
            message: message,
            prompt: prompt // Include the full prompt used
        });
        
        // Keep only last 50 logs
        if (leadsData.leads[leadIndex].auto_chat_logs.length > 50) {
            leadsData.leads[leadIndex].auto_chat_logs = leadsData.leads[leadIndex].auto_chat_logs.slice(-50);
        }
        
        // Update last_updated timestamp
        leadsData.leads[leadIndex].last_updated = new Date().toISOString();
        
        // Save back to file
        writeJson(accountPaths.leadsFile, leadsData);
        
        console.log(`[LEADS AUTO-REPLY] Logged ${type} message for lead: ${leadIndex}`);
        
    } catch (err) {
        console.error(`[LEADS AUTO-REPLY] Error logging message:`, err.message);
    }
}

// Initialize WhatsApp client with error handling and retry logic
async function initializeWhatsAppClient() {
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
        try {
            console.log(`[INIT] Starting WhatsApp client initialization (attempt ${retryCount + 1}/${maxRetries})...`);
            
            // Add timeout to prevent hanging
            const initPromise = client.initialize();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Initialization timeout after 2 minutes')), 120000);
            });
            
            await Promise.race([initPromise, timeoutPromise]);
            console.log('[INIT] WhatsApp client initialization completed successfully');
            
            // Initialize Cloudflare sync after WhatsApp client is ready
            await initializeCloudflareSync();
            break; // Success, exit retry loop
            
        } catch (err) {
            retryCount++;
            console.error(`[INIT] Initialization attempt ${retryCount} failed:`, err.message);
            
            if (retryCount < maxRetries) {
                console.log(`[INIT] Waiting 10 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            } else {
                console.error('[INIT] All initialization attempts failed');
                console.log('[INIT] Retrying in 30 seconds...');
                
                // Final retry after 30 seconds
                setTimeout(async () => {
                    try {
                        console.log('[INIT] Final retry attempt...');
                        await client.initialize();
                        
                        // Initialize Cloudflare sync after retry
                        await initializeCloudflareSync();
                    } catch (retryErr) {
                        console.error('[INIT] Retry failed:', retryErr.message);
                        console.error('[INIT] Full retry error:', retryErr);
                    }
                }, 30000);
            }
        }
    }
}

initializeWhatsAppClient();

// Simple status check every minute
setInterval(() => {
    console.log(`[STATUS] WhatsApp Status: ${waStatus}, Ready: ${ready}, Chats: ${chatsCache.length}`);
}, 60000);

// --- Bulk Message Scheduler ---
const BULK_SEND_DELAY_SEC = 1; // default delay between messages
setInterval(async () => {
    if (!ready) return;
    if (!accountPaths || !accountPaths.bulkFile) return;
    let records = readJson(accountPaths.bulkFile, []);
    let changed = false;
    const now = new Date();
    for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.status !== 'pending') continue;
        const sendTime = new Date(r.send_datetime);
        if (isNaN(sendTime.getTime()) || sendTime > now) continue;
        // Double-check status before sending
        if (r.status === 'sent') continue;
        // Send message with contact management
        try {
            const normalizedNumber = r.number.trim();
            let chatId = !normalizedNumber.endsWith('@c.us') && !normalizedNumber.endsWith('@g.us')
                ? normalizedNumber.replace(/[^0-9]/g, '') + '@c.us'
                : normalizedNumber;
            
            // Check if this is a group (ends with @g.us)
            const isGroup = chatId.endsWith('@g.us');
            
            // For groups, verify we can access the group chat
            if (isGroup) {
                try {
                    const groupChat = await client.getChatById(chatId);
                    if (!groupChat) {
                        throw new Error(`Cannot access group ${chatId}. Account may not be a member.`);
                    }
                    console.log(`[BULK] Group verified: ${groupChat.name || chatId}`);
                    // Skip contact addition for groups
                } catch (groupErr) {
                    console.error(`[BULK] Group verification failed for ${chatId}:`, groupErr.message);
                    records[i].status = 'failed';
                    records[i].sent_datetime = new Date().toISOString();
                    records[i].error = `Failed to verify group access: ${groupErr.message}`;
                    changed = true;
                    writeJson(accountPaths.bulkFile, records);
                    continue; // Skip to next message
                }
            } else {
                // For individual contacts, check if contact exists and add if needed
                let contactExists = false;
                let existingContact = null;
                
                try {
                    existingContact = await client.getContactById(chatId);
                    if (existingContact && existingContact.isMyContact) {
                        // Check if contact has proper name
                        const hasProperName = existingContact.name && 
                                            existingContact.name !== 'undefined' && 
                                            existingContact.name !== undefined && 
                                            existingContact.name !== `Contact ${normalizedNumber.replace(/[^0-9]/g, '')}` && 
                                            existingContact.name !== normalizedNumber.replace(/[^0-9]/g, '');
                        
                        if (hasProperName) {
                            console.log(`[BULK] Contact exists with proper name for ${normalizedNumber}: ${existingContact.name}`);
                            contactExists = true;
                        } else {
                            console.log(`[BULK] Contact exists but needs name update for ${normalizedNumber}: ${existingContact.name} -> ${r.name || 'generated name'}`);
                        }
                    } else {
                        console.log(`[BULK] Contact does not exist for ${normalizedNumber}, adding...`);
                    }
                } catch (err) {
                    console.log(`[BULK] Contact check failed for ${normalizedNumber}, will add: ${err.message}`);
                }
                
                // Add contact if it doesn't exist or needs name update
                if (!contactExists) {
                try {
                    // Generate name if not available
                    let firstName = '';
                    let lastName = '';
                    
                    if (r.name && r.name.trim()) {
                        const nameParts = r.name.trim().split(' ').filter(part => part.length > 0);
                        if (nameParts.length === 1) {
                            firstName = nameParts[0];
                            lastName = '';
                        } else if (nameParts.length >= 2) {
                            firstName = nameParts[0];
                            lastName = nameParts.slice(1).join(' ');
                        }
                    } else {
                        // Generate random 6-character alphanumeric string as firstName
                        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                        firstName = Array.from({length: 6}, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
                        lastName = 'bulk';
                        console.log(`[BULK] Generated random name for ${normalizedNumber}: ${firstName} ${lastName}`);
                    }
                    
                    // Add contact using saveOrEditAddressbookContact
                    const contactChatId = await client.saveOrEditAddressbookContact(
                        normalizedNumber.replace(/[^0-9]/g, ''),
                        firstName,
                        lastName,
                        true // syncToAddressbook = true
                    );
                    
                    console.log(`[BULK] Contact added successfully for ${normalizedNumber}: ${firstName} ${lastName}`);
                    
                    // Verify the contact was added
                    try {
                        const newContact = await client.getContactById(contactChatId._serialized || contactChatId);
                        if (newContact) {
                            const hasProperName = newContact.name && 
                                                newContact.name !== 'undefined' && 
                                                newContact.name !== undefined && 
                                                newContact.name !== `Contact ${normalizedNumber.replace(/[^0-9]/g, '')}` && 
                                                newContact.name !== normalizedNumber.replace(/[^0-9]/g, '');
                            
                            if (hasProperName) {
                                console.log(`[BULK] Contact verified with proper name: ${newContact.name}`);
                                // Use the returned chatId for sending message
                                chatId = contactChatId._serialized || contactChatId;
                            } else {
                                console.log(`[BULK] Contact added but name verification failed: ${newContact.name}`);
                                throw new Error('Failed to add contact with proper name');
                            }
                        } else {
                            console.log(`[BULK] Contact added but verification failed`);
                            throw new Error('Contact verification failed');
                        }
                    } catch (verifyErr) {
                        console.error(`[BULK] Contact verification error for ${normalizedNumber}:`, verifyErr.message);
                        throw new Error(`Failed to verify contact: ${verifyErr.message}`);
                    }
                    
                } catch (addErr) {
                    console.error(`[BULK] Failed to add contact for ${normalizedNumber}:`, addErr.message);
                    // Mark as failed and skip sending message
                    records[i].status = 'failed';
                    records[i].sent_datetime = new Date().toISOString();
                    records[i].error = `Failed to add number to contacts before sending bulk message: ${addErr.message}`;
                    changed = true;
                    writeJson(accountPaths.bulkFile, records);
                    continue; // Skip to next message
                }
                }
            }
            
            // Use retry mechanism for sending messages
            console.log(`[BULK-SCHEDULER] Attempting to send message to ${chatId} (${r.number})`);
            await retryOperation(async () => {
                if (r.media) {
                    console.log(`[BULK-SCHEDULER] Processing media for ${chatId}: ${r.media}`);
                    let media;
                    if (r.media.startsWith('http')) {
                        const fetch = require('node-fetch');
                        const resp = await fetch(r.media);
                        if (!resp.ok) throw new Error('Failed to fetch media');
                        const buf = await resp.buffer();
                        const mime = resp.headers.get('content-type') || 'application/octet-stream';
                        media = new MessageMedia(mime, buf.toString('base64'), r.media.split('/').pop());
                    } else {
                        // Handle media paths relative to public directory
                        let absPath;
                        if (r.media.startsWith('/message-templates/') || r.media.startsWith('/js/') || r.media.startsWith('/')) {
                            // Path is relative to public directory
                            absPath = path.join(__dirname, 'public', r.media);
                        } else {
                            // Path is relative to server root
                            absPath = path.join(__dirname, r.media);
                        }
                        
                        if (!fs.existsSync(absPath)) {
                            console.error(`[BULK-SCHEDULER] Media file not found: ${absPath} (original path: ${r.media})`);
                            throw new Error(`Media file not found: ${r.media}`);
                        }
                        
                        const buf = fs.readFileSync(absPath);
                        const mime = require('mime-types').lookup(absPath) || 'application/octet-stream';
                        media = new MessageMedia(mime, buf.toString('base64'), path.basename(absPath));
                    }
                    console.log(`[BULK-SCHEDULER] Calling client.sendMessage with media for ${chatId}...`);
                    const result = await client.sendMessage(chatId, media, { caption: r.message });
                    console.log(`[BULK-SCHEDULER] client.sendMessage result for ${chatId}:`, result ? 'success' : 'null', result?.id?._serialized || 'no id');
                } else {
                    console.log(`[BULK-SCHEDULER] Calling client.sendMessage with text for ${chatId}...`);
                    const result = await client.sendMessage(chatId, r.message);
                    console.log(`[BULK-SCHEDULER] client.sendMessage result for ${chatId}:`, result ? 'success' : 'null', result?.id?._serialized || 'no id');
                }
            }, 3, 2000); // 3 retries with 2 second delay
            
            records[i].status = 'sent';
            records[i].sent_datetime = new Date().toISOString();
            changed = true;
            writeJson(accountPaths.bulkFile, records);
            await new Promise(res => setTimeout(res, BULK_SEND_DELAY_SEC * 1000));
        } catch (err) {
            console.error(`Bulk send error for ${r.number}:`, err.message);
            console.error(`Message: ${r.message}`);
            console.error(`Media: ${r.media}`);
            console.error(`Full error:`, err);
            records[i].status = 'failed';
            records[i].sent_datetime = new Date().toISOString();
            records[i].error = err.message; // Store error message for debugging
            changed = true;
            writeJson(accountPaths.bulkFile, records);
        }
    }
    if (changed) writeJson(accountPaths.bulkFile, records);
}, 30000);

// --- Automation Scheduler ---
setInterval(async () => {
    if (!ready) return;
    
    const automations = readAutomations().filter(a => a.status === 'active' && a.schedule);
    const now = new Date();
    const currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM format
    
    for (const automation of automations) {
        try {
            const { schedule } = automation;
            if (!schedule || !schedule.days || !schedule.times) continue;
            
            // Check if today is a scheduled day
            if (!schedule.days.includes(currentDay)) continue;
            
            // Check if current time matches any scheduled time
            if (!schedule.times.includes(currentTime)) continue;
            
            // Check if we already sent a message at this time (prevent duplicates)
            const lastSent = automation.lastSent ? new Date(automation.lastSent) : null;
            if (lastSent && lastSent.toDateString() === now.toDateString() && 
                lastSent.toTimeString().slice(0, 5) === currentTime) {
                continue;
            }
            
            console.log(`[AUTOMATION] Triggering scheduled message for ${automation.chatName} at ${currentTime}`);
            
            // Get chat history for context
            let chatHistory = '';
            try {
                const chat = await client.getChatById(automation.chatId);
                const msgs = await chat.fetchMessages({ limit: 100 });
                chatHistory = msgs.map(m => `${m.fromMe ? 'Me' : 'User'}: ${m.body}`).join('\n');
            } catch (err) {
                console.error(`[AUTOMATION] Failed to get chat history for ${automation.chatName}:`, err.message);
                // Continue without chat history if frame is detached
                if (err.message.includes('detached Frame')) {
                    console.log(`[AUTOMATION] Frame detached for ${automation.chatName}, continuing without chat history`);
                }
            }
            
            // Call GenAI to generate scheduled message with JSON mode for structured output
            const genAIResponse = await callGenAI({
                systemPrompt: automation.systemPrompt,
                autoReplyPrompt: automation.scheduledPrompt || '',
                chatHistory,
                userMessage: 'Generate a scheduled message for today',
                useJsonMode: true
            });
            
            if (!genAIResponse) {
                console.error(`[AUTOMATION] GenAI failed to generate message for ${automation.chatName}`);
                appendAutomationLog(automation, { 
                    type: 'error', 
                    message: 'GenAI failed for scheduled message',
                    timestamp: new Date().toISOString()
                });
                continue;
            }
            
            // Extract message and check if it's new
            let scheduledMessage;
            let hasNewMessage = true;
            let aiNotes = '';
            
            if (typeof genAIResponse === 'object' && genAIResponse.message !== undefined) {
                // JSON mode response
                scheduledMessage = genAIResponse.message;
                hasNewMessage = genAIResponse.hasNewMessage;
                aiNotes = genAIResponse.notes || '';
            } else {
                // Fallback: plain text response
                scheduledMessage = genAIResponse;
            }
            
            // Skip if no new message
            if (!hasNewMessage) {
                console.log(`[AUTOMATION] No new message for ${automation.chatName}, skipping send`);
                appendAutomationLog(automation, { 
                    type: 'skipped', 
                    message: 'No new unique message to send',
                    notes: aiNotes,
                    timestamp: new Date().toISOString()
                });
                continue;
            }
            
            // Clean the message - remove any leading/trailing commentary patterns
            scheduledMessage = scheduledMessage.trim();
            
            // Remove common commentary patterns at the start
            const commentaryPatterns = [
                /^I have reviewed.*?\.\s*---\s*/i,
                /^After reviewing.*?\.\s*---\s*/i,
                /^Based on.*?\.\s*---\s*/i,
                /^Currently.*?\.\s*---\s*/i,
                /^Therefore.*?\.\s*---\s*/i
            ];
            
            for (const pattern of commentaryPatterns) {
                scheduledMessage = scheduledMessage.replace(pattern, '');
            }
            
            if (!scheduledMessage || scheduledMessage.length === 0) {
                console.error(`[AUTOMATION] Generated message is empty for ${automation.chatName}`);
                appendAutomationLog(automation, { 
                    type: 'error', 
                    message: 'Generated message is empty after cleaning',
                    notes: aiNotes,
                    timestamp: new Date().toISOString()
                });
                continue;
            }
            
            // Send the scheduled message (handle channels differently)
            const isChannel = automation.automationType === 'channel' || automation.chatId.endsWith('@newsletter') || automation.chatId.endsWith('@broadcast');
            
            if (isChannel) {
                // For channels, use channel.sendMessage() method
                try {
                    const channel = await client.getChatById(automation.chatId);
                    if (!channel.isChannel) {
                        throw new Error('Not a channel');
                    }
                    if (channel.isReadOnly) {
                        throw new Error('Not a channel admin');
                    }
                    await channel.sendMessage(scheduledMessage);
                } catch (err) {
                    console.error(`[AUTOMATION] Failed to send to channel ${automation.chatName}:`, err.message);
                    if (err.message.includes('detached Frame')) {
                        console.log(`[AUTOMATION] Frame detached for channel ${automation.chatName}, skipping this execution`);
                        appendAutomationLog(automation, { type: 'error', message: 'Frame detached - WhatsApp Web needs reconnection' });
                    } else {
                        appendAutomationLog(automation, { type: 'error', message: 'Failed to send to channel: ' + err.message });
                    }
                    continue;
                }
            } else {
                // For regular chats, use client.sendMessage()
                try {
                    await client.sendMessage(automation.chatId, scheduledMessage);
                } catch (err) {
                    console.error(`[AUTOMATION] Failed to send to chat ${automation.chatName}:`, err.message);
                    if (err.message.includes('detached Frame')) {
                        console.log(`[AUTOMATION] Frame detached for chat ${automation.chatName}, skipping this execution`);
                        appendAutomationLog(automation, { type: 'error', message: 'Frame detached - WhatsApp Web needs reconnection' });
                    } else {
                        appendAutomationLog(automation, { type: 'error', message: 'Failed to send message: ' + err.message });
                    }
                    continue;
                }
            }
            
            // Update automation with last sent time
            const automationsList = readAutomations();
            const automationIndex = automationsList.findIndex(a => a.id === automation.id);
            if (automationIndex !== -1) {
                automationsList[automationIndex].lastSent = now.toISOString();
                writeAutomations(automationsList);
            }
            
            // Log the scheduled message with notes if available
            appendAutomationLog(automation, { 
                type: 'scheduled', 
                message: scheduledMessage,
                notes: aiNotes,
                timestamp: new Date().toISOString()
            });
            
            console.log(`[AUTOMATION] Successfully sent scheduled message to ${automation.chatName}`);
            
        } catch (err) {
            console.error(`[AUTOMATION] Error processing automation ${automation.chatName}:`, err);
            appendAutomationLog(automation, { type: 'error', message: 'Failed to send scheduled message: ' + err.message });
        }
    }
}, 60000); // Check every minute

// Utility to append to sent messages log
function appendSentMessageLog(entry) {
    if (!accountPaths) {
        console.error('[SENT-MESSAGES] Cannot append log: account paths not initialized');
        return;
    }
    
    try {
        const logs = readJson(accountPaths.sentMessagesFile);
        logs.unshift({ ...entry, time: new Date().toISOString() });
        
        // Keep only last 1000 sent messages to prevent disk space issues
        if (logs.length > 1000) {
            logs.splice(1000);
        }
        
        const writeSuccess = writeJson(accountPaths.sentMessagesFile, logs);
        if (!writeSuccess) {
            console.log(`[SENT] Failed to save sent message log due to disk space`);
        }
    } catch (error) {
        console.error(`[ERROR] Failed to append sent message log:`, error.message);
        // Don't let log errors crash the app
    }
}

// Utility to manage detected channels
function addDetectedChannel(channelId, channelInfo = {}) {
    try {
        if (!accountPaths || !accountPaths.detectedChannelsFile) {
            console.log('[CHANNEL] Cannot save channel - account paths not initialized');
            return;
        }
        let channels = readJson(accountPaths.detectedChannelsFile, []);
        // Check if channel already exists
        const existingIndex = channels.findIndex(ch => ch.id === channelId);
        const now = new Date().toISOString();
        
        if (existingIndex !== -1) {
            // Update existing channel - PRESERVE ADMIN STATUS
            const existing = channels[existingIndex];
            
            // CRITICAL: Preserve admin status (isReadOnly: false) unless:
            // 1. Fresh data explicitly confirms admin (isReadOnly: false) - keep it
            // 2. Fresh data says read-only AND it was verified - update it
            // 3. Existing was admin - NEVER downgrade to read-only (fresh data may be incomplete)
            let finalIsReadOnly = existing.isReadOnly;
            let finalType = existing.type;
            
            if (channelInfo.isReadOnly === false) {
                // Fresh data confirms admin - definitely admin
                finalIsReadOnly = false;
                finalType = 'admin';
            } else if (existing.isReadOnly === false) {
                // Existing is admin - PRESERVE admin status (don't downgrade)
                finalIsReadOnly = false;
                finalType = 'admin';
            } else if (channelInfo.isReadOnly === true && channelInfo.verified) {
                // Fresh verified data says read-only - update it
                finalIsReadOnly = true;
                finalType = 'subscriber';
            }
            // Otherwise keep existing status
            
            channels[existingIndex] = {
                ...existing,
                ...channelInfo,
                // Preserve firstSeen
                firstSeen: existing.firstSeen || now,
                // Update lastSeen
                lastSeen: now,
                // Increment message count only if not a sync operation
                messageCount: channelInfo.verified ? existing.messageCount || 0 : (existing.messageCount || 0) + 1,
                // Use calculated admin status
                isReadOnly: finalIsReadOnly,
                type: finalType
            };
        } else {
            // Add new channel
            const isAdmin = channelInfo.isReadOnly === false;
            channels.push({
                id: channelId,
                name: channelInfo.name || channelId,
                type: isAdmin ? 'admin' : (channelInfo.type || 'subscriber'),
                isReadOnly: channelInfo.isReadOnly !== undefined ? channelInfo.isReadOnly : true, // Default to read-only for new
                isNewsletter: channelId.endsWith('@newsletter'),
                isBroadcast: channelId === 'status@broadcast',
                firstSeen: now,
                lastSeen: now,
                messageCount: 1,
                ...channelInfo
            });
        }
        
        // Keep only the latest 2000 channels (increased limit for append-only mode)
        if (channels.length > 2000) {
            // Sort by lastSeen and keep the most recent
            channels.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
            channels = channels.slice(0, 2000);
        }
        
        const writeSuccess = writeJson(accountPaths.detectedChannelsFile, channels);
        if (writeSuccess) {
            const isAdmin = channels[existingIndex !== -1 ? existingIndex : channels.length - 1]?.isReadOnly === false;
            console.log(`[CHANNEL] Added/Updated detected channel: ${channelInfo.name || channelId} (${isAdmin ? 'ADMIN' : 'subscriber'})`);
        } else {
            console.log(`[CHANNEL] Failed to save channel data due to disk space: ${channelId}`);
        }
    } catch (error) {
        console.error(`[ERROR] Failed to add detected channel ${channelId}:`, error.message);
        // Don't let channel detection errors crash the app
    }
}

// Get all detected channels
function getDetectedChannels() {
    if (!accountPaths || !accountPaths.detectedChannelsFile) {
        console.log('[CHANNEL] Cannot get channels - account paths not initialized');
        return [];
    }
    return readJson(accountPaths.detectedChannelsFile, []);
}

// Proactive channel discovery function
async function discoverChannels() {
    if (!ready) return;
    
    try {
        console.log('[CHANNEL-DISCOVERY] Starting proactive channel discovery (append-only mode)...');
        
        // Method 1: Get followed channels from WhatsApp
        const chats = await client.getChats();
        const followedChannels = chats.filter(chat => chat.isChannel);
        
        console.log(`[CHANNEL-DISCOVERY] Found ${followedChannels.length} channels in current WhatsApp response`);
        
        // Get existing cached channels
        const existingChannels = getDetectedChannels();
        console.log(`[CHANNEL-DISCOVERY] Existing cached channels: ${existingChannels.length}`);
        
        // Track stats for logging
        let newCount = 0;
        let updatedCount = 0;
        let adminCount = 0;
        
        // APPEND-ONLY: Add/update channels from WhatsApp response (never remove)
        for (const channel of followedChannels) {
            const channelId = channel.id._serialized;
            const isAdmin = !channel.isReadOnly;
            
            // Check if channel already exists in cache
            const existingChannel = existingChannels.find(ch => ch.id === channelId);
            
            if (!existingChannel) {
                // New channel - add it
                newCount++;
                if (isAdmin) adminCount++;
            } else {
                updatedCount++;
                // Existing channel - check admin status
                if (isAdmin) adminCount++;
            }
            
            // Add/update channel - the addDetectedChannel function handles admin status preservation
            addDetectedChannel(channelId, {
                name: channel.name,
                type: isAdmin ? 'admin' : 'subscriber',
                isReadOnly: channel.isReadOnly,
                isNewsletter: channelId.endsWith('@newsletter'),
                isBroadcast: channelId === 'status@broadcast',
                lastSeen: new Date().toISOString(),
                verified: true,
                verifiedAt: new Date().toISOString()
            });
        }
        
        // Method 2: Try to get newsletter collection for additional channels
        try {
            const newsletterChannels = await client.pupPage.evaluate(async () => {
                try {
                    const newsletterCollection = window.Store.NewsletterCollection;
                    const newsletters = newsletterCollection.getModelsArray();
                    return newsletters.map(newsletter => ({
                        id: newsletter.id._serialized,
                        name: newsletter.name,
                        description: newsletter.description,
                        timestamp: newsletter.timestamp
                    }));
                } catch (error) {
                    console.error('Error accessing newsletter collection:', error);
                    return [];
                }
            });
            
            // Add any newsletter channels not already in our list
            for (const newsletter of newsletterChannels) {
                const existingChannel = existingChannels.find(ch => ch.id === newsletter.id);
                if (!existingChannel) {
                    newCount++;
                }
                
                addDetectedChannel(newsletter.id, {
                    name: newsletter.name,
                    description: newsletter.description,
                    type: 'newsletter',
                    isNewsletter: true,
                    isBroadcast: false,
                    lastSeen: new Date().toISOString()
                });
            }
        } catch (error) {
            console.log('[CHANNEL-DISCOVERY] Newsletter collection not accessible:', error.message);
        }
        
        // Get final count
        const finalChannels = getDetectedChannels();
        console.log(`[CHANNEL-DISCOVERY] Complete: ${newCount} new, ${updatedCount} updated, ${adminCount} admin. Total: ${finalChannels.length} channels`);
        
    } catch (error) {
        console.error('[CHANNEL-DISCOVERY] Error during channel discovery:', error);
    }
}

// Get detected channels by type
function getDetectedChannelsByType(type) {
    const channels = getDetectedChannels();
    return channels.filter(ch => ch.type === type);
}

// API to get sent messages log
app.get('/api/sent-messages', (req, res) => {
    if (!accountPaths || !accountPaths.sentMessagesFile) {
        return res.json([]);
    }
    res.json(readJson(accountPaths.sentMessagesFile, []));
});

// API to add a sent message log (for resend, etc.)
app.post('/api/sent-messages', (req, res) => {
    const entry = req.body;
    if (!entry || !entry.to || !entry.message) return res.status(400).json({ error: 'Invalid log entry' });
    appendSentMessageLog(entry);
    res.json({ success: true });
});

// Automations routes are now in src/routes/automations.js

// Early Contacts API (works before WhatsApp is ready - reads from local JSON)
const CONTACTS_FILE_DEFAULT = path.join(__dirname, 'contacts.json');

function getContactsFilePathEarly() {
    return accountPaths && accountPaths.contactsFile ? accountPaths.contactsFile : CONTACTS_FILE_DEFAULT;
}

// Get contacts from local JSON (fast, no WhatsApp required)
app.get('/api/contacts', (req, res) => {
    try {
        const contactsFilePath = getContactsFilePathEarly();
        let localData = { contacts: [], lastSync: null };
        
        if (fs.existsSync(contactsFilePath)) {
            try {
                localData = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
            } catch (e) {
                console.error('[CONTACTS] Error reading local contacts:', e);
            }
        }
        
        const contacts = localData.contacts || [];
        
        // Extract unique tags
        const allTags = new Set();
        contacts.forEach(c => {
            if (c.tags) {
                c.tags.split(',').forEach(tag => {
                    const trimmed = tag.trim();
                    if (trimmed) allTags.add(trimmed);
                });
            }
        });
        
        res.json({
            contacts: contacts,
            total: contacts.length,
            lastSync: localData.lastSync,
            uniqueTags: Array.from(allTags).sort()
        });
  } catch (err) {
        console.error('[CONTACTS] Failed to fetch contacts:', err);
        res.status(500).json({ error: 'Failed to fetch contacts', details: err.message });
    }
});

// Get unique tags
app.get('/api/contacts/tags', (req, res) => {
    try {
        const contactsFilePath = getContactsFilePathEarly();
        let localData = { contacts: [], lastSync: null };
        
        if (fs.existsSync(contactsFilePath)) {
            try {
                localData = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
            } catch (e) {
                console.error('[CONTACTS] Error reading local contacts:', e);
            }
        }
        
        const allTags = new Set();
        (localData.contacts || []).forEach(c => {
            if (c.tags) {
                c.tags.split(',').forEach(tag => {
                    const trimmed = tag.trim();
                    if (trimmed) allTags.add(trimmed);
                });
            }
        });
        
        res.json({
            tags: Array.from(allTags).sort(),
            total: allTags.size
        });
  } catch (err) {
        console.error('[CONTACTS] Failed to get tags:', err);
        res.status(500).json({ error: 'Failed to get tags', details: err.message });
    }
});

// Update tags for contacts
app.post('/api/contacts/tags', (req, res) => {
    try {
        const { contactIds, tags, action } = req.body;
        
        if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
            return res.status(400).json({ error: 'Contact IDs are required' });
        }
        
        if (tags === undefined) {
            return res.status(400).json({ error: 'Tags are required' });
        }
        
        const contactsFilePath = getContactsFilePathEarly();
        let localData = { contacts: [], lastSync: null };
        
        if (fs.existsSync(contactsFilePath)) {
            try {
                localData = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
            } catch (e) {
                console.error('[CONTACTS] Error reading local contacts:', e);
            }
        }
        
        const contactIdSet = new Set(contactIds);
        let updatedCount = 0;
        
        localData.contacts = (localData.contacts || []).map(contact => {
            if (contactIdSet.has(contact.id)) {
                if (action === 'add') {
                    const existingTags = contact.tags ? contact.tags.split(',').map(t => t.trim()).filter(t => t) : [];
                    const newTags = tags.split(',').map(t => t.trim()).filter(t => t);
                    const combinedTags = [...new Set([...existingTags, ...newTags])];
                    contact.tags = combinedTags.join(', ');
                } else if (action === 'remove') {
                    const existingTags = contact.tags ? contact.tags.split(',').map(t => t.trim()).filter(t => t) : [];
                    const tagsToRemove = new Set(tags.split(',').map(t => t.trim().toLowerCase()));
                    const filteredTags = existingTags.filter(t => !tagsToRemove.has(t.toLowerCase()));
                    contact.tags = filteredTags.join(', ');
                } else {
                    contact.tags = tags;
                }
                contact.lastUpdated = new Date().toISOString();
                updatedCount++;
            }
            return contact;
        });
        
        // Write to file
        fs.writeFileSync(contactsFilePath, JSON.stringify(localData, null, 2));
        
        // Get unique tags for response
        const allTags = new Set();
        localData.contacts.forEach(c => {
            if (c.tags) {
                c.tags.split(',').forEach(tag => {
                    const trimmed = tag.trim();
                    if (trimmed) allTags.add(trimmed);
                });
            }
        });
        
        res.json({
            success: true,
            message: `Updated tags for ${updatedCount} contacts`,
            updatedCount: updatedCount,
            uniqueTags: Array.from(allTags).sort()
        });
    } catch (err) {
        console.error('[CONTACTS] Failed to update tags:', err);
        res.status(500).json({ error: 'Failed to update tags', details: err.message });
    }
});

// Sync contacts from WhatsApp (requires WhatsApp to be ready)
app.post('/api/contacts/sync', async (req, res) => {
    if (!ready) {
        return res.status(503).json({ error: 'WhatsApp client not ready' });
    }
    
    try {
        console.log('[CONTACTS-SYNC] Starting sync from WhatsApp...');
        const waContacts = await client.getContacts();
        console.log(`[CONTACTS-SYNC] Fetched ${waContacts.length} contacts from WhatsApp`);
        
        const contactsFilePath = getContactsFilePathEarly();
        let localData = { contacts: [], lastSync: null };
        
        if (fs.existsSync(contactsFilePath)) {
            try {
                localData = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
            } catch (e) {
                console.error('[CONTACTS-SYNC] Error reading local contacts:', e);
            }
        }
        
        // Create map of existing local contacts to preserve tags
        const localContactsMap = new Map();
        (localData.contacts || []).forEach(c => {
            localContactsMap.set(c.id, c);
        });
        
        // Get IDs of all WhatsApp contacts
        const waContactIds = new Set();
        
        // Process WhatsApp contacts
        const syncedContacts = waContacts
            .filter(contact => {
                return contact.id && 
                       contact.id.user && 
                       contact.id._serialized && 
                       !contact.id._serialized.includes('status@broadcast') &&
                       !contact.id._serialized.includes('@g.us') &&
                       !contact.id._serialized.includes('@newsletter');
            })
            .map(contact => {
                const id = contact.id._serialized;
                waContactIds.add(id);
                
                const existingLocal = localContactsMap.get(id);
                
                return {
                    id: id,
                    number: contact.id.user,
                    name: contact.name || null,
                    pushname: contact.pushname || null,
                    shortName: contact.shortName || null,
                    isMyContact: contact.isMyContact || false,
                    isWAContact: contact.isWAContact || false,
                    isBlocked: contact.isBlocked || false,
                    isBusiness: contact.isBusiness || false,
                    isEnterprise: contact.isEnterprise || false,
                    verified: contact.isVerified || false,
                    tags: existingLocal ? existingLocal.tags || '' : '',
                    notes: existingLocal ? existingLocal.notes || '' : '',
                    firstSeen: existingLocal ? existingLocal.firstSeen : new Date().toISOString(),
                    lastUpdated: new Date().toISOString()
                };
            });
        
        // Count removed contacts
        let removedCount = 0;
        if (localData.contacts) {
            localData.contacts.forEach(c => {
                if (!waContactIds.has(c.id)) {
                    removedCount++;
                }
            });
        }
        
        const newLocalData = {
            contacts: syncedContacts,
            lastSync: new Date().toISOString(),
            totalContacts: syncedContacts.length,
            removedCount: removedCount
        };
        
        fs.writeFileSync(contactsFilePath, JSON.stringify(newLocalData, null, 2));
        
        console.log(`[CONTACTS-SYNC] Sync complete. Total: ${syncedContacts.length}, Removed: ${removedCount}`);
        
        res.json({
            success: true,
            message: `Synced ${syncedContacts.length} contacts`,
            totalContacts: syncedContacts.length,
            removedCount: removedCount,
            lastSync: newLocalData.lastSync
        });
  } catch (err) {
        console.error('[CONTACTS-SYNC] Error syncing contacts:', err);
        res.status(500).json({ error: 'Failed to sync contacts', details: err.message });
  }
});

// API Routes

// Get WhatsApp status and QR code
app.get('/api/status', (req, res) => {
    // Check if the client is still connected
    let connectionStatus = waStatus;
    if (ready && client.pupPage) {
        try {
            // Try to access the page to see if it's still connected
            if (client.pupPage.isClosed()) {
                connectionStatus = 'disconnected';
                console.log('[STATUS] WhatsApp Web page is closed');
            }
        } catch (err) {
            connectionStatus = 'error';
            console.log('[STATUS] Error checking WhatsApp Web connection:', err.message);
        }
    }
    
    // Get user information if available
    let userInfo = null;
    if (ready && currentUserInfo) {
        const userIdentifier = getUserIdentifier();
        if (userIdentifier) {
            const phoneNumber = userIdentifier.id.replace('@c.us', '');
            userInfo = {
                name: currentUserInfo.pushname || 'Unknown',
                number: phoneNumber,
                id: userIdentifier.id
            };
        }
    }
    
    res.json({ 
        status: connectionStatus, 
        qr: connectionStatus === 'qr' ? qrCode : null,
        ready: ready && connectionStatus !== 'disconnected' && connectionStatus !== 'error',
        frameDetached: connectionStatus === 'error' || connectionStatus === 'disconnected',
        cloudflare: cloudflareClient ? cloudflareClient.isConnected : false,
        mode: standaloneMode ? 'standalone' : 'cloudflare',
        user: userInfo,
        features: {
            local: true,
            cloudflare: !standaloneMode && cloudflareClient && cloudflareClient.isConnected,
            webInterface: true,
            bulkMessaging: true,
            automation: true,
            channelManagement: !standaloneMode && cloudflareClient && cloudflareClient.isConnected
        }
    });
});

// Get current logged-in user information
app.get('/api/user-info', (req, res) => {
    if (!ready || !client) {
        return res.status(503).json({
            error: 'WhatsApp client not ready',
            message: 'Please wait for WhatsApp to connect'
        });
    }

    const userInfo = getUserIdentifier();
    if (!userInfo) {
        return res.status(404).json({
            error: 'User information not available',
            message: 'User detection failed or client not properly initialized'
        });
    }

    res.json({
        success: true,
        user: userInfo,
        clientInfo: {
            isReady: client.isReady,
            state: client.getState ? client.getState() : 'unknown',
            hasInfo: !!client.info
        }
    });
});

// Helper function for retrying operations
async function retryOperation(operation, maxRetries = 3, delay = 2000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (err) {
            if (i === maxRetries - 1) throw err;
            console.log(`Operation failed, retrying in ${delay}ms... (${i + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Get all chats (optimized for speed)
app.get('/api/chats', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    try {
        // Use Promise.race to add timeout (10 seconds max)
        const chatsPromise = client.getChats();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Chat loading timeout')), 10000)
        );
        
        const chats = await Promise.race([chatsPromise, timeoutPromise]);
        
        // Map chats efficiently (don't await individual properties)
        const chatsList = Array.isArray(chats) ? chats : Array.from(chats || []);
        res.json(chatsList.map(chat => ({
            id: chat.id?._serialized || chat.id,
            name: chat.name || chat.formattedTitle || chat.id?.user || 'Unknown',
            isGroup: chat.isGroup || false,
            unreadCount: chat.unreadCount || 0,
            timestamp: chat.timestamp || (chat.lastMessage?.timestamp) || 0
        })));
    } catch (err) {
        console.error('[CHATS] Failed to fetch chats:', err.message);
        // Return empty array instead of error to allow UI to load
        res.json([]);
    }
});

// Get messages for a chat
app.get('/api/chats/:id/messages', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    try {
        const chat = await client.getChatById(req.params.id);
        const isGroup = chat.isGroup;
        const msgs = await chat.fetchMessages({ limit: 50 });
        
        // Process messages with sender info for groups
        const result = await Promise.all(msgs.map(async (msg) => {
            const messageData = {
                id: msg.id._serialized || msg.id,
                body: msg.body,
                type: msg.type,
                from: msg.from,
                fromMe: msg.fromMe,
                to: msg.to,
                timestamp: msg.timestamp,
                hasMedia: msg.hasMedia,
                author: msg.author,
                mimetype: msg.mimetype,
                filename: msg.filename,
                size: msg._data?.size || null,
                senderName: null,
                senderNumber: null
            };
            
            // For group messages, get sender contact info
            if (isGroup && msg.author && !msg.fromMe) {
                try {
                    const contact = await client.getContactById(msg.author);
                    if (contact) {
                        messageData.senderName = contact.pushname || contact.name || contact.number || 'Unknown';
                        messageData.senderNumber = contact.number || msg.author.replace('@c.us', '') || null;
                    } else {
                        // Fallback: extract number from author ID
                        messageData.senderNumber = msg.author.replace('@c.us', '');
                        messageData.senderName = messageData.senderNumber;
                    }
                } catch (contactErr) {
                    console.error(`[MESSAGES] Failed to get contact for ${msg.author}:`, contactErr.message);
                    // Fallback: extract number from author ID
                    messageData.senderNumber = msg.author.replace('@c.us', '');
                    messageData.senderName = messageData.senderNumber;
                }
            }
            
            return messageData;
        }));
        
        res.json(result);
    } catch (err) {
        console.error('Failed to fetch messages:', err);
        res.status(500).json({ error: err.message });
    }
});

// Download media from a message
app.get('/api/chats/:chatId/messages/:messageId/media', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    try {
        const chat = await client.getChatById(req.params.chatId);
        const msgs = await chat.fetchMessages({ limit: 100 });
        const msg = msgs.find(m => (m.id._serialized || m.id) === req.params.messageId);
        
        if (!msg) {
            return res.status(404).json({ error: 'Message not found' });
        }
        
        if (!msg.hasMedia) {
            return res.status(400).json({ error: 'Message has no media' });
        }
        
        try {
            const media = await msg.downloadMedia();
            if (!media) {
                return res.status(404).json({ error: 'Media not available' });
            }
            
            // Set appropriate headers
            res.setHeader('Content-Type', media.mimetype || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename="${msg.filename || 'media'}"`);
            
            // Send the media data
            const buffer = Buffer.from(media.data, 'base64');
            res.send(buffer);
        } catch (mediaErr) {
            console.error('Failed to download media:', mediaErr);
            res.status(500).json({ error: 'Failed to download media', details: mediaErr.message });
        }
    } catch (err) {
        console.error('Failed to fetch message media:', err);
        res.status(500).json({ error: err.message });
    }
});

// Media upload route is now in src/routes/media.js

// Get all contacts with pagination
// Contacts routes are now in src/routes/contacts.js

// Get group participants
app.get('/api/chats/:id/participants', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    try {
        const chat = await client.getChatById(req.params.id);
        if (!chat.isGroup) {
            return res.status(400).json({ error: 'Not a group chat' });
        }
        
        const participants = chat.participants;
        const result = participants.map(participant => ({
            id: participant.id._serialized,
            number: participant.id.user,
            name: participant.name || participant.pushname || participant.id.user,
            isAdmin: participant.isAdmin,
            isSuperAdmin: participant.isSuperAdmin,
            isMe: participant.isMe
        }));
        
        res.json({
            participants: result,
            total: result.length,
            groupName: chat.name,
            groupId: chat.id._serialized
        });
    } catch (err) {
        console.error('Failed to fetch group participants:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Channels API ---
// Channels routes are now in src/routes/channels.js

// Get all templates
// Templates routes are now in src/routes/templates.js

// Get sent messages log
app.get('/api/messages/log', (req, res) => {
    if (!accountPaths || !accountPaths.sentMessagesFile) {
        return res.json([]);
    }
    res.json(readJson(accountPaths.sentMessagesFile, []));
});

// Send message (with optional media)
app.post('/api/messages/send', messageUpload.single('media'), async (req, res) => {
    console.log('[MESSAGE-SEND] Request received:', {
        hasFile: !!req.file,
        number: req.body?.number,
        hasMessage: !!req.body?.message,
        mediaPath: req.body?.media_path,
        mediaUrl: req.body?.media_url,
        ready: ready
    });
    
    if (!ready) {
        console.error('[MESSAGE-SEND] WhatsApp client not ready');
        return res.status(503).json({ error: 'WhatsApp not ready' });
    }
    
    if (!client) {
        console.error('[MESSAGE-SEND] WhatsApp client not initialized');
        return res.status(503).json({ error: 'WhatsApp client not initialized' });
    }
    
    const number = req.body?.number;
    const message = req.body?.message || '';
    const mediaPath = req.body?.media_path;
    const mediaUrl = req.body?.media_url;
    
    if (!number) {
        console.error('[MESSAGE-SEND] Missing number in request');
        return res.status(400).json({ error: 'Missing number' });
    }
    
    // Normalize WhatsApp ID
    const normalizedNumber = number.trim();
    const chatId = !normalizedNumber.endsWith('@c.us') && !normalizedNumber.endsWith('@g.us')
        ? normalizedNumber.replace(/[^0-9]/g, '') + '@c.us'
        : normalizedNumber;
    
    console.log('[MESSAGE-SEND] Normalized chatId:', chatId, 'from number:', normalizedNumber);
    
        let mediaInfo = null;
    try {
        if (req.file) {
            console.log('[MESSAGE-SEND] Processing file upload:', {
                filename: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            });
            
            // Validate file type/size
            const allowedTypes = ['image/', 'video/', 'application/pdf'];
            if (!allowedTypes.some(t => req.file.mimetype.startsWith(t))) {
                console.error('[MESSAGE-SEND] Unsupported media type:', req.file.mimetype);
                return res.status(400).json({ error: 'Unsupported media type' });
            }
            if (req.file.size > 100 * 1024 * 1024) {
                console.error('[MESSAGE-SEND] File too large:', req.file.size);
                return res.status(400).json({ error: 'File too large (max 100MB)' });
            }
            
            console.log(`[MESSAGE-SEND] Creating MessageMedia for ${chatId}: ${req.file.originalname} (${req.file.mimetype}, ${req.file.size} bytes)`);
            
            const media = new MessageMedia(
                req.file.mimetype,
                req.file.buffer.toString('base64'),
                req.file.originalname
            );
            
            console.log('[MESSAGE-SEND] Calling client.sendMessage with media...');
            const result = await client.sendMessage(chatId, media, { caption: message });
            console.log('[MESSAGE-SEND] client.sendMessage result:', result ? 'success' : 'null', result?.id?._serialized || 'no id');
            
            mediaInfo = { filename: req.file.originalname, mimetype: req.file.mimetype };
            console.log(`[MESSAGE-SEND] Successfully sent media to ${chatId} (${req.file.originalname})`);
        } else if (mediaPath) {
            console.log('[MESSAGE-SEND] Processing template media from path:', mediaPath);
            
            // Send media from disk (template media)
            const absPath = path.join(__dirname, 'public', mediaPath.replace(/^\//, ''));
            console.log('[MESSAGE-SEND] Resolved absolute path:', absPath);
            
            if (!fs.existsSync(absPath)) {
                console.error('[MESSAGE-SEND] Template media file not found:', absPath);
                return res.status(400).json({ error: 'Template media file not found' });
            }
            
            const buf = fs.readFileSync(absPath);
            const mime = require('mime-types').lookup(absPath) || 'application/octet-stream';
            const media = new MessageMedia(mime, buf.toString('base64'), path.basename(absPath));
            
            console.log('[MESSAGE-SEND] Calling client.sendMessage with template media...');
            const result = await client.sendMessage(chatId, media, { caption: message });
            console.log('[MESSAGE-SEND] client.sendMessage result:', result ? 'success' : 'null', result?.id?._serialized || 'no id');
            
            mediaInfo = { filename: path.basename(absPath), mimetype: mime };
            console.log(`[MESSAGE-SEND] Successfully sent template media to ${chatId} (${mediaPath})`);
        } else if (mediaUrl) {
            // Handle mediaUrl if needed, or remove this block if not implemented
            console.log(`[MESSAGE-SEND] mediaUrl provided: ${mediaUrl}`);
            return res.status(400).json({ error: 'Sending media from URL is not implemented.' });
        } else {
            console.log('[MESSAGE-SEND] Sending text message to', chatId, 'Message length:', message.length);
            console.log('[MESSAGE-SEND] Calling client.sendMessage with text...');
            const result = await client.sendMessage(chatId, message);
            console.log('[MESSAGE-SEND] client.sendMessage result:', result ? 'success' : 'null', result?.id?._serialized || 'no id');
            console.log(`[MESSAGE-SEND] Successfully sent text message to ${chatId}`);
        }
        
        console.log('[MESSAGE-SEND] Appending to sent messages log...');
        appendSentMessageLog({ to: chatId, message, media: mediaInfo, status: 'sent', time: new Date().toISOString() });
        console.log('[MESSAGE-SEND] Request completed successfully');
        res.json({ success: true });
    } catch (err) {
        console.error('[MESSAGE-SEND] Error occurred:', err);
        console.error('[MESSAGE-SEND] Error stack:', err.stack);
        console.error('[MESSAGE-SEND] Error details:', {
            message: err.message,
            name: err.name,
            chatId: chatId,
            hasMessage: !!message,
            hasMedia: !!mediaInfo
        });
        res.status(500).json({ error: err.message, details: err.stack });
    }
});

// Bulk routes are now in src/routes/bulk.js

// Get current server time and timezone
app.get('/api/time', (req, res) => {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    res.json({
        now: now.toLocaleString('en-IN', { timeZone: tz }),
        iso: now.toISOString(),
        timezone: tz
    });
});

// Periodic disk space check and cleanup (every 30 minutes)
setInterval(() => {
    checkDiskSpace();
}, 30 * 60 * 1000); // 30 minutes

// Periodic temp files cleanup (every 6 hours)
setInterval(() => {
    cleanupTempFiles();
}, 6 * 60 * 60 * 1000); // 6 hours

// Initial disk space check on startup
setTimeout(() => {
    checkDiskSpace();
}, 10000); // Check after 10 seconds

// Graceful shutdown handling
process.on('SIGINT', async () => {
    console.log('\n[SHUTDOWN] Received SIGINT, shutting down gracefully...');
    try {
        if (client.pupPage && !client.pupPage.isClosed()) {
            await client.pupPage.close();
        }
        if (client.pupBrowser && !client.pupBrowser.isClosed()) {
            await client.pupBrowser.close();
        }
        console.log('[SHUTDOWN] Browser closed successfully');
    } catch (err) {
        console.error('[SHUTDOWN] Error closing browser:', err.message);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[SHUTDOWN] Received SIGTERM, shutting down gracefully...');
    try {
        if (client.pupPage && !client.pupPage.isClosed()) {
            await client.pupPage.close();
        }
        if (client.pupBrowser && !client.pupBrowser.isClosed()) {
            await client.pupBrowser.close();
        }
        console.log('[SHUTDOWN] Browser closed successfully');
    } catch (err) {
        console.error('[SHUTDOWN] Error closing browser:', err.message);
    }
    process.exit(0);
});

// Check and clean up port before starting
async function startServer() {
  await checkAndKillPort(PORT);
  
  // Start the Express server with error handling
  const server = app.listen(PORT, () => {
    console.log(`WhatsApp Web Control Server running at http://localhost:${PORT}`);
    console.log(`Web Interface: http://localhost:${PORT}`);
    console.log(`API Status: http://localhost:${PORT}/api/status`);
  }).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${PORT} is already in use. Please kill the process using this port or use a different port.`);
    console.error(`[ERROR] To kill the process: kill -9 $(lsof -t -i:${PORT})`);
    process.exit(1);
  } else {
    console.error(`[ERROR] Failed to start server:`, err.message);
    process.exit(1);
  }
  });
  
  // Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});
}

// Start the server
startServer().catch(console.error);

// Get all detected channels (from message stream)
// Detected channels and discovery routes are now in src/routes/channels.js

// Leads routes are now in src/routes/leads.js

// Check if contact exists in WhatsApp
// Contacts routes are now in src/routes/contacts.js

// Test leads API configuration
app.post('/api/test-leads-api', async (req, res) => {
    try {
        const { url, method, headers, body, fieldMapping } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'API URL is required' });
        }
        
        const requestOptions = {
            method: method || 'GET',
            headers: headers || {}
        };
        
        if (method === 'POST' && body) {
            requestOptions.body = JSON.stringify(body);
            if (!requestOptions.headers['Content-Type']) {
                requestOptions.headers['Content-Type'] = 'application/json';
            }
        }
        
        const response = await fetch(url, requestOptions);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // If field mapping is provided, process the data
        let processedData = data;
        if (fieldMapping) {
            processedData = processLeadsDataWithMapping(data, fieldMapping);
        }
        
        res.json({
            success: true,
            data: data,
            processedData: processedData
        });
    } catch (err) {
        console.error('API test error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to test API', 
            details: err.message 
        });
    }
});

// Process leads data with field mapping
function processLeadsDataWithMapping(data, fieldMapping) {
    if (!Array.isArray(data)) {
        return data;
    }
    
    return data.map(item => ({
        name: item[fieldMapping.name] || '',
        email: item[fieldMapping.email] || '',
        mobile: item[fieldMapping.mobile] || '',
        inquiry: item[fieldMapping.inquiry] || '',
        source_url: item[fieldMapping.source_url] || '',
        created_on: item[fieldMapping.created_on] || new Date().toISOString(),
        Type: item[fieldMapping.Type] || 'Inquiry',
        additional_details: item[fieldMapping.additional_details] || {}
    }));
}

// Leads config routes are now in src/routes/leads.js
// Media upload routes are now in src/routes/media.js

// Simple cloud status endpoint for frontend (returns baseUrl for channel links)
app.get('/api/cloud/status', (req, res) => {
    const baseUrl = process.env.CLOUDFLARE_BASE_URL || null;
        res.json({
        available: !!cloudflareClient,
        baseUrl: baseUrl,
        connected: cloudflareClient ? cloudflareClient.isConnected : false
    });
});

// Cloudflare API endpoints for external apps
app.get('/api/cloudflare/status', async (req, res) => {
    if (!cloudflareClient) {
        return res.status(503).json({ 
            error: 'Cloudflare sync not available',
            message: 'Cloudflare integration is not configured or not connected',
            available: false,
            baseUrl: process.env.CLOUDFLARE_BASE_URL || null
        });
    }
    
    try {
        const status = await cloudflareClient.getStatus();
        res.json({ 
            success: true, 
            status, 
            available: true,
            baseUrl: process.env.CLOUDFLARE_BASE_URL || null
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Cloudflare sync temporarily unavailable',
            message: 'Unable to connect to Cloudflare sync service',
            available: false,
            baseUrl: process.env.CLOUDFLARE_BASE_URL || null
        });
    }
});

app.get('/api/cloudflare/chats', async (req, res) => {
    if (!cloudflareClient) {
        return res.status(503).json({ 
            error: 'Cloudflare sync not available',
            message: 'Cloudflare integration is not configured or not connected',
            data: [],
            count: 0,
            available: false
        });
    }
    
    try {
        const result = await cloudflareClient.makeRequest('/api/chats');
        res.json({ ...result, available: true });
    } catch (error) {
        res.status(500).json({ 
            error: 'Cloudflare sync temporarily unavailable',
            message: 'Unable to retrieve chats from Cloudflare sync service',
            data: [],
            count: 0,
            available: false
        });
    }
});

// Contact endpoints are handled individually via /api/contact/:contactId

// On-demand endpoint to get today's messages for a specific channel
app.post('/api/channel/:channelId/messages-today', async (req, res) => {
    const { channelId } = req.params;
    const internalRequest = req.headers['x-internal-request'] === 'cloudflare-worker';
    
    if (!internalRequest) {
        return res.status(403).json({
            error: 'This endpoint is for internal use only',
            message: 'Access denied'
        });
    }

    if (!ready || !client) {
        return res.status(503).json({
            error: 'WhatsApp client not ready',
            message: 'WhatsApp client is not connected or ready'
        });
    }

    try {
        console.log(`[ON-DEMAND] Fetching today's messages for channel: ${channelId}`);
        
        // Get today's timestamp
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = today.getTime() / 1000;

        // Get the chat and its messages
        const chat = await client.getChatById(channelId);
        const messages = await chat.fetchMessages({ limit: 100 }); // Fetch last 100 messages
        
        // Filter only today's messages and format them
        const todayMessages = messages
            .filter(msg => msg.timestamp >= todayTimestamp)
            .map(msg => ({
                id: msg.id._serialized || msg.id,
                chatId: channelId,
                body: msg.body || '',
                timestamp: msg.timestamp,
                type: msg.type || 'text',
                author: msg.author || channelId,
                isChannelMessage: true,
                channelType: channelId.endsWith('@newsletter') ? 'newsletter' : 
                            (channelId === 'status@broadcast' ? 'broadcast' : 'channel')
            }))
            .sort((a, b) => b.timestamp - a.timestamp); // Latest first

        console.log(`[ON-DEMAND] Found ${todayMessages.length} messages for today in channel: ${channelId}`);

        res.json({
            success: true,
            channelId: channelId,
            channelName: chat.name || channelId,
            messages: todayMessages,
            count: todayMessages.length,
            fetchTime: new Date().toISOString()
        });

    } catch (error) {
        console.error(`[ON-DEMAND] Error fetching messages for channel ${channelId}:`, error);
        res.status(500).json({
            error: 'Failed to fetch channel messages',
            message: error.message,
            channelId: channelId
        });
    }
});

// Manual sync endpoint for specific channel messages
app.post('/api/channel/:channelId/sync-messages', async (req, res) => {
    const { channelId } = req.params;

    if (!ready || !client) {
        return res.status(503).json({
            error: 'WhatsApp client not ready',
            message: 'WhatsApp client is not connected or ready'
        });
    }

    if (!cloudflareClient || !cloudflareClient.isConnected) {
        return res.status(503).json({
            error: 'Cloudflare client not available',
            message: 'Cloudflare sync is not enabled or connected'
        });
    }

    try {
        console.log(`[MANUAL-SYNC] Syncing messages for channel: ${channelId}`);
        
        // Get today's timestamp
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = today.getTime() / 1000;

        // Get the chat and its messages
        const chat = await client.getChatById(channelId);
        const messages = await chat.fetchMessages({ limit: 100 }); // Fetch last 100 messages
        
        // Filter only today's messages and format them
        const todayMessages = messages
            .filter(msg => msg.timestamp >= todayTimestamp)
            .map(msg => ({
                id: msg.id._serialized || msg.id,
                chatId: channelId,
                body: msg.body || '',
                timestamp: msg.timestamp,
                type: msg.type || 'text',
                author: msg.author || channelId,
                isChannelMessage: true,
                channelType: channelId.endsWith('@newsletter') ? 'newsletter' : 
                            (channelId === 'status@broadcast' ? 'broadcast' : 'channel')
            }))
            .sort((a, b) => b.timestamp - a.timestamp); // Latest first

        // Get channel information
        const channelInfo = {
            id: channelId,
            name: chat.name || channelId,
            type: todayMessages.length > 0 ? todayMessages[0].channelType : 'channel',
            lastMessage: todayMessages.length > 0 ? todayMessages[0].body.substring(0, 100) : '',
            lastSeen: new Date().toISOString()
        };

        // Sync to Cloudflare
        await cloudflareClient.syncAllData({
            chats: [],
            contacts: [],
            messages: [],
            channels: [channelInfo],
            channelMessages: todayMessages
        });

        console.log(`[MANUAL-SYNC] Successfully synced ${todayMessages.length} messages for channel: ${channelId}`);

        res.json({
            success: true,
            channelId: channelId,
            channelName: channelInfo.name,
            messagesSynced: todayMessages.length,
            syncTime: new Date().toISOString(),
            webpageUrl: `${process.env.CLOUDFLARE_BASE_URL || 'https://your-worker-url.workers.dev'}/channel/${encodeChannelIdForUrl(channelId)}`
        });

    } catch (error) {
        console.error(`[MANUAL-SYNC] Error syncing messages for channel ${channelId}:`, error);
        res.status(500).json({
            error: 'Failed to sync channel messages',
            message: error.message,
            channelId: channelId
        });
    }
});

// Web-based sync endpoint (for webpage integration)
app.post('/api/channel/:channelId/sync-web', async (req, res) => {
    const { channelId } = req.params;
    
    // Set CORS headers for web requests
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (!ready || !client) {
        return res.status(503).json({
            error: 'WhatsApp client not ready',
            message: 'Please wait for WhatsApp to connect'
        });
    }
    
    if (!cloudflareClient || !cloudflareClient.isConnected) {
        return res.status(503).json({
            error: 'Cloudflare not connected',
            message: 'Cloudflare sync is not available'
        });
    }
    
    try {
        console.log(`[WEB-SYNC] Syncing messages for channel: ${channelId}`);
        
        // Get today's timestamp
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTimestamp = today.getTime() / 1000;
        
        // Get the chat and its messages
        const chat = await client.getChatById(channelId);
        const messages = await chat.fetchMessages({ limit: 100 });
        
        // Filter only today's messages and format them
        const todayMessages = messages
            .filter(msg => msg.timestamp >= todayTimestamp)
            .map(msg => ({
                id: msg.id._serialized || msg.id,
                chatId: channelId,
                body: msg.body || '',
                timestamp: msg.timestamp,
                type: msg.type || 'text',
                author: msg.author || channelId,
                isChannelMessage: true,
                channelType: channelId.endsWith('@newsletter') ? 'newsletter' : 
                            (channelId === 'status@broadcast' ? 'broadcast' : 'channel')
            }))
            .sort((a, b) => b.timestamp - a.timestamp);
        
        // Get channel information
        const channelInfo = {
            id: channelId,
            name: chat.name || channelId,
            type: todayMessages.length > 0 ? todayMessages[0].channelType : 'channel',
            lastMessage: todayMessages.length > 0 ? todayMessages[0].body.substring(0, 100) : '',
            lastSeen: new Date().toISOString()
        };
        
        // Sync to Cloudflare
        await cloudflareClient.syncAllData({
            chats: [],
            contacts: [],
            messages: [],
            channels: [channelInfo],
            channelMessages: todayMessages
        });
        
        console.log(`[WEB-SYNC] Successfully synced ${todayMessages.length} messages for ${channelInfo.name}`);
        
        res.json({
            success: true,
            channelId: channelId,
            channelName: channelInfo.name,
            messagesSynced: todayMessages.length,
            syncTime: new Date().toISOString(),
            webpageUrl: `${process.env.CLOUDFLARE_BASE_URL || 'https://your-worker-url.workers.dev'}/channel/${encodeChannelIdForUrl(channelId)}`
        });
        
    } catch (error) {
        console.error(`[WEB-SYNC] Error syncing channel ${channelId}:`, error);
        res.status(500).json({
            error: 'Failed to sync channel messages',
            message: error.message,
            channelId: channelId
        });
    }
});

// Encode channel ID for URL but preserve @ symbol (Cloudflare worker expects @ not %40)
function encodeChannelIdForUrl(channelId) {
    // Replace @ with a placeholder, encode, then replace back
    return encodeURIComponent(channelId.replace(/@/g, '__AT__')).replace(/__AT__/g, '@');
}

// Test endpoint to populate channel data for demo
app.post('/api/test/populate-channel', async (req, res) => {
    if (!cloudflareClient || !cloudflareClient.isConnected) {
        return res.status(503).json({
            error: 'Cloudflare client not available',
            message: 'Cloudflare sync is not enabled or connected'
        });
    }

    try {
        const testChannelId = '120363422190491695@newsletter';
        const testChannelInfo = {
            id: testChannelId,
            name: 'Test WhatsApp Channel',
            type: 'newsletter',
            lastMessage: 'Welcome to our test channel!',
            lastSeen: new Date().toISOString()
        };

        const testMessages = [
            {
                id: 'msg_test_1',
                chatId: testChannelId,
                body: '🎉 Welcome to our WhatsApp Channel! This is a test message to showcase the beautiful message display.',
                timestamp: Date.now() / 1000,
                type: 'text',
                author: 'Channel Admin',
                isChannelMessage: true,
                channelType: 'newsletter'
            },
            {
                id: 'msg_test_2',
                chatId: testChannelId,
                body: '📱 This webpage automatically refreshes every 30 seconds to show new messages. The design is responsive and looks great on both mobile and desktop!',
                timestamp: (Date.now() - 300000) / 1000, // 5 minutes ago
                type: 'text',
                author: 'Channel Admin',
                isChannelMessage: true,
                channelType: 'newsletter'
            },
            {
                id: 'msg_test_3',
                chatId: testChannelId,
                body: '🚀 Messages are displayed in beautiful cards with hover effects and animations. Try hovering over the cards on desktop!',
                timestamp: (Date.now() - 600000) / 1000, // 10 minutes ago
                type: 'text',
                author: 'Channel Admin',
                isChannelMessage: true,
                channelType: 'newsletter'
            }
        ];

        await cloudflareClient.syncAllData({
            chats: [],
            contacts: [],
            messages: [],
            channels: [testChannelInfo],
            channelMessages: testMessages
        });

        res.json({
            success: true,
            message: 'Test channel data populated successfully',
            channelId: testChannelId,
            channelName: testChannelInfo.name,
            messagesAdded: testMessages.length,
            webpageUrl: `${process.env.CLOUDFLARE_BASE_URL || 'https://your-worker-url.workers.dev'}/channel/${encodeChannelIdForUrl(testChannelId)}`
        });
    } catch (error) {
        console.error('[TEST] Error populating channel data:', error);
        res.status(500).json({
            error: 'Failed to populate test data',
            message: error.message
        });
    }
});

// Individual contact lookup endpoint - more efficient than bulk sync
app.get('/api/contact/:contactId', async (req, res) => {
    const { contactId } = req.params;
    
    if (!contactId) {
        return res.status(400).json({
            error: 'Contact ID required',
            message: 'Please provide a contact ID to lookup',
            data: null,
            found: false
        });
    }
    
    try {
        // Use the same comprehensive ready check as sync
        const isClientReady = client && (
            client.state === 'CONNECTED' || 
            client.state === 'READY' || 
            client.isReady === true ||
            (client.info && client.info.me)
        );
        
        if (!isClientReady) {
            return res.status(503).json({
                error: 'WhatsApp client not ready',
                message: 'WhatsApp client is not connected',
                data: null,
                found: false
            });
        }
        
        // Try to get specific contact from WhatsApp
        const contact = await client.getContactById(contactId);
        
        if (contact) {
            const contactData = {
                id: contact.id._serialized || contact.id,
                name: contact.name || contact.pushname || 'Unknown',
                number: contact.number || '',
                isMyContact: contact.isMyContact || false,
                isWAContact: contact.isWAContact || false,
                profilePictureUrl: contact.profilePictureUrl || null,
                lastSync: new Date().toISOString()
            };
            
            // Optionally sync this single contact to Cloudflare
            if (cloudflareClient && cloudflareClient.isConnected) {
                try {
                    await cloudflareClient.syncAllData({ 
                        chats: [], 
                        contacts: [contactData],
                        messages: [] 
                    });
                    console.log(`[CLOUDFLARE] Synced individual contact: ${contactId}`);
                } catch (syncError) {
                    console.log(`[CLOUDFLARE] Failed to sync contact ${contactId}:`, syncError.message);
                }
            }
            
            res.json({
                success: true,
                data: contactData,
                found: true,
                message: 'Contact found and retrieved'
            });
        } else {
            res.json({
                success: true,
                data: null,
                found: false,
                message: 'Contact not found'
            });
        }
    } catch (error) {
        console.error('[CONTACT] Lookup error:', error);
        res.status(500).json({
            error: 'Contact lookup failed',
            message: error.message,
            data: null,
            found: false
        });
    }
});

app.get('/api/cloudflare/messages', async (req, res) => {
    if (!cloudflareClient) {
        return res.status(503).json({ 
            error: 'Cloudflare sync not available',
            message: 'Cloudflare integration is not configured or not connected',
            data: [],
            count: 0,
            available: false
        });
    }
    
    const { chatId, limit } = req.query;
    if (!chatId) {
        return res.status(400).json({ error: 'chatId parameter required' });
    }
    
    try {
        const result = await cloudflareClient.makeRequest(`/api/messages?chatId=${chatId}&limit=${limit || 50}`);
        res.json({ ...result, available: true });
    } catch (error) {
        res.status(500).json({ 
            error: 'Cloudflare sync temporarily unavailable',
            message: 'Unable to retrieve messages from Cloudflare sync service',
            data: [],
            count: 0,
            available: false
        });
    }
});

app.post('/api/cloudflare/messages/queue', async (req, res) => {
    if (!cloudflareClient) {
        return res.status(503).json({ 
            error: 'Cloudflare sync not available',
            message: 'Cloudflare integration is not configured or not connected',
            success: false,
            available: false
        });
    }
    
    const { to, message, media, priority, contactName, name } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: 'to and message are required' });
    }
    
    // Extract contact name from request (support both contactName and name fields)
    const finalContactName = contactName || name || to;
    
    // Get current user info for user-specific queuing
    const userInfo = getUserIdentifier();
    const userId = userInfo ? userInfo.id : null;
    
    try {
        // Send user information along with the message for proper user registration
        const result = await cloudflareClient.queueMessage(to, message, media, priority, userId, finalContactName);
        res.json({ ...result, available: true, from: userId, contactName: finalContactName });
    } catch (error) {
        res.status(500).json({ 
            error: 'Cloudflare sync temporarily unavailable',
            message: 'Unable to queue message in Cloudflare sync service',
            success: false,
            available: false
        });
    }
});

// Manual sync trigger endpoint
app.post('/api/cloudflare/sync', async (req, res) => {
    if (!cloudflareClient) {
        return res.status(503).json({ 
            error: 'Cloudflare sync not available',
            message: 'Cloudflare integration is not configured or not connected',
            success: false,
            available: false
        });
    }
    
    try {
        const { force } = req.body;
        
        if (force) {
            console.log('[CLOUDFLARE] Manual FULL sync triggered (force=true)');
            // Reset sync state to force full sync
            lastSyncState.chatIds.clear();
            lastSyncState.contactIds.clear();
            lastSyncState.lastSyncTime = null;
        } else {
            console.log('[CLOUDFLARE] Manual incremental sync triggered');
        }
        
        await syncWhatsAppDataToCloudflare();
        res.json({ 
            success: true, 
            message: force ? 'Manual full sync completed' : 'Manual incremental sync completed',
            available: true 
        });
    } catch (error) {
        console.error('[CLOUDFLARE] Manual sync error:', error);
        res.status(500).json({ 
            error: 'Manual sync failed',
            message: error.message,
            success: false,
            available: false
        });
    }
});

// Manual queue processing endpoint
app.post('/api/cloudflare/process-queue', async (req, res) => {
    if (!cloudflareClient) {
        return res.status(503).json({ 
            error: 'Cloudflare sync not available',
            message: 'Cloudflare integration is not configured or not connected',
            success: false,
            available: false
        });
    }
    
    try {
        console.log('[MANUAL] Processing queued messages...');
        await processQueuedMessages();
        res.json({ 
            success: true, 
            message: 'Manual queue processing completed',
            available: true
        });
    } catch (error) {
        console.error('[CLOUDFLARE] Manual queue processing error:', error);
        res.status(500).json({ 
            error: 'Manual queue processing failed',
            message: error.message,
            success: false,
            available: false
        });
    }
});

// Setup backup routes (pass ready as getter function)
// Setup backup routes - will be set up when account is initialized
let backupRoutesSetup = false;
function setupBackupRoutesForAccount() {
    if (backupRoutesSetup) {
        console.log('[BACKUP] Routes already setup, skipping duplicate setup');
        return;
    }
    try {
        // Setup backup routes (only if account paths are available)
        if (accountPaths) {
            setupBackupRoutes(
                app, 
                client, 
                () => ready, 
                accountPaths.backupsDir, 
                accountPaths.backupListFile, 
                readJson, 
                writeJson, 
                accountPaths.detectedChannelsFile
            );
            const currentAccountNumber = accountPathsModule.getCurrentAccountNumber();
            console.log('[BACKUP] Backup routes setup for account:', currentAccountNumber);
        } else {
            console.log('[BACKUP] Account paths not initialized, backup routes will use default paths');
        }
        
        const currentAccountNumber = accountPaths ? accountPathsModule.getCurrentAccountNumber() : 'default';
        
        // Setup templates routes (always, with fallback to default paths)
        setupTemplatesRoutes(app, {
            readJson,
            writeJson,
            getAccountPaths: () => accountPaths,
            TEMPLATES_FILE,
            templateUpload
        });
        console.log('[TEMPLATES] Templates routes setup for account:', currentAccountNumber);
        
        // Setup leads routes (always, with fallback to default paths)
        setupLeadsRoutes(app, {
            readJson,
            writeJson,
            getAccountPaths: () => accountPaths,
            LEADS_FILE,
            LEADS_CONFIG_FILE,
            client,
            getReady: () => ready,
            callGenAI
        });
        console.log('[LEADS] Leads routes setup for account:', currentAccountNumber);
        
        // Setup contacts routes (always available)
        setupContactsRoutes(app, {
            client,
            getReady: () => ready,
            readJson,
            writeJson,
            getAccountPaths: () => accountPaths
        });
        console.log('[CONTACTS] Contacts routes setup for account:', currentAccountNumber);
        
        // Setup automations routes (always, with fallback to default paths)
        setupAutomationRoutes(app, {
            readJson,
            writeJson,
            getAccountPaths: () => accountPaths,
            AUTOMATIONS_FILE,
            client,
            getReady: () => ready,
            callGenAI,
            readAutomations,
            writeAutomations,
            appendAutomationLog
        });
        console.log('[AUTOMATIONS] Automations routes setup for account:', currentAccountNumber);
        
        // Setup channels routes (always, with fallback to default paths)
        setupChannelsRoutes(app, {
            client,
            getReady: () => ready,
            readJson,
            getAccountPaths: () => accountPaths,
            DETECTED_CHANNELS_FILE,
            messageUpload,
            appendSentMessageLog,
            addDetectedChannel,
            getDetectedChannels,
            discoverChannels
        });
        console.log('[CHANNELS] Channels routes setup for account:', currentAccountNumber);
        
        // Setup bulk routes (always, with fallback to default paths)
        setupBulkRoutes(app, {
            readJson,
            writeJson,
            getAccountPaths: () => accountPaths,
            BULK_FILE,
            client,
            getReady: () => ready,
            csvUpload,
            retryOperation
        });
        console.log('[BULK] Bulk routes setup for account:', currentAccountNumber);
        
        // Setup media routes (always available)
        setupMediaRoutes(app, {
            upload
        });
        console.log('[MEDIA] Media routes setup for account:', currentAccountNumber);
        
        backupRoutesSetup = true;
    } catch (error) {
        console.error('[BACKUP] Error setting up routes:', error);
    }
}

// Don't setup backup routes initially - wait for account to be initialized
// setupBackupRoutesForAccount will be called after account login in the 'ready' event

// Error handling middleware for multer errors
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        console.error('Multer error:', error);
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ 
                error: 'File too large', 
                details: 'File size exceeds the 50MB limit' 
            });
        }
        if (error.code === 'LIMIT_FIELD_SIZE') {
            return res.status(413).json({ 
                error: 'Field too large', 
                details: 'Field size exceeds the 50MB limit' 
            });
        }
        return res.status(400).json({ 
            error: 'File upload error', 
            details: error.message 
        });
    }
    
    if (error.name === 'PayloadTooLargeError') {
        console.error('Payload too large error:', error);
        return res.status(413).json({ 
            error: 'Request too large', 
            details: 'Request payload exceeds the 50MB limit' 
        });
    }
    
    next(error);
});

// General error handling middleware (should be last)
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    
    // Don't leak error details in production
    const errorMessage = process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : error.message;
    
    res.status(500).json({
        error: 'Internal server error',
        message: errorMessage,
        ...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
    });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

