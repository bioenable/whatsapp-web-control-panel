export class WhatsAppDataStore {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.chats = new Map();
    this.contacts = new Map();
    this.messages = new Map();
    this.messageQueue = [];
    this.webhookEndpoints = []; // Store webhook URLs for notifications
    this.channels = new Map(); // Store channel information
    this.channelMessages = new Map(); // Store channel messages
    this.activeUsers = new Map(); // Track active users and their sessions
    this.userSessions = new Map(); // Store user-specific session data

    this.state.blockConcurrencyWhile(async () => {
      this.chats = await this.state.storage.get('chats') || new Map();
      this.contacts = await this.state.storage.get('contacts') || new Map();
      this.messages = await this.state.storage.get('messages') || new Map();
      this.messageQueue = await this.state.storage.get('messageQueue') || [];
      this.webhookEndpoints = await this.state.storage.get('webhookEndpoints') || [];
      this.channels = await this.state.storage.get('channels') || new Map();
      this.channelMessages = await this.state.storage.get('channelMessages') || new Map();
      this.lastSync = await this.state.storage.get('lastSync') || {};
      this.activeUsers = await this.state.storage.get('activeUsers') || new Map();
      this.userSessions = await this.state.storage.get('userSessions') || new Map();
    });
  }

  // User Management Methods
  async registerUser(userId, userInfo) {
    // Extract phone number from userId (remove @c.us or @g.us) as default name
    const phoneNumber = userId.replace('@c.us', '').replace('@g.us', '');
    const userData = {
      id: userId,
      name: userInfo.name || phoneNumber, // Use phone number as default instead of 'Unknown User'
      phone: userInfo.phone || phoneNumber,
      platform: userInfo.platform || 'web',
      lastSeen: new Date().toISOString(),
      isActive: true,
      messageCount: 0,
      webhookUrl: userInfo.webhookUrl || null
    };

    this.activeUsers.set(userId, userData);
    await this.state.storage.put('activeUsers', this.activeUsers);

    console.log(`[USER-REGISTRATION] New user registered: ${userData.name} (${userData.phone})`);
    console.log(`[USER-REGISTRATION] User ID: ${userId}`);
    console.log(`[USER-REGISTRATION] Platform: ${userData.platform}`);
    console.log(`[USER-REGISTRATION] Total active users: ${this.activeUsers.size}`);

    // Trigger webhook for user registration
    await this.triggerWebhook('user_registered', {
      userId,
      userInfo: userData,
      totalUsers: this.activeUsers.size
    });

    return userData;
  }

  async updateUserActivity(userId, activity = 'message_sent') {
    if (this.activeUsers.has(userId)) {
      const userData = this.activeUsers.get(userId);
      userData.lastSeen = new Date().toISOString();
      userData.isActive = true;
      
      if (activity === 'message_sent') {
        userData.messageCount = (userData.messageCount || 0) + 1;
      }
      
      this.activeUsers.set(userId, userData);
      await this.state.storage.put('activeUsers', this.activeUsers);
    }
  }

  async getActiveUsers() {
    const users = Array.from(this.activeUsers.values());
    return {
      success: true,
      totalUsers: users.length,
      activeUsers: users,
      timestamp: new Date().toISOString()
    };
  }

  async getUserSession(userId) {
    const userData = this.activeUsers.get(userId);
    if (!userData) {
      return {
        success: false,
        error: 'User not found',
        message: `User ${userId} is not registered`
      };
    }

    const userQueueKey = `messageQueue_${userId}`;
    const userQueue = await this.state.storage.get(userQueueKey) || [];
    const pendingMessages = userQueue.filter(msg => msg.status === 'queued');

    return {
      success: true,
      user: userData,
      pendingMessages: pendingMessages.length,
      lastSeen: userData.lastSeen,
      isActive: userData.isActive
    };
  }

  async registerUserEndpoint(request) {
    try {
      const data = await request.json();
      const { userId, userInfo } = data;

      if (!userId) {
        return new Response(JSON.stringify({
          success: false,
          error: 'userId is required'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const userData = await this.registerUser(userId, userInfo || {});
      
      return new Response(JSON.stringify({
        success: true,
        user: userData,
        message: 'User registered successfully'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // Trigger webhook notification to local app
  async triggerWebhook(event, data) {
    if (this.webhookEndpoints.length === 0) {
      console.log('No webhook endpoints configured');
      return;
    }

    const webhookPayload = {
      event,
      data,
      timestamp: new Date().toISOString()
    };

    // Send webhook to all registered endpoints
    const promises = this.webhookEndpoints.map(async (webhookUrl) => {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Event': event
          },
          body: JSON.stringify(webhookPayload)
        });
        console.log(`Webhook sent to ${webhookUrl} for event: ${event}`);
      } catch (error) {
        console.error(`Failed to send webhook to ${webhookUrl}:`, error);
      }
    });

    await Promise.all(promises);
  }

  // Register webhook endpoint
  async registerWebhook(request) {
    const data = await request.json();
    const { webhookUrl } = data;

    if (!webhookUrl) {
      return new Response(JSON.stringify({ error: 'webhookUrl is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Add webhook URL if not already present
    if (!this.webhookEndpoints.includes(webhookUrl)) {
      this.webhookEndpoints.push(webhookUrl);
      await this.state.storage.put('webhookEndpoints', this.webhookEndpoints);
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Webhook endpoint registered',
      webhookUrl,
      totalEndpoints: this.webhookEndpoints.length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Handle fetch requests
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      switch (true) {
        case path === '/api/chats' && method === 'GET':
          return this.getChats();
        case path === '/api/chats' && method === 'POST':
          return this.syncChats(request);
        case path === '/api/contacts' && method === 'GET':
          return this.getContacts();
        case path === '/api/messages' && method === 'GET':
          return this.getMessages(request);
        case path === '/api/messages' && method === 'POST':
          return this.syncMessages(request);
        case path === '/api/messages/queue' && method === 'POST':
          return this.queueMessage(request);
        case path === '/api/messages/queue' && method === 'GET':
          return this.getQueuedMessages(request);
        case path === '/api/messages/queue/process' && method === 'POST':
          return this.processMessageQueue(request);
        case path === '/api/webhooks' && method === 'POST':
          return this.registerWebhook(request);
        case path === '/api/channels' && method === 'GET':
          return this.getChannels();
        case path === '/api/channels' && method === 'POST':
          return this.syncChannels(request);
        case path.startsWith('/api/channels/') && path.endsWith('/messages') && method === 'GET':
          return this.getChannelMessages(request);
        case path.startsWith('/channel/') && method === 'GET':
          return this.getChannelWebpage(request);
        case path === '/api/sync' && method === 'POST':
          return this.syncData(request);
        case path === '/api/status' && method === 'GET':
          return this.getStatus();
        case path === '/api/users' && method === 'GET':
          return new Response(JSON.stringify(await this.getActiveUsers()), {
            headers: { 'Content-Type': 'application/json' }
          });
        case path.startsWith('/api/users/') && method === 'GET':
          const userId = path.split('/')[3];
          return new Response(JSON.stringify(await this.getUserSession(userId)), {
            headers: { 'Content-Type': 'application/json' }
          });
        case path === '/api/users/register' && method === 'POST':
          return this.registerUserEndpoint(request);
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('WhatsAppDataStore error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // Get all chats
  async getChats() {
    const chatsArray = Array.from(this.chats.values());
    return new Response(JSON.stringify({
      success: true,
      data: chatsArray,
      count: chatsArray.length,
      lastSync: this.lastSync.chats || null
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Sync chats data
  async syncChats(request) {
    const data = await request.json();
    const { chats, timestamp } = data;

    for (const chat of chats) {
      this.chats.set(chat.id, {
        ...chat,
        lastSync: timestamp || new Date().toISOString()
      });
    }

    this.lastSync.chats = timestamp || new Date().toISOString();
    await this.state.storage.put('chats', this.chats);
    await this.state.storage.put('lastSync', this.lastSync);

    return new Response(JSON.stringify({
      success: true,
      synced: chats.length,
      timestamp: this.lastSync.chats
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get all contacts
  async getContacts() {
    const contactsArray = Array.from(this.contacts.values());
    return new Response(JSON.stringify({
      success: true,
      data: contactsArray,
      count: contactsArray.length,
      lastSync: this.lastSync.contacts || null
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Individual contact sync is handled via syncData method

  // Get messages for a specific chat
  async getMessages(request) {
    const url = new URL(request.url);
    const chatId = url.searchParams.get('chatId');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    if (!chatId) {
      return new Response(JSON.stringify({ error: 'chatId parameter required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const chatMessages = Array.from(this.messages.values())
      .filter(msg => msg.chatId === chatId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    return new Response(JSON.stringify({
      success: true,
      data: chatMessages,
      count: chatMessages.length,
      chatId
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Sync messages data
  async syncMessages(request) {
    const data = await request.json();
    const { messages, timestamp } = data;

    for (const message of messages) {
      this.messages.set(message.id, {
        ...message,
        lastSync: timestamp || new Date().toISOString()
      });
    }

    this.lastSync.messages = timestamp || new Date().toISOString();
    await this.state.storage.put('messages', this.messages);
    await this.state.storage.put('lastSync', this.lastSync);

    return new Response(JSON.stringify({
      success: true,
      synced: messages.length,
      timestamp: this.lastSync.messages
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Queue a message for sending
  async queueMessage(request) {
    const data = await request.json();
    const { to, message, media, priority = 'normal', from, contactName, senderName, userName } = data;

    if (!to || !message) {
      return new Response(JSON.stringify({ error: 'to and message are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // SECURITY VALIDATION: Check if from field is valid
    if (from && from !== 'anonymous') {
      // Check if this is a valid user ID format (should end with @c.us)
      if (!from.includes('@c.us')) {
        return new Response(JSON.stringify({ 
          error: 'Invalid from field format. Must be a valid WhatsApp user ID ending with @c.us' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Extract phone number from from field (remove @c.us part) for use as default name
      const phoneNumber = from.replace('@c.us', '').replace('@g.us', '');
      
      // Register user if provided and not already registered
      // Support both senderName and userName for sender identification
      // If not provided, use phone number as default name
      const senderDisplayName = senderName || userName || phoneNumber;
      if (!this.activeUsers.has(from)) {
        await this.registerUser(from, { 
          id: from,
          name: senderDisplayName
        });
      } else {
        // Update existing user's name if:
        // 1. Explicit senderName/userName provided, OR
        // 2. Current name is "Unknown User" (migrate to phone number)
        const existingUser = this.activeUsers.get(from);
        if (existingUser) {
          const shouldUpdate = (senderName || userName) || (existingUser.name === 'Unknown User');
          if (shouldUpdate) {
            existingUser.name = senderDisplayName;
            this.activeUsers.set(from, existingUser);
            await this.state.storage.put('activeUsers', this.activeUsers);
          }
        }
      }
    }

    const queuedMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      to,
      message,
      media,
      priority,
      from: from || 'anonymous', // Default to anonymous if no from provided
      contactName: contactName || to, // Use contact name or fallback to phone number
      status: 'queued',
      createdAt: new Date().toISOString(),
      attempts: 0
    };

    // Store message individually to avoid size limits
    await this.state.storage.put(`message_${queuedMessage.id}`, queuedMessage);

    // Store in user-specific queue (only store IDs to keep size small)
    const userQueueKey = `messageQueue_${queuedMessage.from}`;
    const userQueueIds = await this.state.storage.get(userQueueKey) || [];
    if (!userQueueIds.includes(queuedMessage.id)) {
      userQueueIds.push(queuedMessage.id);
      // Keep only last 1000 message IDs per user to prevent unbounded growth
      if (userQueueIds.length > 1000) {
        const oldIds = userQueueIds.splice(0, userQueueIds.length - 1000);
        // Clean up old messages
        for (const oldId of oldIds) {
          await this.state.storage.delete(`message_${oldId}`);
        }
      }
      await this.state.storage.put(userQueueKey, userQueueIds);
    }

    // Also maintain global queue IDs for backward compatibility (limit to 1000)
    const globalQueueIds = await this.state.storage.get('messageQueueIds') || [];
    if (!globalQueueIds.includes(queuedMessage.id)) {
      globalQueueIds.push(queuedMessage.id);
      if (globalQueueIds.length > 1000) {
        const oldIds = globalQueueIds.splice(0, globalQueueIds.length - 1000);
        for (const oldId of oldIds) {
          await this.state.storage.delete(`message_${oldId}`);
        }
      }
      await this.state.storage.put('messageQueueIds', globalQueueIds);
    }

    // Update user activity
    if (from) {
      await this.updateUserActivity(from, 'message_queued');
    }

    // Enhanced logging with user distinction
    // Use user's name if available, otherwise extract phone number from from field
    let userDisplay = 'Anonymous User';
    if (from && from !== 'anonymous') {
      const userData = this.activeUsers.get(from);
      if (userData && userData.name) {
        userDisplay = `User: ${userData.name}`;
      } else {
        // Extract phone number (remove @c.us or @g.us) as fallback
        const phoneNumber = from.replace('@c.us', '').replace('@g.us', '');
        userDisplay = `User: ${phoneNumber}`;
      }
    }
    console.log(`[MESSAGE-QUEUE] ${userDisplay} queued message to ${to}`);
    console.log(`[MESSAGE-QUEUE] Message ID: ${queuedMessage.id}`);
    console.log(`[MESSAGE-QUEUE] Priority: ${priority}`);
    console.log(`[MESSAGE-QUEUE] User Queue Length: ${userQueueIds.length}`);

    // Trigger webhook notification for immediate processing
    await this.triggerWebhook('message_queued', {
      messageId: queuedMessage.id,
      to: queuedMessage.to,
      priority: queuedMessage.priority,
      from: queuedMessage.from,
      queueLength: userQueueIds.length,
      userDisplay: userDisplay
    });

    return new Response(JSON.stringify({
      success: true,
      messageId: queuedMessage.id,
      status: 'queued',
      from: queuedMessage.from,
      userDisplay: userDisplay
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get queued messages
  async getQueuedMessages(request) {
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    
    let messageIds = [];
    
    if (from) {
      // Get user-specific message IDs
      const userQueueKey = `messageQueue_${from}`;
      messageIds = await this.state.storage.get(userQueueKey) || [];
    } else {
      // Get all message IDs (backward compatibility)
      messageIds = await this.state.storage.get('messageQueueIds') || [];
    }
    
    // Fetch messages individually
    const pendingMessages = [];
    for (const msgId of messageIds) {
      const message = await this.state.storage.get(`message_${msgId}`);
      if (message && message.status === 'queued') {
        pendingMessages.push(message);
      }
    }
    
    // Sort by priority and creation time
    pendingMessages.sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      const priorityDiff = (priorityOrder[b.priority] || 2) - (priorityOrder[a.priority] || 2);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
    
    return new Response(JSON.stringify({
      success: true,
      data: pendingMessages,
      count: pendingMessages.length,
      from: from || 'all'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Process message queue (mark messages as sent)
  async processMessageQueue(request) {
    try {
      const data = await request.json();
      const { processedMessages, from } = data;

      if (!processedMessages || !Array.isArray(processedMessages)) {
        return new Response(JSON.stringify({ 
          error: 'processedMessages array is required' 
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    let processedCount = 0;

    for (const processedMsg of processedMessages) {
      // Update individual message storage
      const message = await this.state.storage.get(`message_${processedMsg.id}`);
      if (message) {
        const updatedMessage = {
          ...message,
          status: processedMsg.status,
          sentAt: processedMsg.sentAt || new Date().toISOString(),
          error: processedMsg.error
        };
        await this.state.storage.put(`message_${processedMsg.id}`, updatedMessage);
        processedCount++;

        // If message is sent or failed, remove from queue IDs after 24 hours
        if (processedMsg.status === 'sent' || processedMsg.status === 'failed') {
          // Remove from user-specific queue IDs
          if (from) {
            const userQueueKey = `messageQueue_${from}`;
            const userQueueIds = await this.state.storage.get(userQueueKey) || [];
            const filteredIds = userQueueIds.filter(id => id !== processedMsg.id);
            await this.state.storage.put(userQueueKey, filteredIds);
          }

          // Remove from global queue IDs
          const globalQueueIds = await this.state.storage.get('messageQueueIds') || [];
          const filteredGlobalIds = globalQueueIds.filter(id => id !== processedMsg.id);
          await this.state.storage.put('messageQueueIds', filteredGlobalIds);

          // Optionally delete old messages after 7 days (keep for history)
          // For now, we keep them but they won't appear in queue queries
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: processedCount,
      from: from || 'global'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
    } catch (error) {
      console.error('[PROCESS-QUEUE] Error:', error);
      return new Response(JSON.stringify({ 
        error: 'Failed to process message queue',
        details: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // Sync all data at once
  async syncData(request) {
    const data = await request.json();
    const { chats, contacts, messages, channels, channelMessages, timestamp } = data;

    // Sync chats
    if (chats) {
      for (const chat of chats) {
        this.chats.set(chat.id, {
          ...chat,
          lastSync: timestamp || new Date().toISOString()
        });
      }
      this.lastSync.chats = timestamp || new Date().toISOString();
    }

    // Sync contacts
    if (contacts) {
      for (const contact of contacts) {
        this.contacts.set(contact.id, {
          ...contact,
          lastSync: timestamp || new Date().toISOString()
        });
      }
      this.lastSync.contacts = timestamp || new Date().toISOString();
    }

    // Sync messages
    if (messages) {
      for (const message of messages) {
        this.messages.set(message.id, {
          ...message,
          lastSync: timestamp || new Date().toISOString()
        });
      }
      this.lastSync.messages = timestamp || new Date().toISOString();
    }

    // Sync channels
    if (channels) {
      for (const channel of channels) {
        this.channels.set(channel.id, {
          ...channel,
          lastSync: timestamp || new Date().toISOString()
        });
      }
      this.lastSync.channels = timestamp || new Date().toISOString();
    }

    // Sync channel messages
    if (channelMessages) {
      for (const channelMessage of channelMessages) {
        const channelKey = `channel_${channelMessage.chatId}`;
        const existingMessages = this.channelMessages.get(channelKey) || [];
        
        // Add new message if it doesn't exist
        const messageExists = existingMessages.some(msg => msg.id === channelMessage.id);
        if (!messageExists) {
          existingMessages.push({
            ...channelMessage,
            lastSync: timestamp || new Date().toISOString()
          });
          
          // Keep only latest 100 messages per channel
          const sortedMessages = existingMessages.sort((a, b) => 
            new Date(b.timestamp) - new Date(a.timestamp)
          ).slice(0, 100);
          
          this.channelMessages.set(channelKey, sortedMessages);
        }
      }
      this.lastSync.channelMessages = timestamp || new Date().toISOString();
    }

    // Save all data
    await this.state.storage.put('chats', this.chats);
    await this.state.storage.put('contacts', this.contacts);
    await this.state.storage.put('messages', this.messages);
    await this.state.storage.put('channels', this.channels);
    await this.state.storage.put('channelMessages', this.channelMessages);
    await this.state.storage.put('lastSync', this.lastSync);

    const syncResults = {
      chats: chats?.length || 0,
      contacts: contacts?.length || 0,
      messages: messages?.length || 0,
      channels: channels?.length || 0,
      channelMessages: channelMessages?.length || 0
    };

    // Trigger webhook if external app wants to know about data updates
    if (syncResults.chats > 0 || syncResults.contacts > 0 || syncResults.messages > 0 || 
        syncResults.channels > 0 || syncResults.channelMessages > 0) {
      await this.triggerWebhook('data_synced', {
        syncResults,
        timestamp: new Date().toISOString()
      });
    }

    return new Response(JSON.stringify({
      success: true,
      synced: syncResults,
      timestamp: this.lastSync
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get all channels
  async getChannels() {
    const channelsArray = Array.from(this.channels.values());
    return new Response(JSON.stringify({
      success: true,
      data: channelsArray,
      count: channelsArray.length,
      lastSync: this.lastSync.channels || null
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Sync channels data
  async syncChannels(request) {
    const data = await request.json();
    const { channels, timestamp } = data;

    for (const channel of channels) {
      this.channels.set(channel.id, {
        ...channel,
        lastSync: timestamp || new Date().toISOString()
      });
    }

    this.lastSync.channels = timestamp || new Date().toISOString();
    await this.state.storage.put('channels', this.channels);
    await this.state.storage.put('lastSync', this.lastSync);

    return new Response(JSON.stringify({
      success: true,
      synced: channels.length,
      timestamp: this.lastSync.channels
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get messages for a specific channel
  async getChannelMessages(request) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const channelId = pathParts[3]; // /api/channels/{channelId}/messages
    
    if (!channelId) {
      return new Response(JSON.stringify({ error: 'Channel ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const channelKey = `channel_${channelId}`;
    const messages = this.channelMessages.get(channelKey) || [];
    
    // Sort messages by timestamp (latest first)
    const sortedMessages = messages.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    return new Response(JSON.stringify({
      success: true,
      channelId: channelId,
      data: sortedMessages,
      count: sortedMessages.length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Generate beautiful channel webpage with on-demand message fetching
  async getChannelWebpage(request) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const channelId = pathParts[2]; // /channel/{channelId}
    
    if (!channelId) {
      return new Response('Channel ID required', { status: 400 });
    }

    const channel = this.channels.get(channelId);
    const channelName = channel?.name || channelId;
    
    // Check if we should fetch fresh messages (if requested via ?fetch=true)
    const shouldFetchFresh = url.searchParams.get('fetch') === 'true';
    
    let messages = [];
    let fetchError = null;
    
    if (shouldFetchFresh) {
      // Show instructions for manual sync since Cloudflare can't reach localhost
      const channelKey = `channel_${channelId}`;
      messages = this.channelMessages.get(channelKey) || [];
      
      if (messages.length === 0) {
        fetchError = "No cached messages. Use: curl -X POST 'http://localhost:5014/api/channel/" + channelId + "/sync-messages'";
      } else {
        fetchError = "Showing cached messages. For fresh data, use: curl -X POST 'http://localhost:5014/api/channel/" + channelId + "/sync-messages'";
      }
    } else {
      // Use cached messages
      const channelKey = `channel_${channelId}`;
      messages = this.channelMessages.get(channelKey) || [];
    }
    
    // Sort messages by timestamp (latest first)
    const sortedMessages = messages.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    return new Response(this.generateChannelHTML(channelId, channelName, sortedMessages, shouldFetchFresh, fetchError), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // Generate beautiful HTML for channel messages
  generateChannelHTML(channelId, channelName, messages, hasFreshData = false, fetchError = null) {
    // Sort messages by timestamp (latest first)
    const sortedMessages = messages.sort((a, b) => {
      const timeA = typeof a.timestamp === 'number' ? 
        (a.timestamp < 1000000000000 ? a.timestamp * 1000 : a.timestamp) : 
        new Date(a.timestamp).getTime();
      const timeB = typeof b.timestamp === 'number' ? 
        (b.timestamp < 1000000000000 ? b.timestamp * 1000 : b.timestamp) : 
        new Date(b.timestamp).getTime();
      return timeB - timeA; // Latest first
    });

    // Helper function for relative time
    const getRelativeTime = (date) => {
      const now = new Date();
      const diffInMs = now - date;
      const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
      const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
      const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

      if (diffInMinutes < 1) return 'just now';
      if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
      if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
      if (diffInDays < 7) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
      return `${Math.floor(diffInDays / 7)} week${Math.floor(diffInDays / 7) > 1 ? 's' : ''} ago`;
    };

    const messageCards = sortedMessages.map(msg => {
      // Fix timestamp conversion - handle both number and string timestamps
      let timestamp;
      let relativeTime;
      if (typeof msg.timestamp === 'number') {
        // If timestamp is in seconds, convert to milliseconds
        const timestampMs = msg.timestamp < 1000000000000 ? msg.timestamp * 1000 : msg.timestamp;
        const date = new Date(timestampMs);
        timestamp = date.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        relativeTime = getRelativeTime(date);
      } else {
        const date = new Date(msg.timestamp);
        timestamp = date.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        relativeTime = getRelativeTime(date);
      }
      
      const body = msg.body || '';
      
      // Parse message structure: title, content, and URL
      const lines = body.split('\n').filter(line => line.trim());
      let title = '';
      let content = '';
      let url = '';
      
      // Extract title (first line with ** or first line)
      if (lines.length > 0) {
        const firstLine = lines[0];
        if (firstLine.includes('**')) {
          title = firstLine.replace(/\*\*/g, '').trim();
          content = lines.slice(1).join('\n').trim();
        } else {
          title = firstLine;
          content = lines.slice(1).join('\n').trim();
        }
      }
      
      // Extract URL from content
      const urlMatch = content.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        url = urlMatch[0];
        content = content.replace(urlMatch[0], '').trim();
      }
      
      return `
        <article class="message-bubble" role="article" aria-label="Channel message">
          <div class="message-content">
            ${title ? `<h3 class="message-title">${title}</h3>` : ''}
            ${content ? `<p class="message-text">${content}</p>` : ''}
            ${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer" class="message-link">${url}</a>` : ''}
          </div>
          <time class="message-time" datetime="${new Date(msg.timestamp).toISOString()}">${timestamp} (${relativeTime})</time>
        </article>
      `;
    }).join('');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${channelName} - WhatsApp Channel</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        /* CSS Reset and Base Styles */
        *,
        *::before,
        *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        html {
            font-size: 16px;
            scroll-behavior: smooth;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.5;
            color: #e9edef;
            background: #111b21;
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        /* Layout */
        .app-container {
            max-width: 100%;
            margin: 0 auto;
            background: #111b21;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }

        /* Header */
        .channel-header {
            background: #202c33;
            border-bottom: 1px solid #374045;
            padding: 0;
            position: sticky;
            top: 0;
            z-index: 10;
        }

        .header-content {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            max-width: 1200px;
            margin: 0 auto;
        }

        .channel-info {
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .channel-avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: linear-gradient(135deg, #25d366, #128c7e);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 20px;
        }

        .channel-details h1 {
            font-size: 32px;
            font-weight: 700;
            color: #e9edef;
            margin: 0;
            line-height: 1.2;
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .header-button {
            background: transparent;
            border: none;
            color: #8696a0;
            padding: 12px;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 48px;
            height: 48px;
        }

        .header-button:hover {
            background: #374045;
            color: #e9edef;
        }

        .header-button:focus {
            outline: 2px solid #00a884;
            outline-offset: 2px;
        }

        .sync-button {
            background: #00a884;
            color: white;
            border-radius: 12px;
            padding: 12px 16px;
            font-weight: 600;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s ease;
        }

        .sync-button:hover {
            background: #00d4aa;
            transform: translateY(-1px);
        }

        .sync-button:focus {
            outline: 2px solid #e9edef;
            outline-offset: 2px;
        }

        /* Messages Container */
        .messages-container {
            flex: 1;
            padding: 20px;
            max-width: 1200px;
            margin: 0 auto;
            width: 100%;
        }

        .messages-list {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        /* Message Bubbles */
        .message-bubble {
            background: #202c33;
            border-radius: 12px;
            padding: 16px 20px;
            max-width: 100%;
            position: relative;
            border: 1px solid #374045;
        }

        .message-content {
            margin-bottom: 12px;
        }

        .message-title {
            font-size: 19.2px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 12px;
            line-height: 1.3;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }

        .message-text {
            font-size: 14px;
            color: #d1d7db;
            line-height: 1.6;
            margin-bottom: 12px;
            white-space: pre-wrap;
        }

        .message-link {
            display: inline-block;
            color: #00a884;
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            word-break: break-all;
            transition: color 0.2s ease;
        }

        .message-link:hover {
            color: #00d4aa;
            text-decoration: underline;
        }

        .message-link:focus {
            outline: 2px solid #00a884;
            outline-offset: 2px;
            border-radius: 4px;
        }

        .message-time {
            font-size: 12px;
            color: #8696a0;
            text-align: right;
            display: block;
        }

        /* Status Indicators */
        .status-bar {
            background: #202c33;
            border-top: 1px solid #374045;
            padding: 8px 16px;
            text-align: center;
        }

        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: #8696a0;
            padding: 4px 8px;
            border-radius: 12px;
            background: #374045;
        }

        .status-fresh {
            background: #1a3a2e;
            color: #00a884;
        }

        .status-cached {
            background: #3a2e1a;
            color: #ffa726;
        }

        /* Empty State */
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #8696a0;
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .empty-state h3 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
            color: #e9edef;
        }

        .empty-state p {
            font-size: 14px;
            line-height: 1.5;
        }

        /* Loading States */
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px;
            color: #8696a0;
        }

        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid #374045;
            border-top: 2px solid #00a884;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 8px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .header-content {
                padding: 12px 16px;
            }

            .channel-details h1 {
                font-size: 24px;
            }

            .messages-container {
                padding: 16px;
            }

            .message-title {
                font-size: 18px;
            }
        }

        @media (max-width: 480px) {
            .channel-details h1 {
                font-size: 20px;
            }

            .message-bubble {
                padding: 12px 16px;
            }

            .message-title {
                font-size: 16px;
            }

            .message-text {
                font-size: 13px;
            }

            .sync-button {
                padding: 10px 12px;
                font-size: 12px;
            }
        }

        /* High Contrast Mode Support */
        @media (prefers-contrast: high) {
            .message-bubble {
                border: 2px solid #e9edef;
            }

            .sync-button {
                border: 2px solid #e9edef;
            }
        }

        /* Reduced Motion Support */
        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }

        /* Focus Visible for Keyboard Navigation */
        .focus-visible {
            outline: 2px solid #00a884;
            outline-offset: 2px;
        }
    </style>
</head>
<body>
    <div class="app-container" role="main">
        <!-- Channel Header -->
        <header class="channel-header" role="banner">
            <div class="header-content">
                <div class="channel-info">
                    <div class="channel-avatar" aria-hidden="true">
                        ${channelName.charAt(0).toUpperCase()}
                    </div>
                    <div class="channel-details">
                        <h1>${channelName}</h1>
                    </div>
                </div>
                <div class="header-actions">
                    <button class="sync-button" onclick="syncChannelMessages()" aria-label="Sync and refresh messages" title="Sync Messages">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                        </svg>
                        Sync
                    </button>
                </div>
            </div>
        </header>

        <!-- Messages -->
        <main class="messages-container" role="main">
            ${sortedMessages.length > 0 ? `
                <div class="messages-list" role="list">
                    ${messageCards}
                </div>
            ` : `
                <div class="empty-state" role="status" aria-live="polite">
                    <div class="empty-state-icon">💬</div>
                    <h3>No messages yet</h3>
                    <p>Messages will appear here when they are synced from WhatsApp</p>
                    ${hasFreshData && fetchError ? `
                        <div style="margin-top: 20px; padding: 16px; background: #3a2e1a; border-radius: 8px; border-left: 4px solid #ffa726; color: #ffa726;">
                            <strong>💡 To see today's messages:</strong><br>
                            1. Go to your local WhatsApp app (localhost:5014)<br>
                            2. Use the manual sync feature<br>
                            3. Return here and refresh the page
                        </div>
                    ` : ''}
                </div>
            `}
        </main>

        <!-- Status Bar -->
        <footer class="status-bar" role="contentinfo">
            <div class="status-indicator ${hasFreshData ? 'status-fresh' : 'status-cached'}">
                ${hasFreshData ? '🔄' : '💾'} 
                ${hasFreshData ? 'Fresh Data' : 'Cached Data'}
                ${fetchError ? ` - ⚠️ ${fetchError}` : ''}
            </div>
        </footer>
    </div>

    <script>
        // Initialize focus management
        document.addEventListener('DOMContentLoaded', function() {
            // Add focus-visible class for keyboard navigation
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Tab') {
                    document.body.classList.add('focus-visible');
                }
            });

            document.addEventListener('mousedown', function() {
                document.body.classList.remove('focus-visible');
            });

            // Auto-refresh every 30 seconds
            setInterval(() => {
                location.reload();
            }, 30000);
        });

        // Function to sync channel messages
        async function syncChannelMessages() {
            const channelId = '${channelId}';
            const button = document.querySelector('.sync-button');
            const originalHTML = button.innerHTML;
            
            try {
                // Update button to show loading
                button.innerHTML = '<div class="spinner"></div> Syncing...';
                button.disabled = true;
                button.setAttribute('aria-label', 'Syncing messages...');
                
                // Call local server to sync messages
                const response = await fetch('http://localhost:5014/api/channel/' + channelId + '/sync-web', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.ok) {
                    const result = await response.json();
                    // Show success notification
                    showNotification('Sync completed! Found ' + result.messagesSynced + ' messages for ' + result.channelName, 'success');
                    // Reload page to show new messages
                    setTimeout(() => location.reload(), 1000);
                } else {
                    const error = await response.json();
                    showNotification('Sync failed: ' + (error.message || 'Unknown error'), 'error');
                }
            } catch (error) {
                showNotification('Sync failed: ' + error.message, 'error');
            } finally {
                // Restore button
                button.innerHTML = originalHTML;
                button.disabled = false;
                button.setAttribute('aria-label', 'Sync and refresh messages');
            }
        }

        // Notification system
        function showNotification(message, type) {
            const notification = document.createElement('div');
            const bgColor = type === 'success' ? '#00a884' : type === 'error' ? '#dc3545' : '#374045';
            notification.style.cssText = 'position: fixed; top: 20px; right: 20px; padding: 12px 16px; border-radius: 8px; color: white; font-size: 14px; font-weight: 500; z-index: 1000; max-width: 300px; word-wrap: break-word; animation: slideIn 0.3s ease; background: ' + bgColor + ';';
            notification.textContent = message;
            notification.setAttribute('role', 'alert');
            notification.setAttribute('aria-live', 'assertive');
            
            document.body.appendChild(notification);
            
            // Remove after 5 seconds
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, 5000);
        }

        // Add CSS for notifications
        const style = document.createElement('style');
        style.textContent = '@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes slideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }';
        document.head.appendChild(style);
    </script>
</body>
</html>
    `;
  }

  // Get system status
  async getStatus() {
    // Count queued messages from IDs
    const globalQueueIds = await this.state.storage.get('messageQueueIds') || [];
    let queuedCount = 0;
    for (const msgId of globalQueueIds) {
      const message = await this.state.storage.get(`message_${msgId}`);
      if (message && message.status === 'queued') {
        queuedCount++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      status: {
        chats: this.chats.size,
        contacts: this.contacts.size,
        messages: this.messages.size,
        channels: this.channels.size,
        channelMessages: Array.from(this.channelMessages.values()).reduce((total, msgs) => total + msgs.length, 0),
        queuedMessages: queuedCount,
        lastSync: this.lastSync
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
} 