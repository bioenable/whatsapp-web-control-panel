// DOM Elements
const qrCodeContainer = document.getElementById('qrcode-container');
const statusIndicator = document.getElementById('status-indicator');
const chatList = document.getElementById('chat-list');
const chatHeader = document.getElementById('chat-header');
const messageContainer = document.getElementById('message-container');
const recipientSelect = document.getElementById('recipient-select');
const sendMessageForm = document.getElementById('send-message-form');
const mediaUpload = document.getElementById('media-upload');
const mediaPreviewContainer = document.getElementById('media-preview-container');
const imagePreview = document.getElementById('image-preview');
const videoPreview = document.getElementById('video-preview');
const filePreview = document.getElementById('file-preview');
const fileName = document.getElementById('file-name');
const sentMessagesTable = document.getElementById('sent-messages');
const chatSendForm = document.getElementById('chat-send-form');
const chatMessageText = document.getElementById('chat-message-text');
const chatAttachment = document.getElementById('chat-attachment');

// State
let currentStatus = 'initializing';
let chats = [];
let selectedChatId = null; // for chat list selection
let selectedChatIds = [];  // for send message multi-select
let sentMessages = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check WhatsApp connection status
    checkStatus();
    
    // Set up event listeners
    setupEventListeners();
    if (chatSendForm) {
        chatSendForm.addEventListener('submit', handleChatSendMessage);
        chatAttachment.addEventListener('change', renderChatAttachmentPreview);
    }
});

// Setup event listeners
function setupEventListeners() {
    // Send message form submission
    sendMessageForm.addEventListener('submit', handleSendMessage);
    
    // Media upload preview
    mediaUpload.addEventListener('change', handleMediaUpload);
    // Recipient select change (for multi-select)
    recipientSelect.addEventListener('change', handleRecipientSelectChange);
    // Live preview for message
    document.getElementById('message-text').addEventListener('input', renderMessagePreview);
    document.getElementById('recipient-input').addEventListener('input', renderMessagePreview);
}

function handleRecipientSelectChange() {
    // Get all selected options
    selectedChatIds = Array.from(recipientSelect.selectedOptions)
        .map(opt => opt.value)
        .filter(v => v);
    renderMessagePreview();
}

// Check WhatsApp connection status
function checkStatus() {
    fetch('/api/status')
        .then(response => response.json())
        .then(data => {
            updateStatus(data.status);
            
            if (data.qr) {
                showQRCode(data.qr);
            } else {
                hideQRCode();
            }
            
            if (data.status === 'ready') {
                loadChats();
            }
            
            // Poll for status updates
            setTimeout(checkStatus, 3000);
        })
        .catch(error => {
            console.error('Error checking status:', error);
            updateStatus('disconnected');
            setTimeout(checkStatus, 5000);
        });
}

// Update status indicator
function updateStatus(status) {
    currentStatus = status;
    statusIndicator.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    
    // Update status class
    statusIndicator.className = '';
    if (status === 'ready') {
        statusIndicator.classList.add('status-connected');
    } else if (status === 'disconnected' || status === 'auth_failure') {
        statusIndicator.classList.add('status-disconnected');
    } else {
        statusIndicator.classList.add('status-connecting');
    }
}

// Show QR Code
function showQRCode(qrData) {
    qrCodeContainer.innerHTML = '';
    const qrDiv = document.createElement('div');
    qrDiv.id = 'qrcode';
    qrDiv.className = 'mb-3';
    qrCodeContainer.appendChild(qrDiv);
    
    const instructions = document.createElement('p');
    instructions.className = 'text-center mb-4';
    instructions.innerHTML = 'Scan this QR code with your WhatsApp app to log in';
    qrCodeContainer.appendChild(instructions);

    // Debug: log QR code string
    console.log('QR code string from backend:', qrData);

    QRCode.toCanvas(qrDiv, qrData, { width: 250 }, error => {
        if (error) {
            console.error('Error generating QR code:', error);
            const errMsg = document.createElement('div');
            errMsg.className = 'alert alert-danger mt-2';
            errMsg.textContent = 'Failed to render QR code. Check console for details.';
            qrCodeContainer.appendChild(errMsg);
        }
    });
    
    qrCodeContainer.classList.remove('d-none');
}

// Hide QR Code
function hideQRCode() {
    qrCodeContainer.innerHTML = '';
    qrCodeContainer.classList.add('d-none');
}

// Load chats
function loadChats() {
    fetch('/api/chats')
        .then(response => response.json())
        .then(data => {
            chats = data;
            renderChatList();
            populateRecipientSelect();
        })
        .catch(error => {
            console.error('Error loading chats:', error);
        });
}

// Render chat list
function renderChatList() {
    if (chats.length === 0) {
        chatList.innerHTML = '<div class="text-center py-4 text-muted"><p>No chats found</p></div>';
        return;
    }
    
    chatList.innerHTML = '';
    
    chats.forEach(chat => {
        const chatItem = document.createElement('a');
        chatItem.href = '#';
        chatItem.className = 'list-group-item list-group-item-action chat-item';
        chatItem.dataset.chatId = chat.id;
        
        if (chat.id === selectedChatId) {
            chatItem.classList.add('active');
        }
        
        chatItem.innerHTML = `
            <div class="d-flex w-100 justify-content-between">
                <h6 class="mb-1">${chat.name}</h6>
                ${chat.unreadCount > 0 ? `<span class="badge bg-success rounded-pill">${chat.unreadCount}</span>` : ''}
            </div>
            <small>${chat.isGroup ? 'Group' : 'Private'}</small>
        `;
        
        chatItem.addEventListener('click', (e) => {
            e.preventDefault();
            selectChat(chat.id);
        });
        
        chatList.appendChild(chatItem);
    });
}

// Populate recipient select dropdown
function populateRecipientSelect() {
    // Clear existing options except the default one
    recipientSelect.innerHTML = '<option value="">-- Select chat(s) --</option>';
    
    // Add chats to dropdown
    chats.forEach(chat => {
        const option = document.createElement('option');
        option.value = chat.id;
        option.textContent = chat.name;
        recipientSelect.appendChild(option);
    });
}

// Select chat and load messages
function selectChat(chatId) {
    selectedChatId = chatId;
    
    // Update UI
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.chatId === chatId) {
            item.classList.add('active');
        }
    });
    
    // Find selected chat
    const selectedChat = chats.find(chat => chat.id === chatId);
    if (!selectedChat) return;
    
    // Update chat header
    chatHeader.innerHTML = `<h5 class="mb-0">${selectedChat.name}</h5>`;
    
    // Load messages
    loadMessages(chatId);
}

// Load messages for a chat
function loadMessages(chatId) {
    messageContainer.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div><p class="mt-2">Loading messages...</p></div>';
    
    fetch(`/api/chats/${chatId}/messages`)
        .then(response => response.json())
        .then(messages => {
            renderMessages(messages);
        })
        .catch(error => {
            console.error('Error loading messages:', error);
            messageContainer.innerHTML = '<div class="text-center py-4 text-danger"><p>Error loading messages</p></div>';
        });
}

// Render messages
function renderMessages(messages) {
    if (messages.length === 0) {
        messageContainer.innerHTML = '<div class="text-center py-4 text-muted"><p>No messages found</p></div>';
        return;
    }
    
    messageContainer.innerHTML = '';
    const messagesDiv = document.createElement('div');
    messagesDiv.className = 'd-flex flex-column';
    
    messages.forEach(message => {
        const isFromMe = message.fromMe;
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isFromMe ? 'message-sent ms-auto' : 'message-received me-auto'}`;
        
        let content = '';
        
        // Handle different message types
        if (message.hasMedia) {
            content += `<div class="mb-2"><i class="bi bi-paperclip"></i> Media attachment</div>`;
        }
        
        content += `<div>${message.body}</div>`;
        content += `<small class="text-muted">${new Date(message.timestamp * 1000).toLocaleTimeString()}</small>`;
        
        messageDiv.innerHTML = content;
        messagesDiv.appendChild(messageDiv);
    });
    
    messageContainer.appendChild(messagesDiv);
    
    // Scroll to bottom
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

function renderMessagePreview() {
    const previewArea = document.getElementById('message-preview-area');
    const messageText = document.getElementById('message-text').value;
    const recipientInput = document.getElementById('recipient-input').value;
    const recipients = [...selectedChatIds, ...recipientInput.split(',').map(s => s.trim()).filter(Boolean)];
    const mediaFile = mediaUpload.files[0];
    let html = '';
    if (recipients.length > 0) {
        html += `<div class='mb-2'><strong>Recipients:</strong> ${recipients.join(', ')}</div>`;
    }
    if (mediaFile) {
        if (mediaFile.type.startsWith('image/')) {
            html += `<img src='${URL.createObjectURL(mediaFile)}' class='media-preview mb-2' alt='Preview'>`;
        } else if (mediaFile.type.startsWith('video/')) {
            html += `<video src='${URL.createObjectURL(mediaFile)}' class='media-preview mb-2' controls></video>`;
        } else {
            html += `<div class='mb-2'><i class='bi bi-file-earmark-text'></i> ${mediaFile.name}</div>`;
        }
    }
    if (messageText) {
        html += `<div class='border rounded p-2'>${messageText.replace(/\n/g, '<br>')}</div>`;
    }
    previewArea.innerHTML = html || '<div class="text-muted">Message preview will appear here</div>';
}

// Handle media upload
function handleMediaUpload(event) {
    const file = event.target.files[0];
    if (!file) {
        mediaPreviewContainer.classList.add('d-none');
        renderMessagePreview();
        return;
    }
    
    // Show preview container
    mediaPreviewContainer.classList.remove('d-none');
    
    // Hide all preview elements
    imagePreview.classList.add('d-none');
    videoPreview.classList.add('d-none');
    filePreview.classList.add('d-none');
    
    // Show appropriate preview based on file type
    if (file.type.startsWith('image/')) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.classList.remove('d-none');
    } else if (file.type.startsWith('video/')) {
        videoPreview.src = URL.createObjectURL(file);
        videoPreview.classList.remove('d-none');
    } else {
        fileName.textContent = file.name;
        filePreview.classList.remove('d-none');
    }
    renderMessagePreview();
}

// Handle send message form submission
function handleSendMessage(event) {
    event.preventDefault();
    const recipientInput = document.getElementById('recipient-input').value;
    const messageText = document.getElementById('message-text').value;
    const mediaFile = mediaUpload.files[0];
    const recipients = [...selectedChatIds, ...recipientInput.split(',').map(s => s.trim()).filter(Boolean)];
    if (recipients.length === 0 || !messageText) {
        alert('Please select at least one recipient and enter a message');
        return;
    }
    // Disable send button
    const sendBtn = document.getElementById('send-btn');
    const originalBtnText = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...';
    // Send to each recipient
    let pending = recipients.length;
    recipients.forEach(recipient => {
        const formData = new FormData();
        formData.append('number', recipient);
        formData.append('message', messageText);
        if (mediaFile) {
            formData.append('media', mediaFile);
        }
        // Add to sent messages with pending status
        const timestamp = Date.now();
        const newMessage = {
            id: `msg_${timestamp}_${recipient}`,
            to: recipient,
            message: messageText,
            status: 'pending',
            timestamp: timestamp
        };
        sentMessages.unshift(newMessage);
        renderSentMessages();
        fetch('/api/messages/send', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            sentMessages = sentMessages.map(msg => {
                if (msg.id === newMessage.id) {
                    return { ...msg, status: 'sent' };
                }
                return msg;
            });
            renderSentMessages();
        })
        .catch(error => {
            sentMessages = sentMessages.map(msg => {
                if (msg.id === newMessage.id) {
                    return { ...msg, status: 'failed', error: error.message };
                }
                return msg;
            });
            renderSentMessages();
        })
        .finally(() => {
            pending--;
            if (pending === 0) {
                sendBtn.disabled = false;
                sendBtn.innerHTML = originalBtnText;
                sendMessageForm.reset();
                mediaPreviewContainer.classList.add('d-none');
                selectedChatIds = [];
                renderMessagePreview();
            }
        });
    });
}

// Handle chat send message form submission
function handleChatSendMessage(event) {
    event.preventDefault();
    if (!selectedChatId) {
        alert('Please select a chat to send a message.');
        return;
    }
    const message = chatMessageText.value.trim();
    const mediaFile = chatAttachment.files[0];
    if (!message && !mediaFile) {
        alert('Please enter a message or attach a file.');
        return;
    }
    chatSendForm.querySelector('button[type="submit"]').disabled = true;
    // Prepare form data
    const formData = new FormData();
    formData.append('number', selectedChatId);
    formData.append('message', message);
    if (mediaFile) {
        formData.append('media', mediaFile);
    }
    fetch('/api/messages/send', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        chatMessageText.value = '';
        chatAttachment.value = '';
        renderChatAttachmentPreview();
        loadMessages(selectedChatId);
    })
    .catch(err => {
        alert('Failed to send message: ' + err.message);
    })
    .finally(() => {
        chatSendForm.querySelector('button[type="submit"]').disabled = false;
    });
}

function renderChatAttachmentPreview() {
    // Optionally, you can add a preview below the input if needed
    // For now, no-op
}

// Render sent messages table
function renderSentMessages() {
    sentMessagesTable.innerHTML = '';
    
    if (sentMessages.length === 0) {
        sentMessagesTable.innerHTML = '<tr><td colspan="4" class="text-center">No messages sent yet</td></tr>';
        return;
    }
    
    sentMessages.forEach(msg => {
        const row = document.createElement('tr');
        
        // Status badge
        let statusBadge = '';
        if (msg.status === 'sent') {
            statusBadge = '<span class="badge bg-success">Sent</span>';
        } else if (msg.status === 'pending') {
            statusBadge = '<span class="badge bg-warning text-dark">Pending</span>';
        } else {
            statusBadge = `<span class="badge bg-danger">Failed</span>`;
        }
        
        row.innerHTML = `
            <td>${msg.to}</td>
            <td>${msg.message}</td>
            <td>${statusBadge}</td>
            <td>${new Date(msg.timestamp).toLocaleTimeString()}</td>
        `;
        
        sentMessagesTable.appendChild(row);
    });
} 