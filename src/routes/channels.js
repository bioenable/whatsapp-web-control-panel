// Use local MessageMedia (with custom fixes) instead of npm package
const { MessageMedia } = require('../structures');

function setupChannelsRoutes(app, { 
    client,
    getReady,
    readJson,
    getAccountPaths,
    DETECTED_CHANNELS_FILE,
    messageUpload,
    appendSentMessageLog,
    addDetectedChannel,
    getDetectedChannels,
    discoverChannels
}) {
    // Don't cache ready state - check it each time
    
    // List all followed channels (loads from detected_channels.json first, then validates)
    app.get('/api/channels', async (req, res) => {
        const ready = getReady();
        if (!ready) {
            // If not ready, return cached channels from detected_channels.json
            try {
                const cachedChannels = getDetectedChannels();
                const channels = cachedChannels.map(channel => ({
                    id: channel.id,
                    name: channel.name,
                    description: '',
                    isReadOnly: channel.isReadOnly !== undefined ? channel.isReadOnly : true, // Default to read-only if unknown
                    unreadCount: 0,
                    timestamp: new Date(channel.lastSeen || channel.firstSeen).getTime() / 1000,
                    type: channel.type || (channel.isNewsletter ? 'newsletter' : 'unknown'),
                    cached: true
                }));
                return res.json(channels);
            } catch (err) {
                return res.status(503).json({ error: 'WhatsApp client not ready and no cached channels available' });
            }
        }
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
        const ready = getReady();
        if (!ready) {
            // If not ready, return cached channels from detected_channels.json
            try {
                const cachedChannels = getDetectedChannels();
                const channels = cachedChannels.map(channel => ({
                    id: channel.id,
                    name: channel.name,
                    description: '',
                    isReadOnly: channel.isReadOnly !== undefined ? channel.isReadOnly : true,
                    unreadCount: 0,
                    timestamp: new Date(channel.lastSeen || channel.firstSeen).getTime() / 1000,
                    isMuted: false,
                    muteExpiration: null,
                    lastMessage: channel.lastMessage ? {
                        id: 'cached',
                        body: channel.lastMessage,
                        timestamp: new Date(channel.lastSeen || channel.firstSeen).getTime() / 1000,
                        fromMe: false
                    } : null,
                    type: channel.type || (channel.isNewsletter ? 'newsletter' : 'unknown'),
                    cached: true
                }));
                return res.json({ channels, method: 'cached', count: channels.length });
            } catch (err) {
                return res.status(503).json({ error: 'WhatsApp client not ready and no cached channels available' });
            }
        }
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
        const ready = getReady();
        if (!ready) {
            // If not ready, return cached channels from detected_channels.json
            try {
                const cachedChannels = getDetectedChannels();
                const channels = cachedChannels.map(channel => ({
                    id: channel.id,
                    name: channel.name,
                    description: '',
                    isReadOnly: channel.isReadOnly !== undefined ? channel.isReadOnly : true,
                    unreadCount: 0,
                    timestamp: new Date(channel.lastSeen || channel.firstSeen).getTime() / 1000,
                    isMuted: false,
                    muteExpiration: null,
                    lastMessage: channel.lastMessage ? {
                        id: 'cached',
                        body: channel.lastMessage,
                        timestamp: new Date(channel.lastSeen || channel.firstSeen).getTime() / 1000,
                        fromMe: false
                    } : null,
                    subscriberCount: null,
                    type: channel.type || (channel.isNewsletter ? 'newsletter' : 'unknown'),
                    cached: true
                }));
                return res.json({ channels, method: 'cached', count: channels.length });
            } catch (err) {
                return res.status(503).json({ error: 'WhatsApp client not ready and no cached channels available' });
            }
        }
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
        const ready = getReady();
        if (!ready) {
            // If not ready, return cached status from detected_channels.json
            try {
                const cachedChannels = getDetectedChannels();
                const channel = cachedChannels.find(ch => ch.id === req.params.channelId);
                if (channel) {
                    return res.json({
                        id: channel.id,
                        name: channel.name,
                        isReadOnly: channel.isReadOnly !== undefined ? channel.isReadOnly : true,
                        isChannel: true,
                        verified: false, // Mark as not verified since we're using cached data
                        cached: true
                    });
                }
                return res.status(404).json({ error: 'Channel not found in cache' });
            } catch (err) {
                return res.status(503).json({ error: 'WhatsApp client not ready and channel not in cache' });
            }
        }
        try {
            const { channelId } = req.params;
            const channel = await client.getChatById(channelId);
            
            if (!channel) {
                return res.status(404).json({ error: 'Channel not found' });
            }
            
            if (!channel.isChannel) {
                return res.status(400).json({ error: 'Not a channel' });
            }
            
            // Save verified isReadOnly status to cache
            try {
                addDetectedChannel(channelId, {
                    name: channel.name,
                    isReadOnly: channel.isReadOnly,
                    verified: true,
                    verifiedAt: new Date().toISOString()
                });
            } catch (cacheErr) {
                console.error('[CHANNELS] Failed to update channel cache:', cacheErr);
                // Continue even if cache update fails
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
        const ready = getReady();
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
        const ready = getReady();
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
        const ready = getReady();
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
        const ready = getReady();
        if (!ready) {
            console.error('[CHANNELS-SEND] WhatsApp not ready');
            return res.status(503).json({ error: 'WhatsApp not ready' });
        }
        console.log('[CHANNELS-SEND] Request received:', {
            channelId: req.body?.channelId,
            sendToAll: req.body?.sendToAll,
            hasMessage: !!req.body?.message,
            hasFile: !!req.file
        });
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
                    console.log(`[CHANNELS-SEND] Sending to channel: ${channel.id._serialized} (${channel.name || 'unnamed'})`);
                    let sent;
                    if (attachment) {
                        console.log(`[CHANNELS-SEND] Processing attachment: ${attachment.originalname} (${attachment.mimetype})`);
                        const allowedTypes = ['image/', 'video/', 'application/pdf'];
                        if (!allowedTypes.some(t => attachment.mimetype.startsWith(t))) {
                            console.error(`[CHANNELS-SEND] Unsupported media type: ${attachment.mimetype}`);
                            results.push({ channelId: channel.id._serialized, success: false, error: 'Unsupported media type' });
                            continue;
                        }
                        if (attachment.size > 100 * 1024 * 1024) {
                            console.error(`[CHANNELS-SEND] File too large: ${attachment.size} bytes`);
                            results.push({ channelId: channel.id._serialized, success: false, error: 'File too large (max 100MB)' });
                            continue;
                        }
                        const media = new MessageMedia(
                            attachment.mimetype,
                            attachment.buffer.toString('base64'),
                            attachment.originalname
                        );
                        console.log(`[CHANNELS-SEND] Calling channel.sendMessage with media for ${channel.id._serialized}...`);
                        sent = await channel.sendMessage(media, { caption: message });
                        console.log(`[CHANNELS-SEND] channel.sendMessage result for ${channel.id._serialized}:`, sent ? 'success' : 'null', sent?.id?._serialized || 'no id');
                    } else {
                        console.log(`[CHANNELS-SEND] Calling channel.sendMessage with text for ${channel.id._serialized}...`);
                        sent = await channel.sendMessage(message);
                        console.log(`[CHANNELS-SEND] channel.sendMessage result for ${channel.id._serialized}:`, sent ? 'success' : 'null', sent?.id?._serialized || 'no id');
                    }
                    
                    if (sent && sent.id) {
                        results.push({ 
                            channelId: channel.id._serialized, 
                            channelName: channel.name,
                            success: true, 
                            messageId: sent.id._serialized 
                        });
                        console.log(`[CHANNELS-SEND] Successfully sent message to ${channel.id._serialized}`);
                    } else {
                        results.push({ 
                            channelId: channel.id._serialized, 
                            channelName: channel.name,
                            success: false, 
                            error: 'Message sent but no ID returned' 
                        });
                        console.error(`[CHANNELS-SEND] Message sent but no ID returned for ${channel.id._serialized}`);
                    }
                    
                    // Log the sent message
                    if (appendSentMessageLog) {
                        appendSentMessageLog({
                            to: channel.id._serialized,
                            message: message,
                            media: attachment ? attachment.originalname : null,
                            status: 'sent',
                            time: new Date().toISOString()
                        });
                    }
                    
                } catch (err) {
                    console.error(`[CHANNELS-SEND] Error sending to ${channel.id._serialized}:`, err);
                    console.error(`[CHANNELS-SEND] Error stack:`, err.stack);
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

    // Get all detected channels (from message stream) - returns cached data immediately
    app.get('/api/detected-channels', (req, res) => {
        try {
            const channels = getDetectedChannels();
            // Format channels with isReadOnly status
            const formattedChannels = channels.map(channel => ({
                id: channel.id,
                name: channel.name,
                description: '',
                isReadOnly: channel.isReadOnly !== undefined ? channel.isReadOnly : true, // Default to read-only if unknown
                unreadCount: 0,
                timestamp: new Date(channel.lastSeen || channel.firstSeen).getTime() / 1000,
                type: channel.type || (channel.isNewsletter ? 'newsletter' : 'unknown'),
                isNewsletter: channel.isNewsletter || false,
                isBroadcast: channel.isBroadcast || false,
                messageCount: channel.messageCount || 0,
                lastMessage: channel.lastMessage || '',
                cached: true
            }));
            res.json({ channels: formattedChannels });
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch detected channels', details: err.message });
        }
    });

    // Manual channel discovery endpoint
    app.post('/api/channels/discover', async (req, res) => {
        const ready = getReady();
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
}

module.exports = { setupChannelsRoutes };

