// --- Backup Tab Logic ---
// Helper function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const backupChatType = document.getElementById('backup-chat-type');
const backupChatSelect = document.getElementById('backup-chat-select');
const backupChatId = document.getElementById('backup-chat-id');
const backupAddForm = document.getElementById('backup-add-form');
const backupListContainer = document.getElementById('backup-list-container');
const backupListTab = document.getElementById('backup-list-tab');
const backupPeopleTab = document.getElementById('backup-people-tab');
const backupListView = document.getElementById('backup-list-view');
const backupPeopleView = document.getElementById('backup-people-view');
const backupPeopleContainer = document.getElementById('backup-people-container');
const backupAddAllContactsBtn = document.getElementById('backup-add-all-contacts-btn');
const backupMessagesModal = document.getElementById('backup-messages-modal');
const backupMessagesContent = document.getElementById('backup-messages-content');
const backupMessagesTitle = document.getElementById('backup-messages-title');
const backupMessagesClose = document.getElementById('backup-messages-close');
const backupMessagesPrev = document.getElementById('backup-messages-prev');
const backupMessagesNext = document.getElementById('backup-messages-next');
const backupMessagesPageInfo = document.getElementById('backup-messages-page-info');

// Backup state
let currentBackupChatId = null;
let currentBackupPage = 1;
let currentBackupTotalPages = 1;

// Initialize backup functionality
function initializeBackup() {
    // Setup chat type change handler
    if (backupChatType) {
        backupChatType.addEventListener('change', () => {
            populateBackupChatSelect();
        });
    }
    
    // Setup form submission
    if (backupAddForm) {
        backupAddForm.addEventListener('submit', handleAddBackup);
    }
    
    // Setup tab switching
    if (backupListTab) {
        backupListTab.addEventListener('click', () => {
            switchBackupTab('list');
        });
    }
    
    if (backupPeopleTab) {
        backupPeopleTab.addEventListener('click', () => {
            switchBackupTab('people');
        });
    }
    
    // Setup modal close
    if (backupMessagesClose) {
        backupMessagesClose.addEventListener('click', () => {
            backupMessagesModal.classList.add('hidden');
        });
    }
    
    // Setup pagination
    if (backupMessagesPrev) {
        backupMessagesPrev.addEventListener('click', () => {
            if (currentBackupPage > 1) {
                currentBackupPage--;
                loadBackupMessages(currentBackupChatId, currentBackupPage);
            }
        });
    }
    
    if (backupMessagesNext) {
        backupMessagesNext.addEventListener('click', () => {
            if (currentBackupPage < currentBackupTotalPages) {
                currentBackupPage++;
                loadBackupMessages(currentBackupChatId, currentBackupPage);
            }
        });
    }
    
    // Setup add all contacts button
    if (backupAddAllContactsBtn) {
        backupAddAllContactsBtn.addEventListener('click', handleAddAllContacts);
    }
    
    // Load backup list when tab is clicked
    const backupTab = document.getElementById('backup-tab');
    if (backupTab) {
        backupTab.addEventListener('click', () => {
            loadBackupList();
        });
    }
    
    // Load backup list when backup tab becomes visible
    const backupPane = document.getElementById('backup');
    if (backupPane) {
        // Use MutationObserver to watch for class changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const isVisible = !backupPane.classList.contains('hidden');
                    if (isVisible) {
                        loadBackupList();
                    }
                }
            });
        });
        
        observer.observe(backupPane, {
            attributes: true,
            attributeFilter: ['class']
        });
    }
    
    // Load backup list on page load if backup tab is active
    // Check URL hash first
    if (window.location.hash === '#backup') {
        // Small delay to ensure DOM is ready and tab switching is complete
        setTimeout(() => {
            loadBackupList();
        }, 200);
    } else {
        // Also check if backup pane is visible (in case hash wasn't set but tab is active)
        if (backupPane && !backupPane.classList.contains('hidden')) {
            setTimeout(() => {
                loadBackupList();
            }, 200);
        }
    }
    
    // Listen for hash changes to load backup list when navigating to backup tab
    window.addEventListener('hashchange', () => {
        if (window.location.hash === '#backup') {
            setTimeout(() => {
                loadBackupList();
            }, 100);
        }
    });
}

// Populate chat select dropdown based on type
async function populateBackupChatSelect() {
    if (!backupChatSelect || !backupChatType) return;
    
    const chatType = backupChatType.value;
    if (!chatType) {
        backupChatSelect.innerHTML = '<option value="">-- Select Chat --</option>';
        backupChatId.value = '';
        return;
    }
    
    backupChatSelect.innerHTML = '<option value="">Loading...</option>';
    backupChatSelect.disabled = true;
    
    try {
        let chatList = [];
        
        if (chatType === 'private' || chatType === 'group') {
            // Get chats from main.js (chats tab) - use existing data
            if (typeof window.chats !== 'undefined' && Array.isArray(window.chats) && window.chats.length > 0) {
                chatList = window.chats.filter(chat => {
                    if (chatType === 'private') {
                        return !chat.isGroup;
                    } else if (chatType === 'group') {
                        return chat.isGroup;
                    }
                    return false;
                }).map(chat => ({
                    id: chat.id,
                    name: chat.name || chat.id,
                    timestamp: chat.timestamp || 0,
                    unreadCount: chat.unreadCount || 0
                }));
            } else {
                // Fallback: Try to load chats if not available
                try {
                    const response = await fetch('/api/chats');
                    const chats = await response.json();
                    window.chats = chats; // Cache for future use
                    chatList = chats.filter(chat => {
                        if (chatType === 'private') {
                            return !chat.isGroup;
                        } else if (chatType === 'group') {
                            return chat.isGroup;
                        }
                        return false;
                    }).map(chat => ({
                        id: chat.id,
                        name: chat.name || chat.id,
                        timestamp: chat.timestamp || 0,
                        unreadCount: chat.unreadCount || 0
                    }));
                } catch (err) {
                    console.error('[BACKUP] Failed to load chats:', err);
                    backupChatSelect.innerHTML = '<option value="">Error loading chats</option>';
                    backupChatSelect.disabled = false;
                    return;
                }
            }
        } else if (chatType === 'channel') {
            // Use API endpoint which uses detected_channels.json
            try {
                const response = await fetch('/api/backup/chats?type=channel');
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const data = await response.json();
                if (data.chats && Array.isArray(data.chats) && data.chats.length > 0) {
                    chatList = data.chats.map(channel => ({
                        id: channel.id,
                        name: channel.name || channel.id,
                        timestamp: 0 // Channels from detected_channels.json may not have timestamp
                    }));
                } else {
                    console.warn('[BACKUP] No channels in API response');
                    chatList = [];
                }
            } catch (err) {
                console.error('[BACKUP] Failed to load channels:', err);
                backupChatSelect.innerHTML = '<option value="">Error loading channels: ' + err.message + '</option>';
                backupChatSelect.disabled = false;
                return;
            }
        }
        
        backupChatSelect.innerHTML = '<option value="">-- Select Chat --</option>';
        
        if (chatList.length > 0) {
            // Sort by timestamp (most recent first), then by unread count, then by name
            chatList.sort((a, b) => {
                // First sort by timestamp (most recent first)
                if (a.timestamp && b.timestamp) {
                    if (b.timestamp !== a.timestamp) {
                        return b.timestamp - a.timestamp;
                    }
                } else if (a.timestamp && !b.timestamp) {
                    return -1;
                } else if (!a.timestamp && b.timestamp) {
                    return 1;
                }
                
                // Then by unread count (if available)
                if (a.unreadCount !== undefined && b.unreadCount !== undefined) {
                    if (b.unreadCount !== a.unreadCount) {
                        return b.unreadCount - a.unreadCount;
                    }
                }
                
                // Finally by name (alphabetically)
                const nameA = (a.name || a.id || '').toLowerCase();
                const nameB = (b.name || b.id || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });
            
            chatList.forEach(chat => {
                const option = document.createElement('option');
                option.value = chat.id;
                option.textContent = chat.name || chat.id;
                option.dataset.chatId = chat.id;
                backupChatSelect.appendChild(option);
            });
        } else {
            backupChatSelect.innerHTML = '<option value="">No chats found</option>';
        }
    } catch (error) {
        console.error('[BACKUP] Failed to populate chat select:', error);
        backupChatSelect.innerHTML = '<option value="">Error loading chats</option>';
    } finally {
        backupChatSelect.disabled = false;
    }
}

// Handle chat select change
if (backupChatSelect) {
    backupChatSelect.addEventListener('change', () => {
        backupChatId.value = backupChatSelect.value;
    });
}

// Handle add backup form submission
async function handleAddBackup(event) {
    event.preventDefault();
    
    const chatType = backupChatType.value;
    const chatId = backupChatSelect.value;
    const chatName = backupChatSelect.options[backupChatSelect.selectedIndex]?.textContent;
    
    if (!chatType || !chatId || !chatName) {
        alert('Please select a chat type and chat name');
        return;
    }
    
    try {
        const response = await fetch('/api/backup/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chatType,
                chatName,
                chatId
            })
        });
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.error('[BACKUP] Server returned non-JSON response:', text.substring(0, 200));
            alert('Server error: Received HTML instead of JSON. Check console for details.');
            return;
        }
        
        const data = await response.json();
        
        if (!response.ok) {
            alert('Failed to add chat to backup: ' + (data.error || data.message || `HTTP ${response.status}`));
            return;
        }
        
        if (data.success) {
            alert(`Chat added to backup list successfully!`);
            backupAddForm.reset();
            backupChatSelect.innerHTML = '<option value="">-- Select Chat --</option>';
            backupChatId.value = '';
            loadBackupList(); // Reload to show the new entry immediately
        } else {
            alert('Failed to add chat to backup: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('[BACKUP] Failed to add backup:', error);
        alert('Failed to add chat to backup: ' + error.message);
    }
}

// Load backup list
async function loadBackupList() {
    if (!backupListContainer) return;
    
    try {
        const response = await fetch('/api/backup/list');
        const data = await response.json();
        
        if (!data.backups || data.backups.length === 0) {
            backupListContainer.innerHTML = '<div class="text-center text-gray-500 py-8">No backups found. Add a chat to start backing up.</div>';
            return;
        }
        
        backupListContainer.innerHTML = data.backups.map(backup => {
            const lastMessage = backup.lastMessage || {};
            const lastMessageTime = lastMessage.timestamp ? new Date(lastMessage.timestamp * 1000).toLocaleString() : 'N/A';
            const lastBackupTime = backup.lastBackup ? new Date(backup.lastBackup).toLocaleString() : 'Never';
            const typeBadge = backup.chatType === 'private' ? 
                '<span class="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">Private</span>' :
                backup.chatType === 'group' ?
                '<span class="inline-block bg-green-100 text-green-800 px-2 py-1 rounded text-xs">Group</span>' :
                '<span class="inline-block bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs">Channel</span>';
            
            return `
                <div class="p-4 bg-white rounded-lg border hover:shadow-md transition-shadow" data-chat-id="${backup.chatId}">
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <h3 class="font-semibold text-gray-900">${escapeHtml(backup.chatName)}</h3>
                                ${typeBadge}
                            </div>
                            <div class="text-sm text-gray-600">
                                <div>Messages: ${backup.messageCount || 0} | People: ${backup.peopleCount || 0}</div>
                                <div>Last backup: ${lastBackupTime}</div>
                            </div>
                        </div>
                        <button class="backup-now-btn ml-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm" data-chat-id="${backup.chatId}" data-chat-name="${escapeHtml(backup.chatName)}">
                            Backup Now
                        </button>
                    </div>
                    <div class="backup-progress-container mt-3 hidden" data-chat-id="${backup.chatId}">
                        <div class="bg-gray-50 rounded p-3 max-h-48 overflow-y-auto">
                            <div class="text-xs font-semibold text-gray-700 mb-2">Backup Progress:</div>
                            <div class="backup-progress-logs text-xs font-mono space-y-1" data-chat-id="${backup.chatId}">
                                <div class="text-gray-500">Waiting for backup to start...</div>
                            </div>
                        </div>
                    </div>
                    ${lastMessage.body ? `
                        <div class="mt-3 p-2 bg-gray-50 rounded text-sm">
                            <div class="text-xs text-gray-500 mb-1">Last message (${lastMessageTime}):</div>
                            <div class="text-gray-700">${escapeHtml(lastMessage.body.substring(0, 100))}${lastMessage.body.length > 100 ? '...' : ''}</div>
                            <div class="text-xs text-gray-500 mt-1">From: ${escapeHtml(lastMessage.senderName || 'You')}</div>
                        </div>
                    ` : ''}
                    <div class="mt-3 flex gap-2">
                        <button class="view-backup-messages-btn bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700" data-chat-id="${backup.chatId}" data-chat-name="${escapeHtml(backup.chatName)}">
                            View Messages
                        </button>
                        ${backup.chatType === 'group' ? `
                            <button class="view-backup-people-btn bg-purple-600 text-white px-3 py-1 rounded text-sm hover:bg-purple-700" data-chat-id="${backup.chatId}" data-chat-name="${escapeHtml(backup.chatName)}">
                                View People
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        // Add event listeners
        document.querySelectorAll('.view-backup-messages-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const chatId = e.target.dataset.chatId;
                const chatName = e.target.dataset.chatName;
                viewBackupMessages(chatId, chatName);
            });
        });
        
        document.querySelectorAll('.view-backup-people-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const chatId = e.target.dataset.chatId;
                const chatName = e.target.dataset.chatName;
                viewBackupPeople(chatId, chatName);
            });
        });
        
        // Add event listeners for Backup Now buttons
        document.querySelectorAll('.backup-now-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent triggering parent click
                const chatId = e.target.dataset.chatId;
                const chatName = e.target.dataset.chatName;
                await handleBackupNow(chatId, chatName, e.target);
            });
        });
    } catch (error) {
        console.error('[BACKUP] Failed to load backup list:', error);
        backupListContainer.innerHTML = '<div class="text-center text-red-500 py-8">Failed to load backups</div>';
    }
}

// Handle Backup Now button click
async function handleBackupNow(chatId, chatName, buttonElement) {
    if (!buttonElement) return;
    
    const originalText = buttonElement.textContent;
    buttonElement.disabled = true;
    buttonElement.textContent = 'Starting...';
    buttonElement.classList.add('opacity-50', 'cursor-not-allowed');
    
    // Show progress container
    const progressContainer = document.querySelector(`.backup-progress-container[data-chat-id="${chatId}"]`);
    const progressLogs = document.querySelector(`.backup-progress-logs[data-chat-id="${chatId}"]`);
    
    if (progressContainer) {
        progressContainer.classList.remove('hidden');
    }
    if (progressLogs) {
        progressLogs.innerHTML = '<div class="text-gray-500">Starting backup...</div>';
    }
    
    try {
        const response = await fetch(`/api/backup/${encodeURIComponent(chatId)}/backup-now`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            buttonElement.textContent = 'Backing up...';
            
            // Start polling for progress
            const progressInterval = setInterval(async () => {
                try {
                    const progressResponse = await fetch(`/api/backup/${encodeURIComponent(chatId)}/progress`);
                    const progressData = await progressResponse.json();
                    
                    if (progressLogs && progressData.logs) {
                        progressLogs.innerHTML = progressData.logs.map(log => {
                            const time = new Date(log.timestamp).toLocaleTimeString();
                            const isError = log.message.includes('ERROR:');
                            return `<div class="${isError ? 'text-red-600' : 'text-gray-700'}">[${time}] ${escapeHtml(log.message)}</div>`;
                        }).join('');
                        // Scroll to bottom
                        progressLogs.scrollTop = progressLogs.scrollHeight;
                    }
                    
                    if (progressData.status === 'completed') {
                        clearInterval(progressInterval);
                        buttonElement.textContent = 'Backup Complete!';
                        buttonElement.classList.remove('bg-blue-600', 'hover:bg-blue-700');
                        buttonElement.classList.add('bg-green-600');
                        buttonElement.disabled = false;
                        
                        // Reload backup list to show updated data
                        setTimeout(() => {
                            loadBackupList();
                        }, 1000);
                    } else if (progressData.status === 'failed') {
                        clearInterval(progressInterval);
                        buttonElement.textContent = 'Backup Failed';
                        buttonElement.classList.remove('bg-blue-600', 'hover:bg-blue-700');
                        buttonElement.classList.add('bg-red-600');
                        buttonElement.disabled = false;
                    }
                } catch (err) {
                    console.error('[BACKUP] Progress poll error:', err);
                }
            }, 1000); // Poll every second
            
            // Stop polling after 6 minutes (timeout + buffer)
            setTimeout(() => {
                clearInterval(progressInterval);
            }, 360000);
            
        } else {
            buttonElement.textContent = 'Backup Failed';
            buttonElement.classList.remove('bg-blue-600', 'hover:bg-blue-700');
            buttonElement.classList.add('bg-red-600');
            buttonElement.disabled = false;
            if (progressLogs) {
                progressLogs.innerHTML += `<div class="text-red-600">ERROR: ${escapeHtml(data.error || data.details || 'Unknown error')}</div>`;
            }
        }
    } catch (error) {
        console.error('[BACKUP] Backup now error:', error);
        buttonElement.textContent = 'Backup Failed';
        buttonElement.classList.remove('bg-blue-600', 'hover:bg-blue-700');
        buttonElement.classList.add('bg-red-600');
        buttonElement.disabled = false;
        if (progressLogs) {
            progressLogs.innerHTML += `<div class="text-red-600">ERROR: ${escapeHtml(error.message)}</div>`;
        }
    }
}

// View backup messages
async function viewBackupMessages(chatId, chatName) {
    currentBackupChatId = chatId;
    currentBackupPage = 1;
    
    if (backupMessagesTitle) {
        backupMessagesTitle.textContent = `Messages: ${chatName}`;
    }
    
    if (backupMessagesModal) {
        backupMessagesModal.classList.remove('hidden');
    }
    
    await loadBackupMessages(chatId, 1);
}

// Load backup messages with pagination
async function loadBackupMessages(chatId, page = 1) {
    if (!backupMessagesContent) return;
    
    backupMessagesContent.innerHTML = '<div class="text-center text-gray-500 py-8">Loading messages...</div>';
    
    try {
        const response = await fetch(`/api/backup/${encodeURIComponent(chatId)}/messages?page=${page}&pageSize=100`);
        const data = await response.json();
        
        currentBackupPage = data.page;
        currentBackupTotalPages = data.totalPages;
        
        // Update pagination controls
        if (backupMessagesPrev) {
            backupMessagesPrev.disabled = currentBackupPage <= 1;
        }
        if (backupMessagesNext) {
            backupMessagesNext.disabled = currentBackupPage >= currentBackupTotalPages;
        }
        if (backupMessagesPageInfo) {
            backupMessagesPageInfo.textContent = `Page ${currentBackupPage} of ${currentBackupTotalPages} (${data.total} total)`;
        }
        
        if (!data.messages || data.messages.length === 0) {
            backupMessagesContent.innerHTML = '<div class="text-center text-gray-500 py-8">No messages found</div>';
            return;
        }
        
        // Render messages in WhatsApp-like UI
        backupMessagesContent.innerHTML = data.messages.map(msg => {
            const isFromMe = msg.fromMe;
            const timestamp = new Date(msg.timestamp * 1000).toLocaleString();
            const senderInfo = msg.senderName ? `<div class="text-xs text-gray-500 mb-1">${escapeHtml(msg.senderName)}</div>` : '';
            
            return `
                <div class="mb-4 flex ${isFromMe ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${isFromMe ? 'bg-green-500 text-white' : 'bg-white border'}">
                        ${!isFromMe ? senderInfo : ''}
                        <div class="text-sm">${escapeHtml(msg.body || '(media)')}</div>
                        <div class="text-xs ${isFromMe ? 'text-green-100' : 'text-gray-500'} mt-1">${timestamp}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('[BACKUP] Failed to load messages:', error);
        backupMessagesContent.innerHTML = '<div class="text-center text-red-500 py-8">Failed to load messages</div>';
    }
}

// View backup people
async function viewBackupPeople(chatId, chatName) {
    currentBackupChatId = chatId;
    
    // Switch to people tab
    switchBackupTab('people');
    
    if (!backupPeopleContainer) return;
    
    backupPeopleContainer.innerHTML = '<div class="text-center text-gray-500 py-8">Loading people...</div>';
    
    try {
        const response = await fetch(`/api/backup/${encodeURIComponent(chatId)}/people`);
        const data = await response.json();
        
        if (!data.people || data.people.length === 0) {
            backupPeopleContainer.innerHTML = '<div class="text-center text-gray-500 py-8">No people found in this backup</div>';
            return;
        }
        
        // Update people count
        const peopleCountEl = document.getElementById('backup-people-count');
        if (peopleCountEl) {
            peopleCountEl.textContent = `${data.people.length} people`;
        }
        
        // Store chat name for add contacts
        if (backupAddAllContactsBtn) {
            backupAddAllContactsBtn.dataset.chatName = chatName;
        }
        
        // Render people list - compact one row per record
        backupPeopleContainer.innerHTML = data.people.map(person => {
            return `
                <div class="px-3 py-2 bg-white border-b border-gray-200 flex items-center justify-between hover:bg-gray-50">
                    <div class="flex-1 flex items-center gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="text-sm font-medium text-gray-900 truncate">${escapeHtml(person.name || 'Unknown')}</div>
                        </div>
                        <div class="text-xs text-gray-500 font-mono">${escapeHtml(person.number)}</div>
                        <div class="text-xs text-gray-400 w-16 text-right">${person.messageCount || 0} msgs</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('[BACKUP] Failed to load people:', error);
        backupPeopleContainer.innerHTML = '<div class="text-center text-red-500 py-8">Failed to load people</div>';
    }
}

// Switch between backup tabs
function switchBackupTab(tab) {
    if (tab === 'list') {
        if (backupListTab) {
            backupListTab.classList.add('border-green-600', 'font-semibold', 'text-green-700');
            backupListTab.classList.remove('text-gray-600');
        }
        if (backupPeopleTab) {
            backupPeopleTab.classList.remove('border-green-600', 'font-semibold', 'text-green-700');
            backupPeopleTab.classList.add('text-gray-600');
        }
        if (backupListView) backupListView.classList.remove('hidden');
        if (backupPeopleView) backupPeopleView.classList.add('hidden');
    } else if (tab === 'people') {
        if (backupPeopleTab) {
            backupPeopleTab.classList.add('border-green-600', 'font-semibold', 'text-green-700');
            backupPeopleTab.classList.remove('text-gray-600');
        }
        if (backupListTab) {
            backupListTab.classList.remove('border-green-600', 'font-semibold', 'text-green-700');
            backupListTab.classList.add('text-gray-600');
        }
        if (backupPeopleView) backupPeopleView.classList.remove('hidden');
        if (backupListView) backupListView.classList.add('hidden');
    }
}

// Handle add all contacts
async function handleAddAllContacts() {
    if (!currentBackupChatId) {
        alert('Please select a backup first');
        return;
    }
    
    const chatName = backupAddAllContactsBtn?.dataset.chatName || '';
    
    if (!confirm(`Add all people from "${chatName}" to contacts?`)) {
        return;
    }
    
    if (backupAddAllContactsBtn) {
        backupAddAllContactsBtn.disabled = true;
        backupAddAllContactsBtn.textContent = 'Adding...';
    }
    
    try {
        const response = await fetch(`/api/backup/${encodeURIComponent(currentBackupChatId)}/add-contacts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                groupName: chatName
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`Contacts added successfully!\nAdded: ${data.results.added}\nUpdated: ${data.results.updated}\nSkipped: ${data.results.skipped}${data.results.errors.length > 0 ? `\nErrors: ${data.results.errors.length}` : ''}`);
        } else {
            alert('Failed to add contacts: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('[BACKUP] Failed to add contacts:', error);
        alert('Failed to add contacts: ' + error.message);
    } finally {
        if (backupAddAllContactsBtn) {
            backupAddAllContactsBtn.disabled = false;
            backupAddAllContactsBtn.textContent = 'Add All to Contacts';
        }
    }
}

// HTML escape utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeBackup);
} else {
    initializeBackup();
}

