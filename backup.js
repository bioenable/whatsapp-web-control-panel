const path = require('path');
const fs = require('fs');

// Backup configuration
const BACKUP_TIMEOUT_MS = 300000; // 5 minutes timeout
const BACKUP_BATCH_SIZE = 100; // Process messages in batches (increased from 50)
const MAX_BACKUP_MESSAGES = 500; // Maximum messages to fetch in single backup attempt
const MAX_BACKUP_BATCHES = 5; // Maximum number of batches to try

// In-memory progress tracking for active backups
const backupProgress = new Map();

// Schedule nightly backup (11pm-5am IST, once per day)
let nightlyBackupScheduled = false;
let lastNightlyBackupDate = null;

// IST timezone offset: UTC+5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Function to get current IST time
function getISTTime() {
    const now = new Date();
    return new Date(now.getTime() + IST_OFFSET_MS);
}

// Function to get random time between 11pm and 5am IST
function getRandomNightlyTime() {
    const istNow = getISTTime();
    const today = new Date(istNow);
    today.setHours(23, 0, 0, 0); // 11pm IST
    
    // Random time between 11pm (23:00) and 5am next day (05:00) = 6 hours = 360 minutes
    const randomMinutes = Math.floor(Math.random() * 360);
    const scheduledTime = new Date(today.getTime() + randomMinutes * 60 * 1000);
    
    // If scheduled time is before now, schedule for tomorrow
    if (scheduledTime <= istNow) {
        scheduledTime.setDate(scheduledTime.getDate() + 1);
    }
    
    return scheduledTime;
}

// Schedule nightly backup
function scheduleNightlyBackup(client, getReady, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson) {
    if (nightlyBackupScheduled) return;
    
    const scheduledTime = getRandomNightlyTime();
    const now = getISTTime();
    const delayMs = scheduledTime.getTime() - now.getTime();
    
    console.log(`[BACKUP] Nightly backup scheduled for ${scheduledTime.toISOString()} (${Math.round(delayMs / 1000 / 60)} minutes from now)`);
    
    setTimeout(() => {
        const todayIST = getISTTime();
        const todayDate = todayIST.toDateString();
        
        // Only backup once per day
        if (lastNightlyBackupDate !== todayDate) {
            console.log('[BACKUP] Starting scheduled nightly backup...');
            performNightlyBackup(client, getReady, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson);
            lastNightlyBackupDate = todayDate;
        }
        
        // Schedule next backup for tomorrow
        nightlyBackupScheduled = false;
        scheduleNightlyBackup(client, getReady, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson);
    }, delayMs);
    
    nightlyBackupScheduled = true;
}

// Perform nightly backup for all chats in backup list
async function performNightlyBackup(client, getReady, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson) {
    if (!getReady() || !client) {
        console.log('[BACKUP] Client not ready for nightly backup');
        return;
    }
    
    try {
        const backupList = readJson(BACKUP_LIST_FILE, { backups: [] });
        const backups = backupList.backups || [];
        
        console.log(`[BACKUP] Nightly backup: Processing ${backups.length} chats`);
        
        for (const backupEntry of backups) {
            try {
                await performBackup(client, backupEntry.chatId, backupEntry.chatName, backupEntry.chatType, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson, true);
            } catch (err) {
                console.error(`[BACKUP] Failed to backup ${backupEntry.chatId} in nightly backup:`, err.message);
            }
        }
        
        console.log('[BACKUP] Nightly backup completed');
    } catch (err) {
        console.error('[BACKUP] Nightly backup error:', err);
    }
}

// Helper function to add log to progress
function addProgressLog(chatId, message) {
    if (!backupProgress.has(chatId)) {
        backupProgress.set(chatId, { logs: [], status: 'running', startTime: Date.now() });
    }
    const progress = backupProgress.get(chatId);
    const timestamp = new Date().toISOString();
    progress.logs.push({ timestamp, message });
    // Keep only last 100 logs
    if (progress.logs.length > 100) {
        progress.logs.shift();
    }
    console.log(`[BACKUP-${chatId}] ${message}`);
}

// Main backup function - checks existing backup and appends only new messages incrementally
async function performBackup(client, chatId, chatName, chatType, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson, isScheduled = false) {
    const startTime = Date.now();
    addProgressLog(chatId, `Starting backup for ${chatName}`);
    
    try {
        if (!client) {
            throw new Error('WhatsApp client not available');
        }
        
        addProgressLog(chatId, 'Getting chat from WhatsApp...');
        const chat = await client.getChatById(chatId);
        if (!chat) {
            throw new Error('Chat not found');
        }
        addProgressLog(chatId, 'Chat found, checking existing backup...');
        
        // Check if backup file exists
        const backupFileName = `${chatId.replace(/[@.]/g, '_')}.json`;
        const backupFilePath = path.join(BACKUP_DIR, backupFileName);
        let existingBackup = null;
        let existingMessageIds = new Set();
        let peopleMap = new Map();
        let lastBackupTimestamp = null;
        let isFirstBackup = false;
        
        // Ensure backup directory exists
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
        }
        
        if (fs.existsSync(backupFilePath)) {
            try {
                existingBackup = readJson(backupFilePath, null);
                if (existingBackup && existingBackup.messages) {
                    existingMessageIds = new Set(existingBackup.messages.map(m => m.id));
                    // Get the timestamp of the most recent message (last backup point)
                    if (existingBackup.messages.length > 0) {
                        // Messages are sorted by timestamp, so last one is most recent
                        const sortedMessages = [...existingBackup.messages].sort((a, b) => b.timestamp - a.timestamp);
                        lastBackupTimestamp = sortedMessages[0].timestamp;
                        addProgressLog(chatId, `Found existing backup with ${existingBackup.messages.length} messages. Last backup timestamp: ${new Date(lastBackupTimestamp * 1000).toLocaleString()}`);
                    } else {
                        isFirstBackup = true;
                        addProgressLog(chatId, 'Found existing backup file but no messages, treating as first backup');
                    }
                } else {
                    isFirstBackup = true;
                    addProgressLog(chatId, 'Found existing backup file but no messages array, treating as first backup');
                }
                if (existingBackup && existingBackup.people) {
                    existingBackup.people.forEach(person => {
                        peopleMap.set(person.number, person);
                    });
                }
            } catch (err) {
                addProgressLog(chatId, `Failed to read existing backup, creating new: ${err.message}`);
                isFirstBackup = true;
            }
        } else {
            isFirstBackup = true;
            // Create initial backup file immediately
            const initialBackup = {
                chatId: chatId,
                chatName: chatName,
                chatType: chatType,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                messageCount: 0,
                people: [],
                messages: []
            };
            writeJson(backupFilePath, initialBackup);
            addProgressLog(chatId, 'Created new backup file - first backup');
        }
        
        // Get messages - fetch and process incrementally
        let hasMore = true;
        let lastMessageId = null;
        let fetchedCount = 0;
        let newMessagesCount = 0;
        let batchNumber = 0;
        const maxFetchTime = BACKUP_TIMEOUT_MS; // Total 5 minutes
        const BATCH_TIMEOUT_MS = 60000; // 1 minute per batch
        const FIRST_BACKUP_LIMIT = 500; // Limit for first-time backups
        let hasReachedLastBackupPoint = false; // Track if we've reached messages from last backup
        
        if (isFirstBackup) {
            addProgressLog(chatId, `First backup: Starting to fetch messages (up to ${FIRST_BACKUP_LIMIT} messages)...`);
        } else {
            addProgressLog(chatId, `Incremental backup: Fetching messages after ${new Date(lastBackupTimestamp * 1000).toLocaleString()}...`);
        }
        
        while (hasMore && 
               (Date.now() - startTime) < maxFetchTime && 
               batchNumber < MAX_BACKUP_BATCHES && 
               (isFirstBackup ? newMessagesCount < FIRST_BACKUP_LIMIT : true)) {
            batchNumber++;
            const batchStartTime = Date.now();
            
            if (isFirstBackup) {
                addProgressLog(chatId, `Fetching batch ${batchNumber} (${BACKUP_BATCH_SIZE} messages, ${newMessagesCount}/${FIRST_BACKUP_LIMIT} so far)...`);
            } else {
                addProgressLog(chatId, `Fetching batch ${batchNumber} (${BACKUP_BATCH_SIZE} messages, ${newMessagesCount} new so far)...`);
            }
            
            try {
                // For incremental backups, fetch only recent messages
                // For first backup, fetch from the beginning
                let fetchOptions;
                if (isFirstBackup) {
                    // First backup: fetch progressively more messages
                    const requestedLimit = Math.min(BACKUP_BATCH_SIZE * batchNumber, FIRST_BACKUP_LIMIT);
                    fetchOptions = { limit: requestedLimit };
                } else {
                    // Incremental backup: fetch recent messages (newer than last backup)
                    // Use a reasonable limit to get recent messages
                    fetchOptions = { limit: BACKUP_BATCH_SIZE };
                }
                
                const fetchPromise = chat.fetchMessages(fetchOptions);
                const batchTimeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Batch timeout (1 minute)')), BATCH_TIMEOUT_MS);
                });
                
                const messages = await Promise.race([fetchPromise, batchTimeoutPromise]);
                
                if (messages.length === 0) {
                    hasMore = false;
                    if (isFirstBackup) {
                        addProgressLog(chatId, 'No messages found in chat');
                    } else {
                        addProgressLog(chatId, 'No new messages found since last backup');
                    }
                    break;
                }
                
                fetchedCount += messages.length;
                
                // For incremental backups, filter messages by timestamp
                let candidateMessages = messages;
                if (!isFirstBackup && lastBackupTimestamp) {
                    // Only consider messages newer than last backup
                    candidateMessages = messages.filter(m => m.timestamp > lastBackupTimestamp);
                    if (candidateMessages.length === 0) {
                        // All messages are older than last backup - we've reached the last backup point
                        addProgressLog(chatId, 'All fetched messages are older than last backup. Backup is up to date.');
                        hasReachedLastBackupPoint = true;
                        hasMore = false;
                        break;
                    }
                    
                    // Check if we've reached messages from before last backup (meaning we've covered the gap)
                    const oldestNewMessage = Math.min(...candidateMessages.map(m => m.timestamp));
                    const newestOldMessage = Math.max(...messages.filter(m => m.timestamp <= lastBackupTimestamp).map(m => m.timestamp));
                    
                    // If we have messages older than last backup, we've gone too far back
                    if (messages.some(m => m.timestamp <= lastBackupTimestamp)) {
                        addProgressLog(chatId, 'Fetched messages include older messages than last backup. Stopping to avoid fetching past messages.');
                        hasReachedLastBackupPoint = true;
                        hasMore = false;
                        // Still process the new messages we found
                    }
                }
                
                // Filter out messages we already have (from previous batches or existing backup)
                const newMessages = candidateMessages.filter(m => !existingMessageIds.has(m.id._serialized));
                
                // For incremental backup: if this is the first batch and we got new messages covering the gap, we're done
                if (!isFirstBackup && batchNumber === 1 && newMessages.length > 0) {
                    const newestMessageTime = Math.max(...newMessages.map(m => m.timestamp));
                    const currentTime = Math.floor(Date.now() / 1000);
                    // If newest message is very recent (within last 5 minutes), likely we've covered the gap
                    if (currentTime - newestMessageTime < 300) {
                        addProgressLog(chatId, `Fetched ${newMessages.length} new messages up to current time. Backup is up to date.`);
                        hasReachedLastBackupPoint = true;
                        // Process these messages but don't fetch more
                    }
                }
                
                if (newMessages.length === 0 && existingMessageIds.size > 0) {
                    // All messages in this fetch are already backed up
                    if (isFirstBackup) {
                        // For first backup, if we got fewer messages than requested, we're done
                        if (messages.length < fetchOptions.limit) {
                            addProgressLog(chatId, 'All available messages already backed up, no more messages to fetch');
                            hasMore = false;
                            break;
                        }
                    } else {
                        // For incremental backup, if no new messages, we're up to date
                        addProgressLog(chatId, 'All fetched messages already backed up. Backup is up to date.');
                        hasMore = false;
                        break;
                    }
                }
                
                // If no new messages and we've already processed messages, we might have reached the end
                if (newMessages.length === 0 && batchNumber === 1 && existingMessageIds.size === 0) {
                    // First batch and no messages - something wrong
                    addProgressLog(chatId, 'No messages found in chat');
                    hasMore = false;
                    break;
                }
                
                // For first backup, check if we've reached the limit
                if (isFirstBackup && newMessagesCount + newMessages.length >= FIRST_BACKUP_LIMIT) {
                    // Take only what we need to reach the limit
                    const remaining = FIRST_BACKUP_LIMIT - newMessagesCount;
                    const limitedMessages = newMessages.slice(0, remaining);
                    addProgressLog(chatId, `Reached first backup limit, processing ${limitedMessages.length} messages from batch ${batchNumber} (${remaining} remaining to reach ${FIRST_BACKUP_LIMIT})...`);
                    
                    // Process limited messages (code continues below)
                    // We'll handle this in the processing section
                }
                
                // Determine which messages to process
                let messagesToProcess = newMessages;
                if (isFirstBackup && newMessagesCount + newMessages.length >= FIRST_BACKUP_LIMIT) {
                    // Take only what we need to reach the limit
                    const remaining = FIRST_BACKUP_LIMIT - newMessagesCount;
                    messagesToProcess = newMessages.slice(0, remaining);
                    addProgressLog(chatId, `Reached first backup limit, processing ${messagesToProcess.length} messages from batch ${batchNumber} (${remaining} remaining to reach ${FIRST_BACKUP_LIMIT})...`);
                } else {
                    addProgressLog(chatId, `Processing ${messagesToProcess.length} new messages from batch ${batchNumber}...`);
                }
                
                // Process messages incrementally and write to file
                const processedBatch = [];
                
                for (const msg of messagesToProcess) {
                const messageData = {
                    id: msg.id._serialized,
                    body: msg.body || (msg.hasMedia ? '(media)' : ''),
                    timestamp: msg.timestamp,
                    from: msg.from,
                    fromMe: msg.fromMe,
                    type: msg.type,
                    hasMedia: msg.hasMedia,
                    mediaType: msg.hasMedia ? (msg.type === 'image' ? 'image' : msg.type === 'video' ? 'video' : msg.type === 'document' ? 'document' : 'media') : null
                };
                
                // Get sender info for group/channel messages
                if (!msg.fromMe && (chat.isGroup || chat.isChannel)) {
                    try {
                        const contact = await msg.getContact();
                        const senderName = contact.pushname || contact.name || contact.number || 'Unknown';
                        const senderNumber = contact.number || msg.from.split('@')[0] || 'Unknown';
                        
                        messageData.senderName = senderName;
                        messageData.senderNumber = senderNumber;
                        
                        // Track unique people
                        if (!peopleMap.has(senderNumber)) {
                            peopleMap.set(senderNumber, {
                                number: senderNumber,
                                name: senderName,
                                firstSeen: msg.timestamp,
                                lastSeen: msg.timestamp,
                                messageCount: 1
                            });
                        } else {
                            const person = peopleMap.get(senderNumber);
                            person.messageCount++;
                            if (msg.timestamp < person.firstSeen) person.firstSeen = msg.timestamp;
                            if (msg.timestamp > person.lastSeen) person.lastSeen = msg.timestamp;
                            if (senderName && senderName !== 'Unknown' && (!person.name || person.name === 'Unknown')) {
                                person.name = senderName;
                            }
                        }
                    } catch (err) {
                        messageData.senderName = 'Unknown';
                        messageData.senderNumber = msg.from.split('@')[0] || 'Unknown';
                    }
                } else if (msg.fromMe) {
                    messageData.senderName = 'You';
                    messageData.senderNumber = 'me';
                }
                
                processedBatch.push(messageData);
                existingMessageIds.add(msg.id._serialized);
            }
            
            if (processedBatch.length > 0) {
                // Read current backup, append new messages, write back
                const currentBackup = readJson(backupFilePath, {
                    chatId: chatId,
                    chatName: chatName,
                    chatType: chatType,
                    createdAt: new Date().toISOString(),
                    lastUpdated: new Date().toISOString(),
                    messageCount: 0,
                    people: [],
                    messages: []
                });
                
                // Append new messages
                currentBackup.messages = currentBackup.messages.concat(processedBatch);
                // Sort by timestamp (oldest first)
                currentBackup.messages.sort((a, b) => a.timestamp - b.timestamp);
                
                // Update people list
                currentBackup.people = Array.from(peopleMap.values());
                
                // Update metadata
                currentBackup.lastUpdated = new Date().toISOString();
                currentBackup.messageCount = currentBackup.messages.length;
                
                // Write incrementally
                writeJson(backupFilePath, currentBackup);
                newMessagesCount += processedBatch.length;
                
                addProgressLog(chatId, `Saved ${processedBatch.length} messages to backup file (Total: ${currentBackup.messageCount})`);
                
                // For first backup, stop if we've reached the limit
                if (isFirstBackup && newMessagesCount >= FIRST_BACKUP_LIMIT) {
                    hasMore = false;
                    break;
                }
            } else {
                // No new messages to process
                if (!isFirstBackup) {
                    addProgressLog(chatId, 'No new messages to process in this batch');
                }
            }
                
                // Track the oldest message ID for potential future pagination
                // Sort messages by timestamp to get the oldest
                const sortedMessages = [...messages].sort((a, b) => a.timestamp - b.timestamp);
                if (sortedMessages.length > 0) {
                    lastMessageId = sortedMessages[0].id._serialized; // Oldest message ID
                }
                
                // Continue if we got messages and haven't reached limits
                // For incremental backups, stop if we've reached the last backup point
                if (hasReachedLastBackupPoint) {
                    hasMore = false;
                } else if (isFirstBackup) {
                    hasMore = messages.length > 0 && 
                             batchNumber < MAX_BACKUP_BATCHES && 
                             newMessagesCount < FIRST_BACKUP_LIMIT;
                } else {
                    // Incremental backup: stop if no new messages or we've covered the gap
                    hasMore = messages.length > 0 && 
                             batchNumber < MAX_BACKUP_BATCHES &&
                             newMessages.length > 0;
                }
                
                const batchDuration = Date.now() - batchStartTime;
                if (isFirstBackup) {
                    addProgressLog(chatId, `Batch ${batchNumber} completed in ${Math.round(batchDuration/1000)}s. Total fetched: ${fetchedCount}, New: ${newMessagesCount}/${FIRST_BACKUP_LIMIT}`);
                } else {
                    addProgressLog(chatId, `Batch ${batchNumber} completed in ${Math.round(batchDuration/1000)}s. Total fetched: ${fetchedCount}, New: ${newMessagesCount}`);
                }
                
                // Check if we've reached batch limit
                if (batchNumber >= MAX_BACKUP_BATCHES) {
                    addProgressLog(chatId, `Reached batch limit (${MAX_BACKUP_BATCHES} batches), stopping...`);
                    hasMore = false;
                }
                
                // Check if we've reached message limit (for first backup)
                if (isFirstBackup && newMessagesCount >= FIRST_BACKUP_LIMIT) {
                    addProgressLog(chatId, `Reached first backup limit (${FIRST_BACKUP_LIMIT} messages), stopping...`);
                    hasMore = false;
                }
                
                // Small delay to not impact other processes
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (batchError) {
                // Batch failed - log and continue to next batch if time permits
                addProgressLog(chatId, `Batch ${batchNumber} failed: ${batchError.message}. Continuing with next batch if time permits...`);
                
                // Check if we have time for another batch (leave 10 seconds buffer)
                const remainingTime = maxFetchTime - (Date.now() - startTime);
                if (remainingTime < 10000) {
                    addProgressLog(chatId, 'Time limit approaching, stopping batch fetching');
                    hasMore = false;
                    break;
                }
                
                // Try to continue with next batch
                // If we have a lastMessageId, use it, otherwise we can't continue
                if (!lastMessageId) {
                    addProgressLog(chatId, 'Cannot continue without message ID, stopping');
                    hasMore = false;
                    break;
                }
                
                // Small delay before retrying
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Final update to backup list
        const finalBackup = readJson(backupFilePath, null);
        const backupList = readJson(BACKUP_LIST_FILE, { backups: [] });
        const existingIndex = backupList.backups.findIndex(b => b.chatId === chatId);
        const backupEntry = {
            chatId: chatId,
            chatName: chatName,
            chatType: chatType,
            lastBackup: new Date().toISOString(),
            messageCount: finalBackup ? finalBackup.messageCount : 0,
            peopleCount: peopleMap.size,
            lastMessage: finalBackup && finalBackup.messages && finalBackup.messages.length > 0 ? {
                body: finalBackup.messages[finalBackup.messages.length - 1].body,
                timestamp: finalBackup.messages[finalBackup.messages.length - 1].timestamp,
                senderName: finalBackup.messages[finalBackup.messages.length - 1].senderName || 'You'
            } : null
        };
        
        if (existingIndex >= 0) {
            backupList.backups[existingIndex] = backupEntry;
        } else {
            backupList.backups.push(backupEntry);
        }
        
        writeJson(BACKUP_LIST_FILE, backupList);
        
        const duration = Date.now() - startTime;
        addProgressLog(chatId, `Backup completed! Total: ${finalBackup ? finalBackup.messageCount : 0} messages, ${peopleMap.size} people (${Math.round(duration/1000)}s)`);
        
        // Mark as completed
        if (backupProgress.has(chatId)) {
            backupProgress.get(chatId).status = 'completed';
        }
        
        return {
            success: true,
            messageCount: finalBackup ? finalBackup.messageCount : 0,
            peopleCount: peopleMap.size,
            newMessages: newMessagesCount,
            duration
        };
    } catch (error) {
        addProgressLog(chatId, `ERROR: ${error.message}`);
        if (backupProgress.has(chatId)) {
            backupProgress.get(chatId).status = 'failed';
        }
        console.error(`[BACKUP] Failed to backup ${chatId}:`, error.message);
        throw error;
    }
}

// Setup backup API routes
function setupBackupRoutes(app, client, getReady, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson, DETECTED_CHANNELS_FILE) {
    console.log('[BACKUP] Setting up backup routes...');
    
    // Schedule nightly backup on startup
    scheduleNightlyBackup(client, getReady, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson);
    
    // Get backup list
    app.get('/api/backup/list', (req, res) => {
        try {
            // Use the BACKUP_LIST_FILE passed to this function (which should be account-specific)
            const backupList = readJson(BACKUP_LIST_FILE, { backups: [] });
            res.json(backupList);
        } catch (err) {
            console.error('[BACKUP] Failed to get backup list:', err);
            res.status(500).json({ error: 'Failed to get backup list', details: err.message });
        }
    });

    // Add chat to backup (immediately add to list, don't backup yet)
    app.post('/api/backup/add', async (req, res) => {
        try {
            if (!getReady()) {
                return res.status(503).json({ error: 'WhatsApp client not ready' });
            }
            
            const { chatType, chatName, chatId } = req.body;
            
            if (!chatType) {
                return res.status(400).json({ error: 'Chat type is required' });
            }
            
            if (!chatId && !chatName) {
                return res.status(400).json({ error: 'Chat ID or name is required' });
            }
            
            // Support both chatId (preferred) and chatName (backward compatibility)
            let targetChatId = chatId;
            let targetChatName = chatName;
            
            if (!targetChatId && chatName) {
                // Fallback: Find chat by name if chatId not provided
                const chats = await client.getChats();
                let foundChat = null;
                
                for (const chat of chats) {
                    const name = chat.name || chat.formattedTitle || chat.id.user || chat.id._serialized;
                    if (name === chatName) {
                        // Verify chat type matches
                        if (chatType === 'private' && !chat.isGroup && !chat.isChannel) {
                            foundChat = chat;
                            break;
                        } else if (chatType === 'group' && chat.isGroup) {
                            foundChat = chat;
                            break;
                        } else if (chatType === 'channel' && chat.isChannel) {
                            foundChat = chat;
                            break;
                        }
                    }
                }
                
                if (!foundChat) {
                    return res.status(404).json({ error: 'Chat not found or type mismatch' });
                }
                
                targetChatId = foundChat.id._serialized;
                targetChatName = foundChat.name || chat.formattedTitle || foundChat.id.user || targetChatId;
            }
            
            if (!targetChatId) {
                return res.status(400).json({ error: 'Chat ID or name is required' });
            }
            
            // Verify chat exists and get its name if not provided
            let chat = null;
            try {
                chat = await client.getChatById(targetChatId);
                if (!chat) {
                    return res.status(404).json({ error: 'Chat not found' });
                }
                
                if (!targetChatName) {
                    // Safely get chat name
                    const chatIdObj = chat.id && typeof chat.id === 'object' ? chat.id : { _serialized: targetChatId };
                    targetChatName = chat.name || chat.formattedTitle || (chatIdObj.user ? chatIdObj.user : targetChatId);
                }
                
                // Verify chat type matches
                if (chatType === 'private' && (chat.isGroup || chat.isChannel)) {
                    return res.status(400).json({ error: 'Chat type mismatch: expected private chat' });
                } else if (chatType === 'group' && !chat.isGroup) {
                    return res.status(400).json({ error: 'Chat type mismatch: expected group chat' });
                } else if (chatType === 'channel' && !chat.isChannel) {
                    return res.status(400).json({ error: 'Chat type mismatch: expected channel' });
                }
            } catch (err) {
                console.error('[BACKUP] Error getting chat by ID:', err);
                return res.status(404).json({ error: 'Chat not found: ' + err.message });
            }
            
            // Check if already in backup list
            const backupList = readJson(BACKUP_LIST_FILE, { backups: [] });
            if (backupList.backups.some(item => item.chatId === targetChatId)) {
                return res.status(400).json({ error: 'Chat already in backup list' });
            }
            
            // Add to backup list immediately
            const backupEntry = {
                chatId: targetChatId,
                chatName: targetChatName,
                chatType: chatType,
                lastBackup: null,
                messageCount: 0,
                peopleCount: 0,
                lastMessage: null
            };
            
            backupList.backups.push(backupEntry);
            writeJson(BACKUP_LIST_FILE, backupList);
            
            console.log(`[BACKUP] Added ${targetChatId} to backup list`);
            
            res.json({ 
                success: true, 
                message: 'Chat added to backup list',
                backup: backupEntry
            });
        } catch (err) {
            console.error('[BACKUP] Failed to add chat to backup:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Failed to add chat to backup', details: err.message });
            }
        }
    });

    // Get backup progress
    app.get('/api/backup/:chatId/progress', (req, res) => {
        try {
            const { chatId } = req.params;
            const progress = backupProgress.get(chatId);
            
            if (!progress) {
                return res.json({ 
                    status: 'not_started',
                    logs: [],
                    startTime: null
                });
            }
            
            res.json({
                status: progress.status,
                logs: progress.logs,
                startTime: progress.startTime,
                duration: Date.now() - progress.startTime
            });
        } catch (err) {
            res.status(500).json({ error: 'Failed to get progress', details: err.message });
        }
    });

    // Backup now - perform immediate backup
    app.post('/api/backup/:chatId/backup-now', async (req, res) => {
        try {
            if (!getReady()) {
                return res.status(503).json({ error: 'WhatsApp client not ready' });
            }
            
            const { chatId } = req.params;
            
            // Get backup entry
            const backupList = readJson(BACKUP_LIST_FILE, { backups: [] });
            const backupEntry = backupList.backups.find(b => b.chatId === chatId);
            
            if (!backupEntry) {
                return res.status(404).json({ error: 'Chat not found in backup list' });
            }
            
            // Initialize progress
            backupProgress.set(chatId, { logs: [], status: 'running', startTime: Date.now() });
            
            // Perform backup in background (don't await, let it run)
            performBackup(client, chatId, backupEntry.chatName, backupEntry.chatType, BACKUP_DIR, BACKUP_LIST_FILE, readJson, writeJson, false)
                .then(result => {
                    // Clean up progress after 5 minutes
                    setTimeout(() => {
                        backupProgress.delete(chatId);
                    }, 300000);
                })
                .catch(err => {
                    console.error('[BACKUP] Backup failed:', err);
                    // Clean up progress after 5 minutes
                    setTimeout(() => {
                        backupProgress.delete(chatId);
                    }, 300000);
                });
            
            // Return immediately with progress endpoint
            res.json({
                success: true,
                message: 'Backup started',
                progressEndpoint: `/api/backup/${encodeURIComponent(chatId)}/progress`
            });
        } catch (err) {
            console.error('[BACKUP] Failed to start backup:', err);
            res.status(500).json({ 
                error: 'Failed to start backup', 
                details: err.message
            });
        }
    });

    // Get backup messages
    app.get('/api/backup/:chatId/messages', (req, res) => {
        try {
            const { chatId } = req.params;
            const page = parseInt(req.query.page) || 1;
            const pageSize = parseInt(req.query.pageSize) || 100;
            
            const backupFileName = `${chatId.replace(/[@.]/g, '_')}.json`;
            const backupFilePath = path.join(BACKUP_DIR, backupFileName);
            
            if (!fs.existsSync(backupFilePath)) {
                return res.status(404).json({ error: 'Backup not found' });
            }
            
            const backupData = readJson(backupFilePath, null);
            const messages = backupData.messages || [];
            
            // Pagination
            const start = (page - 1) * pageSize;
            const end = start + pageSize;
            const paginatedMessages = messages.slice(start, end);
            
            res.json({
                messages: paginatedMessages,
                total: messages.length,
                page,
                pageSize,
                totalPages: Math.ceil(messages.length / pageSize)
            });
        } catch (err) {
            console.error('[BACKUP] Failed to get backup messages:', err);
            res.status(500).json({ error: 'Failed to get backup messages', details: err.message });
        }
    });

    // Get people from backup
    app.get('/api/backup/:chatId/people', (req, res) => {
        try {
            const { chatId } = req.params;
            const backupFileName = `${chatId.replace(/[@.]/g, '_')}.json`;
            const backupFilePath = path.join(BACKUP_DIR, backupFileName);
            
            if (!fs.existsSync(backupFilePath)) {
                return res.status(404).json({ error: 'Backup not found' });
            }
            
            const backupData = readJson(backupFilePath, null);
            const people = backupData.people || [];
            
            res.json({ people });
        } catch (err) {
            console.error('[BACKUP] Failed to get backup people:', err);
            res.status(500).json({ error: 'Failed to get backup people', details: err.message });
        }
    });

    // Test contact adding/updating endpoint
    app.post('/api/backup/test-contact', async (req, res) => {
        if (!getReady()) return res.status(503).json({ error: 'WhatsApp client not ready' });
        
        try {
            const { number, firstName, lastName } = req.body;
            
            if (!number) {
                return res.status(400).json({ error: 'Phone number is required' });
            }
            
            // Normalize number (remove non-digits)
            const normalizedNumber = number.replace(/[^0-9]/g, '');
            
            console.log(`[BACKUP-TEST] Testing contact: ${normalizedNumber}, firstName="${firstName || ''}", lastName="${lastName || ''}"`);
            
            // Check if contact exists
            let existingContact = null;
            try {
                existingContact = await client.getContactById(`${normalizedNumber}@c.us`);
                console.log(`[BACKUP-TEST] Existing contact found:`, {
                    name: existingContact.name,
                    pushname: existingContact.pushname,
                    number: existingContact.number
                });
            } catch (e) {
                console.log(`[BACKUP-TEST] Contact does not exist, will create new`);
            }
            
            // Add or update contact
            const contactChatId = await client.saveOrEditAddressbookContact(
                normalizedNumber,
                firstName || '',
                lastName || '',
                true // syncToAddressbook
            );
            
            console.log(`[BACKUP-TEST] saveOrEditAddressbookContact returned:`, contactChatId);
            
            // Verify the contact
            let verifiedContact = null;
            try {
                verifiedContact = await client.getContactById(contactChatId._serialized || contactChatId || `${normalizedNumber}@c.us`);
            } catch (verifyErr) {
                console.log(`[BACKUP-TEST] Verification failed:`, verifyErr.message);
            }
            
            // Fetch all contacts and search for this one
            const allContacts = await client.getContacts();
            const foundContact = allContacts.find(c => c.number === normalizedNumber);
            
            res.json({
                success: true,
                existing: existingContact ? {
                    name: existingContact.name,
                    pushname: existingContact.pushname
                } : null,
                added: contactChatId,
                verified: verifiedContact ? {
                    name: verifiedContact.name,
                    pushname: verifiedContact.pushname,
                    number: verifiedContact.number
                } : null,
                foundInAllContacts: foundContact ? {
                    name: foundContact.name,
                    pushname: foundContact.pushname,
                    number: foundContact.number
                } : null,
                totalContacts: allContacts.length
            });
        } catch (err) {
            console.error('[BACKUP-TEST] Test failed:', err);
            res.status(500).json({ error: 'Test failed', details: err.message });
        }
    });

    // Get available chats for backup form
    app.get('/api/backup/chats', async (req, res) => {
        if (!getReady()) return res.status(503).json({ error: 'WhatsApp client not ready' });
        
        try {
            const { type } = req.query;
            
            if (type === 'channel') {
                // Use detected_channels.json for channels
                if (fs.existsSync(DETECTED_CHANNELS_FILE)) {
                    const detectedChannels = readJson(DETECTED_CHANNELS_FILE, []);
                    const channelList = detectedChannels.map(channel => ({
                        id: channel.id,
                        name: channel.name || channel.id
                    }));
                    return res.json({ chats: channelList });
                } else {
                    // Fallback to API
                    const chats = await client.getChats();
                    const channels = chats.filter(c => c.isChannel);
                    const channelList = channels.map(chat => ({
                        id: chat.id._serialized,
                        name: chat.name || chat.formattedTitle || chat.id._serialized
                    }));
                    return res.json({ chats: channelList });
                }
            } else {
                // For private and group, use getChats
                const chats = await client.getChats();
                
                let filteredChats = [];
                if (type === 'private') {
                    filteredChats = chats.filter(c => !c.isGroup && !c.isChannel);
                } else if (type === 'group') {
                    filteredChats = chats.filter(c => c.isGroup);
                } else {
                    filteredChats = chats;
                }
                
                const chatList = filteredChats.map(chat => ({
                    id: chat.id._serialized,
                    name: chat.name || chat.formattedTitle || chat.id.user || chat.id._serialized,
                    timestamp: chat.timestamp || (chat.lastMessage ? chat.lastMessage.timestamp : 0) || 0
                }));
                
                res.json({ chats: chatList });
            }
        } catch (err) {
            console.error('[BACKUP] Failed to get chats:', err);
            res.status(500).json({ error: 'Failed to get chats', details: err.message });
        }
    });

    // Add people to contacts
    app.post('/api/backup/:chatId/add-contacts', async (req, res) => {
        if (!getReady()) return res.status(503).json({ error: 'WhatsApp client not ready' });
        
        try {
            const { chatId } = req.params;
            const { groupName } = req.body;
            const backupFileName = `${chatId.replace(/[@.]/g, '_')}.json`;
            const backupFilePath = path.join(BACKUP_DIR, backupFileName);
            
            if (!fs.existsSync(backupFilePath)) {
                return res.status(404).json({ error: 'Backup not found' });
            }
            
            const backupData = readJson(backupFilePath, null);
            const people = backupData.people || [];
            
            const results = {
                added: 0,
                updated: 0,
                skipped: 0,
                errors: []
            };
            
            for (const person of people) {
                try {
                    const number = person.number;
                    if (!number || number === 'me' || number === 'Unknown') {
                        results.skipped++;
                        continue;
                    }
                    
                    // Get existing contact
                    let contact = null;
                    try {
                        contact = await client.getContactById(`${number}@c.us`);
                    } catch (e) {
                        // Contact doesn't exist
                    }
                    
                    // Helper to check if name is valid (not empty, not N/A, not whitespace, not special chars only)
                    const isValidName = (name) => {
                        if (!name) return false;
                        const trimmed = name.trim();
                        if (!trimmed) return false;
                        // Check for invalid values
                        const invalidValues = ['N/A', 'NULL', 'null', 'Unknown', 'unknown', 'undefined', 'null', ''];
                        if (invalidValues.includes(trimmed)) return false;
                        // Check if it's only whitespace or special characters (no alphanumeric)
                        if (!/[a-zA-Z0-9]/.test(trimmed)) return false;
                        return true;
                    };
                    
                    const personName = person.name || '';
                    // Append group name to last name with brackets: " (GroupName)"
                    const lastNameSuffix = groupName ? ` (${groupName})` : '';
                    
                    if (contact) {
                        // Contact exists - extract existing names properly
                        // WhatsApp may store name in different formats
                        const existingFullName = (contact.pushname || contact.name || '').trim();
                        let existingFirstName = '';
                        let existingLastName = '';
                        
                        if (existingFullName) {
                            const nameParts = existingFullName.split(' ').filter(part => part.trim().length > 0);
                            if (nameParts.length > 0) {
                                existingFirstName = nameParts[0];
                                existingLastName = nameParts.slice(1).join(' ');
                            }
                        }
                        
                        // Check if existing names are valid
                        const hasValidFirstName = isValidName(existingFirstName);
                        const hasValidLastName = isValidName(existingLastName);
                        const hasValidPersonName = isValidName(personName);
                        
                        let newFirstName = existingFirstName;
                        let newLastName = existingLastName;
                        
                        if (hasValidPersonName) {
                            // We have a valid person name from the group
                            if (hasValidFirstName && hasValidLastName) {
                                // Both existing names are valid - keep them, just append group name to last name if not already there
                                if (groupName && !existingLastName.includes(groupName)) {
                                    newLastName = existingLastName + lastNameSuffix;
                                }
                            } else if (hasValidFirstName && !hasValidLastName) {
                                // First name valid, last name invalid - use person name as last name with group suffix
                                newLastName = personName + lastNameSuffix;
                            } else if (!hasValidFirstName && hasValidLastName) {
                                // Last name valid, first name invalid - use person name as first name, keep last name with group suffix
                                // If personName has multiple words, use only the first word as firstName
                                const personNameParts = personName.trim().split(' ').filter(part => part.length > 0);
                                if (personNameParts.length > 0) {
                                    newFirstName = personNameParts[0]; // Use first word only
                                } else {
                                    newFirstName = number; // Fallback
                                }
                                if (groupName && !existingLastName.includes(groupName)) {
                                    newLastName = existingLastName + lastNameSuffix;
                                }
                            } else {
                                // Both existing names invalid - replace with person name
                                // Split personName into firstName and lastName if it has multiple words
                                const personNameParts = personName.trim().split(' ').filter(part => part.length > 0);
                                if (personNameParts.length === 0) {
                                    newFirstName = number; // Fallback
                                    newLastName = lastNameSuffix.trim();
                                } else if (personNameParts.length === 1) {
                                    newFirstName = personNameParts[0];
                                    newLastName = lastNameSuffix.trim();
                                } else {
                                    // Multiple words: first word as firstName, rest as lastName with suffix
                                    newFirstName = personNameParts[0];
                                    newLastName = personNameParts.slice(1).join(' ') + lastNameSuffix;
                                }
                            }
                        } else {
                            // Person name from group is not valid
                            if (!hasValidFirstName && !hasValidLastName) {
                                // Both invalid - use number as first name, group as last name
                                newFirstName = number;
                                newLastName = lastNameSuffix.trim();
                            } else if (hasValidFirstName && !hasValidLastName) {
                                // First name valid, last name invalid - just add group suffix
                                newLastName = lastNameSuffix.trim();
                            } else if (!hasValidFirstName && hasValidLastName) {
                                // Last name valid, first name invalid - use number as first name
                                newFirstName = number;
                                if (groupName && !existingLastName.includes(groupName)) {
                                    newLastName = existingLastName + lastNameSuffix;
                                }
                            } else {
                                // Both valid - just append group suffix if needed
                                if (groupName && !existingLastName.includes(groupName)) {
                                    newLastName = existingLastName + lastNameSuffix;
                                }
                            }
                        }
                        
                        // Ensure we have at least a firstName
                        if (!newFirstName || !isValidName(newFirstName)) {
                            newFirstName = hasValidPersonName ? personName : number;
                        }
                        
                        // Clean up names - CRITICAL: firstName must never be empty (v1.34.2+ fix)
                        newFirstName = newFirstName.trim();
                        newLastName = newLastName.trim();
                        
                        // Ensure firstName is never empty (required by WhatsApp, fixed in v1.34.2 Nov 2025)
                        if (!newFirstName || newFirstName === '') {
                            newFirstName = normalizedNumber || number.replace(/[^0-9]/g, ''); // Use number as fallback
                        }
                        
                        // Build full name for comparison
                        const newFullName = newFirstName + (newLastName ? ' ' + newLastName : '');
                        
                        // Always update if names are different or if existing name was invalid
                        const shouldUpdate = newFullName.trim() !== existingFullName || !hasValidFirstName || !hasValidLastName;
                        
                        if (shouldUpdate) {
                            // Normalize number (remove non-digits) - E.164 format
                            const normalizedNumber = number.replace(/[^0-9]/g, '');
                            
                            console.log(`[BACKUP] Updating contact ${normalizedNumber}: existing="${existingFullName}" -> firstName="${newFirstName}", lastName="${newLastName}"`);
                            
                            try {
                                // Use saveOrEditAddressbookContact with proper parameters (v1.34.2+ fix)
                                const contactChatId = await client.saveOrEditAddressbookContact(
                                    normalizedNumber,
                                    newFirstName,  // Must not be empty
                                    newLastName || '',  // Can be empty string, but not undefined
                                    true // syncToAddressbook
                                );
                                
                                // Verify the contact was updated
                                try {
                                    const updatedContact = await client.getContactById(contactChatId._serialized || contactChatId || `${normalizedNumber}@c.us`);
                                    if (updatedContact) {
                                        const expectedName = (newFirstName + (newLastName ? ' ' + newLastName : '')).trim();
                                        const actualName = (updatedContact.name || updatedContact.pushname || '').trim();
                                        
                                        if (actualName && actualName !== 'N/A' && actualName !== normalizedNumber) {
                                            console.log(`[BACKUP] ✅ Contact ${normalizedNumber} updated and verified: "${actualName}"`);
                                            results.updated++;
                                        } else {
                                            console.log(`[BACKUP] ⚠️ Contact ${normalizedNumber} updated but name not set correctly: "${actualName}"`);
                                            results.updated++; // Still count as updated
                                        }
                                    } else {
                                        console.log(`[BACKUP] ⚠️ Contact ${normalizedNumber} updated but could not verify`);
                                        results.updated++; // Still count as updated
                                    }
                                } catch (verifyErr) {
                                    console.log(`[BACKUP] ⚠️ Contact ${normalizedNumber} updated but verification failed: ${verifyErr.message}`);
                                    results.updated++; // Still count as updated since saveOrEditAddressbookContact succeeded
                                }
                            } catch (saveErr) {
                                throw new Error(`Failed to update contact: ${saveErr.message}`);
                            }
                        } else {
                            results.skipped++;
                        }
                    } else {
                        // New contact - create with person name using saveOrEditAddressbookContact
                        let firstName = '';
                        let lastName = '';
                        
                        if (isValidName(personName)) {
                            // We have a valid person name
                            const fullName = personName + lastNameSuffix;
                            const nameParts = fullName.trim().split(' ').filter(part => part.length > 0);
                            
                            if (nameParts.length === 0) {
                                // Should not happen if isValidName passed, but handle it
                                firstName = number; // Use number as fallback
                                lastName = lastNameSuffix.trim();
                            } else if (nameParts.length === 1) {
                                firstName = nameParts[0];
                                lastName = lastNameSuffix.trim();
                            } else {
                                firstName = nameParts[0];
                                lastName = nameParts.slice(1).join(' ');
                            }
                        } else {
                            // No valid person name - use number as firstName and suffix as lastName
                            firstName = number;
                            lastName = lastNameSuffix.trim();
                        }
                        
                        // Ensure we have at least a firstName (use number if empty)
                        if (!firstName || firstName.trim() === '') {
                            firstName = number;
                        }
                        
                        // Normalize number (remove non-digits) - E.164 format
                        const normalizedNumber = number.replace(/[^0-9]/g, '');
                        
                        // Clean up firstName and lastName - CRITICAL: firstName must never be empty (v1.34.2+ fix)
                        firstName = firstName.trim();
                        lastName = lastName.trim();
                        
                        // Ensure firstName is never empty (required by WhatsApp, fixed in v1.34.2 Nov 2025)
                        if (!firstName || firstName === '') {
                            firstName = normalizedNumber; // Use number as fallback
                        }
                        
                        console.log(`[BACKUP] Adding contact ${normalizedNumber}: firstName="${firstName}", lastName="${lastName}"`);
                        
                        try {
                            // Use saveOrEditAddressbookContact with proper parameters (v1.34.2+ fix)
                            const contactChatId = await client.saveOrEditAddressbookContact(
                                normalizedNumber,
                                firstName,  // Must not be empty
                                lastName || '',  // Can be empty string, but not undefined
                                true // syncToAddressbook
                            );
                            
                            // Verify the contact was added
                            try {
                                const newContact = await client.getContactById(contactChatId._serialized || contactChatId || `${normalizedNumber}@c.us`);
                                if (newContact) {
                                    const hasProperName = newContact.name && 
                                                         newContact.name.trim() !== '' &&
                                                         newContact.name !== 'N/A' &&
                                                         newContact.name !== normalizedNumber;
                                    
                                    if (hasProperName) {
                                        console.log(`[BACKUP] ✅ Contact ${normalizedNumber} added and verified: "${newContact.name}"`);
                                        results.added++;
                                    } else {
                                        console.log(`[BACKUP] ⚠️ Contact ${normalizedNumber} added but name not set correctly: "${newContact.name}"`);
                                        results.added++; // Still count as added
                                    }
                                } else {
                                    console.log(`[BACKUP] ⚠️ Contact ${normalizedNumber} added but could not verify`);
                                    results.added++; // Still count as added
                                }
                            } catch (verifyErr) {
                                console.log(`[BACKUP] ⚠️ Contact ${normalizedNumber} added but verification failed: ${verifyErr.message}`);
                                results.added++; // Still count as added since saveOrEditAddressbookContact succeeded
                            }
                        } catch (saveErr) {
                            throw new Error(`Failed to save contact: ${saveErr.message}`);
                        }
                    }
                } catch (err) {
                    results.errors.push({ person: person.name || person.number, error: err.message });
                    console.error(`[BACKUP] Failed to add contact ${person.number}:`, err.message);
                }
            }
            
            res.json({ success: true, results });
        } catch (err) {
            console.error('[BACKUP] Failed to add contacts:', err);
            res.status(500).json({ error: 'Failed to add contacts', details: err.message });
        }
    });
}

module.exports = {
    setupBackupRoutes
};
