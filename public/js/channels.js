
// --- Channels Tab Logic ---
const channelList = document.getElementById('channel-list');
const channelHeader = document.getElementById('channel-header');
const channelMessageContainer = document.getElementById('channel-message-container');
const channelSendForm = document.getElementById('channel-send-form');
const channelMessageText = document.getElementById('channel-message-text');
const channelAttachment = document.getElementById('channel-attachment');
const refreshChannelsBtn = document.getElementById('refresh-channels-btn');
const channelFilterStatus = document.getElementById('channel-filter-status');
const channelStats = document.getElementById('channel-stats');

// --- Channels State ---
let channels = []; // All channels loaded from server
// Expose channels globally for other modules
window.channels = channels;
let filteredChannels = []; // Channels filtered by status
// Expose filteredChannels globally for other modules
window.filteredChannels = filteredChannels;
let selectedChannel = null;
let selectedChannelIsAdmin = false;
let channelMessages = [];
let incomingChannelMessages = []; // Messages from channels (not @c.us or @g.us)
let currentFilter = 'all'; // Default filter - show all channels

// HTML escape utility (needed for channels.js)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize channels functionality
function initializeChannels() {
    // Setup channel refresh button
    if (refreshChannelsBtn) {
        refreshChannelsBtn.addEventListener('click', () => {
            loadChannels();
        });
    }

    // Setup channel filter status selector
    if (channelFilterStatus) {
        // Set default value to 'all'
        channelFilterStatus.value = 'all';
        currentFilter = 'all';
        
        channelFilterStatus.addEventListener('change', () => {
            currentFilter = channelFilterStatus.value;
            filterChannels();
        });
    }

    // Load channels when channels tab is clicked
    const channelsTab = document.getElementById('channels-tab');
    if (channelsTab) {
        channelsTab.addEventListener('click', () => {
            loadChannels();
            loadIncomingChannelMessages();
        });
    }

    // Setup channel send form
    if (channelSendForm) {
        channelSendForm.addEventListener('submit', handleChannelSendMessage);
        channelAttachment.addEventListener('change', renderChannelAttachmentPreview);
    }
    
    // Load channels if page loaded with #channels hash
    if (window.location.hash === '#channels') {
        setTimeout(() => {
            loadChannels();
            loadIncomingChannelMessages();
        }, 100);
    }
    
    // Handle hash changes to load channels when navigating to tab
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#channels') {
            loadChannels();
            loadIncomingChannelMessages();
        }
    });
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeChannels);
} else {
    initializeChannels();
}

// --- Channels Tab Functions ---

// Load channels from the server
async function loadChannels(isBackgroundRefresh = false) {
    if (!channelList) return;
    
    // Only reset UI if this is NOT a background refresh
    if (!isBackgroundRefresh) {
        // Reset channel header only if no channel selected
        if (!selectedChannel) {
            const channelHeaderName = document.getElementById('channel-header-name');
            const channelHeaderLink = document.getElementById('channel-header-link');
            if (channelHeaderName) {
                channelHeaderName.textContent = 'Select a channel';
            }
            if (channelHeaderLink) {
                channelHeaderLink.innerHTML = '';
            }
            // Fallback for old channelHeader
            if (channelHeader && !channelHeaderName) {
                channelHeader.textContent = 'Select a channel';
            }
            
            channelMessageContainer.innerHTML = '';
            channelSendForm.classList.add('hidden');
        }
        
        // Show loading state only if no channels loaded yet
        if (channels.length === 0) {
            channelList.innerHTML = '<div class="text-gray-500 p-2">Loading channels...</div>';
        }
    }
    
    try {
        // STEP 1: Load cached channels IMMEDIATELY (no waiting)
        let allChannels = [];
        try {
            const cachedResult = await fetch('/api/detected-channels').then(r => r.json());
            allChannels = cachedResult.channels || [];
            console.log(`[CHANNELS] Loaded ${allChannels.length} channels from cache`);
        } catch (e) {
            console.log('[CHANNELS] No cached channels available');
        }
        
        // Immediately show cached channels (don't wait for fresh data)
        if (allChannels.length > 0) {
            channels = allChannels;
            window.channels = channels;
            filterChannels(); // Render immediately with cached data
        }
        
        // STEP 2: Fetch fresh data in background (non-blocking)
        // This will update the JSON and re-render without disturbing UI
        fetchFreshChannelData().catch(err => {
            console.error('[CHANNELS] Background fetch failed:', err);
        });
        
        // Update global filteredChannels reference
        window.filteredChannels = filteredChannels;
    } catch (err) {
        console.error('Failed to load channels:', err);
        if (!isBackgroundRefresh) {
            channelList.innerHTML = `<div class='text-red-600 p-2'>Failed to load channels: ${err.message}</div>`;
        }
    }
}

// Fetch fresh channel data from WhatsApp (background, non-blocking, append-only)
async function fetchFreshChannelData() {
    try {
        console.log('[CHANNELS] Starting background sync (append-only mode)...');
        
        // First trigger server-side discovery (this updates the JSON with append-only logic)
        try {
            await fetch('/api/channels/discover', { method: 'POST' });
            console.log('[CHANNELS] Server-side discovery triggered');
        } catch (e) {
            console.log('[CHANNELS] Server-side discovery skipped (may not be ready)');
        }
        
        // Then fetch fresh data from multiple sources
        const results = await Promise.allSettled([
            fetch('/api/channels/enhanced?method=followed').then(r => r.json()).catch(() => null),
            fetch('/api/channels/enhanced?method=newsletter').then(r => r.json()).catch(() => null)
        ]);
        
        let allChannels = [...channels]; // Start with current channels (append-only)
        let newCount = 0;
        let updatedCount = 0;
        
        // Process followed channels (IMPORTANT: these have accurate isReadOnly status)
        if (results[0].status === 'fulfilled' && results[0].value && results[0].value.channels) {
            console.log(`[CHANNELS] Got ${results[0].value.channels.length} followed channels from fresh request`);
            results[0].value.channels.forEach(freshChannel => {
                const existingIndex = allChannels.findIndex(ch => ch.id === freshChannel.id);
                if (existingIndex !== -1) {
                    // Update existing channel - PRESERVE admin status
                    const existing = allChannels[existingIndex];
                    const wasSelected = selectedChannel && selectedChannel.id === freshChannel.id;
                    
                    // CRITICAL: Preserve admin status (isReadOnly: false)
                    // Only update to admin if fresh confirms admin, never downgrade
                    let finalIsReadOnly = existing.isReadOnly;
                    if (freshChannel.isReadOnly === false) {
                        finalIsReadOnly = false; // Fresh confirms admin
                    } else if (existing.isReadOnly === false) {
                        finalIsReadOnly = false; // Preserve existing admin status
                    }
                    
                    allChannels[existingIndex] = { 
                        ...existing, 
                        ...freshChannel, 
                        isReadOnly: finalIsReadOnly,
                        type: finalIsReadOnly === false ? 'admin' : freshChannel.type,
                        cached: false 
                    };
                    
                    if (wasSelected) {
                        selectedChannel = allChannels[existingIndex];
                    }
                    updatedCount++;
                } else {
                    // New channel - append
                    allChannels.push(freshChannel);
                    newCount++;
                }
            });
        }
        
        // Process newsletter channels
        if (results[1].status === 'fulfilled' && results[1].value && results[1].value.channels) {
            console.log(`[CHANNELS] Got ${results[1].value.channels.length} newsletter channels`);
            results[1].value.channels.forEach(freshChannel => {
                const existingIndex = allChannels.findIndex(ch => ch.id === freshChannel.id);
                if (existingIndex !== -1) {
                    // Update existing - preserve admin status
                    const existing = allChannels[existingIndex];
                    let finalIsReadOnly = existing.isReadOnly;
                    if (freshChannel.isReadOnly === false) {
                        finalIsReadOnly = false;
                    } else if (existing.isReadOnly === false) {
                        finalIsReadOnly = false;
                    }
                    
                    allChannels[existingIndex] = { 
                        ...existing, 
                        ...freshChannel, 
                        isReadOnly: finalIsReadOnly,
                        type: finalIsReadOnly === false ? 'admin' : freshChannel.type,
                        cached: false 
                    };
                    updatedCount++;
                } else {
                    // New channel - append
                    allChannels.push(freshChannel);
                    newCount++;
                }
            });
        }
        
        // Update channels and re-render
        if (newCount > 0 || updatedCount > 0) {
            channels = allChannels;
            window.channels = channels;
            filterChannels(); // Re-render with updated data
            console.log(`[CHANNELS] Sync complete: ${newCount} new, ${updatedCount} updated. Total: ${channels.length}`);
        }
        
        // Reload from server cache to get the authoritative list (includes all appended channels)
        setTimeout(async () => {
            try {
                const cachedResult = await fetch('/api/detected-channels').then(r => r.json());
                if (cachedResult.channels && cachedResult.channels.length > 0) {
                    // Merge with current - server has the authoritative list
                    channels = cachedResult.channels;
                    window.channels = channels;
                    filterChannels();
                    console.log(`[CHANNELS] Loaded ${channels.length} channels from server cache`);
                }
            } catch (e) {
                // Ignore cache reload errors
            }
        }, 2000); // Wait 2 seconds for server to finish updating JSON
        
    } catch (err) {
        console.error('[CHANNELS] Fresh data fetch failed:', err);
    }
}

// Manual channel discovery
async function discoverChannels() {
    try {
        const response = await fetch('/api/channels/discover', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            console.log(`[CHANNEL-DISCOVERY] Found ${result.channels} channels`);
            // Reload channels after discovery
            loadChannels();
        } else {
            console.error('[CHANNEL-DISCOVERY] Discovery failed:', result.error);
        }
    } catch (error) {
        console.error('[CHANNEL-DISCOVERY] Discovery error:', error);
    }
}

// Filter channels based on status
function filterChannels() {
    // Ensure we have the current filter value from the dropdown
    if (channelFilterStatus) {
        currentFilter = channelFilterStatus.value;
    }
    
    if (!channels || channels.length === 0) {
        filteredChannels = [];
        updateChannelStats();
        renderChannelList();
        return;
    }
    
    switch (currentFilter) {
        case 'admin':
            filteredChannels = channels.filter(c => c.isReadOnly === false);
            break;
        case 'readonly':
            filteredChannels = channels.filter(c => c.isReadOnly === true);
            break;
        case 'all':
        default:
            filteredChannels = channels;
            break;
    }
    
    updateChannelStats();
    renderChannelList();
    
    // Update global filteredChannels reference
    window.filteredChannels = filteredChannels;
}

// Update channel statistics
function updateChannelStats() {
    if (!channelStats) return;
    
    const total = channels.length;
    const adminCount = channels.filter(c => !c.isReadOnly).length;
    const readOnlyCount = channels.filter(c => c.isReadOnly).length;
    const filteredCount = filteredChannels.length;
    
    channelStats.innerHTML = `
        Total: ${total} | Admin: ${adminCount} | Read Only: ${readOnlyCount} | Showing: ${filteredCount} (${currentFilter})
    `;
}

// Get Cloudflare base URL (cached)
let cloudflareBaseUrl = null;
async function getCloudflareBaseUrl() {
    if (cloudflareBaseUrl) return cloudflareBaseUrl;
    
    try {
        const response = await fetch('/api/cloud/status');
        const data = await response.json();
        if (data.baseUrl) {
            cloudflareBaseUrl = data.baseUrl;
            return cloudflareBaseUrl;
        }
    } catch (error) {
        console.error('[CHANNELS] Failed to get Cloudflare base URL:', error);
    }
    return null;
}

// Encode channel ID for URL but preserve @ symbol
function encodeChannelIdForUrl(channelId) {
    // Replace @ with a placeholder, encode, then replace back
    return encodeURIComponent(channelId.replace(/@/g, '__AT__')).replace(/__AT__/g, '@');
}

// Render the channel list
async function renderChannelList() {
    if (!channelList) return;
    
    if (!Array.isArray(filteredChannels) || filteredChannels.length === 0) {
        channelList.innerHTML = `<div class='text-gray-500 p-2'>No channels found${currentFilter !== 'all' ? ` (${currentFilter} channels)` : ''}.</div>`;
        return;
    }
    
    // Get Cloudflare base URL for web links
    const baseUrl = await getCloudflareBaseUrl();
    
    channelList.innerHTML = filteredChannels.map(channel => {
        const channelWebUrl = baseUrl ? `${baseUrl}/channel/${encodeChannelIdForUrl(channel.id)}` : null;
        
        return `
        <div class="p-3 hover:bg-gray-50 cursor-pointer border-b" data-id="${channel.id}">
            <div class="flex justify-between items-start">
                <div class="flex-1 min-w-0">
                    <div class="font-semibold text-gray-900 truncate flex items-center gap-2">
                        ${channel.name || 'Unnamed Channel'}
                        ${channelWebUrl ? `
                            <a href="${channelWebUrl}" target="_blank" rel="noopener noreferrer" 
                               class="text-blue-600 hover:text-blue-800 flex-shrink-0" 
                               onclick="event.stopPropagation();"
                               title="Open channel web page">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                                </svg>
                            </a>
                        ` : ''}
                    </div>
                    <div class="text-sm text-gray-500 truncate">${channel.description || 'No description'}</div>
                    <div class="text-xs text-gray-400 mt-1">
                        ID: ${channel.id}
                        ${channel.unreadCount > 0 ? `<span class="ml-2 bg-red-500 text-white px-1 rounded text-xs">${channel.unreadCount}</span>` : ''}
                        ${channel.isMuted ? `<span class="ml-2 bg-gray-500 text-white px-1 rounded text-xs">Muted</span>` : ''}
                    </div>
                    ${channel.lastMessage ? `
                        <div class="text-xs text-gray-500 mt-1">
                            Last: ${channel.lastMessage.body ? channel.lastMessage.body.substring(0, 50) + '...' : 'No message'}
                        </div>
                    ` : ''}
                </div>
                <div class="text-xs text-gray-400 ml-2 channel-status-badge">
                    ${channel.isReadOnly ? 
                        '<span class="inline-block bg-orange-100 text-orange-800 px-1 rounded text-xs">Read Only</span>' : 
                        '<span class="inline-block bg-blue-100 text-blue-800 px-1 rounded text-xs">Admin</span>'
                    }
                </div>
            </div>
        </div>
    `;
    }).join('');
    
    // Add click handlers
    document.querySelectorAll('#channel-list > div').forEach(div => {
        div.addEventListener('click', () => selectChannel(div.dataset.id));
    });
}

// Select a channel and load its messages
async function selectChannel(channelId) {
    // Find channel from all channels (not just filtered)
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    
    selectedChannel = channel;
    
    // Verify channel admin status from server (more reliable than cached data)
    try {
        const verifyResponse = await fetch(`/api/channels/${encodeURIComponent(channelId)}/verify`);
        if (verifyResponse.ok) {
            const verifyData = await verifyResponse.json();
            // Update channel object with verified status
            channel.isReadOnly = verifyData.isReadOnly;
            selectedChannel.isReadOnly = verifyData.isReadOnly;
            selectedChannelIsAdmin = !verifyData.isReadOnly;
        } else {
            // Fallback to cached data if verification fails
            selectedChannelIsAdmin = !channel.isReadOnly;
        }
    } catch (error) {
        console.error('[CHANNELS] Failed to verify channel status:', error);
        // Fallback to cached data
        selectedChannelIsAdmin = !channel.isReadOnly;
    }
    
    // Update channel header with name
    const channelHeaderName = document.getElementById('channel-header-name');
    const channelHeaderLink = document.getElementById('channel-header-link');
    
    if (channelHeaderName) {
        channelHeaderName.textContent = `${channel.name || channel.id} (${channel.id})`;
    }
    
    // Get and display channel web link
    if (channelHeaderLink) {
        const baseUrl = await getCloudflareBaseUrl();
        if (baseUrl) {
            const channelWebUrl = `${baseUrl}/channel/${encodeChannelIdForUrl(channel.id)}`;
            channelHeaderLink.innerHTML = `
                <a href="${channelWebUrl}" target="_blank" rel="noopener noreferrer" 
                   class="text-blue-600 hover:text-blue-800 hover:underline text-sm font-medium flex items-center gap-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
                    </svg>
                    <span class="hidden sm:inline">${channelWebUrl}</span>
                    <span class="sm:hidden">Open</span>
                </a>
            `;
        } else {
            channelHeaderLink.innerHTML = '';
        }
    }
    
    // Fallback: update old channelHeader if it exists (for backward compatibility)
    if (channelHeader && !channelHeaderName) {
        channelHeader.textContent = `${channel.name || channel.id} (${channel.id})`;
    }
    
    // Update the channel list display with verified status
    updateChannelStatusInList(channelId, !selectedChannelIsAdmin);
    
    loadChannelMessages(channel.id);
    
    if (selectedChannelIsAdmin) {
        channelSendForm.classList.remove('hidden');
    } else {
        channelSendForm.classList.add('hidden');
    }
}

// Verify channel statuses from server (only unverified channels, limited batch)
async function verifyAllChannelStatuses() {
    // Only verify channels that don't have verified status yet
    // and limit to first 10 to avoid blocking
    const unverifiedChannels = channels
        .filter(ch => ch.isReadOnly === undefined || ch.verified !== true)
        .slice(0, 10);
    
    if (unverifiedChannels.length === 0) return;
    
    // Verify in parallel with small batch
    await Promise.allSettled(
        unverifiedChannels.map(async (channel) => {
            try {
                const response = await fetch(`/api/channels/${encodeURIComponent(channel.id)}/verify`);
                if (response.ok) {
                    const data = await response.json();
                    // Update channel with verified status
                    channel.isReadOnly = data.isReadOnly;
                    channel.verified = true;
                }
            } catch (error) {
                // Silently ignore - don't spam console
            }
        })
    );
}

// Update channel status badge in the list
function updateChannelStatusInList(channelId, isReadOnly) {
    const channelElement = document.querySelector(`#channel-list > div[data-id="${channelId}"]`);
    if (channelElement) {
        const statusBadge = channelElement.querySelector('.channel-status-badge');
        if (statusBadge) {
            statusBadge.innerHTML = isReadOnly ? 
                '<span class="inline-block bg-orange-100 text-orange-800 px-1 rounded text-xs">Read Only</span>' : 
                '<span class="inline-block bg-blue-100 text-blue-800 px-1 rounded text-xs">Admin</span>';
        }
    }
}

// Load messages for a specific channel
function loadChannelMessages(channelId) {
    if (!channelMessageContainer) return;
    
    channelMessageContainer.innerHTML = '<div class="text-gray-400">Loading messages...</div>';
    
    fetch(`/api/channels/${encodeURIComponent(channelId)}/messages`)
        .then(response => response.json())
        .then(messages => {
            channelMessages = messages;
            renderChannelMessages(messages);
        })
        .catch(err => {
            console.error('Failed to load channel messages:', err);
            channelMessageContainer.innerHTML = `<div class='text-red-600'>Failed to load messages: ${err.message}</div>`;
        });
}

// Render channel messages
function renderChannelMessages(messages) {
    if (!channelMessageContainer) return;
    
    if (!Array.isArray(messages) || messages.length === 0) {
        channelMessageContainer.innerHTML = '<div class="text-gray-400 text-center py-8">No messages in this channel</div>';
        return;
    }
    
    // Sort messages by timestamp (newest first)
    const sortedMessages = messages.sort((a, b) => b.timestamp - a.timestamp);
    
    channelMessageContainer.innerHTML = sortedMessages.map(msg => `
        <div class="mb-4 p-3 bg-white rounded-lg shadow-sm border">
            <div class="flex justify-between items-start mb-2">
                <div class="text-sm font-semibold text-gray-700">
                    ${msg.fromMe ? 'You' : (msg.author || msg.from)}
                </div>
                <div class="text-xs text-gray-500">
                    ${new Date(msg.timestamp * 1000).toLocaleString()}
                </div>
            </div>
            <div class="text-gray-800 mb-2">${escapeHtml(msg.body || '')}</div>
            <div class="text-xs text-gray-500">
                <div>Message ID: ${msg.id}</div>
                <div>From: ${msg.from}</div>
                <div>Type: ${msg.type}</div>
                ${msg.hasMedia ? '<div class="text-blue-600">📎 Has Media</div>' : ''}
                ${msg.mimetype ? `<div>Media Type: ${msg.mimetype}</div>` : ''}
                ${msg.filename ? `<div>Filename: ${msg.filename}</div>` : ''}
                ${msg.size ? `<div>Size: ${(msg.size / 1024).toFixed(1)} KB</div>` : ''}
            </div>
        </div>
    `).join('');
}

// Handle sending messages to channels
function handleChannelSendMessage(event) {
    event.preventDefault();
    
    if (!selectedChannel || !selectedChannelIsAdmin) {
        alert('You can only send messages to channels where you are an admin');
        return;
    }
    
    const message = channelMessageText.value.trim();
    const attachment = channelAttachment.files[0];
    
    if (!message && !attachment) {
        alert('Please enter a message or attach a file');
        return;
    }
    
    const formData = new FormData();
    formData.append('message', message);
    if (attachment) {
        formData.append('media', attachment);
    }
    
    // Disable send button
    const sendBtn = channelSendForm.querySelector('button[type="submit"]');
    const originalText = sendBtn.textContent;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    
    fetch(`/api/channels/${encodeURIComponent(selectedChannel.id)}/send`, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            channelMessageText.value = '';
            channelAttachment.value = '';
            // Reload messages
            loadChannelMessages(selectedChannel.id);
        } else {
            alert('Failed to send message: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(err => {
        console.error('Send channel message error:', err);
        alert('Failed to send message: ' + err.message);
    })
    .finally(() => {
        sendBtn.disabled = false;
        sendBtn.textContent = originalText;
    });
}

// Handle channel attachment preview
function renderChannelAttachmentPreview() {
    const file = channelAttachment.files[0];
    if (!file) return;
    
    // You can add preview logic here similar to other attachment previews
    console.log('Channel attachment selected:', file.name, file.type);
}


// Load incoming channel messages (messages not from @c.us or @g.us)
function loadIncomingChannelMessages() {
    fetch('/api/incoming-channel-messages')
        .then(response => response.json())
        .then(data => {
            incomingChannelMessages = data;
            renderIncomingChannelMessages();
        })
        .catch(err => {
            console.error('Failed to load incoming channel messages:', err);
        });
}

// Render incoming channel messages section
function renderIncomingChannelMessages() {
    // Create or update the incoming messages section in the channels tab
    const channelsTab = document.getElementById('channels');
    if (!channelsTab) return;
    
    // Check if incoming messages section already exists
    let incomingSection = channelsTab.querySelector('#incoming-channel-messages');
    if (!incomingSection) {
        // Create the section
        incomingSection = document.createElement('div');
        incomingSection.id = 'incoming-channel-messages';
        incomingSection.className = 'mt-6 bg-white rounded shadow p-4';
        channelsTab.appendChild(incomingSection);
    }
    
    if (!Array.isArray(incomingChannelMessages) || incomingChannelMessages.length === 0) {
        incomingSection.innerHTML = `
            <h3 class="text-lg font-semibold mb-4">Incoming Channel Messages</h3>
            <div class="text-gray-500 text-center py-4">No incoming channel messages found</div>
        `;
        return;
    }
    
    // Sort by timestamp (newest first)
    const sortedMessages = incomingChannelMessages.sort((a, b) => b.timestamp - a.timestamp);
    
    incomingSection.innerHTML = `
        <h3 class="text-lg font-semibold mb-4">Incoming Channel Messages (${incomingChannelMessages.length})</h3>
        <div class="space-y-3 max-h-96 overflow-y-auto">
            ${sortedMessages.map(msg => {
                const isNewsletter = msg.from && msg.from.endsWith('@newsletter');
                const bgColor = isNewsletter ? 'bg-blue-50 border-blue-200' : 'bg-gray-50';
                const badge = isNewsletter ? '<span class="inline-block bg-blue-500 text-white px-2 py-1 rounded text-xs mr-2">@newsletter</span>' : '';
                
                return `
                <div class="p-3 ${bgColor} rounded border">
                    <div class="flex justify-between items-start mb-2">
                        <div class="text-sm font-semibold text-gray-700">
                            ${badge}From: ${msg.from}
                        </div>
                        <div class="text-xs text-gray-500">
                            ${new Date(msg.timestamp * 1000).toLocaleString()}
                        </div>
                    </div>
                    <div class="text-gray-800 mb-2">${escapeHtml(msg.body || '')}</div>
                    <div class="text-xs text-gray-500 space-y-1">
                        <div><strong>Sender ID:</strong> ${msg.from}</div>
                        <div><strong>Message ID:</strong> ${msg.id}</div>
                        <div><strong>Type:</strong> ${msg.type}</div>
                        ${msg.hasMedia ? '<div class="text-blue-600">📎 Has Media</div>' : ''}
                        ${msg.mimetype ? `<div><strong>Media Type:</strong> ${msg.mimetype}</div>` : ''}
                        ${msg.filename ? `<div><strong>Filename:</strong> ${msg.filename}</div>` : ''}
                        ${msg.size ? `<div><strong>Size:</strong> ${(msg.size / 1024).toFixed(1)} KB</div>` : ''}
                    </div>
                    <div class="mt-2 flex gap-2">
                        <button onclick="replyToChannelMessage('${msg.from}', '${msg.id}')" 
                                class="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700">
                            Reply to Sender
                        </button>
                        ${isNewsletter ? `
                        <button onclick="sendToChannel('${msg.from}')" 
                                class="bg-purple-600 text-white px-3 py-1 rounded text-xs hover:bg-purple-700">
                            Send to This Channel
                        </button>
                        ` : ''}
                    </div>
                </div>
            `}).join('')}
        </div>
    `;
}

// Reply to a channel message (opens send message tab with pre-filled recipient)
function replyToChannelMessage(senderId, messageId) {
    // Switch to messages tab
    document.getElementById('messages-tab').click();
    // Show Send Message sub-tab
    setTimeout(() => {
        if (typeof window.showMessagesSubTab === 'function') {
            window.showMessagesSubTab('send-message');
        }
    }, 100);
    
    // Pre-fill the recipient input
    const recipientInput = document.getElementById('recipient-input');
    if (recipientInput) {
        recipientInput.value = senderId;
        // Trigger change event to update recipient list
        recipientInput.dispatchEvent(new Event('input'));
    }
    
    // Focus on message text
    const messageText = document.getElementById('message-text');
    if (messageText) {
        messageText.focus();
        messageText.placeholder = `Replying to message ${messageId}...`;
    }
}

// Send to a specific channel (selects the channel in the channels tab)
function sendToChannel(channelId) {
    // Switch to channels tab
    const channelsTab = document.getElementById('channels-tab');
    if (channelsTab) {
        channelsTab.click();
    }
    
    // Select the channel
    setTimeout(() => {
        selectChannel(channelId);
        // Focus on message input
        if (channelMessageText) {
            setTimeout(() => {
                channelMessageText.focus();
            }, 200);
        }
    }, 100);
}

// Make functions globally accessible
window.replyToChannelMessage = replyToChannelMessage;
window.sendToChannel = sendToChannel; 