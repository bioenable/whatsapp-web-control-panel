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

function readJson(file, fallback = []) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return fallback;
    }
}
function writeJson(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max

// Initialize Express app
const app = express();
const PORT = 5014;

// Middleware
app.use(cors());
// Place all routes that use multer (file uploads) above this line
app.use(express.static(path.join(__dirname, 'public')));
app.use('/message-templates', express.static(TEMPLATE_MEDIA_DIR));
app.use(bodyParser.json());

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
        // Send message
        try {
            const normalizedNumber = r.number.trim();
            const chatId = !normalizedNumber.endsWith('@c.us') && !normalizedNumber.endsWith('@g.us')
                ? normalizedNumber.replace(/[^0-9]/g, '') + '@c.us'
                : normalizedNumber;
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
                    const absPath = path.join(__dirname, r.media);
                    if (!fs.existsSync(absPath)) throw new Error('Media file not found');
                    const buf = fs.readFileSync(absPath);
                    const mime = require('mime-types').lookup(absPath) || 'application/octet-stream';
                    media = new MessageMedia(mime, buf.toString('base64'), path.basename(absPath));
                }
                await client.sendMessage(chatId, media, { caption: r.message });
            } else {
                await client.sendMessage(chatId, r.message);
            }
            records[i].status = 'sent';
            records[i].sent_datetime = new Date().toISOString();
            changed = true;
            writeJson(BULK_FILE, records);
            await new Promise(res => setTimeout(res, BULK_SEND_DELAY_SEC * 1000));
        } catch (err) {
            console.error('Bulk send error:', err);
            records[i].status = 'failed';
            records[i].sent_datetime = new Date().toISOString();
            changed = true;
            writeJson(BULK_FILE, records);
        }
    }
    if (changed) writeJson(BULK_FILE, records);
}, 30000);

// Utility to append to sent messages log
function appendSentMessageLog(entry) {
    console.log('[DEBUG] appendSentMessageLog called with:', entry);
    let logs = readJson(SENT_MESSAGES_FILE);
    logs.unshift(entry); // newest first
    if (logs.length > 1000) logs = logs.slice(0, 1000); // cap to 1000
    writeJson(SENT_MESSAGES_FILE, logs);
    console.log('[DEBUG] sent_messages.json updated, total logs:', logs.length);
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
            console.log(`[DEBUG] Attempting to download media from URL: ${mediaUrl}`);
            const response = await fetch(mediaUrl);
            if (!response.ok) {
                console.error(`[DEBUG] Failed to download media from URL: ${mediaUrl}, status: ${response.status}`);
                return res.status(400).json({ error: 'Failed to download media from URL' });
            }
            const arrayBuffer = await response.arrayBuffer();
            const buf = Buffer.from(arrayBuffer);
            // Try to get filename from URL
            const urlParts = mediaUrl.split('/');
            let filename = urlParts[urlParts.length - 1].split('?')[0] || 'media';
            // Try to get mimetype from response headers or filename
            let mimetype = response.headers.get('content-type') || '';
            if (!mimetype || mimetype === 'application/octet-stream') {
                if (filename.match(/\.(jpg|jpeg)$/i)) mimetype = 'image/jpeg';
                else if (filename.match(/\.png$/i)) mimetype = 'image/png';
                else if (filename.match(/\.gif$/i)) mimetype = 'image/gif';
                else if (filename.match(/\.webp$/i)) mimetype = 'image/webp';
                else if (filename.match(/\.mp4$/i)) mimetype = 'video/mp4';
                else if (filename.match(/\.pdf$/i)) mimetype = 'application/pdf';
                else mimetype = '';
            }
            // Only allow image, video, or pdf
            if (!mimetype.startsWith('image/') && !mimetype.startsWith('video/') && mimetype !== 'application/pdf') {
                console.error(`[DEBUG] Unsupported media type from URL: ${mediaUrl}, detected mimetype: ${mimetype}`);
                return res.status(400).json({ error: 'Unsupported media type from URL: ' + mimetype });
            }
            console.log(`[DEBUG] Downloaded media from URL: ${mediaUrl}, filename: ${filename}, mimetype: ${mimetype}, size: ${buf.length}`);
            const media = new MessageMedia(
                mimetype,
                buf.toString('base64'),
                filename
            );
            await client.sendMessage(chatId, media, { caption: message });
            mediaInfo = { filename, mimetype };
            console.log(`[DEBUG] Sent media to ${chatId} (from URL: ${mediaUrl})`);
        } else {
            await client.sendMessage(chatId, message);
            console.log(`Sent text to ${chatId}`);
        }
        // Log sent message
        console.log('[DEBUG] Logging sent message to file:', { to: number, message, media: mediaInfo, status: 'sent', time: new Date().toISOString() });
        appendSentMessageLog({
            to: number,
            message,
            media: mediaInfo,
            status: 'sent',
            time: new Date().toISOString()
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Templates API ---
app.get('/api/templates', (req, res) => {
    res.json(readJson(TEMPLATES_FILE));
});
app.post('/api/templates', templateMediaUpload.single('media'), (req, res) => {
    if (!req.body) {
        console.error('[DEBUG] /api/templates POST: req.body is undefined.');
        return res.status(400).json({ error: 'Form data missing. Ensure the form uses enctype="multipart/form-data" and all fields are present.' });
    }
    const { name, text } = req.body;
    if (!name || !text) {
        console.error('[DEBUG] /api/templates POST: name or text missing in req.body:', req.body);
        return res.status(400).json({ error: 'Name and text required' });
    }
    const templates = readJson(TEMPLATES_FILE);
    const id = uuidv4();
    let media = '';
    if (req.file) {
        media = '/message-templates/' + req.file.filename;
    }
    templates.push({ id, name, text, media });
    writeJson(TEMPLATES_FILE, templates);
    res.json({ success: true, id });
});
app.put('/api/templates/:id', templateMediaUpload.single('media'), (req, res) => {
    const { id } = req.params;
    const { name, text, removeMedia } = req.body;
    let templates = readJson(TEMPLATES_FILE);
    const idx = templates.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    // Remove old media if replaced or removed
    if ((req.file || removeMedia === 'true') && templates[idx].media) {
        const oldPath = path.join(__dirname, 'public', templates[idx].media.replace(/^\//, ''));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    let media = templates[idx].media;
    if (req.file) {
        media = '/message-templates/' + req.file.filename;
    } else if (removeMedia === 'true') {
        media = '';
    }
    templates[idx] = { ...templates[idx], name, text, media };
    writeJson(TEMPLATES_FILE, templates);
    res.json({ success: true });
});
app.delete('/api/templates/:id', (req, res) => {
    const { id } = req.params;
    let templates = readJson(TEMPLATES_FILE);
    const idx = templates.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    // Remove media file if exists
    if (templates[idx].media) {
        const oldPath = path.join(__dirname, 'public', templates[idx].media.replace(/^\//, ''));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    templates = templates.filter(t => t.id !== id);
    writeJson(TEMPLATES_FILE, templates);
    res.json({ success: true });
});

// --- Bulk Messaging API ---
app.get('/api/bulk', (req, res) => {
    // Pagination: ?page=1&limit=100
    const { page = 1, limit = 1000, import_filename } = req.query;
    let records = readJson(BULK_FILE);
    if (import_filename) records = records.filter(r => r.import_filename === import_filename);
    const start = (page - 1) * limit;
    const end = start + parseInt(limit);
    res.json({
        total: records.length,
        records: records.slice(start, end)
    });
});
app.post('/api/bulk/import', upload.single('csv'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    const csv = req.file.buffer.toString('utf8');
    let records = readJson(BULK_FILE);
    let errorCount = 0;
    let import_filename = req.file.originalname;
    let import_datetime = new Date().toISOString();
    let tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    let parsed;
    try {
        parsed = parse(csv, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });
    } catch (e) {
        return res.status(400).json({ error: 'CSV parse error: ' + e.message });
    }
    const newRecords = [];
    for (const rec of parsed) {
        if (!rec.number || !rec.message) {
            errorCount++;
            continue;
        }
        // Validate send_datetime
        let send_datetime = rec.send_datetime || '';
        let sendDate;
        if (send_datetime) {
            // Try to parse as ISO or local
            sendDate = new Date(send_datetime);
            if (isNaN(sendDate.getTime())) {
                // Try parsing as local time in system timezone
                try {
                    const [datePart, timePart] = send_datetime.split('T');
                    if (datePart && timePart) {
                        // e.g. 2025-07-17T10:00:00
                        sendDate = new Date(`${datePart}T${timePart}`);
                    }
                } catch {}
            }
        }
        if (!sendDate || isNaN(sendDate.getTime())) {
            // Default to 10 min after import
            sendDate = new Date(new Date(import_datetime).getTime() + 10 * 60000);
            send_datetime = sendDate.toISOString();
        } else {
            send_datetime = sendDate.toISOString();
        }
        // Enforce 10 min after import
        if (sendDate.getTime() < new Date(import_datetime).getTime() + 10 * 60000) {
            errorCount++;
            continue;
        }
        const unique_id = uuidv4();
        newRecords.push({
            ...rec,
            send_datetime,
            import_filename,
            import_datetime,
            unique_id,
            status: 'pending',
            sent_datetime: ''
        });
    }
    records = records.concat(newRecords);
    writeJson(BULK_FILE, records);
    res.json({ success: true, imported: newRecords.length, errors: errorCount });
});
app.delete('/api/bulk/:import_filename', (req, res) => {
    const { import_filename } = req.params;
    let records = readJson(BULK_FILE);
    const before = records.length;
    records = records.filter(r => r.import_filename !== import_filename);
    writeJson(BULK_FILE, records);
    res.json({ success: true, deleted: before - records.length });
});
app.post('/api/bulk/cancel/:import_filename', (req, res) => {
    const { import_filename } = req.params;
    let records = readJson(BULK_FILE);
    let changed = 0;
    records = records.map(r => {
        if (r.import_filename === import_filename && r.status === 'pending') {
            changed++;
            return { ...r, status: 'canceled' };
        }
        return r;
    });
    writeJson(BULK_FILE, records);
    res.json({ success: true, canceled: changed });
});
app.post('/api/bulk/update-status/:unique_id', (req, res) => {
    const { unique_id } = req.params;
    const { status, sent_datetime } = req.body;
    let records = readJson(BULK_FILE);
    const idx = records.findIndex(r => r.unique_id === unique_id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    records[idx] = { ...records[idx], status, sent_datetime };
    writeJson(BULK_FILE, records);
    res.json({ success: true });
});

// --- Bulk Message Test Endpoints ---
app.post('/api/bulk/send-now/:unique_id', async (req, res) => {
    const { unique_id } = req.params;
    let records = readJson(BULK_FILE);
    const idx = records.findIndex(r => r.unique_id === unique_id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const r = records[idx];
    if (r.status === 'sent') return res.status(400).json({ error: 'Already sent' });
    try {
        const normalizedNumber = r.number.trim();
        const chatId = !normalizedNumber.endsWith('@c.us') && !normalizedNumber.endsWith('@g.us')
            ? normalizedNumber.replace(/[^0-9]/g, '') + '@c.us'
            : normalizedNumber;
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
                const absPath = path.join(__dirname, r.media);
                if (!fs.existsSync(absPath)) throw new Error('Media file not found');
                const buf = fs.readFileSync(absPath);
                const mime = require('mime-types').lookup(absPath) || 'application/octet-stream';
                media = new MessageMedia(mime, buf.toString('base64'), path.basename(absPath));
            }
            await client.sendMessage(chatId, media, { caption: r.message });
        } else {
            await client.sendMessage(chatId, r.message);
        }
        records[idx].status = 'sent';
        records[idx].sent_datetime = new Date().toISOString();
        writeJson(BULK_FILE, records);
        res.json({ success: true, status: 'sent' });
    } catch (err) {
        console.error('Bulk send-now error:', err);
        res.status(500).json({ error: err.message });
    }
});
app.post('/api/bulk/schedule/:unique_id', (req, res) => {
    const { unique_id } = req.params;
    let records = readJson(BULK_FILE);
    const idx = records.findIndex(r => r.unique_id === unique_id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const now = new Date();
    const newSend = new Date(now.getTime() + 60 * 1000).toISOString();
    records[idx].send_datetime = newSend;
    records[idx].status = 'pending';
    records[idx].sent_datetime = '';
    writeJson(BULK_FILE, records);
    res.json({ success: true, send_datetime: newSend, status: 'pending' });
});

// API to get system time and timezone
app.get('/api/time', (req, res) => {
    let tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    let now = new Date();
    res.json({
        now: now.toLocaleString('en-US', { timeZone: tz }),
        timezone: tz,
        iso: now.toISOString()
    });
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