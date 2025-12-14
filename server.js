const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const multer = require('multer');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const CloudflareClient = require('./cloudflare-client.js');
const TEMPLATES_FILE = path.join(__dirname, 'templates.json');
const BULK_FILE = path.join(__dirname, 'bulk_messages.json');
const SENT_MESSAGES_FILE = path.join(__dirname, 'sent_messages.json');
const DETECTED_CHANNELS_FILE = path.join(__dirname, 'detected_channels.json');
const LEADS_FILE = path.join(__dirname, 'leads.json');
const LEADS_CONFIG_FILE = path.join(__dirname, 'leads-config.json');
const CLOUDFLARE_LOGS_FILE = path.join(__dirname, 'cloudflare_logs.json');
const CLOUDFLARE_MESSAGES_FILE = path.join(__dirname, 'cloudflare_messages.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const BACKUP_LIST_FILE = path.join(__dirname, 'backup_list.json');
const { setupBackupRoutes } = require('./backup.js');
const fetch = require('node-fetch'); // Add at the top with other requires
const TEMPLATE_MEDIA_DIR = path.join(__dirname, 'public', 'message-templates');
if (!fs.existsSync(TEMPLATE_MEDIA_DIR)) fs.mkdirSync(TEMPLATE_MEDIA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
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
    try {
        let logs = [];
        let currentLogFile = CLOUDFLARE_LOGS_FILE;
        let fileIndex = 0;

        // Find the current log file (handle rotation)
        while (fs.existsSync(currentLogFile)) {
            const stats = fs.statSync(currentLogFile);
            if (stats.size < CLOUDFLARE_LOG_MAX_SIZE) {
                break;
            }
            fileIndex++;
            const baseName = CLOUDFLARE_LOGS_FILE.replace('.json', '');
            currentLogFile = path.join(__dirname, `${path.basename(baseName)}_${fileIndex}.json`);
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
    try {
        let messages = [];
        let currentMessageFile = CLOUDFLARE_MESSAGES_FILE;
        let fileIndex = 0;

        // Find the current message file (handle rotation)
        while (fs.existsSync(currentMessageFile)) {
            const stats = fs.statSync(currentMessageFile);
            if (stats.size < CLOUDFLARE_LOG_MAX_SIZE) {
                break;
            }
            fileIndex++;
            const baseName = CLOUDFLARE_MESSAGES_FILE.replace('.json', '');
            currentMessageFile = path.join(__dirname, `${path.basename(baseName)}_${fileIndex}.json`);
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

// Ensure contact exists before sending message
async function ensureContactExists(chatId, contactName) {
  if (!client || !ready) {
    console.log('[CONTACT-CHECK] WhatsApp client not ready, skipping contact check');
    return;
  }

  try {
    // Check if contact already exists
    const existingContact = await client.getContactById(chatId);
    
    if (existingContact) {
      console.log(`[CONTACT-CHECK] Contact already exists: ${contactName} (${chatId})`);
      return;
    }
    
    // Contact doesn't exist, create it
    console.log(`[CONTACT-CHECK] Contact not found, creating: ${contactName} (${chatId})`);
    
    // Extract phone number from chatId (remove @c.us suffix)
    const phoneNumber = chatId.replace('@c.us', '');
    
    // Create contact using WhatsApp's contact creation method
    // v1.34.2+ fix: firstName must never be empty, use number as fallback if needed
    const firstName = contactName && contactName.trim() ? contactName.trim() : phoneNumber;
    await client.saveOrEditAddressbookContact(phoneNumber, firstName, '', true); // syncToAddressbook = true (as per wwebjs docs)
    
    console.log(`[CONTACT-CHECK] Successfully created contact: ${contactName} (${chatId})`);
    
  } catch (error) {
    console.error(`[CONTACT-CHECK] Error ensuring contact exists for ${chatId}:`, error.message);
    // Don't throw error - continue with message sending even if contact creation fails
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

// Initialize required JSON files with proper structure
function initializeJsonFiles() {
    console.log('[INIT] Checking and initializing required JSON files...');
    
    const filesToInitialize = [
        {
            path: TEMPLATES_FILE,
            defaultContent: []
        },
        {
            path: BULK_FILE,
            defaultContent: []
        },
        {
            path: SENT_MESSAGES_FILE,
            defaultContent: []
        },
        {
            path: AUTOMATIONS_FILE,
            defaultContent: []
        },
        {
            path: DETECTED_CHANNELS_FILE,
            defaultContent: []
        },
        {
            path: LEADS_FILE,
            defaultContent: { leads: [] }
        },
        {
            path: LEADS_CONFIG_FILE,
            defaultContent: {
                enabled: false,
                systemPrompt: '',
                includeJsonContext: true,
                autoReply: false,
                autoReplyPrompt: ''
            }
        },
        {
            path: CLOUDFLARE_LOGS_FILE,
            defaultContent: []
        },
        {
            path: CLOUDFLARE_MESSAGES_FILE,
            defaultContent: []
        }
    ];
    
    filesToInitialize.forEach(file => {
        try {
            if (!fs.existsSync(file.path)) {
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

// Initialize JSON files on startup
initializeJsonFiles();
const genAI = new GoogleGenAI({});
const groundingTool = { googleSearch: {} };
const genAIConfig = { tools: [groundingTool], maxOutputTokens: 512 };

/**
 * Step 2: Parse the response from step 1 into structured JSON format
 * Uses gemini-2.5-flash-lite model without tools to reduce cost
 */
async function parseResponseToJson(step1Response) {
  const jsonSchema = {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The clean message text to send to WhatsApp, without any commentary, notes, or explanations'
      },
      hasNewMessage: {
        type: 'boolean',
        description: 'true if there is a unique new message to send, false if no new content or duplicate'
      },
      notes: {
        type: 'string',
        description: 'Optional internal notes or commentary (not to be sent)'
      }
    },
    required: ['message', 'hasNewMessage']
  };

  const sampleJson = {
    message: "Hello! This is a sample message that will be sent to WhatsApp.",
    hasNewMessage: true,
    notes: "Optional notes about the message generation"
  };

  const parsePrompt = `You are a JSON parser. Your task is to analyze the following AI-generated response and extract/format it into a structured JSON object.

AI Response to parse:
${step1Response}

JSON Schema:
${JSON.stringify(jsonSchema, null, 2)}

Example JSON format:
${JSON.stringify(sampleJson, null, 2)}

Instructions:
1. Extract the main message content that should be sent to WhatsApp and put it in the "message" field
2. Determine if there is a unique new message to send (hasNewMessage: true) or if it's a duplicate/no new content (hasNewMessage: false)
3. Put any commentary, explanations, or notes in the "notes" field (not in the message field)
4. The "message" field must contain ONLY the clean text to be sent, with no commentary or explanations
5. Return ONLY a valid JSON object matching the schema above, no other text

IMPORTANT: Respond with ONLY the JSON object, no markdown, no code blocks, just the raw JSON.`;

  try {
    const config = {
      responseMimeType: 'application/json',
      maxOutputTokens: 512
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
    return {
      message: parsed.message || step1Response,
      hasNewMessage: parsed.hasNewMessage !== false, // Default to true if not specified
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
        // Step 2 failed, fall back to step 1 response
        console.log('[GenAI] Step 2 failed, falling back to step 1 response');
        return {
          message: responseText,
          hasNewMessage: true,
          notes: 'Step 2 JSON parsing failed, using raw response from step 1'
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
  try {
    // Ensure entry has timestamp
    if (!entry.timestamp) {
      entry.timestamp = new Date().toISOString();
    }
    
    // Get current log file path
    let logPath = path.join(__dirname, automation.logFile);
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
          nextLogPath = path.join(__dirname, `${baseName}_${nextIndex}.json`);
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
  if (!fs.existsSync(AUTOMATIONS_FILE)) return [];
  return JSON.parse(fs.readFileSync(AUTOMATIONS_FILE, 'utf8'));
}
function writeAutomations(data) {
  fs.writeFileSync(AUTOMATIONS_FILE, JSON.stringify(data, null, 2));
}

function readJson(file, fallback = []) {
    try {
        if (!fs.existsSync(file)) {
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
        const stats = fs.statSync(__dirname);
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
    try {
        const files = fs.readdirSync(__dirname);
        const logFiles = files.filter(file => 
            file.startsWith('automation_log_') && file.endsWith('.json')
        );
        
        // Sort by modification time (oldest first)
        logFiles.sort((a, b) => {
            const statA = fs.statSync(path.join(__dirname, a));
            const statB = fs.statSync(path.join(__dirname, b));
            return statA.mtime.getTime() - statB.mtime.getTime();
        });
        
        // Keep only the 10 most recent log files
        const filesToDelete = logFiles.slice(0, -10);
        
        filesToDelete.forEach(file => {
            try {
                fs.unlinkSync(path.join(__dirname, file));
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
        const tempDir = path.join(__dirname, 'temp');
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
        const leadsData = readJson(LEADS_FILE, { leads: [] });
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
        const config = readJson(LEADS_CONFIG_FILE, {
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
        const leadsData = readJson(LEADS_FILE, { leads: [] });
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
        writeJson(LEADS_FILE, leadsData);
        
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
    let records = readJson(BULK_FILE);
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
                    writeJson(BULK_FILE, records);
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
                    writeJson(BULK_FILE, records);
                    continue; // Skip to next message
                }
                }
            }
            
            // Use retry mechanism for sending messages
            await retryOperation(async () => {
                if (r.media) {
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
                            console.error(`Media file not found: ${absPath} (original path: ${r.media})`);
                            throw new Error(`Media file not found: ${r.media}`);
                        }
                        
                        const buf = fs.readFileSync(absPath);
                        const mime = require('mime-types').lookup(absPath) || 'application/octet-stream';
                        media = new MessageMedia(mime, buf.toString('base64'), path.basename(absPath));
                    }
                    await client.sendMessage(chatId, media, { caption: r.message });
                } else {
                    await client.sendMessage(chatId, r.message);
                }
            }, 3, 2000); // 3 retries with 2 second delay
            
            records[i].status = 'sent';
            records[i].sent_datetime = new Date().toISOString();
            changed = true;
            writeJson(BULK_FILE, records);
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
            writeJson(BULK_FILE, records);
        }
    }
    if (changed) writeJson(BULK_FILE, records);
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
    try {
        const logs = readJson(SENT_MESSAGES_FILE);
        logs.unshift({ ...entry, time: new Date().toISOString() });
        
        // Keep only last 1000 sent messages to prevent disk space issues
        if (logs.length > 1000) {
            logs.splice(1000);
        }
        
        const writeSuccess = writeJson(SENT_MESSAGES_FILE, logs);
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
        let channels = readJson(DETECTED_CHANNELS_FILE);
        // Check if channel already exists
        const existingIndex = channels.findIndex(ch => ch.id === channelId);
        const now = new Date().toISOString();
        if (existingIndex !== -1) {
            // Update existing channel
            channels[existingIndex] = {
                ...channels[existingIndex],
                ...channelInfo,
                lastSeen: now,
                messageCount: (channels[existingIndex].messageCount || 0) + 1
            };
        } else {
            // Add new channel
            channels.push({
                id: channelId,
                name: channelInfo.name || channelId,
                type: channelInfo.type || 'unknown',
                isNewsletter: channelId.endsWith('@newsletter'),
                isBroadcast: channelId === 'status@broadcast',
                firstSeen: now,
                lastSeen: now,
                messageCount: 1,
                ...channelInfo
            });
        }
        // Keep only the latest 1000 channels
        if (channels.length > 1000) {
            channels = channels.slice(-1000);
        }
        
        const writeSuccess = writeJson(DETECTED_CHANNELS_FILE, channels);
        if (writeSuccess) {
            console.log(`[CHANNEL] Added/Updated detected channel: ${channelId}`);
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
    return readJson(DETECTED_CHANNELS_FILE);
}

// Proactive channel discovery function
async function discoverChannels() {
    if (!ready) return;
    
    try {
        console.log('[CHANNEL-DISCOVERY] Starting proactive channel discovery...');
        
        // Method 1: Get followed channels
        const chats = await client.getChats();
        const followedChannels = chats.filter(chat => chat.isChannel);
        
        for (const channel of followedChannels) {
            addDetectedChannel(channel.id._serialized, {
                name: channel.name,
                type: 'followed',
                isNewsletter: channel.id._serialized.endsWith('@newsletter'),
                isBroadcast: channel.id._serialized === 'status@broadcast',
                lastSeen: new Date().toISOString()
            });
        }
        
        // Method 2: Try to get newsletter collection
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
            
            for (const newsletter of newsletterChannels) {
                addDetectedChannel(newsletter.id, {
                    name: newsletter.name,
                    type: 'newsletter',
                    isNewsletter: true,
                    isBroadcast: false,
                    lastSeen: new Date().toISOString()
                });
            }
        } catch (error) {
            console.log('[CHANNEL-DISCOVERY] Newsletter collection not accessible:', error.message);
        }
        
        console.log(`[CHANNEL-DISCOVERY] Discovered ${followedChannels.length} followed channels`);
        
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
    res.json(readJson(SENT_MESSAGES_FILE));
});

// API to add a sent message log (for resend, etc.)
app.post('/api/sent-messages', (req, res) => {
    const entry = req.body;
    if (!entry || !entry.to || !entry.message) return res.status(400).json({ error: 'Invalid log entry' });
    appendSentMessageLog(entry);
    res.json({ success: true });
});

// --- Automate Tab API ---
// List all automations
app.get('/api/automations', (req, res) => {
  try {
    const automations = readAutomations();
    res.json(automations);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read automations', details: err.message });
  }
});
// Add new automation
app.post('/api/automations', (req, res) => {
  try {
    const automations = readAutomations();
    const { chatId, chatName, systemPrompt, schedule, status, automationType } = req.body;
    
    // Validation based on automation type
    if (!chatId || !chatName || !systemPrompt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const isChannel = automationType === 'channel' || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast');
    
    if (isChannel && !schedule) {
      return res.status(400).json({ error: 'Schedule is required for channel automations' });
    }
    
    const id = uuidv4();
    const newAutomation = {
      id, chatId, chatName, systemPrompt, schedule: schedule || null, status: status || 'active',
      lastSent: null, nextScheduled: null, logFile: `automation_log_${id}.json`, automationType: isChannel ? 'channel' : 'chat'
    };
    automations.push(newAutomation);
    writeAutomations(automations);
    res.json(newAutomation);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add automation', details: err.message });
  }
});
// Edit automation
app.put('/api/automations/:id', (req, res) => {
  try {
    const automations = readAutomations();
    const idx = automations.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Automation not found' });
    const { chatId, chatName, systemPrompt, schedule, status, automationType } = req.body;
    
    // Validation based on automation type
    const isChannel = automationType === 'channel' || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast');
    
    if (isChannel && !schedule) {
      return res.status(400).json({ error: 'Schedule is required for channel automations' });
    }
    
    Object.assign(automations[idx], { 
      chatId, chatName, systemPrompt, schedule: schedule || null, status,
      automationType: isChannel ? 'channel' : 'chat'
    });
    writeAutomations(automations);
    res.json(automations[idx]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update automation', details: err.message });
  }
});
// Delete automation
app.delete('/api/automations/:id', (req, res) => {
  try {
    let automations = readAutomations();
    const idx = automations.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Automation not found' });
    const [removed] = automations.splice(idx, 1);
    writeAutomations(automations);
    // Optionally delete log file
    if (removed.logFile && fs.existsSync(path.join(__dirname, removed.logFile))) {
      fs.unlinkSync(path.join(__dirname, removed.logFile));
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete automation', details: err.message });
  }
});
// Get automation log (paginated) - supports multiple log files
app.get('/api/automations/:id/log', (req, res) => {
  try {
    const automations = readAutomations();
    const automation = automations.find(a => a.id === req.params.id);
    if (!automation) return res.status(404).json({ error: 'Automation not found' });
    
    // Get all log files for this automation (including rotated ones)
    const baseName = automation.logFile.replace('.json', '');
    const logFiles = [];
    
    // Find all log files for this automation
    const files = fs.readdirSync(__dirname);
    files.forEach(file => {
      if (file.startsWith(baseName) && file.endsWith('.json') && !file.includes('_corrupted_')) {
        logFiles.push(file);
      }
    });
    
    // Sort log files: base file first, then numbered files in order
    logFiles.sort((a, b) => {
      if (a === automation.logFile) return -1;
      if (b === automation.logFile) return 1;
      const aNum = parseInt(a.match(/_(\d+)\.json$/)?.[1] || '0');
      const bNum = parseInt(b.match(/_(\d+)\.json$/)?.[1] || '0');
      return bNum - aNum; // Newest first
    });
    
    // Read all log files and merge
    let allLogs = [];
    for (const logFile of logFiles) {
      const logPath = path.join(__dirname, logFile);
      if (fs.existsSync(logPath)) {
        try {
          const fileContent = fs.readFileSync(logPath, 'utf8');
          if (fileContent.trim()) {
            const logs = JSON.parse(fileContent);
            if (Array.isArray(logs)) {
              // Add source file info to each log entry
              logs.forEach(log => {
                if (!log.sourceFile) {
                  log.sourceFile = logFile;
                }
              });
              allLogs = allLogs.concat(logs);
            }
          }
        } catch (parseErr) {
          console.error(`[AUTOMATION] Failed to parse log file ${logFile}:`, parseErr.message);
        }
      }
    }
    
    // Sort by timestamp (most recent first)
    allLogs.sort((a, b) => {
      const timeA = new Date(a.timestamp || a.time || 0).getTime();
      const timeB = new Date(b.timestamp || b.time || 0).getTime();
      return timeB - timeA;
    });
    
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    
    res.json({ 
      logs: allLogs.slice(start, end), 
      total: allLogs.length,
      totalFiles: logFiles.length,
      currentFile: automation.logFile
    });
  } catch (err) {
    console.error('[AUTOMATION] Error fetching logs:', err);
    res.status(500).json({ error: 'Failed to fetch log', details: err.message });
  }
});
// Test GenAI integration (grounded)
app.post('/api/automations/test-genai', async (req, res) => {
  try {
    const { systemPrompt, autoReplyPrompt, userMessage } = req.body;
    if (!systemPrompt || !autoReplyPrompt || !userMessage) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const result = await callGenAI({ systemPrompt, autoReplyPrompt, chatHistory: '', userMessage });
    if (!result) return res.status(500).json({ error: 'GenAI call failed' });
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// Get all chats
app.get('/api/chats', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    try {
        const chats = await retryOperation(() => client.getChats());
        res.json(chats.map(chat => ({
            id: chat.id._serialized,
            name: chat.name || chat.formattedTitle || chat.id.user,
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
            timestamp: chat.timestamp || (chat.lastMessage ? chat.lastMessage.timestamp : 0) || 0
        })));
    } catch (err) {
        console.error('Failed to fetch chats after retries:', err);
        res.status(500).json({ error: 'Failed to fetch chats', details: err.message });
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

// Upload media file
app.post('/api/upload-media', upload.single('media'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No media file provided' });
    }
    
    try {
        // Validate file type
        const allowedTypes = ['image/', 'video/', 'application/pdf'];
        if (!allowedTypes.some(t => req.file.mimetype.startsWith(t))) {
            return res.status(400).json({ error: 'Unsupported media type. Only images, videos, and PDFs are allowed.' });
        }
        
        // Validate file size (100MB max)
        if (req.file.size > 100 * 1024 * 1024) {
            return res.status(400).json({ error: 'File too large. Maximum size is 100MB.' });
        }
        
        // Generate a unique filename
        const timestamp = Date.now();
        const originalName = req.file.originalname;
        const extension = originalName.split('.').pop();
        const filename = `bulk-media-${timestamp}.${extension}`;
        
        // Ensure the message-templates directory exists
        const messageTemplatesDir = path.join(__dirname, 'public', 'message-templates');
        if (!fs.existsSync(messageTemplatesDir)) {
            fs.mkdirSync(messageTemplatesDir, { recursive: true });
        }
        
        // Move file to public directory
        const publicPath = path.join(messageTemplatesDir, filename);
        fs.renameSync(req.file.path, publicPath);
        
        // Return the public URL
        const publicUrl = `/message-templates/${filename}`;
        console.log(`[UPLOAD] Media uploaded successfully: ${filename} (${req.file.size} bytes)`);
        res.json({ url: publicUrl, filename: filename });
    } catch (err) {
        console.error('Media upload error:', err);
        
        // Clean up temp file if it exists
        if (req.file && req.file.path && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (cleanupErr) {
                console.error('Failed to cleanup temp file:', cleanupErr);
            }
        }
        
        res.status(500).json({ error: 'Failed to upload media: ' + err.message });
    }
});

// Get all contacts with pagination
app.get('/api/contacts', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 1000;
        const search = req.query.search || '';
        
        console.log('[CONTACTS] Fetching contacts from WhatsApp...');
        const contacts = await client.getContacts();
        console.log(`[CONTACTS] Fetched ${contacts.length} contacts from WhatsApp`);
        
        let contactsData = contacts.map(contact => ({
            id: contact.id._serialized,
            number: contact.id.user,
            name: contact.name || null,
            pushname: contact.pushname || null,
            status: contact.status || null,
            avatar: contact.profilePicUrl || null,
            verified: contact.isVerified || false,
            businessProfile: contact.businessProfile ? {
                description: contact.businessProfile.description || null,
                website: contact.businessProfile.website || null,
                email: contact.businessProfile.email || null,
                category: contact.businessProfile.category || null,
                subcategory: contact.businessProfile.subcategory || null
            } : null
        }));
        
        // Apply search filter if provided
        if (search) {
            const searchLower = search.toLowerCase();
            contactsData = contactsData.filter(contact => {
                const name = (contact.name || '').toLowerCase();
                const number = (contact.number || '').toLowerCase();
                const pushname = (contact.pushname || '').toLowerCase();
                
                return name.includes(searchLower) || 
                       number.includes(searchLower) || 
                       pushname.includes(searchLower);
            });
        }
        
        // Apply pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedContacts = contactsData.slice(startIndex, endIndex);
        
        res.json({ 
            contacts: paginatedContacts,
            total: contactsData.length,
            page: page,
            limit: limit,
            totalPages: Math.ceil(contactsData.length / limit)
        });
    } catch (err) {
        console.error('Failed to fetch contacts:', err);
        res.status(500).json({ error: 'Failed to fetch contacts', details: err.message });
    }
});





// Update contacts from WhatsApp
app.post('/api/contacts/update', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    
    try {
        console.log('[CONTACTS] Updating contacts from WhatsApp...');
        const contacts = await client.getContacts();
        console.log(`[CONTACTS] Fetched ${contacts.length} contacts from WhatsApp`);
        
        const contactsData = contacts.map(contact => ({
            id: contact.id._serialized,
            number: contact.id.user,
            name: contact.name || null,
            pushname: contact.pushname || null,
            status: contact.status || null,
            avatar: contact.profilePicUrl || null,
            verified: contact.isVerified || false,
            businessProfile: contact.businessProfile ? {
                description: contact.businessProfile.description || null,
                website: contact.businessProfile.website || null,
                email: contact.businessProfile.email || null,
                category: contact.businessProfile.category || null,
                subcategory: contact.businessProfile.subcategory || null
            } : null
        }));
        
        res.json({ 
            success: true, 
            message: `Successfully fetched ${contactsData.length} contacts from WhatsApp`,
            contacts: contactsData
        });
    } catch (err) {
        console.error('Failed to update contacts:', err);
        res.status(500).json({ error: 'Failed to update contacts', details: err.message });
    }
});

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
// List all followed channels
app.get('/api/channels', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    try {
        const chats = await client.getChats();
        const channels = chats.filter(chat => chat.isChannel).map(channel => ({
            id: channel.id._serialized,
            name: channel.name,
            description: channel.description,
            isReadOnly: channel.isReadOnly,
            unreadCount: channel.unreadCount,
            timestamp: channel.timestamp
        }));
        res.json(channels);
    } catch (err) {
        console.error('Failed to fetch channels:', err);
        res.status(500).json({ error: 'Failed to fetch channels', details: err.message });
    }
});

// Enhanced channel detection endpoint that combines multiple methods
app.get('/api/channels/enhanced', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    try {
        const { method = 'all' } = req.query;
        let channels = [];
        
        switch (method) {
            case 'followed':
                // Get only followed channels using client.getChats()
                const chats = await client.getChats();
                channels = chats.filter(chat => chat.isChannel).map(channel => ({
                    id: channel.id._serialized,
                    name: channel.name,
                    description: channel.description,
                    isReadOnly: channel.isReadOnly,
                    unreadCount: channel.unreadCount,
                    timestamp: channel.timestamp,
                    isMuted: channel.isMuted,
                    muteExpiration: channel.muteExpiration,
                    lastMessage: channel.lastMessage ? {
                        id: channel.lastMessage.id._serialized,
                        body: channel.lastMessage.body,
                        timestamp: channel.lastMessage.timestamp,
                        fromMe: channel.lastMessage.fromMe
                    } : null,
                    type: 'followed'
                }));
                break;
                
            case 'newsletter':
                // Get newsletter channels using NewsletterCollection
                const newsletterChannels = await client.pupPage.evaluate(async () => {
                    try {
                        const newsletterCollection = window.Store.NewsletterCollection;
                        const newsletters = newsletterCollection.getModelsArray();
                        return newsletters.map(newsletter => ({
                            id: newsletter.id._serialized,
                            name: newsletter.name,
                            description: newsletter.description,
                            isReadOnly: true,
                            unreadCount: newsletter.unreadCount || 0,
                            timestamp: newsletter.timestamp,
                            isMuted: newsletter.isMuted || false,
                            muteExpiration: newsletter.muteExpiration,
                            lastMessage: newsletter.lastMessage ? {
                                id: newsletter.lastMessage.id._serialized,
                                body: newsletter.lastMessage.body,
                                timestamp: newsletter.lastMessage.timestamp,
                                fromMe: newsletter.lastMessage.fromMe
                            } : null,
                            type: 'newsletter'
                        }));
                    } catch (error) {
                        console.error('Error fetching newsletter collection:', error);
                        return [];
                    }
                });
                channels = newsletterChannels;
                break;
                
            case 'detected':
                // Get channels from detected_channels.json
                const detectedChannels = getDetectedChannels();
                channels = detectedChannels.map(channel => ({
                    id: channel.id,
                    name: channel.name,
                    description: '',
                    isReadOnly: true,
                    unreadCount: 0,
                    timestamp: new Date(channel.lastSeen).getTime() / 1000,
                    isMuted: false,
                    muteExpiration: null,
                    lastMessage: channel.lastMessage ? {
                        id: 'detected',
                        body: channel.lastMessage,
                        timestamp: new Date(channel.lastSeen).getTime() / 1000,
                        fromMe: false
                    } : null,
                    type: channel.type,
                    isNewsletter: channel.isNewsletter,
                    isBroadcast: channel.isBroadcast,
                    messageCount: channel.messageCount,
                    firstSeen: channel.firstSeen,
                    lastSeen: channel.lastSeen
                }));
                break;
                
            default:
                // Get all channels with all information
                const allChats = await client.getChats();
                const allChannels = allChats.filter(chat => chat.isChannel);
                channels = allChannels.map(channel => ({
                    id: channel.id._serialized,
                    name: channel.name,
                    description: channel.description,
                    isReadOnly: channel.isReadOnly,
                    unreadCount: channel.unreadCount,
                    timestamp: channel.timestamp,
                    isMuted: channel.isMuted,
                    muteExpiration: channel.muteExpiration,
                    lastMessage: channel.lastMessage ? {
                        id: channel.lastMessage.id._serialized,
                        body: channel.lastMessage.body,
                        timestamp: channel.lastMessage.timestamp,
                        fromMe: channel.lastMessage.fromMe
                    } : null,
                    type: channel.isReadOnly ? 'subscriber' : 'admin'
                }));
        }
        
        res.json({
            channels,
            total: channels.length,
            method: method,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Failed to fetch enhanced channels:', err);
        res.status(500).json({ error: 'Failed to fetch enhanced channels', details: err.message });
    }
});

// Get channels with detailed information and multiple fetch methods
app.get('/api/channels/detailed', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    try {
        const { method = 'all' } = req.query;
        let channels = [];
        
        switch (method) {
            case 'followed':
                // Get only followed channels
                const chats = await client.getChats();
                channels = chats.filter(chat => chat.isChannel).map(channel => ({
                    id: channel.id._serialized,
                    name: channel.name,
                    description: channel.description,
                    isReadOnly: channel.isReadOnly,
                    unreadCount: channel.unreadCount,
                    timestamp: channel.timestamp,
                    isMuted: channel.isMuted,
                    muteExpiration: channel.muteExpiration,
                    lastMessage: channel.lastMessage ? {
                        id: channel.lastMessage.id._serialized,
                        body: channel.lastMessage.body,
                        timestamp: channel.lastMessage.timestamp,
                        fromMe: channel.lastMessage.fromMe
                    } : null,
                    subscriberCount: null, // Will be fetched separately if needed
                    type: 'followed'
                }));
                break;
                
            case 'subscribed':
                // Get channels where user is a subscriber
                const subscribedChats = await client.getChats();
                const subscribedChannels = subscribedChats.filter(chat => chat.isChannel);
                channels = subscribedChannels.map(channel => ({
                    id: channel.id._serialized,
                    name: channel.name,
                    description: channel.description,
                    isReadOnly: channel.isReadOnly,
                    unreadCount: channel.unreadCount,
                    timestamp: channel.timestamp,
                    isMuted: channel.isMuted,
                    muteExpiration: channel.muteExpiration,
                    lastMessage: channel.lastMessage ? {
                        id: channel.lastMessage.id._serialized,
                        body: channel.lastMessage.body,
                        timestamp: channel.lastMessage.timestamp,
                        fromMe: channel.lastMessage.fromMe
                    } : null,
                    type: 'subscribed'
                }));
                break;
                
            case 'admin':
                // Get channels where user is an admin
                const adminChats = await client.getChats();
                const adminChannels = adminChats.filter(chat => chat.isChannel && !chat.isReadOnly);
                channels = adminChannels.map(channel => ({
                    id: channel.id._serialized,
                    name: channel.name,
                    description: channel.description,
                    isReadOnly: channel.isReadOnly,
                    unreadCount: channel.unreadCount,
                    timestamp: channel.timestamp,
                    isMuted: channel.isMuted,
                    muteExpiration: channel.muteExpiration,
                    lastMessage: channel.lastMessage ? {
                        id: channel.lastMessage.id._serialized,
                        body: channel.lastMessage.body,
                        timestamp: channel.lastMessage.timestamp,
                        fromMe: channel.lastMessage.fromMe
                    } : null,
                    type: 'admin'
                }));
                break;
                
            default:
                // Get all channels with all information
                const allChats = await client.getChats();
                const allChannels = allChats.filter(chat => chat.isChannel);
                channels = allChannels.map(channel => ({
                    id: channel.id._serialized,
                    name: channel.name,
                    description: channel.description,
                    isReadOnly: channel.isReadOnly,
                    unreadCount: channel.unreadCount,
                    timestamp: channel.timestamp,
                    isMuted: channel.isMuted,
                    muteExpiration: channel.muteExpiration,
                    lastMessage: channel.lastMessage ? {
                        id: channel.lastMessage.id._serialized,
                        body: channel.lastMessage.body,
                        timestamp: channel.lastMessage.timestamp,
                        fromMe: channel.lastMessage.fromMe
                    } : null,
                    type: channel.isReadOnly ? 'subscriber' : 'admin'
                }));
        }
        
        res.json({
            channels,
            total: channels.length,
            method: method,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Failed to fetch detailed channels:', err);
        res.status(500).json({ error: 'Failed to fetch detailed channels', details: err.message });
    }
});

// Verify channel admin status (get fresh data from WhatsApp)
app.get('/api/channels/:channelId/verify', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    try {
        const { channelId } = req.params;
        const channel = await client.getChatById(channelId);
        
        if (!channel) {
            return res.status(404).json({ error: 'Channel not found' });
        }
        
        if (!channel.isChannel) {
            return res.status(400).json({ error: 'Not a channel' });
        }
        
        // Return the actual isReadOnly status from WhatsApp
        res.json({
            id: channel.id._serialized,
            name: channel.name,
            isReadOnly: channel.isReadOnly,
            isChannel: channel.isChannel,
            verified: true
        });
    } catch (err) {
        console.error('Failed to verify channel status:', err);
        res.status(500).json({ error: 'Failed to verify channel status', details: err.message });
    }
});

// Get incoming channel messages (messages not from @c.us or @g.us)
app.get('/api/incoming-channel-messages', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    try {
        // Get all chats to find channel messages
        const chats = await client.getChats();
        const channelMessages = [];
        
        for (const chat of chats) {
            if (chat.isChannel) {
                try {
                    // Get recent messages from this channel
                    const messages = await chat.fetchMessages({ limit: 20 });
                    
                    // Filter for messages that are not from @c.us or @g.us, or specifically from @newsletter
                    const filteredMessages = messages.filter(msg => {
                        const from = msg.from || msg.author;
                        return from && (!from.endsWith('@c.us') && !from.endsWith('@g.us') || from.endsWith('@newsletter'));
                    });
                    
                    // Add to our collection
                    channelMessages.push(...filteredMessages.map(msg => ({
                        id: msg.id._serialized || msg.id,
                        body: msg.body,
                        type: msg.type,
                        from: msg.from || msg.author,
                        fromMe: msg.fromMe,
                        to: msg.to,
                        timestamp: msg.timestamp,
                        hasMedia: msg.hasMedia,
                        author: msg.author,
                        mimetype: msg.mimetype,
                        filename: msg.filename,
                        size: msg._data?.size || null,
                        chatId: chat.id._serialized,
                        chatName: chat.name
                    })));
                } catch (err) {
                    console.error(`Failed to fetch messages from channel ${chat.id._serialized}:`, err);
                }
            }
        }
        
        // Sort by timestamp (newest first)
        channelMessages.sort((a, b) => b.timestamp - a.timestamp);
        
        res.json(channelMessages);
    } catch (err) {
        console.error('Failed to fetch incoming channel messages:', err);
        res.status(500).json({ error: 'Failed to fetch incoming channel messages', details: err.message });
    }
});


// Get messages for a channel
app.get('/api/channels/:id/messages', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    try {
        const channel = await client.getChatById(req.params.id);
        if (!channel.isChannel) return res.status(404).json({ error: 'Not a channel' });
        const msgs = await channel.fetchMessages({ limit: 50 });
        const result = msgs.map(msg => ({
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
            size: msg._data?.size || null
        }));
        res.json(result);
    } catch (err) {
        console.error('Failed to fetch channel messages:', err);
        res.status(500).json({ error: err.message });
    }
});
// Send message to a channel (if admin)
app.post('/api/channels/:id/send', messageUpload.single('media'), async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    try {
        const channel = await client.getChatById(req.params.id);
        if (!channel.isChannel) return res.status(404).json({ error: 'Not a channel' });
        if (channel.isReadOnly) return res.status(403).json({ error: 'Not a channel admin' });
        const message = req.body?.message || '';
        let sent;
        if (req.file) {
            const allowedTypes = ['image/', 'video/', 'application/pdf'];
            if (!allowedTypes.some(t => req.file.mimetype.startsWith(t))) {
                return res.status(400).json({ error: 'Unsupported media type' });
            }
            if (req.file.size > 100 * 1024 * 1024) {
                return res.status(400).json({ error: 'File too large (max 100MB)' });
            }
            const media = new MessageMedia(
                req.file.mimetype,
                req.file.buffer.toString('base64'),
                req.file.originalname
            );
            sent = await channel.sendMessage(media, { caption: message });
        } else {
            sent = await channel.sendMessage(message);
        }
        res.json({ success: true, id: sent.id._serialized });
    } catch (err) {
        console.error('Send channel message error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Send message to all channels or specific channel
app.post('/api/channels/send', messageUpload.single('media'), async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    try {
        const { channelId, message, sendToAll } = req.body;
        const attachment = req.file;
        
        if (!message && !attachment) {
            return res.status(400).json({ error: 'Message or attachment is required' });
        }
        
        let channels = [];
        
        if (sendToAll === 'true') {
            // Get all channels where user is admin
            const allChats = await client.getChats();
            channels = allChats.filter(chat => chat.isChannel && !chat.isReadOnly);
        } else if (channelId) {
            // Send to specific channel
            const channel = await client.getChatById(channelId);
            if (!channel.isChannel) {
                return res.status(404).json({ error: 'Not a channel' });
            }
            if (channel.isReadOnly) {
                return res.status(403).json({ error: 'Not a channel admin' });
            }
            channels = [channel];
        } else {
            return res.status(400).json({ error: 'Either channelId or sendToAll must be specified' });
        }
        
        const results = [];
        
        for (const channel of channels) {
            try {
                let sent;
                if (attachment) {
                    const allowedTypes = ['image/', 'video/', 'application/pdf'];
                    if (!allowedTypes.some(t => attachment.mimetype.startsWith(t))) {
                        results.push({ channelId: channel.id._serialized, success: false, error: 'Unsupported media type' });
                        continue;
                    }
                    if (attachment.size > 100 * 1024 * 1024) {
                        results.push({ channelId: channel.id._serialized, success: false, error: 'File too large (max 100MB)' });
                        continue;
                    }
                    const media = new MessageMedia(
                        attachment.mimetype,
                        attachment.buffer.toString('base64'),
                        attachment.originalname
                    );
                    sent = await channel.sendMessage(media, { caption: message });
                } else {
                    sent = await channel.sendMessage(message);
                }
                
                results.push({ 
                    channelId: channel.id._serialized, 
                    channelName: channel.name,
                    success: true, 
                    messageId: sent.id._serialized 
                });
                
                // Log the sent message
                appendSentMessageLog({
                    to: channel.id._serialized,
                    message: message,
                    media: attachment ? attachment.originalname : null,
                    status: 'sent',
                    time: new Date().toISOString()
                });
                
            } catch (err) {
                console.error(`Failed to send message to channel ${channel.id._serialized}:`, err);
                results.push({ 
                    channelId: channel.id._serialized, 
                    channelName: channel.name,
                    success: false, 
                    error: err.message 
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.length - successCount;
        
        res.json({ 
            success: true, 
            results,
            summary: {
                total: results.length,
                successful: successCount,
                failed: failureCount
            }
        });
        
    } catch (err) {
        console.error('Send to channels error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get all templates
app.get('/api/templates', (req, res) => {
    res.json(readJson(TEMPLATES_FILE));
});

// Create new template
app.post('/api/templates', templateUpload.single('media'), (req, res) => {
    try {
        const { name, text, removeMedia } = req.body;
        if (!name || !text) {
            return res.status(400).json({ error: 'Name and text are required' });
        }
        
        const templates = readJson(TEMPLATES_FILE);
        const template = {
            id: require('crypto').randomUUID(),
            name: name.trim(),
            text: text.trim(),
            media: null,
            createdAt: new Date().toISOString()
        };
        
        // Handle media upload
        if (req.file) {
            const mediaDir = path.join(__dirname, 'public', 'message-templates');
            if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
            }
            
            const fileExt = path.extname(req.file.originalname);
            const fileName = `${template.id}${fileExt}`;
            const filePath = path.join(mediaDir, fileName);
            
            fs.writeFileSync(filePath, req.file.buffer);
            template.media = `/message-templates/${fileName}`;
        }
        
        templates.push(template);
        writeJson(TEMPLATES_FILE, templates);
        res.json(template);
    } catch (err) {
        console.error('Create template error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update existing template
app.put('/api/templates/:id', templateUpload.single('media'), (req, res) => {
    try {
        const { id } = req.params;
        const { name, text, removeMedia } = req.body;
        if (!name || !text) {
            return res.status(400).json({ error: 'Name and text are required' });
        }
        
        const templates = readJson(TEMPLATES_FILE);
        const templateIndex = templates.findIndex(t => t.id === id);
        if (templateIndex === -1) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const template = templates[templateIndex];
        template.name = name.trim();
        template.text = text.trim();
        template.updatedAt = new Date().toISOString();
        
        // Handle media removal
        if (removeMedia === 'true' && template.media) {
            const oldMediaPath = path.join(__dirname, 'public', template.media);
            if (fs.existsSync(oldMediaPath)) {
                fs.unlinkSync(oldMediaPath);
            }
            template.media = null;
        }
        
        // Handle new media upload
        if (req.file) {
            // Remove old media if exists
            if (template.media) {
                const oldMediaPath = path.join(__dirname, 'public', template.media);
                if (fs.existsSync(oldMediaPath)) {
                    fs.unlinkSync(oldMediaPath);
                }
            }
            
            const mediaDir = path.join(__dirname, 'public', 'message-templates');
            if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
            }
            
            const fileExt = path.extname(req.file.originalname);
            const fileName = `${template.id}${fileExt}`;
            const filePath = path.join(mediaDir, fileName);
            
            fs.writeFileSync(filePath, req.file.buffer);
            template.media = `/message-templates/${fileName}`;
        }
        
        templates[templateIndex] = template;
        writeJson(TEMPLATES_FILE, templates);
        res.json(template);
    } catch (err) {
        console.error('Update template error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete template
app.delete('/api/templates/:id', (req, res) => {
    try {
        const { id } = req.params;
        const templates = readJson(TEMPLATES_FILE);
        const templateIndex = templates.findIndex(t => t.id === id);
        if (templateIndex === -1) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const template = templates[templateIndex];
        
        // Remove media file if exists
        if (template.media) {
            const mediaPath = path.join(__dirname, 'public', template.media);
            if (fs.existsSync(mediaPath)) {
                fs.unlinkSync(mediaPath);
            }
        }
        
        templates.splice(templateIndex, 1);
        writeJson(TEMPLATES_FILE, templates);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete template error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get sent messages log
app.get('/api/messages/log', (req, res) => {
    res.json(readJson(SENT_MESSAGES_FILE));
});

// Send message (with optional media)
app.post('/api/messages/send', messageUpload.single('media'), async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    
    const number = req.body?.number;
    const message = req.body?.message || '';
    const mediaPath = req.body?.media_path;
    const mediaUrl = req.body?.media_url;
    
    if (!number) return res.status(400).json({ error: 'Missing number' });
    
    // Normalize WhatsApp ID
    const normalizedNumber = number.trim();
    const chatId = !normalizedNumber.endsWith('@c.us') && !normalizedNumber.endsWith('@g.us')
        ? normalizedNumber.replace(/[^0-9]/g, '') + '@c.us'
        : normalizedNumber;
    
    try {
        let mediaInfo = null;
        if (req.file) {
            // Validate file type/size
            const allowedTypes = ['image/', 'video/', 'application/pdf'];
            if (!allowedTypes.some(t => req.file.mimetype.startsWith(t))) {
                return res.status(400).json({ error: 'Unsupported media type' });
            }
            if (req.file.size > 100 * 1024 * 1024) {
                return res.status(400).json({ error: 'File too large (max 100MB)' });
            }
            
            console.log(`Sending media to ${chatId}: ${req.file.originalname} (${req.file.mimetype}, ${req.file.size} bytes)`);
            
            const media = new MessageMedia(
                req.file.mimetype,
                req.file.buffer.toString('base64'),
                req.file.originalname
            );
            
            await client.sendMessage(chatId, media, { caption: message });
            mediaInfo = { filename: req.file.originalname, mimetype: req.file.mimetype };
            console.log(`Sent media to ${chatId} (${req.file.originalname})`);
        } else if (mediaPath) {
            // Send media from disk (template media)
            const absPath = path.join(__dirname, 'public', mediaPath.replace(/^\//, ''));
            if (!fs.existsSync(absPath)) {
                return res.status(400).json({ error: 'Template media file not found' });
            }
            const buf = fs.readFileSync(absPath);
            const mime = require('mime-types').lookup(absPath) || 'application/octet-stream';
            const media = new MessageMedia(mime, buf.toString('base64'), path.basename(absPath));
            await client.sendMessage(chatId, media, { caption: message });
            mediaInfo = { filename: path.basename(absPath), mimetype: mime };
            console.log(`[DEBUG] Sent template media to ${chatId} (${mediaPath})`);
        } else if (mediaUrl) {
            // Handle mediaUrl if needed, or remove this block if not implemented
            // Example: fetch and send media from URL, or just log
            console.log(`[DEBUG] mediaUrl provided: ${mediaUrl}`);
            return res.status(400).json({ error: 'Sending media from URL is not implemented.' });
        } else {
            await client.sendMessage(chatId, message);
        }
        appendSentMessageLog({ to: chatId, message, media: mediaInfo, status: 'sent', time: new Date().toISOString() });
        res.json({ success: true });
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get all bulk messages (paginated)
app.get('/api/bulk', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const records = readJson(BULK_FILE);
    const start = (page - 1) * limit;
    const end = start + limit;
    res.json({
        records: records.slice(start, end),
        total: records.length
    });
});

// Import bulk messages from CSV
app.post('/api/bulk-import', csvUpload.single('csv'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
    
    try {
        const csvData = req.file.buffer.toString('utf8');
        const records = parse(csvData, { 
            columns: true, 
            skip_empty_lines: true,
            trim: true
        });
        
        const errors = [];
        const imported = [];
        const importFilename = req.file.originalname;
        const importDatetime = new Date().toISOString();
        
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (!record.number || !record.message) {
                errors.push(`Row ${i + 2}: Missing number or message`);
                continue;
            }
            
            // Add metadata
            record.import_filename = importFilename;
            record.import_datetime = importDatetime;
            record.unique_id = uuidv4();
            record.status = 'pending';
            
            imported.push(record);
        }
        
        // Append to bulk file
        const existing = readJson(BULK_FILE);
        existing.push(...imported);
        writeJson(BULK_FILE, existing);
        
        res.json({ imported: imported.length, errors });
    } catch (err) {
        console.error('Bulk import error:', err);
        res.status(500).json({ error: 'Failed to import CSV: ' + err.message });
    }
});

// Get bulk imports with pagination and filtering
app.get('/api/bulk-imports', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const importFilename = req.query.import_filename;
    
    let records = readJson(BULK_FILE);
    
    // Filter by import filename if specified
    if (importFilename) {
        records = records.filter(r => r.import_filename === importFilename);
    }
    
    const start = (page - 1) * limit;
    const end = start + limit;
    
    res.json({
        records: records.slice(start, end),
        total: records.length
    });
});

// Test send a specific bulk record
app.post('/api/bulk-test/:id', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    
    const { action } = req.body;
    const recordId = req.params.id;
    
    try {
        const records = readJson(BULK_FILE);
        const recordIndex = records.findIndex(r => r.unique_id === recordId);
        
        if (recordIndex === -1) {
            return res.status(404).json({ error: 'Record not found' });
        }
        
        const record = records[recordIndex];
        
        // Set send time based on action
        if (action === 'now') {
            record.send_datetime = new Date().toISOString();
        } else if (action === 'schedule') {
            const oneMinuteFromNow = new Date(Date.now() + 60000);
            record.send_datetime = oneMinuteFromNow.toISOString();
        }
        
        record.status = 'pending';
        delete record.error; // Clear any previous error
        
        // Update the record
        records[recordIndex] = record;
        writeJson(BULK_FILE, records);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Bulk test error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Retry failed bulk messages
app.post('/api/bulk-retry/:filename', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    
    try {
        const { filename } = req.params;
        const bulkMessagesPath = path.join(__dirname, 'bulk_messages.json');
        
        if (!fs.existsSync(bulkMessagesPath)) {
            return res.status(404).json({ error: 'Bulk messages file not found' });
        }
        
        const bulkMessages = JSON.parse(fs.readFileSync(bulkMessagesPath, 'utf8'));
        const importData = bulkMessages[filename];
        
        if (!importData) {
            return res.status(404).json({ error: 'Import not found' });
        }
        
        const failedMessages = importData.messages.filter(msg => msg.status === 'failed');
        
        if (failedMessages.length === 0) {
            return res.json({ message: 'No failed messages to retry' });
        }
        
        console.log(`Retrying ${failedMessages.length} failed messages for import: ${filename}`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const message of failedMessages) {
            try {
                const normalizedNumber = message.to.trim();
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
                        console.log(`[BULK RETRY] Group verified: ${groupChat.name || chatId}`);
                        // Skip contact addition for groups
                    } catch (groupErr) {
                        console.error(`[BULK RETRY] Group verification failed for ${chatId}:`, groupErr.message);
                        message.status = 'failed';
                        message.error = `Failed to verify group access: ${groupErr.message}`;
                        failCount++;
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
                                console.log(`[BULK RETRY] Contact exists with proper name for ${normalizedNumber}: ${existingContact.name}`);
                                contactExists = true;
                            } else {
                                console.log(`[BULK RETRY] Contact exists but needs name update for ${normalizedNumber}: ${existingContact.name}`);
                            }
                        } else {
                            console.log(`[BULK RETRY] Contact does not exist for ${normalizedNumber}, adding...`);
                        }
                    } catch (err) {
                        console.log(`[BULK RETRY] Contact check failed for ${normalizedNumber}, will add: ${err.message}`);
                    }
                    
                    // Add contact if it doesn't exist or needs name update
                    if (!contactExists) {
                    try {
                        // Generate name if not available
                        let firstName = '';
                        let lastName = '';
                        
                        if (message.name && message.name.trim()) {
                            const nameParts = message.name.trim().split(' ').filter(part => part.length > 0);
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
                            console.log(`[BULK RETRY] Generated random name for ${normalizedNumber}: ${firstName} ${lastName}`);
                        }
                        
                        // Add contact using saveOrEditAddressbookContact
                        const contactChatId = await client.saveOrEditAddressbookContact(
                            normalizedNumber.replace(/[^0-9]/g, ''),
                            firstName,
                            lastName,
                            true // syncToAddressbook = true
                        );
                        
                        console.log(`[BULK RETRY] Contact added successfully for ${normalizedNumber}: ${firstName} ${lastName}`);
                        
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
                                    console.log(`[BULK RETRY] Contact verified with proper name: ${newContact.name}`);
                                    // Use the returned chatId for sending message
                                    chatId = contactChatId._serialized || contactChatId;
                                } else {
                                    console.log(`[BULK RETRY] Contact added but name verification failed: ${newContact.name}`);
                                    throw new Error('Failed to add contact with proper name');
                                }
                            } else {
                                console.log(`[BULK RETRY] Contact added but verification failed`);
                                throw new Error('Contact verification failed');
                            }
                        } catch (verifyErr) {
                            console.error(`[BULK RETRY] Contact verification error for ${normalizedNumber}:`, verifyErr.message);
                            throw new Error(`Failed to verify contact: ${verifyErr.message}`);
                        }
                        
                    } catch (addErr) {
                        console.error(`[BULK RETRY] Failed to add contact for ${normalizedNumber}:`, addErr.message);
                        message.status = 'failed';
                        message.error = `Failed to add number to contacts before sending bulk message: ${addErr.message}`;
                        failCount++;
                        continue; // Skip to next message
                    }
                    }
                }
                
                let media = null;
                
                if (message.media) {
                    try {
                        let mediaPath = message.media;
                        if (mediaPath.startsWith('/message-templates/') || mediaPath.startsWith('/')) {
                            mediaPath = path.join(__dirname, 'public', mediaPath);
                        } else {
                            mediaPath = path.join(__dirname, mediaPath);
                        }
                        
                        if (fs.existsSync(mediaPath)) {
                            const mimeType = mime.lookup(mediaPath) || 'application/octet-stream';
                            const mediaBuffer = fs.readFileSync(mediaPath);
                            media = new MessageMedia(mimeType, mediaBuffer.toString('base64'));
                        } else {
                            console.error(`Media file not found: ${mediaPath}`);
                            message.status = 'failed';
                            message.error = 'Media file not found';
                            failCount++;
                            continue;
                        }
                    } catch (mediaErr) {
                        console.error('Error processing media:', mediaErr);
                        message.status = 'failed';
                        message.error = 'Media processing error: ' + mediaErr.message;
                        failCount++;
                        continue;
                    }
                }
                
                const result = await retryOperation(async () => {
                    if (media) {
                        return await client.sendMessage(chatId, media, { caption: message.text });
                    } else {
                        return await client.sendMessage(chatId, message.text);
                    }
                }, 3, 2000);
                
                if (result.success) {
                    message.status = 'sent';
                    message.sentAt = new Date().toISOString();
                    delete message.error;
                    successCount++;
                    console.log(`Retry successful for ${message.to}`);
                } else {
                    message.status = 'failed';
                    message.error = result.error || 'Unknown error';
                    failCount++;
                    console.error(`Retry failed for ${message.to}:`, result.error);
                }
                
                // Small delay between messages
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (err) {
                console.error(`Error retrying message to ${message.to}:`, err);
                message.status = 'failed';
                message.error = err.message;
                failCount++;
            }
        }
        
        // Save updated status
        fs.writeFileSync(bulkMessagesPath, JSON.stringify(bulkMessages, null, 2));
        
        res.json({
            success: true,
            message: `Retry completed: ${successCount} successful, ${failCount} failed`,
            successCount,
            failCount
        });
        
    } catch (err) {
        console.error('Error in bulk retry:', err);
        res.status(500).json({ 
            error: 'Failed to retry bulk messages', 
            details: err.message 
        });
    }
});

// Delete all records from a specific import
app.delete('/api/bulk-delete/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const records = readJson(BULK_FILE);
        const filteredRecords = records.filter(r => r.import_filename !== filename);
        
        writeJson(BULK_FILE, filteredRecords);
        
        res.json({ 
            success: true, 
            deleted: records.length - filteredRecords.length 
        });
    } catch (err) {
        console.error('Bulk delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Cancel all pending records from a specific import
app.post('/api/bulk-cancel/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const records = readJson(BULK_FILE);
        let cancelledCount = 0;
        
        for (let i = 0; i < records.length; i++) {
            if (records[i].import_filename === filename && records[i].status === 'pending') {
                records[i].status = 'cancelled';
                cancelledCount++;
            }
        }
        
        writeJson(BULK_FILE, records);
        
        res.json({ 
            success: true, 
            cancelled: cancelledCount 
        });
    } catch (err) {
        console.error('Bulk cancel error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Legacy bulk import endpoint (used by old code)
app.post('/api/bulk/import', csvUpload.single('csv'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });
    
    try {
        const csvData = req.file.buffer.toString('utf8');
        const records = parse(csvData, { 
            columns: true, 
            skip_empty_lines: true,
            trim: true
        });
        
        let errors = 0;
        const imported = [];
        const importFilename = req.file.originalname;
        const importDatetime = new Date().toISOString();
        
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (!record.number || !record.message) {
                errors++;
                continue;
            }
            
            // Add metadata
            record.import_filename = importFilename;
            record.import_datetime = importDatetime;
            record.unique_id = uuidv4();
            record.status = 'pending';
            
            imported.push(record);
        }
        
        // Append to bulk file
        const existing = readJson(BULK_FILE);
        existing.push(...imported);
        writeJson(BULK_FILE, existing);
        
        res.json({ imported: imported.length, errors });
    } catch (err) {
        console.error('Bulk import error:', err);
        res.status(500).json({ error: 'Failed to import CSV: ' + err.message });
    }
});

// Send bulk message now (legacy endpoint)
app.post('/api/bulk/send-now/:uid', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    
    try {
        const records = readJson(BULK_FILE);
        const recordIndex = records.findIndex(r => r.unique_id === req.params.uid);
        
        if (recordIndex === -1) {
            return res.status(404).json({ error: 'Record not found' });
        }
        
        const record = records[recordIndex];
        
        // Set send time to now and status to pending
        record.send_datetime = new Date().toISOString();
        record.status = 'pending';
        
        // Update the record
        records[recordIndex] = record;
        writeJson(BULK_FILE, records);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Bulk send-now error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Schedule bulk message (legacy endpoint)
app.post('/api/bulk/schedule/:uid', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    
    try {
        const records = readJson(BULK_FILE);
        const recordIndex = records.findIndex(r => r.unique_id === req.params.uid);
        
        if (recordIndex === -1) {
            return res.status(404).json({ error: 'Record not found' });
        }
        
        const record = records[recordIndex];
        
        // Set send time to 1 minute from now
        const oneMinuteFromNow = new Date(Date.now() + 60000);
        record.send_datetime = oneMinuteFromNow.toISOString();
        record.status = 'pending';
        
        // Update the record
        records[recordIndex] = record;
        writeJson(BULK_FILE, records);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Bulk schedule error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete bulk records by filename (legacy endpoint)
app.delete('/api/bulk/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const records = readJson(BULK_FILE);
        const filteredRecords = records.filter(r => r.import_filename !== filename);
        
        writeJson(BULK_FILE, filteredRecords);
        
        res.json({ 
            success: true, 
            deleted: records.length - filteredRecords.length 
        });
    } catch (err) {
        console.error('Bulk delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Cancel bulk records by filename (legacy endpoint)
app.post('/api/bulk/cancel/:filename', (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const records = readJson(BULK_FILE);
        let cancelledCount = 0;
        
        for (let i = 0; i < records.length; i++) {
            if (records[i].import_filename === filename && records[i].status === 'pending') {
                records[i].status = 'cancelled';
                cancelledCount++;
            }
        }
        
        writeJson(BULK_FILE, records);
        
        res.json({ 
            success: true, 
            cancelled: cancelledCount 
        });
    } catch (err) {
        console.error('Bulk cancel error:', err);
        res.status(500).json({ error: err.message });
    }
});

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
app.get('/api/detected-channels', (req, res) => {
    try {
        const channels = getDetectedChannels();
        res.json({ channels });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch detected channels', details: err.message });
    }
});

// Manual channel discovery endpoint
app.post('/api/channels/discover', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    
    try {
        console.log('[API] Manual channel discovery requested');
        await discoverChannels();
        const channels = getDetectedChannels();
        
        res.json({
            success: true,
            message: 'Channel discovery completed',
            channels: channels.length,
            discovered: channels
        });
    } catch (err) {
        console.error('Failed to discover channels:', err);
        res.status(500).json({ error: 'Failed to discover channels', details: err.message });
    }
});

// Get leads data
app.get('/api/leads', (req, res) => {
    try {
        const leadsData = readJson(LEADS_FILE);
        res.json(leadsData);
    } catch (err) {
        console.error('Failed to fetch leads:', err);
        res.status(500).json({ error: 'Failed to fetch leads', details: err.message });
    }
});

// Save leads data
app.post('/api/leads', (req, res) => {
    try {
        const { leads } = req.body;
        if (!leads || !Array.isArray(leads)) {
            return res.status(400).json({ error: 'Invalid leads data' });
        }
        
        // Ensure we don't exceed 200 records
        const limitedLeads = leads.slice(0, 200);
        
        writeJson(LEADS_FILE, { leads: limitedLeads });
        res.json({ success: true, count: limitedLeads.length });
    } catch (err) {
        console.error('Failed to save leads:', err);
        res.status(500).json({ error: 'Failed to save leads', details: err.message });
    }
});

// Get leads auto chat configuration
app.get('/api/leads/config', (req, res) => {
    try {
        const config = readJson(LEADS_CONFIG_FILE, {
            enabled: false,
            systemPrompt: '',
            includeJsonContext: true,
            autoReply: false,
            autoReplyPrompt: ''
        });
        res.json(config);
    } catch (err) {
        console.error('Failed to load leads config:', err);
        res.status(500).json({ error: 'Failed to load leads config', details: err.message });
    }
});

// Save leads auto chat configuration
app.post('/api/leads/config', (req, res) => {
    try {
        const { enabled, systemPrompt, includeJsonContext, autoReply, autoReplyPrompt } = req.body;
        
        const config = {
            enabled: Boolean(enabled),
            systemPrompt: systemPrompt || '',
            includeJsonContext: Boolean(includeJsonContext),
            autoReply: Boolean(autoReply),
            autoReplyPrompt: autoReplyPrompt || ''
        };
        
        writeJson(LEADS_CONFIG_FILE, config);
        console.log('Leads auto chat config saved:', config);
        res.json({ success: true, config });
    } catch (err) {
        console.error('Failed to save leads config:', err);
        res.status(500).json({ error: 'Failed to save leads config', details: err.message });
    }
});

// Gemini API endpoint for leads auto chat
app.post('/api/gemini/chat', async (req, res) => {
    try {
        const { systemPrompt, context, lead, autoReply, autoReplyPrompt, chatHistory } = req.body;
        
        if (!systemPrompt) {
            return res.status(400).json({ error: 'System prompt is required' });
        }

        let fullPrompt = systemPrompt;
        
        if (context) {
            fullPrompt += `\n\nLead Context:\n${context}`;
        }
        
        if (chatHistory) {
            fullPrompt += `\n\nChat History:\n${chatHistory}`;
        }
        
        if (autoReply && autoReplyPrompt) {
            fullPrompt += `\n\nAuto Reply Instructions:\n${autoReplyPrompt}`;
        }

        const response = await callGenAI({
            systemPrompt: fullPrompt,
            autoReplyPrompt: autoReplyPrompt || '',
            chatHistory: chatHistory || '',
            userMessage: `Generate a response for lead: ${lead.name} (${lead.mobile})`
        });

        res.json({ success: true, response });
    } catch (err) {
        console.error('Gemini chat error:', err);
        res.status(500).json({ error: 'Failed to generate response', details: err.message });
    }
});

// Proxy endpoint for external leads API (to avoid CORS issues)
app.post('/api/proxy/leads', async (req, res) => {
    try {
        const apiUrl = process.env.LEADS_API_URL;
        const apiKey = process.env.LEADS_API_KEY;

        if (!apiUrl || !apiKey) {
            return res.status(500).json({ 
                error: 'Leads API configuration missing', 
                details: 'LEADS_API_URL and LEADS_API_KEY environment variables must be set in .env file',
                configuration: {
                    required: [
                        'LEADS_API_URL=https://your-api-endpoint.com/api/leads',
                        'LEADS_API_KEY=your-api-key-here'
                    ],
                    sampleFormat: {
                        "success": true,
                        "data": [
                            {
                                "id": 1,
                                "name": "John Doe",
                                "phone": "+1234567890",
                                "email": "john@example.com",
                                "location": "New York",
                                "status": "active",
                                "created_at": "2025-01-27T10:00:00Z"
                            },
                            {
                                "id": 2,
                                "name": "Jane Smith",
                                "phone": "+1234567891",
                                "email": "jane@example.com",
                                "location": "Los Angeles",
                                "status": "pending",
                                "created_at": "2025-01-27T11:00:00Z"
                            },
                            {
                                "id": 3,
                                "name": "Bob Johnson",
                                "phone": "+1234567892",
                                "email": "bob@example.com",
                                "location": "Chicago",
                                "status": "active",
                                "created_at": "2025-01-27T12:00:00Z"
                            },
                            {
                                "id": 4,
                                "name": "Alice Brown",
                                "phone": "+1234567893",
                                "email": "alice@example.com",
                                "location": "Houston",
                                "status": "inactive",
                                "created_at": "2025-01-27T13:00:00Z"
                            },
                            {
                                "id": 5,
                                "name": "Charlie Wilson",
                                "phone": "+1234567894",
                                "email": "charlie@example.com",
                                "location": "Phoenix",
                                "status": "active",
                                "created_at": "2025-01-27T14:00:00Z"
                            }
                        ]
                    }
                }
            });
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ apikey: apiKey })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('Proxy leads API error:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch leads from external API', 
            details: err.message 
        });
    }
});

// Check if contact exists in WhatsApp
app.post('/api/contacts/check', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    
    try {
        const { mobile } = req.body;
        if (!mobile) {
            return res.status(400).json({ error: 'Mobile number is required' });
        }

        console.log('Checking contact status for:', mobile);

        // Normalize mobile number
        const normalizedNumber = mobile.replace(/[^0-9]/g, '');
        const chatId = normalizedNumber + '@c.us';
        
        console.log('Normalized chat ID:', chatId);
        
        // Try to get the contact using WhatsApp Web.js methods
        try {
            const contact = await client.getContactById(chatId._serialized || chatId);
            
            if (contact) {
                console.log('Contact found:', {
                    id: contact.id,
                    name: contact.name,
                    number: contact.number,
                    isMyContact: contact.isMyContact,
                    isWAContact: contact.isWAContact,
                    pushname: contact.pushname,
                    shortName: contact.shortName
                });
                
                // Check if contact has a proper name (not just the number or default name)
                const hasProperName = contact.name && 
                                    contact.name !== normalizedNumber && 
                                    contact.name !== `Contact ${normalizedNumber}` &&
                                    contact.name !== 'undefined' &&
                                    contact.name !== undefined &&
                                    contact.name.length > 0;
                
                console.log('Contact name check:', {
                    name: contact.name,
                    normalizedNumber: normalizedNumber,
                    hasProperName: hasProperName,
                    nameLength: contact.name ? contact.name.length : 0
                });
                
                // Contact exists if it's either in our contacts or is a WhatsApp user
                const exists = contact.isMyContact || contact.isWAContact;
                
                res.json({ 
                    exists: exists,
                    hasProperName: hasProperName,
                    contact: {
                        id: contact.id,
                        name: contact.name,
                        number: contact.number,
                        isMyContact: contact.isMyContact,
                        isWAContact: contact.isWAContact,
                        pushname: contact.pushname,
                        shortName: contact.shortName
                    }
                });
            } else {
                console.log('Contact not found');
                res.json({ exists: false, hasProperName: false });
            }
        } catch (contactErr) {
            console.log('Error getting contact, trying chat method:', contactErr.message);
            
            // Fallback: try to get the chat
            try {
                const chat = await client.getChatById(chatId);
                if (chat) {
                    console.log('Chat found for contact');
                    res.json({ exists: true, hasProperName: false, contact: { id: chat.id } });
                } else {
                    console.log('No chat found for contact');
                    res.json({ exists: false, hasProperName: false });
                }
            } catch (chatErr) {
                console.log('Contact not found (expected for new contacts):', chatErr.message);
                res.json({ exists: false, hasProperName: false });
            }
        }
    } catch (err) {
        console.error('Error checking contact status:', err);
        res.status(500).json({ 
            error: 'Failed to check contact status', 
            details: err.message 
        });
    }
});

// Test endpoint for debugging
app.get('/api/contacts/test', (req, res) => {
    res.json({ success: true, message: 'Contacts API is working' });
});

// Process leads contacts - add contacts for leads with failed/error status
app.post('/api/leads/process-contacts', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    
    try {
        console.log('[LEADS] Processing contacts for leads...');
        
        // Read leads data
        const leadsData = readJson(LEADS_FILE, { leads: [] });
        const leadsNeedingContacts = leadsData.leads.filter(lead => 
            lead.contact_added !== true && 
            lead.contact_added !== 'error' &&
            lead.mobile
        );
        
        console.log(`[LEADS] Found ${leadsNeedingContacts.length} leads needing contacts`);
        
        if (leadsNeedingContacts.length === 0) {
            return res.json({
                success: true,
                message: 'No leads need contact processing',
                processed: 0,
                successful: 0,
                failed: 0
            });
        }
        
        const results = [];
        const logs = [];
        
        for (let i = 0; i < leadsNeedingContacts.length; i++) {
            const lead = leadsNeedingContacts[i];
            const { mobile, name } = lead;
            
            // Find the original lead in the full leads data
            const originalLeadIndex = leadsData.leads.findIndex(l => l.mobile === mobile);
            if (originalLeadIndex === -1) {
                logs.push(`[${i + 1}] ⚠️ Lead not found in original data: ${mobile}`);
                continue;
            }
            
            logs.push(`[${i + 1}] 📞 Processing: ${mobile} (${name})`);
            
            try {
                // Normalize phone number
                const normalizedNumber = mobile.replace(/[^0-9]/g, '');
                const chatId = normalizedNumber + '@c.us';
                
                // Check if contact already exists
                let contactExists = false;
                let existingContact = null;
                
                try {
                    existingContact = await client.getContactById(chatId);
                    if (existingContact && existingContact.isMyContact) {
                        // Check if contact has proper name
                        const hasProperName = existingContact.name && 
                                            existingContact.name !== 'undefined' && 
                                            existingContact.name !== undefined && 
                                            existingContact.name !== `Contact ${normalizedNumber}` && 
                                            existingContact.name !== normalizedNumber;
                        
                        if (hasProperName) {
                            logs.push(`[${i + 1}] ✅ Contact already exists with proper name: ${existingContact.name}`);
                            results.push({
                                index: i,
                                success: true,
                                message: 'Contact already exists with proper name',
                                contact: {
                                    id: existingContact.id,
                                    name: existingContact.name,
                                    number: existingContact.number,
                                    isMyContact: existingContact.isMyContact,
                                    isWAContact: existingContact.isWAContact
                                }
                            });
                            contactExists = true;
                        } else {
                            logs.push(`[${i + 1}] ⚠️ Contact exists but needs name update: ${existingContact.name} -> ${name}`);
                        }
                    }
                } catch (err) {
                    logs.push(`[${i + 1}] ℹ️ Contact check failed, will add: ${err.message}`);
                }
                
                if (!contactExists) {
                    // Parse name into firstName and lastName
                    let firstName = '';
                    let lastName = '';
                    
                    if (name && name.trim()) {
                        const nameParts = name.trim().split(' ').filter(part => part.trim());
                        if (nameParts.length === 1) {
                            firstName = nameParts[0];
                            lastName = '';
                        } else if (nameParts.length >= 2) {
                            firstName = nameParts[0];
                            lastName = nameParts.slice(1).join(' ');
                        }
                    } else {
                        // Generate random name if no name provided
                        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                        firstName = Array.from({length: 6}, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
                        lastName = 'lead';
                        logs.push(`[${i + 1}] 🔄 Generated random name: ${firstName} ${lastName}`);
                    }
                    
                    // Add contact using saveOrEditAddressbookContact
                    const contactChatId = await client.saveOrEditAddressbookContact(
                        normalizedNumber,
                        firstName,
                        lastName,
                        true // syncToAddressbook = true
                    );
                    
                    logs.push(`[${i + 1}] ✅ Contact added successfully: ${firstName} ${lastName}`);
                    
                    // Verify the contact was added
                    try {
                        const newContact = await client.getContactById(contactChatId._serialized || contactChatId);
                        if (newContact) {
                            const hasProperName = newContact.name && 
                                                newContact.name !== 'undefined' && 
                                                newContact.name !== undefined && 
                                                newContact.name !== `Contact ${normalizedNumber}` && 
                                                newContact.name !== normalizedNumber;
                            
                            if (hasProperName) {
                                logs.push(`[${i + 1}] ✅ Contact verified with proper name: ${newContact.name}`);
                                results.push({
                                    index: i,
                                    success: true,
                                    message: 'Contact added successfully',
                                    contact: {
                                        id: newContact.id,
                                        name: newContact.name,
                                        number: newContact.number,
                                        isMyContact: newContact.isMyContact,
                                        isWAContact: newContact.isWAContact
                                    }
                                });
                                
                                // Update lead status
                                leadsData.leads[originalLeadIndex].contact_added = true;
                                leadsData.leads[originalLeadIndex].last_updated = new Date().toISOString();
                                
                            } else {
                                logs.push(`[${i + 1}] ⚠️ Contact added but name verification failed: ${newContact.name}`);
                                results.push({
                                    index: i,
                                    success: true,
                                    message: 'Contact added but name verification failed',
                                    contact: {
                                        id: newContact.id,
                                        name: newContact.name,
                                        number: newContact.number,
                                        isMyContact: newContact.isMyContact,
                                        isWAContact: newContact.isWAContact
                                    },
                                    needsManualNameUpdate: true
                                });
                                
                                // Update lead status
                                leadsData.leads[originalLeadIndex].contact_added = 'error';
                                leadsData.leads[originalLeadIndex].last_updated = new Date().toISOString();
                            }
                        } else {
                            logs.push(`[${i + 1}] ⚠️ Contact added but verification failed`);
                            results.push({
                                index: i,
                                success: true,
                                message: 'Contact added but verification failed',
                                chatId: contactChatId
                            });
                            
                            // Update lead status
                            leadsData.leads[originalLeadIndex].contact_added = 'error';
                            leadsData.leads[originalLeadIndex].last_updated = new Date().toISOString();
                        }
                    } catch (verifyErr) {
                        logs.push(`[${i + 1}] ⚠️ Contact added but verification error: ${verifyErr.message}`);
                        results.push({
                            index: i,
                            success: true,
                            message: 'Contact added but verification failed',
                            chatId: contactChatId,
                            verificationError: verifyErr.message
                        });
                        
                        // Update lead status
                        leadsData.leads[originalLeadIndex].contact_added = 'error';
                        leadsData.leads[originalLeadIndex].last_updated = new Date().toISOString();
                    }
                }
                
            } catch (err) {
                logs.push(`[${i + 1}] ❌ Failed to add contact: ${err.message}`);
                results.push({
                    index: i,
                    success: false,
                    error: err.message,
                    mobile: mobile
                });
                
                // Update lead status
                leadsData.leads[originalLeadIndex].contact_added = 'error';
                leadsData.leads[originalLeadIndex].last_updated = new Date().toISOString();
            }
        }
        
        // Save updated leads data
        writeJson(LEADS_FILE, leadsData);
        
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;
        
        logs.push(`\n📊 Summary: ${successCount} successful, ${errorCount} failed out of ${leadsNeedingContacts.length} total`);
        
        res.json({
            success: true,
            results: results,
            logs: logs,
            summary: {
                total: leadsNeedingContacts.length,
                successful: successCount,
                failed: errorCount
            }
        });
        
    } catch (err) {
        console.error('Error processing leads contacts:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to process leads contacts',
            details: err.message
        });
    }
});

// Add multiple contacts to WhatsApp
app.post('/api/contacts/add-multiple', async (req, res) => {
    console.log('[CONTACTS] Add multiple contacts endpoint called');
    console.log('[CONTACTS] Request body:', req.body);
    
    if (!ready) {
        console.log('[CONTACTS] WhatsApp not ready');
        return res.status(503).json({ error: 'WhatsApp not ready' });
    }
    
    try {
        const { contacts } = req.body;
        console.log('[CONTACTS] Contacts received:', contacts);
        
        if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
            console.log('[CONTACTS] Invalid contacts data');
            return res.status(400).json({ error: 'Contacts array is required' });
        }
        
        if (contacts.length > 1000) {
            return res.status(400).json({ error: 'Maximum 1000 contacts allowed per request' });
        }
        
        const results = [];
        const logs = [];
        
        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const { number, firstName, lastName, originalName } = contact;
            
            if (!number) {
                results.push({ 
                    index: i, 
                    success: false, 
                    error: 'Missing phone number',
                    number: number || 'unknown'
                });
                logs.push(`[${i + 1}] ❌ Missing phone number`);
                continue;
            }
            
            try {
                // Normalize phone number
                const normalizedNumber = number.replace(/[^0-9]/g, '');
                const chatId = normalizedNumber + '@c.us';
                
                logs.push(`[${i + 1}] 📞 Processing: ${number} (${originalName || firstName + ' ' + lastName})`);
                
                // Check if contact already exists
                let contactExists = false;
                try {
                    const existingContact = await client.getContactById(chatId);
                    if (existingContact && existingContact.isMyContact) {
                        logs.push(`[${i + 1}] ✅ Contact already exists: ${existingContact.name}`);
                        results.push({
                            index: i,
                            success: true,
                            message: 'Contact already exists',
                            contact: {
                                id: existingContact.id,
                                name: existingContact.name,
                                number: existingContact.number,
                                isMyContact: existingContact.isMyContact,
                                isWAContact: existingContact.isWAContact
                            }
                        });
                        contactExists = true;
                    }
                } catch (err) {
                    logs.push(`[${i + 1}] ℹ️ Contact check failed, will add: ${err.message}`);
                }
                
                if (!contactExists) {
                    // v1.34.2+ fix: firstName must never be empty
                    const finalFirstName = (firstName && firstName.trim()) ? firstName.trim() : normalizedNumber;
                    const finalLastName = (lastName && lastName.trim()) ? lastName.trim() : '';
                    
                    // Add contact using saveOrEditAddressbookContact
                    const contactChatId = await client.saveOrEditAddressbookContact(
                        normalizedNumber,
                        finalFirstName,  // Must not be empty
                        finalLastName,
                        true // syncToAddressbook = true
                    );
                    
                    logs.push(`[${i + 1}] ✅ Contact added successfully: ${firstName} ${lastName}`);
                    
                    // Verify the contact was added
                    try {
                        const newContact = await client.getContactById(contactChatId._serialized || contactChatId);
                        if (newContact) {
                            const hasProperName = newContact.name && 
                                                newContact.name !== 'undefined' && 
                                                newContact.name !== undefined && 
                                                newContact.name !== `Contact ${normalizedNumber}` && 
                                                newContact.name !== normalizedNumber;
                            
                            if (hasProperName) {
                                logs.push(`[${i + 1}] ✅ Contact verified with proper name: ${newContact.name}`);
                                results.push({
                                    index: i,
                                    success: true,
                                    message: 'Contact added successfully',
                                    contact: {
                                        id: newContact.id,
                                        name: newContact.name,
                                        number: newContact.number,
                                        isMyContact: newContact.isMyContact,
                                        isWAContact: newContact.isWAContact
                                    }
                                });
                            } else {
                                logs.push(`[${i + 1}] ⚠️ Contact added but name verification failed: ${newContact.name}`);
                                results.push({
                                    index: i,
                                    success: true,
                                    message: 'Contact added but name verification failed',
                                    contact: {
                                        id: newContact.id,
                                        name: newContact.name,
                                        number: newContact.number,
                                        isMyContact: newContact.isMyContact,
                                        isWAContact: newContact.isWAContact
                                    },
                                    needsManualNameUpdate: true
                                });
                            }
                        } else {
                            logs.push(`[${i + 1}] ⚠️ Contact added but verification failed`);
                            results.push({
                                index: i,
                                success: true,
                                message: 'Contact added but verification failed',
                                chatId: contactChatId
                            });
                        }
                    } catch (verifyErr) {
                        logs.push(`[${i + 1}] ⚠️ Contact added but verification error: ${verifyErr.message}`);
                        results.push({
                            index: i,
                            success: true,
                            message: 'Contact added but verification failed',
                            chatId: contactChatId,
                            verificationError: verifyErr.message
                        });
                    }
                }
                
            } catch (err) {
                logs.push(`[${i + 1}] ❌ Failed to add contact: ${err.message}`);
                results.push({
                    index: i,
                    success: false,
                    error: err.message,
                    number: number
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const errorCount = results.filter(r => !r.success).length;
        
        logs.push(`\n📊 Summary: ${successCount} successful, ${errorCount} failed`);
        
        res.json({
            success: true,
            results: results,
            logs: logs,
            summary: {
                total: contacts.length,
                successful: successCount,
                failed: errorCount
            }
        });
        
            } catch (err) {
            console.error('Error adding multiple contacts:', err);
            res.status(500).json({
                success: false,
                error: 'Failed to add contacts',
                details: err.message
            });
        }
    });

// Add contact to WhatsApp
app.post('/api/contacts/add', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    
    try {
        const { mobile, name } = req.body;
        if (!mobile) {
            return res.status(400).json({ error: 'Mobile number is required' });
        }

        console.log('Adding contact:', { mobile, name });

        // Normalize mobile number
        const normalizedNumber = mobile.replace(/[^0-9]/g, '');
        const chatId = normalizedNumber + '@c.us';
        
        console.log('Normalized chat ID:', chatId);
        
        // Check if contact already exists
        let existingContact = null;
        let needsUpdate = false;
        
        try {
            existingContact = await client.getContactById(chatId._serialized || chatId);
            if (existingContact) {
                console.log('Contact found:', {
                    id: existingContact.id,
                    name: existingContact.name,
                    number: existingContact.number,
                    isMyContact: existingContact.isMyContact,
                    isWAContact: existingContact.isWAContact
                });
                
                // Check if contact needs name update
                if (name && (!existingContact.name || existingContact.name === `Contact ${normalizedNumber}` || existingContact.name === normalizedNumber || existingContact.name === 'undefined' || existingContact.name === undefined)) {
                    console.log('Contact exists but needs name update:', existingContact.name, '->', name);
                    needsUpdate = true;
                } else if (name && existingContact.name === name) {
                    console.log('Contact already exists with correct name');
                    return res.json({ 
                        success: true, 
                        message: 'Contact already exists with correct name',
                        contact: {
                            id: existingContact.id,
                            name: existingContact.name,
                            number: existingContact.number,
                            isMyContact: existingContact.isMyContact,
                            isWAContact: existingContact.isWAContact
                        }
                    });
                } else {
                    console.log('Contact already exists with different name:', existingContact.name);
                    return res.json({ 
                        success: true, 
                        message: 'Contact already exists',
                        contact: {
                            id: existingContact.id,
                            name: existingContact.name,
                            number: existingContact.number,
                            isMyContact: existingContact.isMyContact,
                            isWAContact: existingContact.isWAContact
                        }
                    });
                }
            }
        } catch (err) {
            console.log('Contact does not exist, will add new contact');
            // Contact doesn't exist, continue to add
        }
        
        // If contact exists but needs name update, try to update it
        if (needsUpdate && existingContact) {
            try {
                console.log('Attempting to update contact name...');
                
                // Try to get the chat and update contact name
                const chat = await client.getChatById(chatId);
                if (chat) {
                    // Update the contact name in the chat
                    // Note: WhatsApp Web.js doesn't have a direct method to update contact name
                    // We'll try to recreate the contact with the correct name
                    console.log('Will recreate contact with proper name');
                }
            } catch (updateErr) {
                console.log('Could not update contact, will recreate:', updateErr.message);
            }
        }
        
        // Try to add or update contact using saveOrEditAddressbookContact
        try {
            console.log('Attempting to add/update contact using saveOrEditAddressbookContact...');
            
            // Parse name into firstName and lastName with improved handling
            let firstName = '';
            let lastName = '';
            
            if (name && typeof name === 'string' && name.trim()) {
                const trimmedName = name.trim();
                const nameParts = trimmedName.split(' ').filter(part => part.length > 0);
                
                if (nameParts.length === 0) {
                    // Empty or whitespace-only name
                    firstName = '';
                    lastName = '';
                } else if (nameParts.length === 1) {
                    // Single word name
                    firstName = nameParts[0];
                    lastName = '';
                } else if (nameParts.length === 2) {
                    // Two word name
                    firstName = nameParts[0];
                    lastName = nameParts[1];
                } else {
                    // Multiple word name - first word as firstName, rest as lastName
                    firstName = nameParts[0];
                    lastName = nameParts.slice(1).join(' ');
                }
            } else {
                // No name provided
                firstName = '';
                lastName = '';
            }
            
            console.log('Parsed name:', { firstName, lastName, originalName: name });
            
            // v1.34.2+ fix: firstName must never be empty (Nov 2025 fix)
            const finalFirstName = (firstName && firstName.trim()) ? firstName.trim() : normalizedNumber;
            const finalLastName = (lastName && lastName.trim()) ? lastName.trim() : '';
            
            // Call saveOrEditAddressbookContact with syncToAddressbook = true
            const chatId = await client.saveOrEditAddressbookContact(
                normalizedNumber, 
                finalFirstName,  // Must not be empty (v1.34.2+ fix)
                finalLastName, 
                true // syncToAddressbook = true
            );
            
            console.log('saveOrEditAddressbookContact successful, chatId:', chatId);
            
            // Verify the contact was added/updated
            // Use the original chatId string for verification, not the returned object
            try {
                const contact = await client.getContactById(chatId._serialized || chatId);
                
                if (contact) {
                    console.log('Contact successfully added/updated:', {
                        id: contact.id,
                        name: contact.name,
                        number: contact.number,
                        isMyContact: contact.isMyContact,
                        isWAContact: contact.isWAContact
                    });
                    
                    res.json({ 
                        success: true, 
                        message: 'Contact successfully added/updated',
                        contact: {
                            id: contact.id,
                            name: contact.name,
                            number: contact.number,
                            isMyContact: contact.isMyContact,
                            isWAContact: contact.isWAContact
                        }
                    });
                } else {
                    console.log('Contact added but could not verify');
                    res.json({ 
                        success: true, 
                        message: 'Contact added but verification failed',
                        chatId: chatId
                    });
                }
            } catch (verifyErr) {
                console.log('Verification failed but contact was likely added successfully:', verifyErr.message);
                // Since saveOrEditAddressbookContact succeeded, we'll consider this a success
                res.json({ 
                    success: true, 
                    message: 'Contact added successfully (verification failed)',
                    chatId: chatId,
                    verificationError: verifyErr.message
                });
            }
            
        } catch (addErr) {
            console.error('Error adding/updating contact with saveOrEditAddressbookContact:', addErr);
            
            // Fallback: try to verify if contact exists anyway
            try {
                const contact = await client.getContactById(chatId._serialized || chatId);
                
                if (contact && contact.isWAContact) {
                    console.log('Contact exists in WhatsApp (fallback verification):', {
                        id: contact.id,
                        name: contact.name,
                        number: contact.number,
                        isMyContact: contact.isMyContact,
                        isWAContact: contact.isWAContact
                    });
                    
                    res.json({ 
                        success: true, 
                        message: 'Contact exists in WhatsApp but name update may have failed',
                        contact: {
                            id: contact.id,
                            name: contact.name,
                            number: contact.number,
                            isMyContact: contact.isMyContact,
                            isWAContact: contact.isWAContact
                        },
                        needsManualNameUpdate: contact.name === undefined || contact.name === 'undefined'
                    });
                } else {
                    console.log('Contact does not exist in WhatsApp');
                    res.status(404).json({ 
                        success: false, 
                        error: 'Contact not found in WhatsApp',
                        details: 'The contact does not exist in WhatsApp'
                    });
                }
            } catch (verifyErr) {
                console.error('Error in fallback contact verification:', verifyErr);
                res.status(500).json({ 
                    success: false, 
                    error: 'Failed to add or verify contact', 
                    details: addErr.message 
                });
            }
        }
    } catch (err) {
        console.error('Error adding contact:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to add contact', 
            details: err.message 
        });
    }
});

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

// Get leads configuration
app.get('/api/leads-config', (req, res) => {
    try {
        const configPath = path.join(__dirname, 'leads-config.json');
        if (!fs.existsSync(configPath)) {
            return res.status(404).json({ error: 'Leads configuration file not found' });
        }
        
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        res.json(config);
    } catch (err) {
        console.error('Error reading leads config:', err);
        res.status(500).json({ error: 'Failed to read leads configuration' });
    }
});

// Save leads configuration
app.post('/api/leads-config', (req, res) => {
    try {
        const config = req.body;
        const configPath = path.join(__dirname, 'leads-config.json');
        
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        
        res.json({ success: true, message: 'Configuration saved successfully' });
    } catch (err) {
        console.error('Error saving leads config:', err);
        res.status(500).json({ error: 'Failed to save leads configuration' });
    }
});

// Upload media for message templates
app.post('/api/upload-media', upload.single('media'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const filePath = req.file.path;
        const fileName = req.file.filename;
        const fileUrl = `/message-templates/${fileName}`;

        console.log('Media uploaded:', { fileName, filePath, fileUrl });

        res.json({
            success: true,
            fileName: fileName,
            filePath: filePath,
            fileUrl: fileUrl
        });
    } catch (error) {
        console.error('Error uploading media:', error);
        res.status(500).json({ error: 'Failed to upload media', details: error.message });
    }
});

// Cloudflare API endpoints for external apps
app.get('/api/cloudflare/status', async (req, res) => {
    if (!cloudflareClient) {
        return res.status(503).json({ 
            error: 'Cloudflare sync not available',
            message: 'Cloudflare integration is not configured or not connected',
            available: false
        });
    }
    
    try {
        const status = await cloudflareClient.getStatus();
        res.json({ success: true, status, available: true });
    } catch (error) {
        res.status(500).json({ 
            error: 'Cloudflare sync temporarily unavailable',
            message: 'Unable to connect to Cloudflare sync service',
            available: false
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
setupBackupRoutes(app, client, () => ready, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson, DETECTED_CHANNELS_FILE);

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

