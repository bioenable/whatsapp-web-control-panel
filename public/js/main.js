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
const refreshChatsBtn = document.getElementById('refresh-chats-btn');



// --- Templates Tab Logic ---
const templatesTab = document.getElementById('templates');
const templatesList = document.getElementById('templates-list');
const addTemplateBtn = document.getElementById('add-template-btn');
const templateModal = document.getElementById('template-modal');
const closeTemplateModal = document.getElementById('close-template-modal');
const templateForm = document.getElementById('template-form');
const templateModalTitle = document.getElementById('template-modal-title');
const cancelTemplateBtn = document.getElementById('cancel-template-btn');
const templateIdInput = document.getElementById('template-id');
const templateNameInput = document.getElementById('template-name');
const templateTextInput = document.getElementById('template-text');
const templateMediaInput = document.getElementById('template-media');
const templatePreviewModal = document.getElementById('template-preview-modal');
const closeTemplatePreview = document.getElementById('close-template-preview');
const templatePreviewContent = document.getElementById('template-preview-content');
// Add new DOM refs for file input and preview
const templateMediaFileInput = document.getElementById('template-media-file');
const templateMediaPreview = document.getElementById('template-media-preview');
const removeTemplateMediaBtn = document.getElementById('remove-template-media-btn');
let currentTemplateMediaPath = '';
let templateMediaToRemove = false;

// --- Send Message Tab: Template Integration ---
const templateSelect = document.getElementById('template-select');
const previewTemplateBtn = document.getElementById('preview-template-btn');

// State
let currentStatus = 'initializing';
let chats = [];
let selectedChatId = null; // for chat list selection
let selectedChatIds = [];  // for send message multi-select
let templates = [];
let sendTabSelectedTemplateMediaPath = '';
let chatTabSelectedTemplateMediaPath = '';



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

    // --- Templates Tab Logic ---
    if (templatesTab) {
        // Load templates when tab is shown
        document.getElementById('templates-tab').addEventListener('click', loadTemplates);
        addTemplateBtn.addEventListener('click', () => openTemplateModal());
        closeTemplateModal.addEventListener('click', closeTemplateModalFn);
        cancelTemplateBtn.addEventListener('click', closeTemplateModalFn);
        if (templateForm) {
            templateForm.addEventListener('submit', handleTemplateFormSubmit);
        }
        closeTemplatePreview.addEventListener('click', closeTemplatePreviewFn);
    }

    // --- Send Message Tab: Template Integration ---
    if (templateSelect) {
        document.getElementById('send-tab').addEventListener('click', () => {
            console.log('Send tab clicked, loading templates and sent messages');
            populateTemplateSelect();
            loadSentMessagesLog();
        });
        templateSelect.addEventListener('change', handleTemplateSelectChange);
        previewTemplateBtn.addEventListener('click', handlePreviewTemplateBtn);
    }

    if (refreshChatsBtn) {
        refreshChatsBtn.addEventListener('click', () => {
            loadChats();
        });
    }

    // Load templates when chats tab is clicked
    const chatsTab = document.getElementById('chats-tab');
    if (chatsTab) {
        chatsTab.addEventListener('click', () => {
            populateChatTemplateSelect();
        });
    }

    const chatTemplateSelect = document.getElementById('chat-template-select');

    if (chatTemplateSelect) {
        populateChatTemplateSelect();
        chatTemplateSelect.addEventListener('change', handleChatTemplateSelectChange);
    }

    // --- Sent Messages Log for Send Message Tab ---
    if (sentMessagesTable) {
        // Load sent messages when page loads
        loadSentMessagesLog();
        const sendTabBtn = document.getElementById('send-tab');
        if (sendTabBtn) {
            sendTabBtn.addEventListener('click', () => {
                console.log('Send tab clicked, reloading sent messages');
                loadSentMessagesLog();
            });
        }
    }
});

// Global utility function for text truncation
function toggleText(btn) {
    const container = btn.closest('.text-truncate-container');
    const shortText = container.querySelector('.short-text');
    const fullText = container.querySelector('.full-text');
    
    if (fullText.style.display === 'none' || !fullText.style.display) {
        shortText.style.display = 'none';
        fullText.style.display = 'block';
        btn.textContent = 'show less';
    } else {
        shortText.style.display = 'block';
        fullText.style.display = 'none';
        btn.textContent = 'show more';
    }
}

// HTML escape utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Setup event listeners
function setupEventListeners() {
    // Setup media upload handler
    if (mediaUpload) {
        mediaUpload.addEventListener('change', handleMediaUpload);
    }
    
    // Setup send message form
    if (sendMessageForm) {
        sendMessageForm.addEventListener('submit', handleSendMessage);
    }
    
    // Setup recipient multi-select
    if (recipientSelect) {
        // Make it multi-select
        recipientSelect.multiple = true;
        recipientSelect.addEventListener('change', handleRecipientSelectChange);
    }
    
    // Load initial data
    loadChats();
    loadTemplates();
    
    // Load templates for both tabs initially
    setTimeout(() => {
        populateTemplateSelect();
        populateChatTemplateSelect();
    }, 1000);
}

// Check WhatsApp connection status
function checkStatus() {
    fetch('/api/status')
        .then(response => response.json())
        .then(data => {
            currentStatus = data.status;
            updateStatusIndicator(data.status);
            
            if (data.status === 'qr') {
                showQRCode(data.qr);
            } else {
                hideQRCode();
            }
            
            if (data.status === 'ready') {
                loadChats();
            } else {
                // If not ready, clear chat list
                if (chatList) chatList.innerHTML = '<div class="text-center text-gray-400 py-4">WhatsApp not connected. Waiting for connection...</div>';
            }
            
            // Poll for status updates every 3 seconds
            setTimeout(checkStatus, 3000);
        })
        .catch(error => {
            console.error('Error checking status:', error);
            updateStatusIndicator('error');
            // Poll again after 5 seconds on error
            setTimeout(checkStatus, 5000);
        });
}

// Update status indicator
function updateStatusIndicator(status) {
    if (!statusIndicator) return;
    
    const statusText = document.getElementById('status-text');
    if (!statusText) return;
    
    const statusMap = {
        'initializing': { text: 'Initializing...', class: 'bg-yellow-500' },
        'qr': { text: 'Scan QR Code', class: 'bg-blue-500' },
        'authenticated': { text: 'Connected', class: 'bg-green-500' },
        'ready': { text: 'Ready', class: 'bg-green-500' },
        'error': { text: 'Error', class: 'bg-red-500' },
        'disconnected': { text: 'Disconnected', class: 'bg-red-500' }
    };
    
    const statusInfo = statusMap[status] || { text: 'Unknown', class: 'bg-gray-500' };
    statusIndicator.className = `inline-block w-3 h-3 rounded-full ${statusInfo.class}`;
    statusText.textContent = statusInfo.text;
}

// Show QR Code
function showQRCode(qrData) {
    if (!qrCodeContainer || !qrData) return;
    
    qrCodeContainer.innerHTML = '';
    
    const qrDiv = document.createElement('div');
    qrDiv.className = 'flex justify-center';
    qrCodeContainer.appendChild(qrDiv);
    
    const instructions = document.createElement('div');
    instructions.className = 'text-center mt-4 text-gray-600';
    instructions.innerHTML = `
        <p class="mb-2">Scan this QR code with WhatsApp to connect:</p>
        <p class="text-sm">WhatsApp > Settings > Linked Devices > Link a Device</p>
    `;
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

// Render chat list (sidebar style)
function renderChatList() {
    if (chats.length === 0) {
        chatList.innerHTML = '<div class="text-center py-4 text-gray-400">No chats found</div>';
        return;
    }
    chatList.innerHTML = '';
    chats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'px-4 py-3 cursor-pointer hover:bg-green-50 flex items-center gap-2' + (chat.id === selectedChatId ? ' bg-green-100' : '');
        chatItem.dataset.chatId = chat.id;
        chatItem.innerHTML = `
            <div class="flex-1 truncate">
                <div class="font-semibold truncate">${escapeHtml(chat.name)}</div>
                <div class="text-xs text-gray-500">${chat.isGroup ? 'Group' : 'Private'}</div>
            </div>
            ${chat.unreadCount > 0 ? `<span class="ml-2 bg-green-600 text-white text-xs rounded-full px-2 py-0.5">${chat.unreadCount}</span>` : ''}
        `;
        chatItem.addEventListener('click', () => selectChat(chat.id));
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

// Handle recipient select change (multi-select)
function handleRecipientSelectChange() {
    selectedChatIds = Array.from(recipientSelect.selectedOptions).map(option => option.value);
    renderMessagePreview();
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
    
    // Update chat header with participants button for groups
    let headerContent = `<div class="flex items-center justify-between w-full">`;
    headerContent += `<h5 class="mb-0">${selectedChat.name}</h5>`;
    if (selectedChat.isGroup) {
        headerContent += `
            <button id="show-participants-btn" class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors duration-200 flex items-center gap-1">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"></path>
                </svg>
                Show Participants
            </button>
        `;
    }
    headerContent += `</div>`;
    chatHeader.innerHTML = headerContent;
    
    // Add event listener for participants button if it's a group
    if (selectedChat.isGroup) {
        const participantsBtn = document.getElementById('show-participants-btn');
        if (participantsBtn) {
            participantsBtn.addEventListener('click', () => showGroupParticipants(chatId, selectedChat.name));
        }
    }
    
    // Load messages
    loadMessages(chatId);
    // After selecting a chat, repopulate templates
    populateChatTemplateSelect();
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

// Render messages (WhatsApp-like bubbles)
function renderMessages(messages) {
    if (messages.length === 0) {
        messageContainer.innerHTML = '<div class="text-center py-4 text-gray-400">No messages found</div>';
        return;
    }
    messageContainer.innerHTML = '';
    const messagesDiv = document.createElement('div');
    messagesDiv.className = 'flex flex-col gap-2';
    messages.forEach(message => {
        const isFromMe = message.fromMe;
        const bubble = document.createElement('div');
        bubble.className = 'max-w-[70%] px-4 py-2 rounded-lg shadow ' + (isFromMe ? 'bg-green-100 self-end' : 'bg-white self-start');
        let content = '';
        if (message.hasMedia) {
            content += `<div class='mb-1 text-xs text-green-600'>[Media attachment]</div>`;
        }
        content += `<div>${escapeHtml(message.body)}</div>`;
        content += `<div class='text-xs text-gray-400 mt-1 text-right'>${new Date(message.timestamp * 1000).toLocaleTimeString()}</div>`;
        bubble.innerHTML = content;
        messagesDiv.appendChild(bubble);
    });
    messageContainer.appendChild(messagesDiv);
    messageContainer.scrollTop = messageContainer.scrollHeight;
}

// Fix Send Message preview: only show media if present
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
        html += `<div class='border rounded p-2'>${escapeHtml(messageText).replace(/\n/g, '<br>')}</div>`;
    }
    previewArea.innerHTML = html || '<div class="text-gray-400">Message preview will appear here</div>';
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
    let messageText = document.getElementById('message-text').value;
    let mediaFile = mediaUpload.files[0];
    const recipients = [...selectedChatIds, ...recipientInput.split(',').map(s => s.trim()).filter(Boolean)];

    // --- Template logic ---
    const templateId = templateSelect ? templateSelect.value : '';
    let templateText = '';
    let templateMedia = '';
    if (templateId) {
        const templates = window.sendTabTemplates || [];
        const t = templates.find(t => t.id === templateId);
        if (t) {
            templateText = t.text || '';
            templateMedia = t.media || '';
        }
    }

    // Use template text/media if user input is empty
    if (!messageText && templateText) {
        messageText = templateText;
    }
    // If no file uploaded but template has media, use template media (as URL)
    // Note: We can't upload a file from a URL, so we send the media URL to the backend
    let useTemplateMedia = false;
    if (!mediaFile && templateMedia) {
        useTemplateMedia = true;
    }

    // Validation: must have at least one recipient, and either messageText or mediaFile or template content
    if (recipients.length === 0 || (!messageText && !mediaFile && !templateMedia)) {
        alert('Please select at least one recipient and enter a message or select a template/attach a file.');
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
        } else if (useTemplateMedia && templateMedia) {
            formData.append('media_path', templateMedia); // Backend should handle media_path
        }
        fetch('/api/messages/send', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            // No local sentMessages update; rely on backend log
        })
        .catch(error => {
            // Optionally show error
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
                // Always reload log after send
                loadSentMessagesLog();
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
    let message = chatMessageText.value.trim();
    let mediaFile = chatAttachment.files[0];

    // --- Template logic ---
    const chatTemplateSelect = document.getElementById('chat-template-select');
    const templateId = chatTemplateSelect ? chatTemplateSelect.value : '';
    let templateText = '';
    let templateMedia = '';
    if (templateId) {
        const templates = window.chatTabTemplates || [];
        const t = templates.find(t => t.id === templateId);
        if (t) {
            templateText = t.text || '';
            templateMedia = t.media || '';
        }
    }

    // Use template text/media if user input is empty
    if (!message && templateText) {
        message = templateText;
    }
    // If no file uploaded but template has media, use template media (as URL)
    let useTemplateMedia = false;
    if (!mediaFile && templateMedia) {
        useTemplateMedia = true;
    }

    // Validation: must have either message or media or template content
    if (!message && !mediaFile && !templateMedia) {
        alert('Please enter a message or attach a file or select a template.');
        return;
    }
    chatSendForm.querySelector('button[type="submit"]').disabled = true;
    // Prepare form data
    const formData = new FormData();
    formData.append('number', selectedChatId);
    formData.append('message', message);
    if (mediaFile) {
        formData.append('media', mediaFile);
    } else if (useTemplateMedia && templateMedia) {
        formData.append('media_path', templateMedia); // Backend should handle media_path
    }
    fetch('/api/messages/send', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        chatMessageText.value = '';
        chatAttachment.value = '';
        clearChatTabMediaPreview();
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

// State for sent messages pagination
let sentMessagesPage = 1;
let sentMessagesLimit = 20;
let allSentMessages = [];

// Load sent messages log (for Send Message tab)
function loadSentMessagesLog(page = 1) {
    if (!sentMessagesTable) {
        console.error('sentMessagesTable element not found');
        return;
    }
    
    sentMessagesPage = page;
    
    fetch('/api/messages/log')
        .then(response => response.json())
        .then(data => {
            if (!Array.isArray(data)) {
                console.error('Expected array from /api/messages/log, got:', typeof data, data);
                return;
            }
            console.log('Sent messages loaded:', data.length, 'messages');
            allSentMessages = data.reverse(); // Show newest first
            renderSentMessagesTable();
        })
        .catch(error => {
            console.error('Error loading sent messages log:', error);
        });
}

// Render sent messages table with pagination and resend functionality
function renderSentMessagesTable() {
    if (!sentMessagesTable) {
        console.error('sentMessagesTable not found in renderSentMessagesTable');
        return;
    }
    
    // sentMessagesTable IS the tbody element, no need to search for tbody within it
    const tbody = sentMessagesTable;
    
    if (allSentMessages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-400 py-4">No sent messages</td></tr>';
        updateSentMessagesPagination();
        return;
    }
    
    // Calculate pagination
    const startIndex = (sentMessagesPage - 1) * sentMessagesLimit;
    const endIndex = startIndex + sentMessagesLimit;
    const pageMessages = allSentMessages.slice(startIndex, endIndex);
    
    console.log(`Showing messages ${startIndex + 1}-${Math.min(endIndex, allSentMessages.length)} of ${allSentMessages.length}`);
    
    tbody.innerHTML = pageMessages.map((msg, index) => {
        const globalIndex = startIndex + index;
        const hasMedia = msg.media && (msg.media.filename || msg.media.mimetype);
        const recipient = msg.to || msg.recipient || 'Unknown';
        const timestamp = msg.time || msg.timestamp;
        
        return `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-sm">${new Date(timestamp).toLocaleString()}</td>
                <td class="px-4 py-3 text-sm">${escapeHtml(recipient.replace('@c.us', '').replace('@g.us', ' (Group)'))}</td>
                <td class="px-4 py-3 text-sm max-w-xs">
                    <div class="truncate">${escapeHtml(msg.message || '')}</div>
                    ${hasMedia ? `<div class="text-xs text-blue-600 mt-1">📎 ${msg.media.filename || 'Media'}</div>` : ''}
                </td>
                <td class="px-4 py-3 text-sm text-center">${hasMedia ? 'Yes' : 'No'}</td>
                <td class="px-4 py-3 text-sm">
                    <span class="px-2 py-1 text-xs rounded ${msg.status === 'sent' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}">
                        ${escapeHtml(msg.status)}
                    </span>
                </td>
                <td class="px-4 py-3 text-sm">
                    <button onclick="resendMessage(${globalIndex})" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">
                        Resend
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    updateSentMessagesPagination();
}

// Update pagination controls for sent messages
function updateSentMessagesPagination() {
    const totalPages = Math.ceil(allSentMessages.length / sentMessagesLimit);
    const container = document.getElementById('sent-messages-pagination');
    
    if (!container) {
        // Create pagination container if it doesn't exist
        const paginationHtml = `
            <div id="sent-messages-pagination" class="flex justify-between items-center mt-4 px-4 py-3 bg-gray-50 rounded">
                <div class="text-sm text-gray-600">
                    Showing <span id="sent-messages-range"></span> of <span id="sent-messages-total"></span> messages
                </div>
                <div class="flex gap-2">
                    <button id="sent-messages-prev" class="px-3 py-1 bg-white border rounded text-sm hover:bg-gray-50 disabled:opacity-50" onclick="loadSentMessagesLog(sentMessagesPage - 1)">
                        Previous
                    </button>
                    <span id="sent-messages-page-info" class="px-3 py-1 text-sm"></span>
                    <button id="sent-messages-next" class="px-3 py-1 bg-white border rounded text-sm hover:bg-gray-50 disabled:opacity-50" onclick="loadSentMessagesLog(sentMessagesPage + 1)">
                        Next
                    </button>
                </div>
            </div>
        `;
        
        // Insert after the sent messages table (sentMessagesTable is the tbody, so we need its parent table's parent)
        if (sentMessagesTable && sentMessagesTable.parentNode && sentMessagesTable.parentNode.parentNode) {
            sentMessagesTable.parentNode.parentNode.insertAdjacentHTML('afterend', paginationHtml);
        }
    }
    
    // Update pagination info
    const startIndex = (sentMessagesPage - 1) * sentMessagesLimit + 1;
    const endIndex = Math.min(sentMessagesPage * sentMessagesLimit, allSentMessages.length);
    
    const rangeElement = document.getElementById('sent-messages-range');
    const totalElement = document.getElementById('sent-messages-total');
    const pageInfoElement = document.getElementById('sent-messages-page-info');
    const prevButton = document.getElementById('sent-messages-prev');
    const nextButton = document.getElementById('sent-messages-next');
    
    if (rangeElement) rangeElement.textContent = `${startIndex}-${endIndex}`;
    if (totalElement) totalElement.textContent = allSentMessages.length;
    if (pageInfoElement) pageInfoElement.textContent = `Page ${sentMessagesPage} of ${totalPages}`;
    
    if (prevButton) prevButton.disabled = sentMessagesPage <= 1;
    if (nextButton) nextButton.disabled = sentMessagesPage >= totalPages;
}

// Resend a message from the sent messages log (global function)
window.resendMessage = function(messageIndex) {
    const message = allSentMessages[messageIndex];
    if (!message) {
        alert('Message not found');
        return;
    }
    
    if (!confirm(`Resend message to ${message.to}?\n\nMessage: ${message.message}`)) {
        return;
    }
    
    const formData = new FormData();
    formData.append('number', message.to);
    formData.append('message', message.message || '');
    
    // If the message had media, we need to handle it
    if (message.media && message.media.filename) {
        // For resending, we'll use media_path since the file should still exist
        formData.append('media_path', `/uploads/${message.media.filename}`);
    }
    
    fetch('/api/messages/send', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }
        alert('Message resent successfully!');
        // Reload the sent messages log to show the new entry
        loadSentMessagesLog(1); // Go to first page to see the latest message
    })
    .catch(error => {
        console.error('Resend error:', error);
        alert('Failed to resend message: ' + error.message);
    });
};

// --- Templates Tab Logic ---
function loadTemplates() {
    fetch('/api/templates')
        .then(res => res.json())
        .then(data => {
            templates = data;
            renderTemplatesList();
        });
}

function renderTemplatesList() {
    if (!templatesList) return;
    if (!templates || templates.length === 0) {
        templatesList.innerHTML = '<div class="text-gray-400 text-center py-8">No templates found.</div>';
        return;
    }
    templatesList.innerHTML = '';
    templates.forEach(t => {
        const div = document.createElement('div');
        div.className = 'flex items-center bg-white rounded shadow p-3 gap-4';
        div.style.maxHeight = '6.5rem'; // ~4 lines
        div.innerHTML = `
            <div class="flex-1 overflow-hidden">
                <div class="font-semibold truncate">${escapeHtml(t.name)}</div>
                <div class="text-sm text-gray-600 whitespace-pre-line overflow-hidden" style="max-height:4.5em;">${escapeHtml(t.text)}</div>
            </div>
            ${t.media ? renderTemplateMediaThumb(t.media) : ''}
            <div class="flex flex-col gap-1 ml-2">
                <button class="text-green-600 hover:underline text-xs" data-action="preview" data-id="${t.id}">View</button>
                <button class="text-blue-600 hover:underline text-xs" data-action="edit" data-id="${t.id}">Edit</button>
                <button class="text-red-600 hover:underline text-xs" data-action="delete" data-id="${t.id}">Delete</button>
            </div>
        `;
        templatesList.appendChild(div);
    });
    // Add event listeners for actions
    templatesList.querySelectorAll('button[data-action]').forEach(btn => {
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        btn.addEventListener('click', () => {
            if (action === 'edit') openTemplateModal(id);
            else if (action === 'delete') deleteTemplate(id);
            else if (action === 'preview') previewTemplate(id);
        });
    });
}

function renderTemplateMediaThumb(media) {
    if (!media) return '';
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(media);
    const isVideo = /\.(mp4|avi|mov|webm)$/i.test(media);
    if (isImage) {
        return `<img src='${media}' class='w-12 h-12 object-cover rounded' alt='Thumbnail'>`;
    } else if (isVideo) {
        return `<div class='w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-xs'>Video</div>`;
    } else {
        return `<div class='w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-xs'>File</div>`;
    }
}

function openTemplateModal(id = null) {
    templateModal.classList.remove('hidden');
    templateMediaFileInput.value = '';
    templateMediaPreview.innerHTML = '';
    removeTemplateMediaBtn.classList.add('hidden');
    templateMediaToRemove = false;
    currentTemplateMediaPath = '';
    if (id) {
        const t = templates.find(t => t.id === id);
        if (!t) return;
        templateModalTitle.textContent = 'Edit Template';
        templateIdInput.value = t.id;
        templateNameInput.value = t.name;
        templateTextInput.value = t.text;
        currentTemplateMediaPath = t.media || '';
        if (t.media) {
            showTemplateMediaPreview(t.media);
            removeTemplateMediaBtn.classList.remove('hidden');
        }
    } else {
        templateModalTitle.textContent = 'Add Template';
        templateIdInput.value = '';
        templateNameInput.value = '';
        templateTextInput.value = '';
        currentTemplateMediaPath = '';
    }
}

function closeTemplateModalFn() {
    templateModal.classList.add('hidden');
}

function handleTemplateFormSubmit(e) {
    e.preventDefault();
    const id = templateIdInput.value;
    const name = templateNameInput.value.trim();
    const text = templateTextInput.value.trim();
    const file = templateMediaFileInput.files[0];
    const formData = new FormData();
    formData.append('name', name);
    formData.append('text', text);
    if (file) {
        formData.append('media', file);
    }
    if (id) {
        if (templateMediaToRemove && !file) {
            formData.append('removeMedia', 'true');
        }
        fetch(`/api/templates/${id}`, {
            method: 'PUT',
            body: formData
        })
        .then(res => res.json())
        .then(() => {
            closeTemplateModalFn();
            loadTemplates();
        });
    } else {
        fetch('/api/templates', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(() => {
            closeTemplateModalFn();
            loadTemplates();
        });
    }
}

function deleteTemplate(id) {
    if (!confirm('Are you sure you want to delete this template?')) return;
    fetch(`/api/templates/${id}`, { method: 'DELETE' })
        .then(() => loadTemplates());
}

function previewTemplate(id) {
    const t = templates.find(t => t.id === id);
    if (!t) return;
    templatePreviewContent.innerHTML = renderTemplatePreview(t);
    templatePreviewModal.classList.remove('hidden');
}

function renderTemplatePreview(template) {
    let html = `<h3 class='font-semibold mb-2'>${escapeHtml(template.name)}</h3>`;
    if (template.media) {
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(template.media);
        const isVideo = /\.(mp4|avi|mov|webm)$/i.test(template.media);
        if (isImage) {
            html += `<img src='${template.media}' class='max-w-full mb-3 rounded' alt='Preview'>`;
        } else if (isVideo) {
            html += `<video src='${template.media}' class='max-w-full mb-3 rounded' controls></video>`;
        } else {
            html += `<a href='${template.media}' target='_blank' class='text-blue-600 underline mb-3 block'>Download File</a>`;
        }
    }
    html += `<div class='whitespace-pre-line'>${escapeHtml(template.text)}</div>`;
    return html;
}

function closeTemplatePreviewFn() {
    templatePreviewModal.classList.add('hidden');
}

function showTemplateMediaPreview(mediaPath) {
    if (!mediaPath) return;
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaPath);
    const isVideo = /\.(mp4|avi|mov|webm)$/i.test(mediaPath);
    if (isImage) {
        templateMediaPreview.innerHTML = `<img src='${mediaPath}' class='max-w-32 max-h-32 object-cover rounded' alt='Current'>`;
    } else if (isVideo) {
        templateMediaPreview.innerHTML = `<video src='${mediaPath}' class='max-w-32 max-h-32 object-cover rounded' muted></video>`;
    } else {
        templateMediaPreview.innerHTML = `<div class='p-2 bg-gray-100 rounded text-sm'>File: ${mediaPath.split('/').pop()}</div>`;
    }
}

// Template media file input change handler
if (templateMediaFileInput) {
    templateMediaFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            if (file.type.startsWith('image/')) {
                templateMediaPreview.innerHTML = `<img src='${url}' class='max-w-32 max-h-32 object-cover rounded' alt='Preview'>`;
            } else if (file.type.startsWith('video/')) {
                templateMediaPreview.innerHTML = `<video src='${url}' class='max-w-32 max-h-32 object-cover rounded' muted></video>`;
            } else {
                templateMediaPreview.innerHTML = `<div class='p-2 bg-gray-100 rounded text-sm'>File: ${file.name}</div>`;
            }
            removeTemplateMediaBtn.classList.remove('hidden');
            templateMediaToRemove = false;
        }
    });
}

// Remove template media button handler
if (removeTemplateMediaBtn) {
    removeTemplateMediaBtn.addEventListener('click', () => {
        templateMediaFileInput.value = '';
        templateMediaPreview.innerHTML = '';
        removeTemplateMediaBtn.classList.add('hidden');
        if (currentTemplateMediaPath) {
            templateMediaToRemove = true;
        }
    });
}

// --- Send Message Tab: Template Integration ---
function populateTemplateSelect() {
    console.log('populateTemplateSelect called for Send Message tab');
    if (!templateSelect) {
        console.warn('template-select element not found');
        return;
    }
    
    fetch('/api/templates')
        .then(res => res.json())
        .then(data => {
            console.log('Templates loaded for send message tab:', data);
            // Save for preview
            window.sendTabTemplates = data;
            templateSelect.innerHTML = '<option value="">-- None --</option>';
            data.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                templateSelect.appendChild(opt);
            });
            previewTemplateBtn.classList.add('hidden');
        })
        .catch(err => {
            console.error('Failed to load templates for send message tab:', err);
        });
}

function handleTemplateSelectChange() {
    const id = templateSelect.value;
    const templates = window.sendTabTemplates || [];
    const t = templates.find(t => t.id === id);
    if (t) {
        document.getElementById('message-text').value = t.text;
        if (t.media) {
            // Show media as attachment preview (simulate file input for preview only)
            showSendTabMediaPreview(t.media);
            // Store media_path for sending
            sendTabSelectedTemplateMediaPath = t.media;
        } else {
            clearSendTabMediaPreview();
            sendTabSelectedTemplateMediaPath = '';
        }
        previewTemplateBtn.classList.remove('hidden');
    } else {
        document.getElementById('message-text').value = '';
        clearSendTabMediaPreview();
        sendTabSelectedTemplateMediaPath = '';
        previewTemplateBtn.classList.add('hidden');
    }
}

function handlePreviewTemplateBtn() {
    const id = templateSelect.value;
    const templates = window.sendTabTemplates || [];
    const t = templates.find(t => t.id === id);
    if (t) {
        // Reuse the preview modal from Templates tab
        document.getElementById('template-preview-content').innerHTML = renderTemplatePreview(t);
        document.getElementById('template-preview-modal').classList.remove('hidden');
    }
}

function showSendTabMediaPreview(mediaPath) {
    // Simulate file attachment preview for template media
    if (!mediaPreviewContainer) return;
    mediaPreviewContainer.classList.remove('d-none');
    imagePreview.classList.add('d-none');
    videoPreview.classList.add('d-none');
    filePreview.classList.add('d-none');
    
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(mediaPath);
    const isVideo = /\.(mp4|avi|mov|webm)$/i.test(mediaPath);
    
    if (isImage) {
        imagePreview.src = mediaPath;
        imagePreview.classList.remove('d-none');
    } else if (isVideo) {
        videoPreview.src = mediaPath;
        videoPreview.classList.remove('d-none');
    } else {
        fileName.textContent = mediaPath.split('/').pop();
        filePreview.classList.remove('d-none');
    }
}

function clearSendTabMediaPreview() {
    if (mediaPreviewContainer) {
        mediaPreviewContainer.classList.add('d-none');
    }
}

// --- Chat Tab Template Integration ---
function populateChatTemplateSelect() {
    const chatTemplateSelect = document.getElementById('chat-template-select');
    console.log('populateChatTemplateSelect called, element found:', !!chatTemplateSelect);
    if (!chatTemplateSelect) {
        console.warn('chat-template-select element not found');
        return;
    }
    
    fetch('/api/templates')
        .then(res => res.json())
        .then(data => {
            console.log('Templates loaded for chat tab:', data);
            chatTemplateSelect.innerHTML = '<option value="">-- Template --</option>';
            data.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                chatTemplateSelect.appendChild(opt);
            });
            window.chatTabTemplates = data;
        })
        .catch(err => {
            console.error('Failed to load templates for chat tab:', err);
        });
}

function handleChatTemplateSelectChange() {
    const chatTemplateSelect = document.getElementById('chat-template-select');
    const id = chatTemplateSelect.value;
    const templates = window.chatTabTemplates || [];
    const t = templates.find(t => t.id === id);
    if (t) {
        document.getElementById('chat-message-text').value = t.text;
        if (t.media) {
            showChatTabMediaPreview(t.media);
            chatTabSelectedTemplateMediaPath = t.media;
        } else {
            clearChatTabMediaPreview();
            chatTabSelectedTemplateMediaPath = '';
        }
    } else {
        document.getElementById('chat-message-text').value = '';
        clearChatTabMediaPreview();
        chatTabSelectedTemplateMediaPath = '';
    }
}

function showChatTabMediaPreview(mediaPath) {
    // For chat tab, we might not have a dedicated preview area
    // This is a placeholder for future enhancement
    console.log('Chat template media preview:', mediaPath);
}

function clearChatTabMediaPreview() {
    console.log('Clear chat template media preview');
}

// Group Participants Functions
function showGroupParticipants(chatId, groupName) {
    // Create modal if it doesn't exist
    let participantsModal = document.getElementById('participants-modal');
    if (!participantsModal) {
        participantsModal = document.createElement('div');
        participantsModal.id = 'participants-modal';
        participantsModal.className = 'fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 hidden';
        participantsModal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full max-w-5xl p-6 relative max-h-[90vh] overflow-hidden">
                <button id="close-participants-modal" class="absolute top-4 right-4 text-gray-400 hover:text-gray-700 text-2xl font-bold w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">&times;</button>
                <h3 id="participants-modal-title" class="text-xl font-semibold mb-6 text-gray-800 border-b pb-3">Group Participants</h3>
                <div id="participants-content" class="overflow-y-auto max-h-[calc(90vh-120px)]">
                    <div class="text-center py-8">
                        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <p class="mt-3 text-gray-600">Loading participants...</p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(participantsModal);
        
        // Add close event listener
        document.getElementById('close-participants-modal').addEventListener('click', () => {
            participantsModal.classList.add('hidden');
        });
        
        // Close modal when clicking outside
        participantsModal.addEventListener('click', (e) => {
            if (e.target === participantsModal) {
                participantsModal.classList.add('hidden');
            }
        });
    }
    
    // Show modal and load participants
    participantsModal.classList.remove('hidden');
    document.getElementById('participants-modal-title').textContent = `Participants - ${groupName}`;
    
    // Load participants data
    fetch(`/api/chats/${chatId}/participants`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            renderParticipantsTable(data);
        })
        .catch(error => {
            console.error('Error loading participants:', error);
            document.getElementById('participants-content').innerHTML = `
                <div class="text-center py-4 text-danger">
                    <p>Error loading participants: ${error.message}</p>
                </div>
            `;
        });
}

function renderParticipantsTable(data) {
    const { participants, total, groupName } = data;
    const contentDiv = document.getElementById('participants-content');
    
    if (participants.length === 0) {
        contentDiv.innerHTML = '<div class="text-center py-4 text-gray-400">No participants found</div>';
        return;
    }
    
    const tableHtml = `
        <div class="mb-4">
            <div class="flex items-center justify-between mb-4">
                <div class="text-lg font-semibold text-gray-800">Total Participants: ${total}</div>
                <button id="download-csv-btn" class="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 transition-colors duration-200 flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    Download CSV
                </button>
            </div>
            <div class="overflow-x-auto border border-gray-200 rounded-lg">
                <table class="min-w-full bg-white text-sm">
                    <thead class="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th class="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider">#</th>
                            <th class="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider">Group Name</th>
                            <th class="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider">Phone Number</th>
                            <th class="px-6 py-4 text-left font-semibold text-gray-700 uppercase tracking-wider">Role</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                        ${participants.map((participant, index) => {
                            let role = 'Member';
                            if (participant.isSuperAdmin) role = 'Super Admin';
                            else if (participant.isAdmin) role = 'Admin';
                            
                            return `
                                <tr class="hover:bg-gray-50 transition-colors duration-150">
                                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${index + 1}</td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(groupName)}</td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">${escapeHtml(participant.number)}</td>
                                    <td class="px-6 py-4 whitespace-nowrap">
                                        <span class="inline-flex px-3 py-1 text-xs font-semibold rounded-full ${
                                            participant.isSuperAdmin ? 'bg-red-100 text-red-800' :
                                            participant.isAdmin ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-gray-100 text-gray-800'
                                        }">
                                            ${role}
                                        </span>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    contentDiv.innerHTML = tableHtml;
    
    // Add event listener for CSV download
    const downloadBtn = document.getElementById('download-csv-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => downloadParticipantsCSV(data));
    }
}

function downloadParticipantsCSV(data) {
    const { participants, groupName } = data;
    
    // Create CSV content
    const csvContent = [
        ['Group Name', 'Phone Number', 'Role'],
        ...participants.map(participant => {
            let role = 'Member';
            if (participant.isSuperAdmin) role = 'Super Admin';
            else if (participant.isAdmin) role = 'Admin';
            
            return [
                groupName,
                participant.number,
                role
            ];
        })
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    
    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${groupName.replace(/[^a-zA-Z0-9]/g, '_')}_participants.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

