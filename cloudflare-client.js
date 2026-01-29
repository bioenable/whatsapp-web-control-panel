// Cloudflare Client for WhatsApp Desktop App
class CloudflareClient {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.CLOUDFLARE_BASE_URL || 'https://your-worker-url.workers.dev';
    this.apiKey = config.apiKey || process.env.CLOUDFLARE_API_KEY || 'your-api-key-here';
    this.syncInterval = config.syncInterval || 30000; // 30 seconds
    this.queueProcessInterval = config.queueProcessInterval || 10000; // 10 seconds
    this.isConnected = false;
    this.syncTimer = null;
    this.queueTimer = null;
  }

  // Initialize the client
  async init() {
    try {
      const response = await this.makeRequest('/health');
      this.isConnected = response.status === 'healthy';
      console.log('[CLOUDFLARE] Client initialized:', this.isConnected);
      return this.isConnected;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to initialize:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  // Make authenticated request to Cloudflare Workers
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.log(`[CLOUDFLARE] Request failed for ${endpoint}:`, error.message);
      throw error;
    }
  }

  // Sync chats data
  async syncChats(chats) {
    if (!this.isConnected) return false;
    
    try {
      const result = await this.makeRequest('/api/chats', {
        method: 'POST',
        body: {
          chats,
          timestamp: new Date().toISOString()
        }
      });
      
      console.log(`[CLOUDFLARE] Synced ${result.synced} chats`);
      return result.success;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to sync chats:', error.message);
      return false;
    }
  }

  // Sync contacts data
  async syncContacts(contacts) {
    if (!this.isConnected) return false;
    
    try {
      const result = await this.makeRequest('/api/contacts', {
        method: 'POST',
        body: {
          contacts,
          timestamp: new Date().toISOString()
        }
      });
      
      console.log(`[CLOUDFLARE] Synced ${result.synced} contacts`);
      return result.success;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to sync contacts:', error.message);
      return false;
    }
  }

  // Sync messages data
  async syncMessages(messages) {
    if (!this.isConnected) return false;
    
    try {
      const result = await this.makeRequest('/api/messages', {
        method: 'POST',
        body: {
          messages,
          timestamp: new Date().toISOString()
        }
      });
      
      console.log(`[CLOUDFLARE] Synced ${result.synced} messages`);
      return result.success;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to sync messages:', error.message);
      return false;
    }
  }

  // Sync all data at once
  async syncAllData(data) {
    if (!this.isConnected) return false;
    
    try {
      const result = await this.makeRequest('/api/sync', {
        method: 'POST',
        body: {
          ...data,
          timestamp: new Date().toISOString()
        }
      });
      
      console.log(`[CLOUDFLARE] Synced data:`, result.synced);
      return result.success;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to sync all data:', error.message);
      return false;
    }
  }

  // Queue a message for sending
  async queueMessage(to, message, media, priority, from = null, contactName = null, expiresInHours = null) {
    if (!this.isConnected) return null;
    
    try {
      const body = { to, message, media, priority, from, contactName };
      
      // Add expiry timestamp if provided
      if (expiresInHours !== null && expiresInHours !== undefined && expiresInHours > 0) {
        const expiryTime = new Date();
        expiryTime.setHours(expiryTime.getHours() + expiresInHours);
        body.expiresAt = expiryTime.toISOString();
      }
      
      const result = await this.makeRequest('/api/messages/queue', {
        method: 'POST',
        body
      });
      return result;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to queue message:', error.message);
      return null;
    }
  }

  // Get queued messages (with optional user filtering)
  async getQueuedMessages(from = null) {
    if (!this.isConnected) return [];
    
    try {
      const endpoint = from ? `/api/messages/queue?from=${encodeURIComponent(from)}` : '/api/messages/queue';
      const result = await this.makeRequest(endpoint);
      return result.data || [];
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to get queued messages:', error.message);
      return [];
    }
  }

  // Mark messages as processed (with optional user filtering)
  async processMessages(processedMessages, from = null) {
    if (!this.isConnected) return false;
    
    try {
      const result = await this.makeRequest('/api/messages/queue/process', {
        method: 'POST',
        body: { processedMessages, from }
      });
      
      console.log(`[CLOUDFLARE] Processed ${result.processed} messages`);
      return result.success;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to process messages:', error.message);
      return false;
    }
  }

  // Clear queued messages (all or by user)
  async clearQueue(from = null, messageIds = null) {
    if (!this.isConnected) return { success: false, error: 'Not connected' };
    
    try {
      const body = {};
      if (from) body.from = from;
      if (messageIds && messageIds.length > 0) body.messageIds = messageIds;
      
      const result = await this.makeRequest('/api/messages/queue/clear', {
        method: 'POST',
        body
      });
      
      console.log(`[CLOUDFLARE] Cleared ${result.cleared || 0} queued messages`);
      return result;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to clear queue:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Get queue statistics
  async getQueueStats(from = null) {
    if (!this.isConnected) return null;
    
    try {
      const endpoint = from ? `/api/messages/queue/stats?from=${encodeURIComponent(from)}` : '/api/messages/queue/stats';
      const result = await this.makeRequest(endpoint);
      return result;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to get queue stats:', error.message);
      return null;
    }
  }

  // Get active users
  async getActiveUsers() {
    if (!this.isConnected) return null;
    
    try {
      const result = await this.makeRequest('/api/users');
      return result;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to get active users:', error.message);
      return null;
    }
  }

  // Get user session
  async getUserSession(userId) {
    if (!this.isConnected) return null;
    
    try {
      const result = await this.makeRequest(`/api/users/${encodeURIComponent(userId)}`);
      return result;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to get user session:', error.message);
      return null;
    }
  }

  // Register user
  async registerUser(userId, userInfo) {
    if (!this.isConnected) return null;
    
    try {
      const result = await this.makeRequest('/api/users/register', {
        method: 'POST',
        body: { userId, userInfo }
      });
      return result;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to register user:', error.message);
      return null;
    }
  }

  // Register webhook endpoint
  async registerWebhook(webhookUrl) {
    if (!this.isConnected) return null;
    
    try {
      const result = await this.makeRequest('/api/webhooks', {
        method: 'POST',
        body: { webhookUrl }
      });
      return result;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to register webhook:', error.message);
      return null;
    }
  }

  // Get system status
  async getStatus() {
    if (!this.isConnected) return null;
    
    try {
      const result = await this.makeRequest('/api/status');
      return result.status;
    } catch (error) {
      console.log('[CLOUDFLARE] Failed to get status:', error.message);
      return null;
    }
  }

  // Start automatic sync
  startAutoSync(syncFunction) {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    
    this.syncTimer = setInterval(async () => {
      if (this.isConnected) {
        try {
          await syncFunction();
        } catch (error) {
          console.log('[CLOUDFLARE] Auto sync error:', error.message);
        }
      }
    }, this.syncInterval);
    
    console.log(`[CLOUDFLARE] Auto sync started (${this.syncInterval}ms interval)`);
  }

  // Stop automatic sync
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('[CLOUDFLARE] Auto sync stopped');
    }
  }

  // Start message queue processing
  startQueueProcessing(processFunction) {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
    }
    
    this.queueTimer = setInterval(async () => {
      if (this.isConnected) {
        try {
          await processFunction();
        } catch (error) {
          console.log('[CLOUDFLARE] Queue processing error:', error.message);
        }
      }
    }, this.queueProcessInterval);
    
    console.log(`[CLOUDFLARE] Queue processing started (${this.queueProcessInterval}ms interval)`);
  }

  // Stop message queue processing
  stopQueueProcessing() {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
      console.log('[CLOUDFLARE] Queue processing stopped');
    }
  }

  // Disconnect and cleanup
  disconnect() {
    this.stopAutoSync();
    this.stopQueueProcessing();
    this.isConnected = false;
    console.log('[CLOUDFLARE] Client disconnected');
  }
}

// Export for use in server.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CloudflareClient;
} 