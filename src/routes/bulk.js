const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
// Use local MessageMedia (with custom fixes) instead of npm package
const { MessageMedia } = require('../structures');
const parse = require('csv-parse/sync').parse;
const mime = require('mime-types');

function setupBulkRoutes(app, { 
    readJson, 
    writeJson, 
    getAccountPaths, 
    BULK_FILE,
    client,
    getReady,
    csvUpload,
    retryOperation
}) {
    // Don't cache ready state - check it each time
    
    // Get bulk messages with pagination
    app.get('/api/bulk', (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 100;
            
            // Get account paths - handle both function and direct object
            let accountPathsObj = null;
            if (typeof getAccountPaths === 'function') {
                accountPathsObj = getAccountPaths();
            } else {
                accountPathsObj = getAccountPaths;
            }
            
            const bulkFilePath = accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE;
            const records = readJson(bulkFilePath, []);
            const start = (page - 1) * limit;
            const end = start + limit;
            res.json({
                records: records.slice(start, end),
                total: records.length
            });
        } catch (err) {
            console.error('[BULK-GET] Failed to fetch bulk messages:', err);
            console.error('[BULK-GET] Error stack:', err.stack);
            res.status(500).json({ error: 'Failed to fetch bulk messages', details: err.message });
        }
    });

    // Import bulk messages from CSV (legacy endpoint)
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
            
            const accountPathsObj = getAccountPaths();
            
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
            const existing = readJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE);
            existing.push(...imported);
            writeJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE, existing);
            
            res.json({ imported: imported.length, errors });
        } catch (err) {
            console.error('Bulk import error:', err);
            res.status(500).json({ error: 'Failed to import CSV: ' + err.message });
        }
    });

    // Get bulk imports with pagination and filtering
    app.get('/api/bulk-imports', (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 100;
            const importFilename = req.query.import_filename;
            const accountPathsObj = getAccountPaths();
            
            let records = readJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE);
            
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
        } catch (err) {
            console.error('Failed to fetch bulk imports:', err);
            res.status(500).json({ error: 'Failed to fetch bulk imports', details: err.message });
        }
    });

    // Test send a specific bulk record
    app.post('/api/bulk-test/:id', async (req, res) => {
        const ready = getReady();
        if (!ready) {
            console.error('[BULK-TEST] WhatsApp not ready');
            return res.status(503).json({ error: 'WhatsApp not ready' });
        }
        
        const { action } = req.body;
        const recordId = req.params.id;
        
        try {
            // Get account paths - handle both function and direct object
            let accountPathsObj = null;
            if (typeof getAccountPaths === 'function') {
                accountPathsObj = getAccountPaths();
            } else {
                accountPathsObj = getAccountPaths;
            }
            
            console.log('[BULK-TEST] Processing test send for record:', recordId, 'action:', action);
            console.log('[BULK-TEST] Account paths:', accountPathsObj ? 'available' : 'not available');
            
            const bulkFilePath = accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE;
            console.log('[BULK-TEST] Reading bulk file from:', bulkFilePath);
            
            const records = readJson(bulkFilePath, []);
            console.log('[BULK-TEST] Total records in file:', records.length);
            
            const recordIndex = records.findIndex(r => r.unique_id === recordId);
            
            if (recordIndex === -1) {
                console.error('[BULK-TEST] Record not found:', recordId);
                return res.status(404).json({ error: 'Record not found' });
            }
            
            const record = records[recordIndex];
            console.log('[BULK-TEST] Found record:', record.number, record.message?.substring(0, 50));
            
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
            writeJson(bulkFilePath, records);
            
            console.log('[BULK-TEST] Record updated successfully, status set to pending');
            res.json({ success: true, message: 'Record queued for sending' });
        } catch (err) {
            console.error('[BULK-TEST] Error:', err);
            console.error('[BULK-TEST] Error stack:', err.stack);
            res.status(500).json({ error: err.message, details: err.stack });
        }
    });

    // Retry failed bulk messages
    app.post('/api/bulk-retry/:filename', async (req, res) => {
        const ready = getReady();
        if (!ready) {
            console.error('[BULK-RETRY] WhatsApp not ready');
            return res.status(503).json({ error: 'WhatsApp not ready' });
        }
        
        try {
            const { filename } = req.params;
            const accountPathsObj = getAccountPaths();
            const bulkMessagesPath = accountPathsObj ? accountPathsObj.bulkFile : path.join(__dirname, '../../bulk_messages.json');
            
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
                                mediaPath = path.join(__dirname, '../../public', mediaPath);
                            } else {
                                mediaPath = path.join(__dirname, '../../', mediaPath);
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
                    
                    try {
                        const sentMessage = await retryOperation(async () => {
                            if (media) {
                                return await client.sendMessage(chatId, media, { caption: message.text });
                            } else {
                                return await client.sendMessage(chatId, message.text);
                            }
                        }, 3, 2000);
                        
                        message.status = 'sent';
                        message.sentAt = new Date().toISOString();
                        delete message.error;
                        successCount++;
                        console.log(`Retry successful for ${message.to}`);
                    } catch (sendErr) {
                        message.status = 'failed';
                        message.error = sendErr.message || 'Unknown error';
                        failCount++;
                        console.error(`Retry failed for ${message.to}:`, sendErr.message);
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
            const accountPathsObj = getAccountPaths();
            const records = readJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE);
            const filteredRecords = records.filter(r => r.import_filename !== filename);
            
            writeJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE, filteredRecords);
            
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
            const accountPathsObj = getAccountPaths();
            const records = readJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE);
            let cancelledCount = 0;
            
            for (let i = 0; i < records.length; i++) {
                if (records[i].import_filename === filename && records[i].status === 'pending') {
                    records[i].status = 'cancelled';
                    cancelledCount++;
                }
            }
            
            writeJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE, records);
            
            res.json({ 
                success: true, 
                cancelled: cancelledCount 
            });
        } catch (err) {
            console.error('Bulk cancel error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // Import bulk messages from CSV (new endpoint)
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
            const accountPathsObj = getAccountPaths();
            
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
            const existing = readJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE);
            existing.push(...imported);
            writeJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE, existing);
            
            res.json({ imported: imported.length, errors });
        } catch (err) {
            console.error('Bulk import error:', err);
            res.status(500).json({ error: 'Failed to import CSV: ' + err.message });
        }
    });

    // Send bulk message now (legacy endpoint)
    app.post('/api/bulk/send-now/:uid', async (req, res) => {
        const ready = getReady();
        if (!ready) {
            console.error('[BULK-SEND-NOW] WhatsApp not ready');
            return res.status(503).json({ error: 'WhatsApp not ready' });
        }
        
        try {
            // Get account paths - handle both function and direct object
            let accountPathsObj = null;
            if (typeof getAccountPaths === 'function') {
                accountPathsObj = getAccountPaths();
            } else {
                accountPathsObj = getAccountPaths;
            }
            
            console.log('[BULK-SEND-NOW] Processing send-now for record:', req.params.uid);
            
            const bulkFilePath = accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE;
            console.log('[BULK-SEND-NOW] Reading bulk file from:', bulkFilePath);
            
            const records = readJson(bulkFilePath, []);
            const recordIndex = records.findIndex(r => r.unique_id === req.params.uid);
            
            if (recordIndex === -1) {
                console.error('[BULK-SEND-NOW] Record not found:', req.params.uid);
                return res.status(404).json({ error: 'Record not found' });
            }
            
            const record = records[recordIndex];
            console.log('[BULK-SEND-NOW] Found record:', record.number);
            
            // Set send time to now and status to pending
            record.send_datetime = new Date().toISOString();
            record.status = 'pending';
            delete record.error; // Clear any previous error
            
            // Update the record
            records[recordIndex] = record;
            writeJson(bulkFilePath, records);
            
            console.log('[BULK-SEND-NOW] Record updated successfully, status set to pending');
            res.json({ success: true, message: 'Record queued for immediate sending' });
        } catch (err) {
            console.error('[BULK-SEND-NOW] Error:', err);
            console.error('[BULK-SEND-NOW] Error stack:', err.stack);
            res.status(500).json({ error: err.message, details: err.stack });
        }
    });

    // Schedule bulk message (legacy endpoint)
    app.post('/api/bulk/schedule/:uid', async (req, res) => {
        const ready = getReady();
        if (!ready) {
            console.error('[BULK-SCHEDULE] WhatsApp not ready');
            return res.status(503).json({ error: 'WhatsApp not ready' });
        }
        
        try {
            const accountPathsObj = getAccountPaths();
            const records = readJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE);
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
            writeJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE, records);
            
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
            const accountPathsObj = getAccountPaths();
            const records = readJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE);
            const filteredRecords = records.filter(r => r.import_filename !== filename);
            
            writeJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE, filteredRecords);
            
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
            const accountPathsObj = getAccountPaths();
            const records = readJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE);
            let cancelledCount = 0;
            
            for (let i = 0; i < records.length; i++) {
                if (records[i].import_filename === filename && records[i].status === 'pending') {
                    records[i].status = 'cancelled';
                    cancelledCount++;
                }
            }
            
            writeJson(accountPathsObj ? accountPathsObj.bulkFile : BULK_FILE, records);
            
            res.json({ 
                success: true, 
                cancelled: cancelledCount 
            });
        } catch (err) {
            console.error('Bulk cancel error:', err);
            res.status(500).json({ error: err.message });
        }
    });
}

module.exports = { setupBulkRoutes };

