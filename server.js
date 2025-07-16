const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('./whatsapp-web');
const multer = require('multer');
const qrcode = require('qrcode-terminal');

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max

// Initialize Express app
const app = express();
const PORT = 5014;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: false, 
        protocolTimeout: 120000,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
});

client.on('message', async (msg) => {
    console.log('New message received:', msg.body);
    // Optionally update chats cache on new message
    if (ready) {
        try {
            chatsCache = await client.getChats();
        } catch (err) {
            // Ignore errors
        }
    }
});

// Initialize WhatsApp client
client.initialize();

// API Routes

// Get WhatsApp status and QR code
app.get('/api/status', (req, res) => {
    res.json({ status: waStatus, qr: qrCode });
});

// Get all chats
app.get('/api/chats', async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp client not ready' });
    try {
        const chats = await client.getChats();
        res.json(chats.map(chat => ({
            id: chat.id._serialized,
            name: chat.name || chat.formattedTitle || chat.id.user,
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount
        })));
    } catch (err) {
        console.error('Failed to fetch chats:', err);
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

// Send message (with optional media)
app.post('/api/messages/send', upload.single('media'), async (req, res) => {
    if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
    
    // When using multipart/form-data, form fields are in req.body
    // But if the body is undefined (which can happen with some configurations),
    // we need to handle it gracefully
    const number = req.body?.number;
    const message = req.body?.message || '';
    
    if (!number) return res.status(400).json({ error: 'Missing number' });
    
    // Normalize WhatsApp ID
    const normalizedNumber = number.trim();
    const chatId = !normalizedNumber.endsWith('@c.us') && !normalizedNumber.endsWith('@g.us')
        ? normalizedNumber.replace(/[^0-9]/g, '') + '@c.us'
        : normalizedNumber;
    
    try {
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
            console.log(`Sent media to ${chatId} (${req.file.originalname})`);
        } else {
            await client.sendMessage(chatId, message);
            console.log(`Sent text to ${chatId}`);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Serve the main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start the server
app.listen(PORT, () => {
    console.log(`WhatsApp Web Control Server running at http://localhost:${PORT}`);
}); 