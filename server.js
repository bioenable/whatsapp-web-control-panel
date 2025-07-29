const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('./whatsapp-web');
const multer = require('multer');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const TEMPLATES_FILE = path.join(__dirname, 'templates.json');
const BULK_FILE = path.join(__dirname, 'bulk_messages.json');
const SENT_MESSAGES_FILE = path.join(__dirname, 'sent_messages.json');
const DETECTED_CHANNELS_FILE = path.join(__dirname, 'detected_channels.json');
const LEADS_FILE = path.join(__dirname, 'leads.json');
const LEADS_CONFIG_FILE = path.join(__dirname, 'leads-config.json');
const fetch = require('node-fetch'); // Add at the top with other requires
const TEMPLATE_MEDIA_DIR = path.join(__dirname, 'public', 'message-templates');
if (!fs.existsSync(TEMPLATE_MEDIA_DIR)) fs.mkdirSync(TEMPLATE_MEDIA_DIR, { recursive: true });
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
const GOOGLE_MODEL = process.env.GOOGLE_MODEL || 'gemini-2.0-flash';
const AUTOMATIONS_FILE = path.join(__dirname, 'automations.json');
const cron = require('node-cron');
const { GoogleGenAI } = require('@google/genai');
const mime = require('mime-types');

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
const genAIConfig = { tools: [groundingTool], output_token_limit: 512 };
async function callGenAI({ systemPrompt, autoReplyPrompt, chatHistory, userMessage }) {
  // Compose prompt for grounding
  const contents = `${systemPrompt}\n\nChat history:\n${chatHistory}\n\nUser: ${userMessage}\n\n${autoReplyPrompt}`;
  try {
    const response = await genAI.models.generateContent({
      model: process.env.GOOGLE_MODEL || 'gemini-2.5-flash',
      contents,
      config: genAIConfig
    });
    return response.text;
  } catch (err) {
    console.error('[GenAI] Error:', err);
    return null;
  }
}
function appendAutomationLog(automation, entry) {
  try {
    const logPath = path.join(__dirname, automation.logFile);
    let logs = [];
    if (fs.existsSync(logPath)) {
      try { logs = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch {}
    }
    logs.unshift({ ...entry, time: new Date().toISOString() });
    
    // Keep only last 1000 log entries to prevent disk space issues
    if (logs.length > 1000) {
      logs = logs.slice(0, 1000);
    }
    
    const writeSuccess = writeJson(logPath, logs);
    if (!writeSuccess) {
      console.log(`[AUTOMATION] Failed to save log due to disk space: ${automation.chatName}`);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to append automation log:`, error.message);
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
const PORT = 5014;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/message-templates', express.static(TEMPLATE_MEDIA_DIR));

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: false, 
        protocolTimeout: 300000, // Increased to 5 minutes
        timeout: 60000,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection'
        ]
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
    try {
        chatsCache = await client.getChats();
        console.log(`Loaded ${chatsCache.length} chats`);
    } catch (err) {
        console.error('Failed to load chats:', err);
        chatsCache = [];
    }
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

client.on('message', async (msg) => {
    console.log('New message received:', msg.body);
    console.log('Message from:', msg.from, 'Type:', msg.type, 'Author:', msg.author);
    
    // Check if this is a channel message (not from @c.us or @g.us, or specifically from @newsletter)
    const from = msg.from || msg.author;
    const isChannelMessage = from && (!from.endsWith('@c.us') && !from.endsWith('@g.us') || from.endsWith('@newsletter'));
    
    if (isChannelMessage) {
        console.log('Channel message detected from:', from);
        // Store in detected channels file
        addDetectedChannel(from, {
            lastMessage: msg.body ? msg.body.substring(0, 100) : '',
            lastSeen: new Date().toISOString(),
            type: from.endsWith('@newsletter') ? 'newsletter' : (from === 'status@broadcast' ? 'broadcast' : 'channel')
        });
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
        
        // 1. Check regular automations first
        const automations = readAutomations().filter(a => a.status === 'active' && a.chatId === msg.from);
        for (const a of automations) {
            // Skip channel automations for auto-reply (channels only support scheduled messages)
            const isChannel = a.automationType === 'channel' || a.chatId.endsWith('@newsletter') || a.chatId.endsWith('@broadcast');
            if (isChannel) continue;
            
            // Compose chat history (last 100 messages)
            let chatHistory = '';
            try {
                const chat = await client.getChatById(a.chatId);
                const msgs = await chat.fetchMessages({ limit: 100 });
                chatHistory = msgs.map(m => `${m.fromMe ? 'Me' : 'User'}: ${m.body}`).join('\n');
            } catch (err) {
                console.error(`[AUTOMATION] Failed to get chat history for auto-reply:`, err.message);
                // Continue without chat history if frame is detached
                if (err.message.includes('detached Frame')) {
                    console.log('[AUTOMATION] Frame detached, continuing without chat history');
                }
            }
            // Call GenAI
            const aiReply = await callGenAI({
                systemPrompt: a.systemPrompt,
                autoReplyPrompt: a.autoReplyPrompt,
                chatHistory,
                userMessage: msg.body
            });
            if (!aiReply) {
                appendAutomationLog(a, { type: 'error', message: 'GenAI failed for auto-reply' });
                continue;
            }
            try {
                await msg.reply(aiReply);
                appendAutomationLog(a, { type: 'auto-reply', message: aiReply });
                processed = true;
            } catch (err) {
                console.error(`[AUTOMATION] Failed to send auto-reply:`, err.message);
                if (err.message.includes('detached Frame')) {
                    console.log(`[AUTOMATION] Frame detached during auto-reply, skipping`);
                    appendAutomationLog(a, { type: 'error', message: 'Frame detached - WhatsApp Web needs reconnection' });
                } else {
                    appendAutomationLog(a, { type: 'error', message: 'Failed to send auto-reply: ' + err.message });
                }
            }
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

// Initialize WhatsApp client with error handling
async function initializeWhatsAppClient() {
    try {
        console.log('[INIT] Starting WhatsApp client initialization...');
        await client.initialize();
    } catch (err) {
        console.error('[INIT] Failed to initialize WhatsApp client:', err.message);
        console.log('[INIT] Retrying in 30 seconds...');
        
        // Retry after 30 seconds
        setTimeout(async () => {
            try {
                console.log('[INIT] Retrying WhatsApp client initialization...');
                await client.initialize();
            } catch (retryErr) {
                console.error('[INIT] Retry failed:', retryErr.message);
            }
        }, 30000);
    }
}

initializeWhatsAppClient();

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
        // Send message with retry mechanism
        try {
            const normalizedNumber = r.number.trim();
            const chatId = !normalizedNumber.endsWith('@c.us') && !normalizedNumber.endsWith('@g.us')
                ? normalizedNumber.replace(/[^0-9]/g, '') + '@c.us'
                : normalizedNumber;
            
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
            
            // Call GenAI to generate scheduled message
            const scheduledMessage = await callGenAI({
                systemPrompt: automation.systemPrompt,
                autoReplyPrompt: automation.scheduledPrompt || automation.autoReplyPrompt,
                chatHistory,
                userMessage: 'Generate a scheduled message for today'
            });
            
            if (!scheduledMessage) {
                console.error(`[AUTOMATION] GenAI failed to generate message for ${automation.chatName}`);
                appendAutomationLog(automation, { type: 'error', message: 'GenAI failed for scheduled message' });
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
            
            // Log the scheduled message
            appendAutomationLog(automation, { type: 'scheduled', message: scheduledMessage });
            
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
    const { chatId, chatName, systemPrompt, autoReplyPrompt, schedule, status, automationType } = req.body;
    
    // Validation based on automation type
    if (!chatId || !chatName || !systemPrompt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const isChannel = automationType === 'channel' || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast');
    
    if (!isChannel && !autoReplyPrompt) {
      return res.status(400).json({ error: 'Auto Reply Prompt is required for chat automations' });
    }
    
    if (isChannel && !schedule) {
      return res.status(400).json({ error: 'Schedule is required for channel automations' });
    }
    
    const id = uuidv4();
    const newAutomation = {
      id, chatId, chatName, systemPrompt, autoReplyPrompt, schedule: schedule || null, status: status || 'active',
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
    const { chatId, chatName, systemPrompt, autoReplyPrompt, schedule, status, automationType } = req.body;
    
    // Validation based on automation type
    const isChannel = automationType === 'channel' || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast');
    
    if (!isChannel && !autoReplyPrompt) {
      return res.status(400).json({ error: 'Auto Reply Prompt is required for chat automations' });
    }
    
    if (isChannel && !schedule) {
      return res.status(400).json({ error: 'Schedule is required for channel automations' });
    }
    
    Object.assign(automations[idx], { 
      chatId, chatName, systemPrompt, autoReplyPrompt, schedule: schedule || null, status,
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
// Get automation log (paginated)
app.get('/api/automations/:id/log', (req, res) => {
  try {
    const automations = readAutomations();
    const automation = automations.find(a => a.id === req.params.id);
    if (!automation) return res.status(404).json({ error: 'Automation not found' });
    const logPath = path.join(__dirname, automation.logFile);
    if (!fs.existsSync(logPath)) return res.json([]);
    const logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    // Simple pagination
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    res.json({ logs: logs.slice(start, end), total: logs.length });
  } catch (err) {
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
    
    res.json({ 
        status: connectionStatus, 
        qr: connectionStatus === 'qr' ? qrCode : null,
        ready: ready && connectionStatus !== 'disconnected' && connectionStatus !== 'error',
        frameDetached: connectionStatus === 'error' || connectionStatus === 'disconnected'
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
            unreadCount: chat.unreadCount
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
        const msgs = await chat.fetchMessages({ limit: 50 });
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
        console.error('Failed to fetch messages:', err);
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
                const chatId = message.to + '@c.us';
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

// Start the Express server
app.listen(PORT, () => {
  console.log(`WhatsApp Web Control Server running at http://localhost:${PORT}`);
});

// Get all detected channels (from message stream)
app.get('/api/detected-channels', (req, res) => {
    try {
        const channels = getDetectedChannels();
        res.json({ channels });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch detected channels', details: err.message });
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
        const apiUrl = 'https://dashboard.geosquare.in/api/get_registrations';
        const apiKey = 'GEOREG25URSECRET';

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
        
        // Try to get the chat
        const chat = await client.getChatById(chatId);
        
        // If we can get the chat, the contact exists
        const exists = chat && chat.id;
        
        console.log('Contact exists:', exists);
        res.json({ exists: !!exists });
    } catch (err) {
        console.log('Contact not found (expected for new contacts):', err.message);
        // If chat doesn't exist, it will throw an error
        res.json({ exists: false });
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
        try {
            const existingChat = await client.getChatById(chatId);
            if (existingChat) {
                console.log('Contact already exists');
                return res.json({ success: true, message: 'Contact already exists' });
            }
        } catch (err) {
            console.log('Contact does not exist, will add new contact');
            // Contact doesn't exist, continue to add
        }
        
        // Add contact to WhatsApp
        const contact = await client.addContact({
            id: chatId,
            name: name || `Contact ${normalizedNumber}`
        });
        
        console.log('Contact added successfully:', contact.id);
        res.json({ success: true, message: 'Contact added successfully' });
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

