
// --- Channels Tab Logic ---
const channelList = document.getElementById('channel-list');
const channelHeader = document.getElementById('channel-header');
const channelMessageContainer = document.getElementById('channel-message-container');
const channelSendForm = document.getElementById('channel-send-form');
const channelMessageText = document.getElementById('channel-message-text');
const channelAttachment = document.getElementById('channel-attachment');
const refreshChannelsBtn = document.getElementById('refresh-channels-btn');
const channelFetchMethod = document.getElementById('channel-fetch-method');
const channelStats = document.getElementById('channel-stats');

// --- Channel Send Options ---
const channelSendOptions = document.getElementById('channel-send-options');
const channelSendToAllBtn = document.getElementById('channel-send-to-all-btn');
const channelSendSpecificBtn = document.getElementById('channel-send-specific-btn');
const channelIdInput = document.getElementById('channel-id-input');
const channelSendFormGlobal = document.getElementById('channel-send-form-global');
const channelMessageTextGlobal = document.getElementById('channel-message-text-global');
const channelAttachmentGlobal = document.getElementById('channel-attachment-global');

// --- Channels State ---
let channels = [];
let selectedChannel = null;
let selectedChannelIsAdmin = false;
let channelMessages = [];
let incomingChannelMessages = []; // Messages from channels (not @c.us or @g.us)

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

    // Setup channel fetch method selector
    if (channelFetchMethod) {
        channelFetchMethod.addEventListener('change', () => {
            loadChannels();
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

    // Setup global channel send options
    if (channelSendToAllBtn) {
        channelSendToAllBtn.addEventListener('click', () => {
            showChannelSendForm('all');
        });
    }

    if (channelSendSpecificBtn) {
        channelSendSpecificBtn.addEventListener('click', () => {
            showChannelSendForm('specific');
        });
    }

    // Setup global channel send form
    if (channelSendFormGlobal) {
        channelSendFormGlobal.addEventListener('submit', handleGlobalChannelSendMessage);
        channelAttachmentGlobal.addEventListener('change', renderGlobalChannelAttachmentPreview);
    }
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeChannels);
} else {
    initializeChannels();
}

// --- Channels Tab Functions ---

// Load channels from the server
function loadChannels() {
    if (!channelList) return;
    
    channelHeader.textContent = 'Select a channel';
    channelMessageContainer.innerHTML = '';
    channelSendForm.classList.add('hidden');
    selectedChannel = null;
    
    // Try multiple methods to get channels
    Promise.allSettled([
        // Method 1: Enhanced channels API (followed channels)
        fetch('/api/channels/enhanced?method=followed').then(r => r.json()),
        // Method 2: Newsletter channels
        fetch('/api/channels/enhanced?method=newsletter').then(r => r.json()),
        // Method 3: Detected channels from message stream
        fetch('/api/detected-channels').then(r => r.json())
    ]).then(results => {
        let allChannels = [];
        let methodUsed = 'combined';
        
        // Process followed channels
        if (results[0].status === 'fulfilled') {
            const followedData = results[0].value;
            if (followedData.channels) {
                allChannels = allChannels.concat(followedData.channels);
            }
        }
        
        // Process newsletter channels
        if (results[1].status === 'fulfilled') {
            const newsletterData = results[1].value;
            if (newsletterData.channels) {
                allChannels = allChannels.concat(newsletterData.channels);
            }
        }
        
        // Process detected channels
        if (results[2].status === 'fulfilled') {
            const detectedData = results[2].value;
            if (detectedData.channels) {
                allChannels = allChannels.concat(detectedData.channels);
            }
        }
        
        // Remove duplicates based on channel ID
        const uniqueChannels = allChannels.reduce((acc, channel) => {
            const existingIndex = acc.findIndex(ch => ch.id === channel.id);
            if (existingIndex === -1) {
                acc.push(channel);
            } else {
                // Merge data, preferring more complete information
                acc[existingIndex] = { ...acc[existingIndex], ...channel };
            }
            return acc;
        }, []);
        
        channels = uniqueChannels;
        updateChannelStats({ total: channels.length, method: methodUsed });
        renderChannelList();
    }).catch(err => {
        console.error('Failed to load channels:', err);
        channelList.innerHTML = `<div class='text-red-600 p-2'>Failed to load channels: ${err.message}</div>`;
    });
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

// Update channel statistics
function updateChannelStats(data) {
    if (!channelStats) return;
    
    const total = data.total || channels.length;
    const method = data.method || 'all';
    const adminCount = channels.filter(c => !c.isReadOnly).length;
    const readOnlyCount = channels.filter(c => c.isReadOnly).length;
    
    channelStats.innerHTML = `
        Total: ${total} | Admin: ${adminCount} | Read Only: ${readOnlyCount} | Method: ${method}
    `;
}

// Render the channel list
function renderChannelList() {
    if (!channelList) return;
    
    if (!Array.isArray(channels) || channels.length === 0) {
        channelList.innerHTML = `<div class='text-gray-500 p-2'>No channels found.</div>`;
        return;
    }
    
    channelList.innerHTML = channels.map(channel => `
        <div class="p-3 hover:bg-gray-50 cursor-pointer border-b" data-id="${channel.id}">
            <div class="flex justify-between items-start">
                <div class="flex-1 min-w-0">
                    <div class="font-semibold text-gray-900 truncate">${channel.name || 'Unnamed Channel'}</div>
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
                <div class="text-xs text-gray-400 ml-2">
                    ${channel.isReadOnly ? 
                        '<span class="inline-block bg-orange-100 text-orange-800 px-1 rounded text-xs">Read Only</span>' : 
                        '<span class="inline-block bg-blue-100 text-blue-800 px-1 rounded text-xs">Admin</span>'
                    }
                </div>
            </div>
        </div>
    `).join('');
    
    // Add click handlers
    document.querySelectorAll('#channel-list > div').forEach(div => {
        div.addEventListener('click', () => selectChannel(div.dataset.id));
    });
}

// Select a channel and load its messages
function selectChannel(channelId) {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;
    
    selectedChannel = channel;
    selectedChannelIsAdmin = !channel.isReadOnly;
    channelHeader.textContent = `${channel.name || channel.id} (${channel.id})`;
    loadChannelMessages(channel.id);
    
    if (selectedChannelIsAdmin) {
        channelSendForm.classList.remove('hidden');
    } else {
        channelSendForm.classList.add('hidden');
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

// Show channel send form based on type (all or specific)
function showChannelSendForm(type) {
    if (!channelSendFormGlobal || !channelSendOptions) return;
    
    if (type === 'all') {
        channelSendFormGlobal.style.display = 'block';
        channelSendOptions.style.display = 'none';
        channelIdInput.style.display = 'none';
        channelMessageTextGlobal.placeholder = 'Enter message to send to all channels where you are admin...';
    } else if (type === 'specific') {
        channelSendFormGlobal.style.display = 'block';
        channelSendOptions.style.display = 'none';
        channelIdInput.style.display = 'block';
        channelMessageTextGlobal.placeholder = 'Enter message to send to specific channel...';
    }
    
    channelMessageTextGlobal.focus();
}

// Handle global channel send message
function handleGlobalChannelSendMessage(event) {
    event.preventDefault();
    
    const message = channelMessageTextGlobal.value.trim();
    const attachment = channelAttachmentGlobal.files[0];
    const channelId = channelIdInput ? channelIdInput.value.trim() : '';
    
    if (!message && !attachment) {
        alert('Please enter a message or attach a file');
        return;
    }
    
    // Determine if sending to all or specific channel
    const sendToAll = !channelId || channelId === '';
    
    if (!sendToAll && !channelId) {
        alert('Please enter a channel ID');
        return;
    }
    
    const formData = new FormData();
    formData.append('message', message);
    if (attachment) {
        formData.append('media', attachment);
    }
    if (sendToAll) {
        formData.append('sendToAll', 'true');
    } else {
        formData.append('channelId', channelId);
    }
    
    // Disable send button
    const sendBtn = channelSendFormGlobal.querySelector('button[type="submit"]');
    const originalText = sendBtn.textContent;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    
    fetch('/api/channels/send', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            channelMessageTextGlobal.value = '';
            channelAttachmentGlobal.value = '';
            if (channelIdInput) channelIdInput.value = '';
            
            // Show results
            const summary = data.summary;
            const message = `Message sent successfully!\n\nSummary:\n- Total: ${summary.total}\n- Successful: ${summary.successful}\n- Failed: ${summary.failed}`;
            
            if (summary.failed > 0) {
                const failedDetails = data.results.filter(r => !r.success)
                    .map(r => `${r.channelName || r.channelId}: ${r.error}`)
                    .join('\n');
                alert(message + '\n\nFailed channels:\n' + failedDetails);
            } else {
                alert(message);
            }
            
            // Reset form display
            if (channelSendOptions) channelSendOptions.style.display = 'block';
            if (channelSendFormGlobal) channelSendFormGlobal.style.display = 'none';
            if (channelIdInput) channelIdInput.style.display = 'none';
            
        } else {
            alert('Failed to send message: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(err => {
        console.error('Send to channels error:', err);
        alert('Failed to send message: ' + err.message);
    })
    .finally(() => {
        sendBtn.disabled = false;
        sendBtn.textContent = originalText;
    });
}

// Handle global channel attachment preview
function renderGlobalChannelAttachmentPreview() {
    const file = channelAttachmentGlobal.files[0];
    if (!file) return;
    
    console.log('Global channel attachment selected:', file.name, file.type);
}

// Cancel channel send form
function cancelChannelSend() {
    if (channelSendFormGlobal) channelSendFormGlobal.style.display = 'none';
    if (channelSendOptions) channelSendOptions.style.display = 'block';
    if (channelIdInput) channelIdInput.style.display = 'none';
    if (channelMessageTextGlobal) channelMessageTextGlobal.value = '';
    if (channelAttachmentGlobal) channelAttachmentGlobal.value = '';
}

// Make cancelChannelSend globally accessible
window.cancelChannelSend = cancelChannelSend;

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

// Send to a specific channel (opens the send form with pre-filled channel ID)
function sendToChannel(channelId) {
    if (!channelSendSpecificBtn) return;
    
    // Show the specific channel send form
    showChannelSendForm('specific');
    
    // Pre-fill the channel ID
    if (channelIdInput) {
        channelIdInput.querySelector('input').value = channelId;
    }
    
    // Focus on message text
    if (channelMessageTextGlobal) {
        channelMessageTextGlobal.focus();
        channelMessageTextGlobal.placeholder = `Send message to ${channelId}...`;
    }
}

// Make functions globally accessible
window.replyToChannelMessage = replyToChannelMessage;
window.sendToChannel = sendToChannel; 