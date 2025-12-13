// Cloud Section JavaScript
let cloudStatus = null;
let cloudLogsPage = 1;
let cloudMessagesPage = 1;
const CLOUD_PAGE_SIZE = 50;

// Initialize Cloud section when tab is shown
document.addEventListener('DOMContentLoaded', function() {
    // Function to load all cloud data
    function loadAllCloudData() {
        console.log('[CLOUD] Loading all cloud data...');
        loadCloudStatus();
        loadCloudChannels();
        loadCloudMessages();
        loadCloudQueue();
        loadCloudLogs();
    }
    
    // Load data when tab is clicked
    const cloudTab = document.getElementById('cloud-tab');
    if (cloudTab) {
        cloudTab.addEventListener('click', function() {
            console.log('[CLOUD] Cloud tab clicked');
            loadAllCloudData();
        });
    }
    
    // Also use MutationObserver to detect when cloud tab becomes visible
    const cloudPane = document.getElementById('cloud');
    if (cloudPane) {
        // Check if already visible on page load
        if (!cloudPane.classList.contains('hidden')) {
            console.log('[CLOUD] Cloud pane already visible on load');
            loadAllCloudData();
        }
        
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const isVisible = !cloudPane.classList.contains('hidden');
                    if (isVisible) {
                        console.log('[CLOUD] Cloud pane became visible');
                        loadAllCloudData();
                    }
                }
            });
        });
        
        observer.observe(cloudPane, {
            attributes: true,
            attributeFilter: ['class']
        });
    }
    
    // Also listen for URL hash changes
    window.addEventListener('hashchange', function() {
        if (window.location.hash === '#cloud') {
            console.log('[CLOUD] URL hash changed to #cloud');
            loadAllCloudData();
        }
    });
    
    // Check if we're on cloud tab on initial load
    if (window.location.hash === '#cloud') {
        console.log('[CLOUD] Initial load with #cloud hash');
        setTimeout(loadAllCloudData, 500);
    }
    
    // Refresh buttons
    const refreshStatusBtn = document.getElementById('cloud-refresh-status-btn');
    const refreshMessagesBtn = document.getElementById('cloud-refresh-messages-btn');
    const refreshQueueBtn = document.getElementById('cloud-refresh-queue-btn');
    const refreshLogsBtn = document.getElementById('cloud-refresh-logs-btn');
    
    if (refreshStatusBtn) {
        refreshStatusBtn.addEventListener('click', loadCloudStatus);
    }
    
    if (refreshMessagesBtn) {
        refreshMessagesBtn.addEventListener('click', () => {
            cloudMessagesPage = 1;
            loadCloudMessages();
        });
    }
    
    if (refreshQueueBtn) {
        refreshQueueBtn.addEventListener('click', loadCloudQueue);
    }
    
    if (refreshLogsBtn) {
        refreshLogsBtn.addEventListener('click', () => {
            cloudLogsPage = 1;
            loadCloudLogs();
        });
    }
    
    // Pagination buttons
    const logsPrevBtn = document.getElementById('cloud-logs-prev');
    const logsNextBtn = document.getElementById('cloud-logs-next');
    const messagesPrevBtn = document.getElementById('cloud-messages-prev');
    const messagesNextBtn = document.getElementById('cloud-messages-next');
    
    if (logsPrevBtn) {
        logsPrevBtn.addEventListener('click', () => {
            if (cloudLogsPage > 1) {
                cloudLogsPage--;
                loadCloudLogs();
            }
        });
    }
    
    if (logsNextBtn) {
        logsNextBtn.addEventListener('click', () => {
            cloudLogsPage++;
            loadCloudLogs();
        });
    }
    
    if (messagesPrevBtn) {
        messagesPrevBtn.addEventListener('click', () => {
            if (cloudMessagesPage > 1) {
                cloudMessagesPage--;
                loadCloudMessages();
            }
        });
    }
    
    if (messagesNextBtn) {
        messagesNextBtn.addEventListener('click', () => {
            cloudMessagesPage++;
            loadCloudMessages();
        });
    }
});

// Load Cloudflare connection status
async function loadCloudStatus() {
    const statusContainer = document.getElementById('cloud-status-container');
    const statusIndicator = document.getElementById('cloud-status-indicator');
    const statusText = document.getElementById('cloud-status-text');
    const statusDetails = document.getElementById('cloud-status-details');
    
    if (!statusContainer) {
        console.error('[CLOUD] Status container not found');
        return;
    }
    
    if (statusText) {
        statusText.textContent = 'Loading...';
    }
    
    try {
        console.log('[CLOUD] Fetching status from /api/cloud/status');
        const response = await fetch('/api/cloud/status');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log('[CLOUD] Status data received:', data);
        cloudStatus = data;
        
        if (statusIndicator && statusText) {
            if (data.connected) {
                statusIndicator.className = 'w-4 h-4 rounded-full bg-green-500';
                statusText.textContent = 'Connected';
            } else if (data.hasConfig) {
                statusIndicator.className = 'w-4 h-4 rounded-full bg-yellow-500';
                statusText.textContent = 'Disconnected';
            } else {
                statusIndicator.className = 'w-4 h-4 rounded-full bg-gray-400';
                statusText.textContent = 'Not Configured';
            }
        } else {
            console.error('[CLOUD] Status indicator or text element not found');
        }
        
        if (statusDetails) {
            let detailsHtml = '';
            if (data.standaloneMode) {
                detailsHtml = '<div class="text-yellow-600">Running in standalone mode (Cloudflare sync disabled)</div>';
            } else if (data.connected) {
                detailsHtml = `
                    <div class="space-y-1">
                        <div><strong>Base URL:</strong> ${data.baseUrl || 'N/A'}</div>
                        <div><strong>Sync Interval:</strong> ${data.syncInterval ? (data.syncInterval / 1000 / 60) + ' minutes' : 'N/A'}</div>
                        <div><strong>Queue Process Interval:</strong> ${data.queueProcessInterval ? (data.queueProcessInterval / 1000) + ' seconds' : 'N/A'}</div>
                    </div>
                `;
            } else if (data.hasConfig) {
                detailsHtml = '<div class="text-yellow-600">Cloudflare configuration found but connection failed. Check server logs.</div>';
            } else {
                detailsHtml = '<div class="text-gray-500">Cloudflare integration not configured. Set CLOUDFLARE_BASE_URL and CLOUDFLARE_API_KEY environment variables.</div>';
            }
            statusDetails.innerHTML = detailsHtml;
        }
    } catch (error) {
        console.error('Error loading Cloudflare status:', error);
        if (statusText) statusText.textContent = 'Error';
        if (statusIndicator) statusIndicator.className = 'w-4 h-4 rounded-full bg-red-500';
        if (statusDetails) {
            statusDetails.innerHTML = '<div class="text-red-600">Failed to load status: ' + error.message + '</div>';
        }
    }
}

// Load channel web links
async function loadCloudChannels() {
    const channelsContainer = document.getElementById('cloud-channels-container');
    if (!channelsContainer) {
        console.error('[CLOUD] Channels container not found');
        return;
    }
    
    channelsContainer.innerHTML = '<div class="text-gray-500">Loading channels...</div>';
    
    try {
        console.log('[CLOUD] Fetching channels from /api/cloud/channels');
        const response = await fetch('/api/cloud/channels');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log('[CLOUD] Channels data received:', data);
        
        if (!data.connected) {
            channelsContainer.innerHTML = '<div class="text-gray-500">Cloudflare not connected</div>';
            return;
        }
        
        if (!data.channels || data.channels.length === 0) {
            channelsContainer.innerHTML = '<div class="text-gray-500">No channels found</div>';
            return;
        }
        
        let channelsHtml = '<div class="space-y-2">';
        data.channels.forEach(channel => {
            channelsHtml += `
                <div class="flex items-center justify-between p-3 border rounded hover:bg-gray-50">
                    <div>
                        <div class="font-semibold">${escapeHtml(channel.name)}</div>
                        <div class="text-xs text-gray-500">${channel.id}</div>
                    </div>
                    <a href="${escapeHtml(channel.webUrl)}" target="_blank" class="text-blue-600 hover:text-blue-800 text-sm font-semibold">
                        View Page →
                    </a>
                </div>
            `;
        });
        channelsHtml += '</div>';
        channelsContainer.innerHTML = channelsHtml;
    } catch (error) {
        console.error('Error loading channels:', error);
        channelsContainer.innerHTML = '<div class="text-red-600">Error loading channels: ' + error.message + '</div>';
    }
}

// Load Cloudflare messages
async function loadCloudMessages() {
    const tableBody = document.getElementById('cloud-messages-table-body');
    const pageInfo = document.getElementById('cloud-messages-page-info');
    const prevBtn = document.getElementById('cloud-messages-prev');
    const nextBtn = document.getElementById('cloud-messages-next');
    
    if (!tableBody) {
        console.error('[CLOUD] Messages table body not found');
        return;
    }
    
    tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-500">Loading messages...</td></tr>';
    
    try {
        console.log('[CLOUD] Fetching messages from /api/cloud/messages');
        const response = await fetch(`/api/cloud/messages?page=${cloudMessagesPage}&pageSize=${CLOUD_PAGE_SIZE}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log('[CLOUD] Messages data received:', data);
        
        if (!data.messages || data.messages.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-500">No messages found</td></tr>';
            if (pageInfo) pageInfo.textContent = 'No messages';
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) nextBtn.disabled = true;
            return;
        }
        
        let tableHtml = '';
        data.messages.forEach(msg => {
            const time = msg.timestamp || msg.sentAt || 'N/A';
            const timeFormatted = time !== 'N/A' ? new Date(time).toLocaleString() : 'N/A';
            const to = msg.to || 'N/A';
            const messageText = msg.message || '';
            const messagePreview = messageText.length > 100 ? messageText.substring(0, 100) + '...' : messageText;
            const hasMedia = msg.hasMedia || false;
            const status = msg.status || 'unknown';
            const messageId = msg.messageId || msg.id || 'N/A';
            
            const statusClass = status === 'sent' ? 'text-green-600' : status === 'failed' ? 'text-red-600' : 'text-gray-600';
            
            tableHtml += `
                <tr class="border-b hover:bg-gray-50">
                    <td class="px-4 py-2">${escapeHtml(timeFormatted)}</td>
                    <td class="px-4 py-2">${escapeHtml(to)}</td>
                    <td class="px-4 py-2">${escapeHtml(messagePreview)}</td>
                    <td class="px-4 py-2">${hasMedia ? '<span class="text-blue-600">Yes</span>' : 'No'}</td>
                    <td class="px-4 py-2"><span class="${statusClass} font-semibold">${escapeHtml(status)}</span></td>
                    <td class="px-4 py-2 text-xs text-gray-500">${escapeHtml(messageId)}</td>
                </tr>
            `;
        });
        tableBody.innerHTML = tableHtml;
        
        if (pageInfo) {
            pageInfo.textContent = `Page ${data.page} of ${data.totalPages} (${data.total} total)`;
        }
        
        if (prevBtn) {
            prevBtn.disabled = data.page <= 1;
        }
        
        if (nextBtn) {
            nextBtn.disabled = data.page >= data.totalPages;
        }
    } catch (error) {
        console.error('Error loading messages:', error);
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-600">Error loading messages: ' + error.message + '</td></tr>';
    }
}

// Load message queue
async function loadCloudQueue() {
    const tableBody = document.getElementById('cloud-queue-table-body');
    if (!tableBody) {
        console.error('[CLOUD] Queue table body not found');
        return;
    }
    
    tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Loading queue...</td></tr>';
    
    try {
        console.log('[CLOUD] Fetching queue from /api/cloud/queue');
        const response = await fetch('/api/cloud/queue');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log('[CLOUD] Queue data received:', data);
        
        if (!data.connected) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Cloudflare not connected</td></tr>';
            return;
        }
        
        if (!data.queue || data.queue.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Queue is empty</td></tr>';
            return;
        }
        
        let tableHtml = '';
        data.queue.forEach(msg => {
            const queueId = msg.id || msg.queueId || 'N/A';
            const to = msg.to || 'N/A';
            const messageText = msg.message || '';
            const messagePreview = messageText.length > 100 ? messageText.substring(0, 100) + '...' : messageText;
            const priority = msg.priority || 'normal';
            const queuedAt = msg.queuedAt || msg.timestamp || 'N/A';
            const queuedAtFormatted = queuedAt !== 'N/A' ? new Date(queuedAt).toLocaleString() : 'N/A';
            
            const priorityClass = priority === 'high' ? 'text-red-600' : priority === 'low' ? 'text-gray-600' : 'text-blue-600';
            
            tableHtml += `
                <tr class="border-b hover:bg-gray-50">
                    <td class="px-4 py-2 text-xs">${escapeHtml(queueId)}</td>
                    <td class="px-4 py-2">${escapeHtml(to)}</td>
                    <td class="px-4 py-2">${escapeHtml(messagePreview)}</td>
                    <td class="px-4 py-2"><span class="${priorityClass} font-semibold">${escapeHtml(priority)}</span></td>
                    <td class="px-4 py-2">${escapeHtml(queuedAtFormatted)}</td>
                </tr>
            `;
        });
        tableBody.innerHTML = tableHtml;
    } catch (error) {
        console.error('Error loading queue:', error);
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-red-600">Error loading queue: ' + error.message + '</td></tr>';
    }
}

// Load Cloudflare sync logs
async function loadCloudLogs() {
    const logsContainer = document.getElementById('cloud-logs-container');
    const pageInfo = document.getElementById('cloud-logs-page-info');
    const prevBtn = document.getElementById('cloud-logs-prev');
    const nextBtn = document.getElementById('cloud-logs-next');
    
    if (!logsContainer) {
        console.error('[CLOUD] Logs container not found');
        return;
    }
    
    logsContainer.innerHTML = '<div class="text-gray-500">Loading logs...</div>';
    
    try {
        console.log('[CLOUD] Fetching logs from /api/cloud/logs');
        const response = await fetch(`/api/cloud/logs?page=${cloudLogsPage}&pageSize=${CLOUD_PAGE_SIZE}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log('[CLOUD] Logs data received:', data);
        
        if (!data.logs || data.logs.length === 0) {
            logsContainer.innerHTML = '<div class="text-gray-500">No logs found</div>';
            if (pageInfo) pageInfo.textContent = 'No logs';
            if (prevBtn) prevBtn.disabled = true;
            if (nextBtn) nextBtn.disabled = true;
            return;
        }
        
        let logsHtml = '<div class="space-y-2">';
        data.logs.forEach(log => {
            const timestamp = log.timestamp || 'N/A';
            const timeFormatted = timestamp !== 'N/A' ? new Date(timestamp).toLocaleString() : 'N/A';
            const type = log.type || 'unknown';
            const status = log.status || 'unknown';
            const message = log.message || '';
            const error = log.error || '';
            
            let statusColor = 'bg-gray-500';
            if (status === 'connected' || status === 'completed' || status === 'success') {
                statusColor = 'bg-green-500';
            } else if (status === 'error' || status === 'failed') {
                statusColor = 'bg-red-500';
            } else if (status === 'started' || status === 'processing') {
                statusColor = 'bg-blue-500';
            }
            
            logsHtml += `
                <div class="border rounded p-3 hover:bg-gray-50">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <div class="flex items-center gap-2 mb-1">
                                <div class="w-2 h-2 rounded-full ${statusColor}"></div>
                                <span class="font-semibold text-sm">${escapeHtml(type)}</span>
                                <span class="text-xs text-gray-500">${escapeHtml(timeFormatted)}</span>
                            </div>
                            <div class="text-sm text-gray-700">${escapeHtml(message)}</div>
                            ${error ? `<div class="text-xs text-red-600 mt-1">Error: ${escapeHtml(error)}</div>` : ''}
                            ${log.baseUrl ? `<div class="text-xs text-gray-500 mt-1">URL: ${escapeHtml(log.baseUrl)}</div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
        logsHtml += '</div>';
        logsContainer.innerHTML = logsHtml;
        
        if (pageInfo) {
            pageInfo.textContent = `Page ${data.page} of ${data.totalPages} (${data.total} total${data.totalFiles > 1 ? `, ${data.totalFiles} files` : ''})`;
        }
        
        if (prevBtn) {
            prevBtn.disabled = data.page <= 1;
        }
        
        if (nextBtn) {
            nextBtn.disabled = data.page >= data.totalPages;
        }
    } catch (error) {
        console.error('Error loading logs:', error);
        logsContainer.innerHTML = '<div class="text-red-600">Error loading logs: ' + error.message + '</div>';
    }
}

// Utility function to escape HTML
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

