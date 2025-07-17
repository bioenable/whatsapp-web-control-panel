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

// --- Bulk Tab Logic ---
const bulkImportForm = document.getElementById('bulk-import-form');
const bulkCsvInput = document.getElementById('bulk-csv');
const bulkImportErrors = document.getElementById('bulk-import-errors');
const bulkList = document.getElementById('bulk-list');
const bulkListContainer = document.getElementById('bulk-list-container');
const bulkImportFilter = document.getElementById('bulk-import-filter');
const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
const bulkCancelBtn = document.getElementById('bulk-cancel-btn');
const bulkPrevPage = document.getElementById('bulk-prev-page');
const bulkNextPage = document.getElementById('bulk-next-page');
const bulkPageInfo = document.getElementById('bulk-page-info');

let bulkRecords = [];
let bulkPage = 1;
let bulkLimit = 100;
let bulkTotal = 0;
let bulkCurrentImport = '';

if (bulkImportForm) {
    document.getElementById('bulk-tab').addEventListener('click', () => {
        bulkPage = 1;
        loadBulkImports();
        loadBulkImportFilenames();
    });
    bulkImportForm.addEventListener('submit', handleBulkImport);
    bulkImportFilter.addEventListener('change', () => {
        bulkCurrentImport = bulkImportFilter.value;
        bulkPage = 1;
        loadBulkImports();
    });
    bulkDeleteBtn.addEventListener('click', handleBulkDelete);
    bulkCancelBtn.addEventListener('click', handleBulkCancel);
    bulkPrevPage.addEventListener('click', () => {
        if (bulkPage > 1) {
            bulkPage--;
            loadBulkImports();
        }
    });
    bulkNextPage.addEventListener('click', () => {
        if (bulkPage * bulkLimit < bulkTotal) {
            bulkPage++;
            loadBulkImports();
        }
    });
}

// Bulk Sample CSV Download
const downloadSampleCsvBtn = document.getElementById('download-sample-csv');
let bulkTimezone = 'Asia/Kolkata';
let bulkNow = new Date();
function updateBulkTimezoneInfo() {
    fetch('/api/time')
        .then(res => res.json())
        .then(data => {
            bulkTimezone = data.timezone || 'Asia/Kolkata';
            bulkNow = new Date(data.iso);
            document.getElementById('bulk-timezone-info').textContent = `Current time: ${data.now} (${bulkTimezone})`;
        });
}
const bulkTabBtn = document.getElementById('bulk-tab');
if (bulkTabBtn) {
    bulkTabBtn.addEventListener('click', updateBulkTimezoneInfo);
}
// Also update on page load if already on bulk tab
if (document.getElementById('bulk').classList.contains('hidden') === false) {
    updateBulkTimezoneInfo();
}
if (downloadSampleCsvBtn) {
    downloadSampleCsvBtn.addEventListener('click', function() {
        // Wait for timezone info if not loaded
        if (!bulkTimezone || !bulkNow) updateBulkTimezoneInfo();
        const jokes = [
            "Why do programmers prefer dark mode? Because light attracts bugs!",
            "Why did the computer show up at work late? It had a hard drive!",
            "Why do Java developers wear glasses? Because they don't see sharp!"
        ];
        const media = [
            // Wikimedia Commons public domain images
            'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png',
            'https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg',
            'https://upload.wikimedia.org/wikipedia/commons/6/6e/Golde33443.jpg'
        ];
        // Use bulkNow as base, or fallback to new Date()
        const now = bulkNow instanceof Date ? bulkNow : new Date();
        const base = new Date(now.getTime() + 20 * 60 * 1000); // 20 min from now
        const datetimes = [
            new Date(base.getTime()).toLocaleString('sv-SE', { timeZone: bulkTimezone }).replace(' ', 'T'),
            new Date(base.getTime() + 30 * 1000).toLocaleString('sv-SE', { timeZone: bulkTimezone }).replace(' ', 'T'),
            new Date(base.getTime() + 60 * 1000).toLocaleString('sv-SE', { timeZone: bulkTimezone }).replace(' ', 'T')
        ];
        let csv = 'number,message,media,send_datetime\n';
        for (let i = 0; i < 3; i++) {
            csv += `917972402648,"${jokes[i]}",${media[i]},${datetimes[i]}\n`;
        }
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sample_bulk_import.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    });
}

// State
let currentStatus = 'initializing';
let chats = [];
let selectedChatId = null; // for chat list selection
let selectedChatIds = [];  // for send message multi-select
// Remove in-memory sentMessages array for Send Message tab
// Only use backend log for sent messages
// (No declaration or use of let sentMessages = [] for Send Message tab)

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
        document.getElementById('send-tab').addEventListener('click', populateTemplateSelect);
        templateSelect.addEventListener('change', handleTemplateSelectChange);
        previewTemplateBtn.addEventListener('click', handlePreviewTemplateBtn);
    }

    if (refreshChatsBtn) {
        refreshChatsBtn.addEventListener('click', () => {
            loadChats();
        });
    }

    const chatTemplateSelect = document.getElementById('chat-template-select');

    if (chatTemplateSelect) {
        document.addEventListener('DOMContentLoaded', populateChatTemplateSelect);
        chatTemplateSelect.addEventListener('change', handleChatTemplateSelectChange);
    }

    // --- Sent Messages Log for Send Message Tab ---
    if (sentMessagesTable) {
        document.addEventListener('DOMContentLoaded', loadSentMessagesLog);
        const sendTabBtn = document.getElementById('send-tab');
        if (sendTabBtn) {
            sendTabBtn.addEventListener('click', loadSentMessagesLog);
        }
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
            } else {
                // If not ready, clear chat list
                if (chatList) chatList.innerHTML = '<div class="text-center text-gray-400 py-4">WhatsApp not connected. Waiting for connection...</div>';
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
    // After selecting a chat, repopulate templates
    if (chatTemplateSelect) populateChatTemplateSelect();
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
    if (media.match(/\.(jpg|jpeg|png|gif|webp)$/i) || media.startsWith('http')) {
        return `<img src="${escapeHtml(media)}" class="w-16 h-16 object-cover rounded ml-2" alt="media">`;
    }
    return '';
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
    if (!confirm('Delete this template?')) return;
    fetch(`/api/templates/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(() => loadTemplates());
}
function previewTemplate(id) {
    const t = templates.find(t => t.id === id);
    if (!t) return;
    templatePreviewModal.classList.remove('hidden');
    templatePreviewContent.innerHTML = renderTemplatePreview(t);
}
function closeTemplatePreviewFn() {
    templatePreviewModal.classList.add('hidden');
}
function renderTemplatePreview(t) {
    // WhatsApp-style preview
    return `
      <div class="bg-gray-100 rounded-lg p-4 flex flex-col gap-2">
        <div class="flex items-center gap-2 mb-2">
          <div class="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white font-bold">T</div>
          <div class="font-semibold">${escapeHtml(t.name)}</div>
        </div>
        <div class="bg-white rounded-lg p-3 shadow text-gray-800 whitespace-pre-line">${escapeHtml(t.text)}</div>
        ${t.media ? `<img src="${escapeHtml(t.media)}" class="rounded-lg max-h-48 mt-2" alt="media">` : ''}
      </div>
    `;
}
function escapeHtml(str) {
    return String(str).replace(/[&<>'"]/g, function (c) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c];
    });
} 

function populateTemplateSelect() {
    fetch('/api/templates')
        .then(res => res.json())
        .then(data => {
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

function renderMessagePreviewWithMediaUrl(mediaUrl) {
    const previewArea = document.getElementById('message-preview-area');
    const messageText = document.getElementById('message-text').value;
    let html = '';
    if (mediaUrl) {
        html += `<img src='${mediaUrl}' class='media-preview mb-2' alt='Preview'>`;
    }
    if (messageText) {
        html += `<div class='border rounded p-2'>${escapeHtml(messageText).replace(/\n/g, '<br>')}</div>`;
    }
    previewArea.innerHTML = html || '<div class="text-muted">Message preview will appear here</div>';
} 

function handleBulkImport(e) {
    e.preventDefault();
    bulkImportErrors.textContent = '';
    const file = bulkCsvInput.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('csv', file);
    fetch('/api/bulk/import', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.errors > 0) {
            bulkImportErrors.textContent = `${data.errors} record(s) were not imported due to missing or invalid fields.`;
        } else {
            bulkImportErrors.textContent = '';
        }
        bulkCsvInput.value = '';
        loadBulkImports();
        loadBulkImportFilenames();
    })
    .catch(err => {
        bulkImportErrors.textContent = 'Import failed: ' + err.message;
    });
}

function loadBulkImports() {
    let url = `/api/bulk?page=${bulkPage}&limit=${bulkLimit}`;
    if (bulkCurrentImport) url += `&import_filename=${encodeURIComponent(bulkCurrentImport)}`;
    fetch(url)
        .then(res => res.json())
        .then(data => {
            bulkRecords = data.records;
            bulkTotal = data.total;
            renderBulkList();
        });
}

function renderBulkList() {
    if (!bulkList) return;
    if (!bulkRecords || bulkRecords.length === 0) {
        bulkList.innerHTML = '<tr><td colspan="9" class="text-center text-gray-400 py-4">No records found.</td></tr>';
        bulkPageInfo.textContent = '';
        return;
    }
    bulkList.innerHTML = '';
    bulkRecords.forEach((r, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-2 py-1 text-xs">${(bulkPage - 1) * bulkLimit + i + 1}</td>
            <td class="px-2 py-1 text-xs">${escapeHtml(r.number)}</td>
            <td class="px-2 py-1 text-xs truncate max-w-xs" title="${escapeHtml(r.message)}">${escapeHtml(r.message).slice(0, 80)}${r.message.length > 80 ? '…' : ''}</td>
            <td class="px-2 py-1 text-xs">${r.media ? `<a href='${escapeHtml(r.media)}' target='_blank' class='text-green-600 underline'>Media</a>` : ''}</td>
            <td class="px-2 py-1 text-xs">${escapeHtml(r.send_datetime)}</td>
            <td class="px-2 py-1 text-xs">${escapeHtml(r.import_filename)}</td>
            <td class="px-2 py-1 text-xs">${renderBulkStatus(r.status)}</td>
            <td class="px-2 py-1 text-xs">${escapeHtml(r.sent_datetime || '')}</td>
            <td class="px-2 py-1 text-xs">
                <button class="test-bulk-btn bg-blue-600 text-white px-2 py-1 rounded text-xs" data-uid="${r.unique_id}">Test</button>
            </td>
        `;
        bulkList.appendChild(tr);
    });
    const start = (bulkPage - 1) * bulkLimit + 1;
    const end = Math.min(bulkPage * bulkLimit, bulkTotal);
    bulkPageInfo.textContent = `Showing ${start}-${end} of ${bulkTotal}`;
    // Add event listeners for Test buttons
    bulkList.querySelectorAll('.test-bulk-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const uid = this.getAttribute('data-uid');
            showBulkTestOptions(this, uid);
        });
    });
}

function renderBulkStatus(status) {
    if (status === 'pending') return '<span class="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs">Pending</span>';
    if (status === 'sent') return '<span class="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs">Sent</span>';
    if (status === 'canceled') return '<span class="bg-gray-200 text-gray-600 px-2 py-0.5 rounded text-xs">Canceled</span>';
    return escapeHtml(status);
}

function loadBulkImportFilenames() {
    fetch('/api/bulk?page=1&limit=10000')
        .then(res => res.json())
        .then(data => {
            const filenames = Array.from(new Set(data.records.map(r => r.import_filename)));
            bulkImportFilter.innerHTML = '<option value="">-- All --</option>';
            filenames.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f;
                opt.textContent = f;
                bulkImportFilter.appendChild(opt);
            });
        });
}

function handleBulkDelete() {
    const filename = bulkImportFilter.value;
    if (!filename) return alert('Select an import filename to delete.');
    if (!confirm('Delete all records for this import?')) return;
    fetch(`/api/bulk/${encodeURIComponent(filename)}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(() => {
            loadBulkImports();
            loadBulkImportFilenames();
        });
}

function handleBulkCancel() {
    const filename = bulkImportFilter.value;
    if (!filename) return alert('Select an import filename to cancel.');
    if (!confirm('Cancel all pending records for this import?')) return;
    fetch(`/api/bulk/cancel/${encodeURIComponent(filename)}`, { method: 'POST' })
        .then(res => res.json())
        .then(() => {
            loadBulkImports();
            loadBulkImportFilenames();
        });
} 

function populateChatTemplateSelect() {
    console.log('[DEBUG] populateChatTemplateSelect called');
    if (!chatTemplateSelect) {
        console.warn('[DEBUG] chatTemplateSelect element not found');
        return;
    }
    fetch('/api/templates')
        .then(res => res.json())
        .then(data => {
            console.log('[DEBUG] Templates fetched for chat:', data);
            chatTemplateSelect.innerHTML = '<option value="">-- Template --</option>';
            data.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                chatTemplateSelect.appendChild(opt);
            });
            window.chatTabTemplates = data;
        });
}

function handleChatTemplateSelectChange() {
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
    // Use the same logic as showSendTabMediaPreview
    const container = document.getElementById('media-preview-container');
    const img = document.getElementById('image-preview');
    const vid = document.getElementById('video-preview');
    const fileDiv = document.getElementById('file-preview');
    const fileName = document.getElementById('file-name');
    container.classList.remove('d-none');
    img.classList.add('d-none');
    vid.classList.add('d-none');
    fileDiv.classList.add('d-none');
    if (mediaPath.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        img.src = mediaPath;
        img.classList.remove('d-none');
    } else if (mediaPath.match(/\.(mp4|webm|ogg)$/i)) {
        vid.src = mediaPath;
        vid.classList.remove('d-none');
    } else if (mediaPath.match(/\.pdf$/i)) {
        fileDiv.classList.remove('d-none');
        fileName.textContent = mediaPath.split('/').pop();
    }
}
function clearChatTabMediaPreview() {
    const container = document.getElementById('media-preview-container');
    const img = document.getElementById('image-preview');
    const vid = document.getElementById('video-preview');
    const fileDiv = document.getElementById('file-preview');
    const fileName = document.getElementById('file-name');
    img.src = '';
    vid.src = '';
    fileName.textContent = '';
    img.classList.add('d-none');
    vid.classList.add('d-none');
    fileDiv.classList.add('d-none');
    container.classList.add('d-none');
} 

// --- Sent Messages Log Pagination ---
let sentMessagesPage = 1;
const sentMessagesPerPage = 100;

function loadSentMessagesLog() {
    fetch('/api/sent-messages')
        .then(res => res.json())
        .then(data => renderSentMessagesLog(data));
}

function renderSentMessagesLog(logs) {
    if (!sentMessagesTable) return;
    if (!logs || logs.length === 0) {
        sentMessagesTable.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400">No sent messages yet.</td></tr>';
        renderSentMessagesPagination(0, 0);
        return;
    }
    const start = (sentMessagesPage - 1) * sentMessagesPerPage;
    const end = Math.min(start + sentMessagesPerPage, logs.length);
    const pageLogs = logs.slice(start, end);
    sentMessagesTable.innerHTML = '';
    pageLogs.forEach((msg, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><a href="#" class="text-green-700 hover:underline" data-phone="${escapeHtml(msg.to)}">${escapeHtml(msg.to)}</a></td>
            <td>${escapeHtml(msg.message)}</td>
            <td>${msg.status === 'sent' ? '<span class="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs">Sent</span>' : escapeHtml(msg.status)}</td>
            <td>${msg.time ? new Date(msg.time).toLocaleString() : ''}</td>
            <td><button class="resend-btn text-blue-600 hover:underline text-xs" data-index="${start + i}">Resend</button></td>
        `;
        sentMessagesTable.appendChild(tr);
    });
    // Add click handlers for resend and recipient
    sentMessagesTable.querySelectorAll('.resend-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const idx = this.getAttribute('data-index');
            fetch('/api/sent-messages')
                .then(res => res.json())
                .then(logs => resendSentMessage(logs[idx]));
        });
    });
    sentMessagesTable.querySelectorAll('a[data-phone]').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const phone = this.getAttribute('data-phone');
            const input = document.getElementById('recipient-input');
            let nums = input.value.split(',').map(s => s.trim()).filter(Boolean);
            if (!nums.includes(phone)) nums.push(phone);
            input.value = nums.join(', ');
        });
    });
    renderSentMessagesPagination(logs.length, sentMessagesPage);
}

function renderSentMessagesPagination(total, page) {
    let pagination = document.getElementById('sent-messages-pagination');
    if (!pagination) {
        pagination = document.createElement('div');
        pagination.id = 'sent-messages-pagination';
        pagination.className = 'flex justify-between items-center mt-2';
        sentMessagesTable.parentElement.appendChild(pagination);
    }
    if (total <= sentMessagesPerPage) {
        pagination.innerHTML = '';
        return;
    }
    const totalPages = Math.ceil(total / sentMessagesPerPage);
    pagination.innerHTML = `
        <button id="sent-messages-prev" class="px-2 py-1 border rounded text-xs" ${page === 1 ? 'disabled' : ''}>Prev</button>
        <span class="text-xs">Page ${page} of ${totalPages}</span>
        <button id="sent-messages-next" class="px-2 py-1 border rounded text-xs" ${page === totalPages ? 'disabled' : ''}>Next</button>
    `;
    document.getElementById('sent-messages-prev').onclick = () => {
        if (sentMessagesPage > 1) {
            sentMessagesPage--;
            loadSentMessagesLog();
        }
    };
    document.getElementById('sent-messages-next').onclick = () => {
        if (sentMessagesPage < totalPages) {
            sentMessagesPage++;
            loadSentMessagesLog();
        }
    };
}

// --- Fix Chat Template Dropdown ---
function robustPopulateChatTemplateSelect(attempt = 0) {
    const maxAttempts = 5;
    const delay = 100;
    const el = document.getElementById('chat-template-select');
    if (!el) {
        if (attempt < maxAttempts) {
            setTimeout(() => robustPopulateChatTemplateSelect(attempt + 1), delay);
        } else {
            console.warn('[DEBUG] chat-template-select not found after retries');
        }
        return;
    }
    fetch('/api/templates')
        .then(res => res.json())
        .then(data => {
            el.innerHTML = '<option value="">-- Template --</option>';
            data.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                el.appendChild(opt);
            });
            window.chatTabTemplates = data;
        });
}
// On DOMContentLoaded, on Chats tab click, and after chat select
if (document.getElementById('chats-tab')) {
    document.addEventListener('DOMContentLoaded', () => robustPopulateChatTemplateSelect());
    document.getElementById('chats-tab').addEventListener('click', () => robustPopulateChatTemplateSelect());
}
const originalSelectChat = selectChat;
selectChat = function(chatId) {
    originalSelectChat.apply(this, arguments);
    robustPopulateChatTemplateSelect();
};

function resendSentMessage(msg) {
    // Reuse the send message API
    const formData = new FormData();
    formData.append('number', msg.to);
    formData.append('message', msg.message);
    // Media resend not supported in this UI (could be added)
    fetch('/api/messages/send', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(() => loadSentMessagesLog());
} 

// Unified preview logic for both template and send message media
function showTemplateMediaPreview(mediaPath) {
    templateMediaPreview.innerHTML = '';
    if (!mediaPath) return;
    if (mediaPath.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        templateMediaPreview.innerHTML = `<img src="${mediaPath}" class="w-32 h-32 object-contain rounded border mx-auto" alt="media">`;
    } else if (mediaPath.match(/\.(mp4|webm|ogg)$/i)) {
        templateMediaPreview.innerHTML = `<video src="${mediaPath}" class="w-32 h-32 object-contain rounded border mx-auto" controls></video>`;
    } else if (mediaPath.match(/\.pdf$/i)) {
        templateMediaPreview.innerHTML = `<a href="${mediaPath}" target="_blank" class="text-green-700 underline">View PDF</a>`;
    }
}
function showSendTabMediaPreview(mediaPath) {
    const container = document.getElementById('media-preview-container');
    const img = document.getElementById('image-preview');
    const vid = document.getElementById('video-preview');
    const fileDiv = document.getElementById('file-preview');
    const fileName = document.getElementById('file-name');
    container.classList.remove('d-none');
    img.classList.add('d-none');
    vid.classList.add('d-none');
    fileDiv.classList.add('d-none');
    if (mediaPath.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        img.src = mediaPath;
        img.classList.remove('d-none');
    } else if (mediaPath.match(/\.(mp4|webm|ogg)$/i)) {
        vid.src = mediaPath;
        vid.classList.remove('d-none');
    } else if (mediaPath.match(/\.pdf$/i)) {
        fileDiv.classList.remove('d-none');
        fileName.textContent = mediaPath.split('/').pop();
    }
}
function clearSendTabMediaPreview() {
    const container = document.getElementById('media-preview-container');
    const img = document.getElementById('image-preview');
    const vid = document.getElementById('video-preview');
    const fileDiv = document.getElementById('file-preview');
    const fileName = document.getElementById('file-name');
    img.src = '';
    vid.src = '';
    fileName.textContent = '';
    img.classList.add('d-none');
    vid.classList.add('d-none');
    fileDiv.classList.add('d-none');
    container.classList.add('d-none');
} 

// Modal/dropdown for Test options
let bulkTestDropdown;
function showBulkTestOptions(btn, uid) {
    if (bulkTestDropdown) bulkTestDropdown.remove();
    bulkTestDropdown = document.createElement('div');
    bulkTestDropdown.className = 'absolute z-50 bg-white border rounded shadow p-2 flex flex-col gap-1';
    bulkTestDropdown.style.minWidth = '120px';
    // Find the record to check status
    const record = bulkRecords.find(r => r.unique_id === uid);
    const isSent = record && record.status === 'sent';
    bulkTestDropdown.innerHTML = `
        <button class="send-now-btn text-green-700 hover:underline text-xs py-1" ${isSent ? 'disabled' : ''}>Send Now</button>
        <button class="send-in-1min-btn text-blue-700 hover:underline text-xs py-1">Send in 1 min</button>
        <button class="close-bulk-test-btn text-gray-500 hover:underline text-xs py-1">Cancel</button>
    `;
    document.body.appendChild(bulkTestDropdown);
    const rect = btn.getBoundingClientRect();
    bulkTestDropdown.style.left = `${rect.left + window.scrollX}px`;
    bulkTestDropdown.style.top = `${rect.bottom + window.scrollY}px`;
    // Handlers
    bulkTestDropdown.querySelector('.send-now-btn').onclick = () => {
        if (isSent) {
            alert('Already sent. Please reschedule to test again.');
            bulkTestDropdown.remove();
            return;
        }
        fetch(`/api/bulk/send-now/${uid}`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.error) alert('Error: ' + data.error);
                else alert('Message sent immediately.');
                loadBulkImports();
            });
        bulkTestDropdown.remove();
    };
    bulkTestDropdown.querySelector('.send-in-1min-btn').onclick = () => {
        fetch(`/api/bulk/schedule/${uid}`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.error) alert('Error: ' + data.error);
                else alert('Message scheduled for 1 min from now.');
                loadBulkImports();
            });
        bulkTestDropdown.remove();
    };
    bulkTestDropdown.querySelector('.close-bulk-test-btn').onclick = () => {
        bulkTestDropdown.remove();
    };
    // Remove dropdown if clicking elsewhere
    setTimeout(() => {
        document.addEventListener('click', closeBulkTestDropdown, { once: true });
    }, 10);
}
function closeBulkTestDropdown(e) {
    if (bulkTestDropdown) bulkTestDropdown.remove();
} 