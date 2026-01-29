// Queue Management Module
// Handles Cloudflare message queue display, clearing, and history

// State
let queuePendingMessages = [];
let queueHistoryMessages = [];
let queueHistoryPage = 1;
let queueHistoryTotalPages = 1;
let queueHistoryFilter = '';
let selectedQueueIds = new Set();

// DOM Elements
const queueRefreshBtn = document.getElementById('queue-refresh-btn');
const queueProcessBtn = document.getElementById('queue-process-btn');
const queueClearAllBtn = document.getElementById('queue-clear-all-btn');
const queueClearSelectedBtn = document.getElementById('queue-clear-selected-btn');
const queueSelectAll = document.getElementById('queue-select-all');
const queueExpiryHours = document.getElementById('queue-expiry-hours');
const queueRateLimit = document.getElementById('queue-rate-limit');
const queueRateInfo = document.getElementById('queue-rate-info');
const queueSaveConfigBtn = document.getElementById('queue-save-config-btn');
const queueHistoryFilter$ = document.getElementById('queue-history-filter');
const queueHistoryPrev = document.getElementById('queue-history-prev');
const queueHistoryNext = document.getElementById('queue-history-next');

// Test Queue Modal Elements
const queueTestBtn = document.getElementById('queue-test-btn');
const queueTestModal = document.getElementById('queue-test-modal');
const queueTestClose = document.getElementById('queue-test-close');
const queueTestCancel = document.getElementById('queue-test-cancel');
const queueTestForm = document.getElementById('queue-test-form');
const queueTestTo = document.getElementById('queue-test-to');
const queueTestMessage = document.getElementById('queue-test-message');
const queueTestExpiry = document.getElementById('queue-test-expiry');
const queueTestSubmit = document.getElementById('queue-test-submit');

// Current user info for test message
let currentUserNumber = null;

// Initialize queue module
function initQueueModule() {
    if (!queueRefreshBtn) return; // Queue tab not present
    
    // Event listeners
    queueRefreshBtn.addEventListener('click', loadQueueData);
    queueProcessBtn.addEventListener('click', processQueue);
    queueClearAllBtn.addEventListener('click', clearAllQueue);
    queueClearSelectedBtn.addEventListener('click', clearSelectedQueue);
    queueSelectAll.addEventListener('change', toggleSelectAll);
    queueSaveConfigBtn.addEventListener('click', saveQueueConfig);
    queueHistoryFilter$.addEventListener('change', () => {
        queueHistoryFilter = queueHistoryFilter$.value;
        queueHistoryPage = 1;
        loadQueueHistory();
    });
    queueHistoryPrev.addEventListener('click', () => {
        if (queueHistoryPage > 1) {
            queueHistoryPage--;
            loadQueueHistory();
        }
    });
    queueHistoryNext.addEventListener('click', () => {
        if (queueHistoryPage < queueHistoryTotalPages) {
            queueHistoryPage++;
            loadQueueHistory();
        }
    });
    
    // Test Queue Modal event listeners
    if (queueTestBtn) {
        queueTestBtn.addEventListener('click', openTestQueueModal);
    }
    if (queueTestClose) {
        queueTestClose.addEventListener('click', closeTestQueueModal);
    }
    if (queueTestCancel) {
        queueTestCancel.addEventListener('click', closeTestQueueModal);
    }
    if (queueTestForm) {
        queueTestForm.addEventListener('submit', handleTestQueueSubmit);
    }
    if (queueTestModal) {
        queueTestModal.addEventListener('click', (e) => {
            if (e.target === queueTestModal) {
                closeTestQueueModal();
            }
        });
    }
    
    // Load data when queue sub-tab is clicked
    const queueSubTab = document.getElementById('queue-sub-tab');
    if (queueSubTab) {
        queueSubTab.addEventListener('click', () => {
            loadQueueData();
        });
    }
    
    // Fetch current user number for test message prefill
    fetchCurrentUserNumber();
    
    console.log('[QUEUE] Module initialized');
}

// Fetch current user number from API
async function fetchCurrentUserNumber() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        if (data.status === 'ready' && data.user && data.user.id) {
            // Extract number from id (e.g., "919822218111@c.us" -> "919822218111")
            currentUserNumber = data.user.id.replace('@c.us', '');
            console.log('[QUEUE] Current user number:', currentUserNumber);
        }
    } catch (error) {
        console.error('[QUEUE] Failed to fetch user number:', error);
    }
}

// Open test queue modal
function openTestQueueModal() {
    if (!queueTestModal) return;
    
    // Pre-fill with current user's number for self-test
    if (currentUserNumber) {
        queueTestTo.value = currentUserNumber;
    }
    
    // Pre-fill with a test message
    const now = new Date();
    const timestamp = now.toLocaleString();
    queueTestMessage.value = `🧪 Queue Test Message\n\nThis is a test message sent via the Cloudflare queue system.\n\nTimestamp: ${timestamp}\n\nIf you receive this, the queue is working correctly! ✅`;
    
    // Default expiry to 1 hour for quick test
    queueTestExpiry.value = 1;
    
    queueTestModal.classList.remove('hidden');
}

// Close test queue modal
function closeTestQueueModal() {
    if (!queueTestModal) return;
    queueTestModal.classList.add('hidden');
}

// Handle test queue form submission
async function handleTestQueueSubmit(e) {
    e.preventDefault();
    
    const to = queueTestTo.value.trim();
    const message = queueTestMessage.value.trim();
    const expiryHours = parseInt(queueTestExpiry.value) || 0;
    
    if (!to) {
        showNotification('Please enter a recipient number', 'error');
        return;
    }
    
    if (!message) {
        showNotification('Please enter a message', 'error');
        return;
    }
    
    // Format the number (add @c.us if not present)
    let formattedTo = to;
    if (!formattedTo.includes('@')) {
        formattedTo = formattedTo.replace(/[^0-9]/g, '') + '@c.us';
    }
    
    try {
        queueTestSubmit.disabled = true;
        queueTestSubmit.textContent = 'Queuing...';
        
        const response = await fetch('/api/cloudflare/messages/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: formattedTo,
                message: message,
                expiresInHours: expiryHours > 0 ? expiryHours : null,
                contactName: 'Queue Test'
            })
        });
        
        const data = await response.json();
        
        if (data.success || data.id) {
            showNotification('Test message queued successfully! Check the Pending Messages table.', 'success');
            closeTestQueueModal();
            
            // Refresh the queue data to show the new message
            setTimeout(() => {
                loadQueueData();
            }, 500);
        } else {
            showNotification(data.error || 'Failed to queue test message', 'error');
        }
    } catch (error) {
        console.error('[QUEUE] Failed to queue test message:', error);
        showNotification('Failed to queue test message: ' + error.message, 'error');
    } finally {
        queueTestSubmit.disabled = false;
        queueTestSubmit.textContent = 'Queue Test Message';
    }
}

// Load all queue data (stats, pending, history)
async function loadQueueData() {
    await Promise.all([
        loadQueueStats(),
        loadPendingQueue(),
        loadQueueHistory()
    ]);
}

// Load queue statistics
async function loadQueueStats() {
    try {
        const response = await fetch('/api/cloudflare/queue/stats');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('queue-stat-pending').textContent = data.stats.pending || 0;
            document.getElementById('queue-stat-sent').textContent = data.stats.processed?.sent || 0;
            document.getElementById('queue-stat-failed').textContent = data.stats.processed?.failed || 0;
            document.getElementById('queue-stat-expired').textContent = data.stats.processed?.expired || 0;
            document.getElementById('queue-stat-rejected').textContent = data.stats.processed?.rejected || 0;
            
            // Update expiry config
            if (data.stats.expiryHours !== undefined) {
                queueExpiryHours.value = data.stats.expiryHours;
            }
            
            // Update rate limit config and status
            if (data.stats.rateLimit) {
                const rl = data.stats.rateLimit;
                if (queueRateLimit) {
                    queueRateLimit.value = rl.messagesPerMinute || 2;
                }
                if (queueRateInfo) {
                    const statusColor = rl.availableSlots > 0 ? 'bg-green-500' : 'bg-yellow-500';
                    const statusDot = queueRateInfo.parentElement.querySelector('.rounded-full');
                    if (statusDot) {
                        statusDot.className = `w-2 h-2 ${statusColor} rounded-full`;
                    }
                    
                    let statusText = `Rate: ${rl.sentInLastMinute}/${rl.messagesPerMinute} sent in last minute`;
                    if (rl.availableSlots === 0 && rl.timeUntilNextSlot > 0) {
                        const waitSec = Math.ceil(rl.timeUntilNextSlot / 1000);
                        statusText += ` (next slot in ${waitSec}s)`;
                    }
                    queueRateInfo.textContent = statusText;
                }
            }
        }
    } catch (error) {
        console.error('[QUEUE] Failed to load stats:', error);
    }
}

// Load pending queue messages
async function loadPendingQueue() {
    try {
        const response = await fetch('/api/cloudflare/queue');
        const data = await response.json();
        
        // Debug: Log the data to see what fields are returned
        console.log('[QUEUE] Pending queue data:', data);
        if (data.data && data.data.length > 0) {
            console.log('[QUEUE] First message fields:', Object.keys(data.data[0]));
            console.log('[QUEUE] First message expiresAt:', data.data[0].expiresAt);
        }
        
        const pendingList = document.getElementById('queue-pending-list');
        const emptyState = document.getElementById('queue-pending-empty');
        
        if (data.success && data.data && data.data.length > 0) {
            queuePendingMessages = data.data;
            renderPendingQueue();
            pendingList.parentElement.classList.remove('hidden');
            emptyState.classList.add('hidden');
        } else {
            queuePendingMessages = [];
            pendingList.innerHTML = '';
            pendingList.parentElement.classList.add('hidden');
            emptyState.classList.remove('hidden');
        }
        
        // Reset selection
        selectedQueueIds.clear();
        queueSelectAll.checked = false;
        updateSelectionUI();
    } catch (error) {
        console.error('[QUEUE] Failed to load pending queue:', error);
        document.getElementById('queue-pending-list').innerHTML = `
            <tr>
                <td colspan="8" class="px-3 py-4 text-center text-red-500">
                    Failed to load pending messages: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Render pending queue messages
function renderPendingQueue() {
    const pendingList = document.getElementById('queue-pending-list');
    const now = new Date();
    
    pendingList.innerHTML = queuePendingMessages.map(msg => {
        const queuedAt = msg.createdAt || msg.timestamp || msg.queuedAt;
        const queuedDate = queuedAt ? new Date(typeof queuedAt === 'number' ? queuedAt * 1000 : queuedAt) : null;
        const expiresAt = msg.expiresAt ? new Date(msg.expiresAt) : null;
        
        // Calculate age
        let ageStr = '-';
        let ageHours = 0;
        if (queuedDate) {
            const ageMs = now - queuedDate;
            const ageMinutes = Math.floor(ageMs / 60000);
            ageHours = Math.floor(ageMinutes / 60);
            if (ageHours > 0) {
                ageStr = `${ageHours}h ${ageMinutes % 60}m`;
            } else {
                ageStr = `${ageMinutes}m`;
            }
        }
        
        // Check if expired
        const isExpired = expiresAt && expiresAt < now;
        const rowClass = isExpired ? 'bg-red-50' : '';
        
        return `
            <tr class="border-b hover:bg-gray-50 ${rowClass}">
                <td class="px-3 py-2">
                    <input type="checkbox" class="queue-item-checkbox rounded" data-id="${msg.id}" ${selectedQueueIds.has(msg.id) ? 'checked' : ''}>
                </td>
                <td class="px-3 py-2 font-mono text-xs">${(msg.id || '').substring(0, 8)}...</td>
                <td class="px-3 py-2">${escapeHtml(msg.to || '-')}</td>
                <td class="px-3 py-2 max-w-xs truncate" title="${escapeHtml(msg.message || '')}">${escapeHtml((msg.message || '').substring(0, 50))}${(msg.message || '').length > 50 ? '...' : ''}</td>
                <td class="px-3 py-2">${msg.media ? '<span class="text-green-600">✓</span>' : '-'}</td>
                <td class="px-3 py-2 text-xs">${queuedDate ? formatDateTime(queuedDate) : '-'}</td>
                <td class="px-3 py-2 text-xs ${isExpired ? 'text-red-600 font-semibold' : ''}">${expiresAt ? formatDateTime(expiresAt) : 'No expiry'}</td>
                <td class="px-3 py-2 text-xs ${ageHours > 12 ? 'text-orange-600 font-semibold' : ''}">${ageStr}</td>
            </tr>
        `;
    }).join('');
    
    // Add checkbox event listeners
    pendingList.querySelectorAll('.queue-item-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const id = e.target.dataset.id;
            if (e.target.checked) {
                selectedQueueIds.add(id);
            } else {
                selectedQueueIds.delete(id);
            }
            updateSelectionUI();
        });
    });
}

// Load queue history
async function loadQueueHistory() {
    try {
        const response = await fetch(`/api/cloudflare/queue/logs?page=${queueHistoryPage}&limit=20`);
        const data = await response.json();
        
        const historyList = document.getElementById('queue-history-list');
        const emptyState = document.getElementById('queue-history-empty');
        
        if (data.success && data.data && data.data.length > 0) {
            // Filter by status if filter is set
            let filteredData = data.data;
            if (queueHistoryFilter) {
                filteredData = data.data.filter(msg => msg.status === queueHistoryFilter);
            }
            
            queueHistoryMessages = filteredData;
            queueHistoryTotalPages = data.pagination?.totalPages || 1;
            
            renderQueueHistory();
            historyList.parentElement.classList.remove('hidden');
            emptyState.classList.add('hidden');
            
            // Update pagination
            updateHistoryPagination(data.pagination);
        } else {
            queueHistoryMessages = [];
            historyList.innerHTML = '';
            historyList.parentElement.classList.add('hidden');
            emptyState.classList.remove('hidden');
        }
    } catch (error) {
        console.error('[QUEUE] Failed to load history:', error);
        document.getElementById('queue-history-list').innerHTML = `
            <tr>
                <td colspan="6" class="px-3 py-4 text-center text-red-500">
                    Failed to load history: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Render queue history
function renderQueueHistory() {
    const historyList = document.getElementById('queue-history-list');
    
    historyList.innerHTML = queueHistoryMessages.map(msg => {
        const processedAt = msg.sentAt || msg.failedAt || msg.expiredAt || msg.rejectedAt || msg.timestamp;
        const processedDate = processedAt ? new Date(processedAt) : null;
        
        const statusColors = {
            sent: 'bg-green-100 text-green-800',
            failed: 'bg-red-100 text-red-800',
            expired: 'bg-orange-100 text-orange-800',
            rejected: 'bg-purple-100 text-purple-800'
        };
        const statusColor = statusColors[msg.status] || 'bg-gray-100 text-gray-800';
        
        return `
            <tr class="border-b hover:bg-gray-50">
                <td class="px-3 py-2 font-mono text-xs">${(msg.queueId || msg.id || '').substring(0, 8)}...</td>
                <td class="px-3 py-2">${escapeHtml(msg.to || '-')}</td>
                <td class="px-3 py-2 max-w-xs truncate" title="${escapeHtml(msg.message || '')}">${escapeHtml((msg.message || '').substring(0, 40))}${(msg.message || '').length > 40 ? '...' : ''}</td>
                <td class="px-3 py-2">
                    <span class="px-2 py-1 rounded text-xs font-medium ${statusColor}">${msg.status || 'unknown'}</span>
                </td>
                <td class="px-3 py-2 text-xs">${processedDate ? formatDateTime(processedDate) : '-'}</td>
                <td class="px-3 py-2 text-xs text-red-600 max-w-xs truncate" title="${escapeHtml(msg.error || '')}">${escapeHtml((msg.error || '-').substring(0, 40))}${(msg.error || '').length > 40 ? '...' : ''}</td>
            </tr>
        `;
    }).join('');
}

// Update history pagination UI
function updateHistoryPagination(pagination) {
    const pageInfo = document.getElementById('queue-history-page-info');
    
    if (pagination) {
        pageInfo.textContent = `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} total)`;
        queueHistoryPrev.disabled = pagination.page <= 1;
        queueHistoryNext.disabled = pagination.page >= pagination.totalPages;
    } else {
        pageInfo.textContent = 'Page 1';
        queueHistoryPrev.disabled = true;
        queueHistoryNext.disabled = true;
    }
}

// Process queue manually
async function processQueue() {
    try {
        queueProcessBtn.disabled = true;
        queueProcessBtn.textContent = 'Processing...';
        
        const response = await fetch('/api/cloudflare/process-queue', {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            showNotification('Queue processed successfully', 'success');
            await loadQueueData();
        } else {
            showNotification(data.error || 'Failed to process queue', 'error');
        }
    } catch (error) {
        console.error('[QUEUE] Failed to process queue:', error);
        showNotification('Failed to process queue: ' + error.message, 'error');
    } finally {
        queueProcessBtn.disabled = false;
        queueProcessBtn.textContent = 'Process Queue';
    }
}

// Clear all queued messages
async function clearAllQueue() {
    if (!confirm('Are you sure you want to clear ALL pending messages from the queue? This cannot be undone.')) {
        return;
    }
    
    try {
        queueClearAllBtn.disabled = true;
        queueClearAllBtn.textContent = 'Clearing...';
        
        const response = await fetch('/api/cloudflare/queue/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clearAll: true })
        });
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Cleared ${data.cleared} messages from queue`, 'success');
            await loadQueueData();
        } else {
            // Show more detailed error message
            const errorMsg = data.message || data.error || 'Failed to clear queue';
            showNotification(errorMsg, 'error');
            console.error('[QUEUE] Clear queue error:', data);
        }
    } catch (error) {
        console.error('[QUEUE] Failed to clear queue:', error);
        showNotification('Failed to clear queue: ' + error.message, 'error');
    } finally {
        queueClearAllBtn.disabled = false;
        queueClearAllBtn.textContent = 'Clear All';
    }
}

// Clear selected queued messages
async function clearSelectedQueue() {
    if (selectedQueueIds.size === 0) {
        showNotification('No messages selected', 'warning');
        return;
    }
    
    if (!confirm(`Are you sure you want to clear ${selectedQueueIds.size} selected messages from the queue?`)) {
        return;
    }
    
    try {
        queueClearSelectedBtn.disabled = true;
        queueClearSelectedBtn.textContent = 'Clearing...';
        
        const response = await fetch('/api/cloudflare/queue/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageIds: Array.from(selectedQueueIds) })
        });
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Cleared ${data.cleared} messages from queue`, 'success');
            selectedQueueIds.clear();
            await loadQueueData();
        } else {
            // Show more detailed error message
            const errorMsg = data.message || data.error || 'Failed to clear selected messages';
            showNotification(errorMsg, 'error');
            console.error('[QUEUE] Clear selected error:', data);
        }
    } catch (error) {
        console.error('[QUEUE] Failed to clear selected:', error);
        showNotification('Failed to clear selected: ' + error.message, 'error');
    } finally {
        queueClearSelectedBtn.disabled = false;
        queueClearSelectedBtn.textContent = 'Clear Selected';
    }
}

// Toggle select all checkboxes
function toggleSelectAll() {
    const isChecked = queueSelectAll.checked;
    
    if (isChecked) {
        queuePendingMessages.forEach(msg => selectedQueueIds.add(msg.id));
    } else {
        selectedQueueIds.clear();
    }
    
    // Update all checkboxes
    document.querySelectorAll('.queue-item-checkbox').forEach(checkbox => {
        checkbox.checked = isChecked;
    });
    
    updateSelectionUI();
}

// Update selection UI
function updateSelectionUI() {
    const count = selectedQueueIds.size;
    
    if (count > 0) {
        queueClearSelectedBtn.classList.remove('hidden');
        queueClearSelectedBtn.textContent = `Clear Selected (${count})`;
    } else {
        queueClearSelectedBtn.classList.add('hidden');
    }
    
    // Update select all checkbox state
    if (queuePendingMessages.length > 0) {
        queueSelectAll.checked = count === queuePendingMessages.length;
        queueSelectAll.indeterminate = count > 0 && count < queuePendingMessages.length;
    }
}

// Save queue configuration
async function saveQueueConfig() {
    try {
        const expiryHours = parseInt(queueExpiryHours.value) || 0;
        const messagesPerMinute = queueRateLimit ? parseInt(queueRateLimit.value) || 2 : 2;
        
        // Validate rate limit
        if (messagesPerMinute < 1 || messagesPerMinute > 60) {
            showNotification('Rate limit must be between 1 and 60 messages per minute', 'error');
            return;
        }
        
        const response = await fetch('/api/cloudflare/queue/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expiryHours, messagesPerMinute })
        });
        const data = await response.json();
        
        if (data.success) {
            showNotification(`Config saved: Expiry ${expiryHours}h, Rate limit ${messagesPerMinute}/min`, 'success');
            // Refresh stats to show updated rate limit info
            loadQueueStats();
        } else {
            showNotification(data.error || 'Failed to save config', 'error');
        }
    } catch (error) {
        console.error('[QUEUE] Failed to save config:', error);
        showNotification('Failed to save config: ' + error.message, 'error');
    }
}

// Utility: Format date/time
function formatDateTime(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Utility: Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Utility: Show notification (with toast)
function showNotification(message, type = 'info') {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2';
        document.body.appendChild(toastContainer);
    }
    
    // Create toast element
    const toast = document.createElement('div');
    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        warning: 'bg-yellow-500',
        info: 'bg-blue-500'
    };
    const bgColor = colors[type] || colors.info;
    
    toast.className = `${bgColor} text-white px-4 py-3 rounded shadow-lg transform transition-all duration-300 translate-x-full opacity-0`;
    toast.innerHTML = `
        <div class="flex items-center gap-2">
            <span>${escapeHtml(message)}</span>
            <button class="ml-2 text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    toastContainer.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.classList.remove('translate-x-full', 'opacity-0');
    }, 10);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
    
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Make showNotification available globally
window.showToast = showNotification;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initQueueModule);
