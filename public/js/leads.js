// === LEADS TAB MODULE ===
// All functionality related to the Leads Management tab

(function() {
    'use strict';
    
    // DOM Elements for Leads Tab
    const leadsList = document.getElementById('leads-list');
    const leadsContainer = document.getElementById('leads-container');
    const leadsSearch = document.getElementById('leads-search');
    const leadsFilter = document.getElementById('leads-filter');
    const leadsRefreshBtn = document.getElementById('leads-refresh-btn');
    const leadsAutoChatToggle = document.getElementById('leads-auto-chat-toggle');
    const leadsAutoChatConfigBtn = document.getElementById('leads-auto-chat-config-btn');
    const leadsAutoChatModal = document.getElementById('leads-auto-chat-modal');
    const closeLeadsAutoChatModal = document.getElementById('close-leads-auto-chat-modal');
    const leadsAutoChatForm = document.getElementById('leads-auto-chat-form');
    const leadsTestRecordSelect = document.getElementById('leads-test-record-select');
    const leadsTestBtn = document.getElementById('leads-test-btn');
    
    // Leads Tab State Variables
    let leadsData = [];
    let leadsFilteredData = [];
    let autoChatConfig = {
        enabled: false,
        systemPrompt: '',
        includeJsonContext: true,
        autoReply: false,
        autoReplyPrompt: ''
    };
    let lastFetchTime = null;
    let fetchInterval = null;
    let contactsCache = new Map(); // Cache for contact status
    
    // Initialize Leads Tab
    async function initLeadsTab() {
        if (!leadsList) return;

        // Set up event listeners
        const leadsTabBtn = document.getElementById('leads-tab');
        if (leadsTabBtn) {
            leadsTabBtn.addEventListener('click', async () => {
                fetchLeadsFromAPI();
                await loadAutoChatConfig();
                startAutoFetch();
            });
        }

        // Search and filter functionality
        if (leadsSearch) {
            leadsSearch.addEventListener('input', filterLeads);
        }
        
        if (leadsFilter) {
            leadsFilter.addEventListener('change', filterLeads);
        }

        // Refresh button
        if (leadsRefreshBtn) {
            leadsRefreshBtn.addEventListener('click', () => {
                fetchLeadsFromAPI();
            });
        }

        // Auto chat toggle
        if (leadsAutoChatToggle) {
            leadsAutoChatToggle.addEventListener('change', toggleAutoChat);
        }

        // Auto chat configuration
        if (leadsAutoChatConfigBtn) {
            leadsAutoChatConfigBtn.addEventListener('click', openAutoChatConfig);
        }

        if (closeLeadsAutoChatModal) {
            closeLeadsAutoChatModal.addEventListener('click', closeAutoChatConfig);
        }

        if (leadsAutoChatForm) {
            leadsAutoChatForm.addEventListener('submit', saveAutoChatConfig);
        }

        // Handle auto reply section visibility
        const autoReplyCheckbox = document.getElementById('autoReply');
        const autoReplySection = document.getElementById('autoReplySection');
        
        if (autoReplyCheckbox && autoReplySection) {
            autoReplyCheckbox.addEventListener('change', function() {
                if (this.checked) {
                    autoReplySection.classList.remove('hidden');
                } else {
                    autoReplySection.classList.add('hidden');
                }
            });
        }

        // Test functionality
        if (leadsTestBtn) {
            leadsTestBtn.addEventListener('click', testAutoChat);
        }

        // Add contacts button
        const leadsAddContactsBtn = document.getElementById('leads-add-contacts-btn');
        if (leadsAddContactsBtn) {
            leadsAddContactsBtn.addEventListener('click', addAllLeadsToContacts);
        }

        // Cancel button
        const cancelLeadsAutoChatBtn = document.getElementById('cancel-leads-auto-chat-btn');
        if (cancelLeadsAutoChatBtn) {
            cancelLeadsAutoChatBtn.addEventListener('click', closeAutoChatConfig);
        }

        // Modal close on outside click
        if (leadsAutoChatModal) {
            leadsAutoChatModal.addEventListener('click', (e) => {
                if (e.target === leadsAutoChatModal) {
                    closeAutoChatConfig();
                }
            });
        }

        // Initialize leads data
        loadLeadsData();
        await loadAutoChatConfig();
        
        // Fetch fresh data from API after loading local data
        setTimeout(() => {
            fetchLeadsFromAPI();
        }, 1000);
    }

    // Load leads data from local JSON file
    function loadLeadsData() {
        try {
            fetch('/api/leads')
                .then(res => {
                    if (!res.ok) {
                        throw new Error(`HTTP error! status: ${res.status}`);
                    }
                    return res.json();
                })
                .then(data => {
                    leadsData = data.leads || [];
                    leadsFilteredData = [...leadsData];
                    renderLeadsList();
                    updateLeadsCount();
                })
                .catch(err => {
                    console.error('Failed to load leads:', err);
                    showLeadsStatus(`Failed to load leads: ${err.message}`, 'error');
                    leadsData = [];
                    leadsFilteredData = [];
                    renderLeadsList();
                });
        } catch (err) {
            console.error('Error loading leads:', err);
            showLeadsStatus(`Error loading leads: ${err.message}`, 'error');
        }
    }

    // Fetch leads from external API via proxy
    function fetchLeadsFromAPI() {
        // Show loading state
        if (leadsRefreshBtn) {
            leadsRefreshBtn.textContent = 'Loading...';
            leadsRefreshBtn.disabled = true;
        }

        // Show status in the leads tab
        showLeadsStatus('Fetching leads from API...', 'info');

        fetch('/api/proxy/leads', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (data.success && data.data) {
                processNewLeads(data.data);
                console.log(`Successfully fetched ${data.data.length} leads from API`);
                showLeadsStatus(`Successfully fetched ${data.data.length} leads from API`, 'success');
            } else {
                const errorMsg = data.error || 'API returned an error response';
                console.error('API returned error:', data);
                showLeadsStatus(`Failed to fetch leads: ${errorMsg}`, 'error');
            }
        })
        .catch(err => {
            console.error('Failed to fetch leads from API:', err);
            showLeadsStatus(`Failed to fetch leads from API: ${err.message}`, 'error');
        })
        .finally(() => {
            // Reset button state
            if (leadsRefreshBtn) {
                leadsRefreshBtn.textContent = 'Refresh';
                leadsRefreshBtn.disabled = false;
            }
        });
    }

    // Process new leads and update local storage - COMPREHENSIVE DUPLICATE PREVENTION
    function processNewLeads(apiLeads) {
        try {
            const existingLeads = [...leadsData];
            const newLeads = [];
            
            // First, deduplicate the API leads themselves (prefer latest based on created_on)
            const apiMobileMap = new Map();
            apiLeads.forEach(lead => {
                const mobile = lead.mobile;
                if (!apiMobileMap.has(mobile) || new Date(lead.created_on) > new Date(apiMobileMap.get(mobile).created_on)) {
                    apiMobileMap.set(mobile, lead);
                }
            });
            
            // Convert back to array of unique API leads
            const uniqueApiLeads = Array.from(apiMobileMap.values());
            
            // Create mobile map for existing leads (prefer latest)
            const existingMobileMap = new Map();
            existingLeads.forEach(lead => {
                const mobile = lead.mobile;
                if (!existingMobileMap.has(mobile) || new Date(lead.created_on) > new Date(existingMobileMap.get(mobile).created_on)) {
                    existingMobileMap.set(mobile, lead);
                }
            });

            // Process unique API leads - only add if mobile doesn't exist or if newer
            uniqueApiLeads.forEach(lead => {
                const mobile = lead.mobile;
                const existingLead = existingMobileMap.get(mobile);
                
                if (!existingLead || new Date(lead.created_on) > new Date(existingLead.created_on)) {
                    const newLead = {
                        ...lead,
                        id: `${lead.email}-${lead.mobile}-${lead.created_on}`,
                        processed: false,
                        chat_started: false,
                        auto_chat_enabled: false, // Individual auto chat control
                        auto_chat_logs: existingLead ? existingLead.auto_chat_logs || [] : [], // Preserve existing logs
                        last_updated: new Date().toISOString()
                    };
                    
                    newLeads.push(newLead);
                    existingMobileMap.set(mobile, newLead);
                }
            });

            if (newLeads.length > 0) {
                console.log(`Found ${newLeads.length} new/updated leads`);
                
                // Merge all leads from the map to ensure no duplicates
                const allLeads = Array.from(existingMobileMap.values())
                    .sort((a, b) => new Date(b.created_on) - new Date(a.created_on));
                
                // Keep only latest 200 records
                const limitedLeads = allLeads.slice(0, 200);
                
                // Save to server
                saveLeadsData(limitedLeads);
                
                // Update local data
                leadsData = limitedLeads;
                leadsFilteredData = [...leadsData];
                renderLeadsList();
                updateLeadsCount();
                
                // Show success message for new leads
                if (newLeads.length > 0) {
                    showLeadsStatus(`Successfully added ${newLeads.length} new/updated leads to the system.`, 'success');
                }
                
                // Process auto chat for new leads if enabled (only for leads created in last 30 minutes)
                if (autoChatConfig.enabled) {
                    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
                    newLeads.forEach(lead => {
                        const leadDate = new Date(lead.created_on);
                        if (leadDate > thirtyMinutesAgo && !lead.auto_chat_logs || lead.auto_chat_logs.length === 0) {
                            processAutoChat(lead);
                        }
                    });
                }
            } else {
                console.log('No new leads found');
                // Still update the display with current data, ensuring no duplicates
                const allLeads = Array.from(existingMobileMap.values())
                    .sort((a, b) => new Date(b.created_on) - new Date(a.created_on));
                const limitedLeads = allLeads.slice(0, 200);
                
                leadsData = limitedLeads;
                leadsFilteredData = [...leadsData];
                renderLeadsList();
                updateLeadsCount();
            }
        } catch (err) {
            console.error('Error processing leads:', err);
            showLeadsStatus(`Error processing leads: ${err.message}`, 'error');
        }
    }

    // Save leads data to server
    function saveLeadsData(leads) {
        fetch('/api/leads', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ leads: leads })
        })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (data.success) {
                console.log('Leads data saved successfully');
            } else {
                throw new Error(data.error || 'Failed to save leads data');
            }
        })
        .catch(err => {
            console.error('Failed to save leads data:', err);
            showLeadsStatus(`Failed to save leads data: ${err.message}`, 'error');
        });
    }

    // Render leads list with enhanced features
    function renderLeadsList() {
        if (!leadsList) return;

        if (leadsFilteredData.length === 0) {
            leadsList.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">No leads found</td></tr>';
            return;
        }

        leadsList.innerHTML = leadsFilteredData.map(lead => {
            const isInContacts = contactsCache.get(lead.mobile);
            const contactIconColor = isInContacts ? 'text-green-600' : 'text-red-600';
            
            return `
            <tr class="border-b hover:bg-gray-50">
                <td class="px-3 py-2">
                    <div class="flex items-center">
                        <div class="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-semibold mr-2">
                            ${getTypeIcon(lead.Type)}
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="font-medium text-gray-900 truncate">${escapeHtml(lead.name)}</div>
                            <div class="text-xs text-gray-500 truncate">${escapeHtml(lead.email)}</div>
                        </div>
                    </div>
                </td>
                <td class="px-3 py-2">
                    <div class="flex items-center justify-between">
                        <span class="text-sm text-gray-900 truncate">${escapeHtml(lead.mobile)}</span>
                        <div class="flex space-x-1 ml-2">
                            <button onclick="startChat('${lead.mobile}')" class="text-green-600 hover:text-green-800 p-1 rounded hover:bg-green-50" title="Start/Open Chat">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                                </svg>
                            </button>
                            <button onclick="toggleContactStatus('${lead.mobile}', '${escapeHtml(lead.name)}')" 
                                    class="contact-status-btn p-1 rounded hover:bg-gray-50" 
                                    data-mobile="${lead.mobile}"
                                    title="${isInContacts ? 'Contact exists in WhatsApp' : 'Click to add to WhatsApp contacts'}">
                                <svg class="w-4 h-4 contact-status-icon ${contactIconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </td>
                <td class="px-3 py-2">
                    <div class="max-w-xs">
                        <div class="text-xs text-gray-900 truncate">
                            ${lead.inquiry ? escapeHtml(lead.inquiry.substring(0, 30)) + (lead.inquiry.length > 30 ? '...' : '') : 'No inquiry'}
                        </div>
                        ${lead.inquiry && lead.inquiry.length > 30 ? `
                            <button onclick="showInquiryDetails('${escapeHtml(lead.inquiry)}')" class="text-blue-600 hover:text-blue-800 text-xs">
                                View full
                            </button>
                        ` : ''}
                    </div>
                </td>
                <td class="px-3 py-2">
                    <a href="${escapeHtml(lead.source_url)}" target="_blank" class="text-blue-600 hover:text-blue-800 hover:underline text-xs truncate block" title="${escapeHtml(lead.source_url)}">
                        ${getDomainFromUrl(lead.source_url)}
                    </a>
                </td>
                <td class="px-3 py-2 text-xs text-gray-500">
                    ${getTimeAgo(lead.created_on)}
                </td>
                <td class="px-3 py-2">
                    <div class="flex items-center space-x-2">
                        <label class="flex items-center">
                            <input type="checkbox" 
                                   ${lead.auto_chat_enabled ? 'checked' : ''} 
                                   onchange="toggleIndividualAutoChat('${lead.id}', this.checked)"
                                   class="mr-1 text-blue-600">
                            <span class="text-xs">Auto</span>
                        </label>
                        ${lead.auto_chat_logs && lead.auto_chat_logs.length > 0 ? `
                            <button onclick="showAutoChatLogs('${lead.id}')" 
                                    class="text-blue-600 hover:text-blue-800 text-xs bg-blue-50 px-2 py-1 rounded"
                                    title="View auto chat logs">
                                ${lead.auto_chat_logs.length} msgs
                            </button>
                        ` : ''}
                    </div>
                </td>
                <td class="px-3 py-2">
                    <button onclick="toggleLeadDetails(this, '${lead.id}')" class="text-blue-600 hover:text-blue-800 text-xs">
                        Details
                    </button>
                </td>
            </tr>
            <tr id="details-${lead.id}" class="hidden bg-gray-50">
                <td colspan="8" class="px-4 py-4">
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <strong>Full Name:</strong> ${escapeHtml(lead.name)}<br>
                            <strong>Email:</strong> ${escapeHtml(lead.email)}<br>
                            <strong>Mobile:</strong> ${escapeHtml(lead.mobile)}<br>
                            <strong>Type:</strong> ${escapeHtml(lead.Type)}<br>
                            <strong>Created:</strong> ${formatDateTime(lead.created_on)}<br>
                            <strong>Auto Chat:</strong> ${lead.auto_chat_enabled ? 'Enabled' : 'Disabled'}<br>
                            <strong>Auto Chat Messages:</strong> ${lead.auto_chat_logs ? lead.auto_chat_logs.length : 0}
                        </div>
                        <div>
                            <strong>Source URL:</strong> <a href="${escapeHtml(lead.source_url)}" target="_blank" class="text-blue-600 hover:text-blue-800">${escapeHtml(lead.source_url)}</a><br>
                            <strong>Inquiry:</strong> ${lead.inquiry ? escapeHtml(lead.inquiry) : 'No inquiry'}<br>
                            <strong>Additional Details:</strong><br>
                            <pre class="text-xs bg-white p-2 rounded border mt-1 overflow-auto max-h-32">${formatAdditionalDetails(lead.additional_details)}</pre>
                        </div>
                    </div>
                </td>
            </tr>
        `;
        }).join('');
        
        // Check contact statuses after rendering
        setTimeout(() => {
            checkAllContactStatuses();
        }, 100);
    }

    // Toggle individual auto chat for a lead
    window.toggleIndividualAutoChat = function(leadId, enabled) {
        const leadIndex = leadsData.findIndex(lead => lead.id === leadId);
        if (leadIndex === -1) return;

        leadsData[leadIndex].auto_chat_enabled = enabled;
        
        // Save to server
        saveLeadsData(leadsData);
        
        // Update display
        leadsFilteredData = [...leadsData];
        renderLeadsList();
        
        // If enabled and no previous auto chat, trigger auto chat
        if (enabled && (!leadsData[leadIndex].auto_chat_logs || leadsData[leadIndex].auto_chat_logs.length === 0)) {
            processAutoChat(leadsData[leadIndex]);
        }
        
        showLeadsStatus(`Auto chat ${enabled ? 'enabled' : 'disabled'} for ${leadsData[leadIndex].name}`, 'success');
    };

    // Show auto chat logs for a lead
    window.showAutoChatLogs = function(leadId) {
        const lead = leadsData.find(l => l.id === leadId);
        if (!lead || !lead.auto_chat_logs || lead.auto_chat_logs.length === 0) {
            showLeadsStatus('No auto chat logs found for this lead', 'info');
            return;
        }

        const logsHtml = lead.auto_chat_logs
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .map(log => `
                <div class="border-b pb-3 mb-3">
                    <div class="flex justify-between items-start">
                        <span class="text-xs text-gray-600">${formatDateTime(log.timestamp)}</span>
                        <span class="text-xs px-2 py-1 rounded ${log.type === 'sent' || log.type === 'auto-reply' ? 'bg-green-100 text-green-800' : log.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}">${log.type}</span>
                    </div>
                    ${log.prompt ? `
                        <div class="mt-2">
                            <div class="text-xs font-semibold text-gray-700 mb-1">Prompt Used:</div>
                            <div class="text-xs bg-gray-50 p-2 rounded border max-h-32 overflow-y-auto">${escapeHtml(log.prompt)}</div>
                        </div>
                    ` : ''}
                    <div class="mt-2">
                        <div class="text-xs font-semibold text-gray-700 mb-1">${log.type === 'error' ? 'Error:' : 'Response:'}</div>
                        <div class="text-sm bg-white p-2 rounded border">${escapeHtml(log.message)}</div>
                    </div>
                </div>
            `).join('');

        // Create modal for logs
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-lg w-full max-w-4xl p-6 relative max-h-[80vh] overflow-y-auto">
                <button onclick="this.closest('.fixed').remove()" class="absolute top-2 right-2 text-gray-400 hover:text-gray-700 text-2xl">&times;</button>
                <h3 class="text-lg font-semibold mb-4">Auto Chat Logs - ${escapeHtml(lead.name)} (${lead.mobile})</h3>
                <div class="space-y-3">
                    ${logsHtml}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    };

    // Filter leads based on search and filter criteria
    function filterLeads() {
        const searchTerm = leadsSearch ? leadsSearch.value.toLowerCase() : '';
        const filterType = leadsFilter ? leadsFilter.value : 'all';

        leadsFilteredData = leadsData.filter(lead => {
            const matchesSearch = !searchTerm || 
                lead.name.toLowerCase().includes(searchTerm) ||
                lead.email.toLowerCase().includes(searchTerm) ||
                lead.mobile.includes(searchTerm) ||
                (lead.inquiry && lead.inquiry.toLowerCase().includes(searchTerm));

            const matchesFilter = filterType === 'all' || lead.Type === filterType;

            return matchesSearch && matchesFilter;
        });

        renderLeadsList();
        updateLeadsCount();
    }

    // Update leads count display
    function updateLeadsCount() {
        const countElement = document.getElementById('leads-count');
        if (countElement) {
            countElement.textContent = `${leadsFilteredData.length} of ${leadsData.length} leads`;
        }
    }

    // Show status messages in the leads tab (instead of popups)
    function showLeadsStatus(message, type = 'info') {
        // Create or get status container
        let statusContainer = document.getElementById('leads-status');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.id = 'leads-status';
            statusContainer.className = 'mb-4 p-3 rounded-lg';
            
            // Insert after the leads header
            const leadsHeader = document.querySelector('#leads-tab-content .flex.justify-between');
            if (leadsHeader) {
                leadsHeader.parentNode.insertBefore(statusContainer, leadsHeader.nextSibling);
            }
        }

        // Set message and styling based on type
        statusContainer.textContent = message;
        statusContainer.className = `mb-4 p-3 rounded-lg ${getStatusClass(type)}`;
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                if (statusContainer.textContent === message) {
                    statusContainer.remove();
                }
            }, 5000);
        }
    }

    // Get CSS classes for status types
    function getStatusClass(type) {
        switch (type) {
            case 'success':
                return 'bg-green-100 border border-green-400 text-green-700';
            case 'error':
                return 'bg-red-100 border border-red-400 text-red-700';
            case 'warning':
                return 'bg-yellow-100 border border-yellow-400 text-yellow-700';
            case 'info':
            default:
                return 'bg-blue-100 border border-blue-400 text-blue-700';
        }
    }

    // Get type icon
    function getTypeIcon(type) {
        switch (type) {
            case 'Registration':
                return 'R';
            case 'Inquiry':
                return 'I';
            default:
                return '?';
        }
    }

    // Get time ago string
    function getTimeAgo(createdOn) {
        const now = new Date();
        const created = new Date(createdOn);
        const diffMs = now - created;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        if (diffDays > 0) {
            return `${diffDays}d ago`;
        } else if (diffHours > 0) {
            return `${diffHours}h ago`;
        } else if (diffMinutes > 0) {
            return `${diffMinutes}m ago`;
        } else {
            return 'Just now';
        }
    }

    // Get domain from URL
    function getDomainFromUrl(url) {
        try {
            const domain = new URL(url).hostname;
            return domain.replace('www.', '');
        } catch (err) {
            return url;
        }
    }

    // Format date time
    function formatDateTime(dateString) {
        const date = new Date(dateString);
        return date.toLocaleString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Format additional details
    function formatAdditionalDetails(details) {
        try {
            const parsed = JSON.parse(details);
            return JSON.stringify(parsed, null, 2);
        } catch (err) {
            return details;
        }
    }

    // Escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Toggle lead details
    window.toggleLeadDetails = function(button, leadId) {
        const detailsDiv = document.getElementById(`details-${leadId}`);
        if (detailsDiv.classList.contains('hidden')) {
            detailsDiv.classList.remove('hidden');
            button.textContent = 'Hide Details';
        } else {
            detailsDiv.classList.add('hidden');
            button.textContent = 'View Details';
        }
    };

    // Show inquiry details
    window.showInquiryDetails = function(inquiry) {
        if (inquiry && inquiry.trim()) {
            showLeadsStatus(`Full Inquiry:\n\n${inquiry}`, 'info');
        }
    };

    // Start chat
    // Format phone number for WhatsApp (remove +, spaces, etc.)
    function formatPhoneForWhatsApp(phone) {
        if (!phone) return '';
        
        // Remove all non-digit characters
        let cleaned = phone.replace(/[^\d]/g, '');
        
        // Handle different formats
        if (cleaned.length === 10) {
            // 10-digit number, add 91 country code
            cleaned = '91' + cleaned;
        } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
            // Already has 91 country code
            cleaned = cleaned;
        } else if (cleaned.length === 11 && cleaned.startsWith('91')) {
            // 11 digits starting with 91, keep as is
            cleaned = cleaned;
        } else if (cleaned.length > 12) {
            // Too long, take last 12 digits (assuming country code + number)
            cleaned = cleaned.slice(-12);
        }
        
        // Ensure it's exactly 12 digits (91 + 10 digits)
        if (cleaned.length !== 12) {
            console.warn('Phone number format issue:', phone, '->', cleaned);
        }
        
        return cleaned;
    }

    window.startChat = function(mobile) {
        console.log('Starting chat with:', mobile);
        
        // Format the phone number for WhatsApp
        const formattedNumber = formatPhoneForWhatsApp(mobile);
        console.log('Formatted number:', formattedNumber);
        
        // Use the enhanced openChatByNumber function
        if (typeof window.openChatByNumber === 'function') {
            window.openChatByNumber(formattedNumber);
            showLeadsStatus(`Opening chat with ${mobile}`, 'info');
        } else {
            showLeadsStatus(`Chat functionality not available. Please navigate to Chats tab manually.`, 'warning');
        }
    };

    // Enhanced Auto chat functionality
    function toggleAutoChat() {
        autoChatConfig.enabled = leadsAutoChatToggle.checked;
        saveAutoChatConfig();
        
        if (autoChatConfig.enabled) {
            console.log('Auto chat with new leads enabled');
        } else {
            console.log('Auto chat with new leads disabled');
        }
    }

    async function openAutoChatConfig() {
        if (leadsAutoChatModal) {
            leadsAutoChatModal.classList.remove('hidden');
            await populateAutoChatForm();
        }
    }

    function closeAutoChatConfig() {
        if (leadsAutoChatModal) {
            leadsAutoChatModal.classList.add('hidden');
        }
    }

    async function populateAutoChatForm() {
        const form = leadsAutoChatForm;
        if (!form) return;

        // Ensure we have the latest config
        await loadAutoChatConfig();

        // Populate form fields with current config
        const systemPromptField = form.querySelector('[name="systemPrompt"]');
        const includeJsonField = form.querySelector('[name="includeJsonContext"]');
        const autoReplyField = form.querySelector('[name="autoReply"]');
        const autoReplyPromptField = form.querySelector('[name="autoReplyPrompt"]');

        if (systemPromptField) systemPromptField.value = autoChatConfig.systemPrompt || '';
        if (includeJsonField) includeJsonField.checked = autoChatConfig.includeJsonContext;
        if (autoReplyField) autoReplyField.checked = autoChatConfig.autoReply;
        if (autoReplyPromptField) autoReplyPromptField.value = autoChatConfig.autoReplyPrompt || '';

        // Show/hide auto reply section based on checkbox state
        const autoReplySection = document.getElementById('autoReplySection');
        if (autoReplySection) {
            if (autoChatConfig.autoReply) {
                autoReplySection.classList.remove('hidden');
            } else {
                autoReplySection.classList.add('hidden');
            }
        }

        // Populate test record select
        populateTestRecordSelect();
    }

    function populateTestRecordSelect() {
        const select = leadsTestRecordSelect;
        if (!select) return;

        select.innerHTML = '<option value="">Select a record to test...</option>';
        
        leadsData.slice(0, 10).forEach(lead => {
            const option = document.createElement('option');
            option.value = lead.id;
            option.textContent = `${lead.name} (${lead.mobile})`;
            select.appendChild(option);
        });
    }

    async function saveAutoChatConfig(e) {
        if (e) e.preventDefault();
        
        // Only update from form if form exists and is visible
        if (leadsAutoChatForm && !leadsAutoChatModal.classList.contains('hidden')) {
            const formData = new FormData(leadsAutoChatForm);
            
            autoChatConfig = {
                enabled: autoChatConfig.enabled, // Keep current toggle state
                systemPrompt: formData.get('systemPrompt') || '',
                includeJsonContext: formData.get('includeJsonContext') === 'on',
                autoReply: formData.get('autoReply') === 'on',
                autoReplyPrompt: formData.get('autoReplyPrompt') || ''
            };
        }

        try {
            // Save to server
            const response = await fetch('/api/leads/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(autoChatConfig)
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('Auto chat config saved to server successfully:', result);
                // Also save to localStorage as backup
                localStorage.setItem('leadsAutoChatConfig', JSON.stringify(autoChatConfig));
                if (e) showLeadsStatus('Auto chat configuration saved successfully', 'success');
            } else {
                throw new Error('Failed to save config to server');
            }
        } catch (err) {
            console.error('Error saving auto chat config to server, using localStorage:', err);
            // Fallback to localStorage
            localStorage.setItem('leadsAutoChatConfig', JSON.stringify(autoChatConfig));
            if (e) showLeadsStatus('Configuration saved to local storage (server unavailable)', 'warning');
        }
        
        if (e) closeAutoChatConfig();
    }

    async function loadAutoChatConfig() {
        try {
            // Try to load from server first
            const response = await fetch('/api/leads/config');
            if (response.ok) {
                const serverConfig = await response.json();
                autoChatConfig = { ...autoChatConfig, ...serverConfig };
                console.log('Auto chat config loaded from server:', autoChatConfig);
            } else {
                throw new Error('Failed to load config from server');
            }
        } catch (err) {
            console.error('Error loading auto chat config from server, trying localStorage:', err);
            
            // Fallback to localStorage
            try {
                const saved = localStorage.getItem('leadsAutoChatConfig');
                if (saved) {
                    autoChatConfig = { ...autoChatConfig, ...JSON.parse(saved) };
                    console.log('Auto chat config loaded from localStorage:', autoChatConfig);
                }
            } catch (localErr) {
                console.error('Error loading auto chat config from localStorage:', localErr);
            }
        }
        
        // Update toggle state
        if (leadsAutoChatToggle) {
            leadsAutoChatToggle.checked = autoChatConfig.enabled;
        }
    }

    function testAutoChat() {
        const selectedRecordId = leadsTestRecordSelect.value;
        if (!selectedRecordId) {
            showLeadsStatus('Please select a record to test', 'warning');
            return;
        }

        const record = leadsData.find(lead => lead.id === selectedRecordId);
        if (!record) {
            showLeadsStatus('Selected record not found', 'error');
            return;
        }

        console.log('Testing auto chat with record:', record);
        
        // Simulate auto chat process
        processAutoChat(record, true);
    }

    // Enhanced auto chat processing with chat history
    async function processAutoChat(lead, isTest = false) {
        if (!autoChatConfig.enabled && !isTest && !lead.auto_chat_enabled) return;

        try {
            // Get chat history for this mobile number
            let chatHistory = '';
            try {
                const formattedNumber = formatPhoneForWhatsApp(lead.mobile);
                const chatId = formattedNumber + '@c.us';
                
                // Fetch chat history from WhatsApp
                const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`);
                if (response.ok) {
                    const messages = await response.json();
                    // Get last 100 messages and format them
                    const recentMessages = messages.slice(0, 100);
                    chatHistory = recentMessages.map(msg => 
                        `${msg.fromMe ? 'Me' : 'User'}: ${msg.body || '[Media]'}`
                    ).join('\n');
                }
            } catch (err) {
                console.log('Could not fetch chat history:', err.message);
            }

            const context = autoChatConfig.includeJsonContext ? JSON.stringify(lead) : '';
            const prompt = autoChatConfig.systemPrompt;
            
            // Build full prompt for logging
            let fullPrompt = prompt;
            if (context) {
                fullPrompt += `\n\nLead Context:\n${context}`;
            }
            if (chatHistory) {
                fullPrompt += `\n\nChat History:\n${chatHistory}`;
            }
            if (autoChatConfig.autoReply && autoChatConfig.autoReplyPrompt) {
                fullPrompt += `\n\nAuto Reply Instructions:\n${autoChatConfig.autoReplyPrompt}`;
            }
            
            // Call Gemini API with chat history
            const response = await callGeminiAPI(prompt, context, lead, chatHistory);
            console.log('Auto chat response:', response);
            
            if (isTest) {
                showLeadsStatus(`Test Auto Chat Response:\n\n${response}`, 'success');
            } else {
                // Send to WhatsApp
                await sendWhatsAppMessage(lead.mobile, response);
                
                // Log the auto chat message with full prompt
                logAutoChatMessage(lead.id, 'sent', response, fullPrompt);
                
                showLeadsStatus(`Auto chat message sent to ${lead.name}`, 'success');
            }
        } catch (err) {
            console.error('Auto chat error:', err);
            if (isTest) {
                showLeadsStatus(`Auto chat test failed: ${err.message}`, 'error');
            } else {
                // Build full prompt for error logging
                let fullPrompt = autoChatConfig.systemPrompt;
                const context = autoChatConfig.includeJsonContext ? JSON.stringify(lead) : '';
                if (context) {
                    fullPrompt += `\n\nLead Context:\n${context}`;
                }
                if (chatHistory) {
                    fullPrompt += `\n\nChat History:\n${chatHistory}`;
                }
                if (autoChatConfig.autoReply && autoChatConfig.autoReplyPrompt) {
                    fullPrompt += `\n\nAuto Reply Instructions:\n${autoChatConfig.autoReplyPrompt}`;
                }
                
                logAutoChatMessage(lead.id, 'error', err.message, fullPrompt);
            }
        }
    }

    // Log auto chat message
    function logAutoChatMessage(leadId, type, message, prompt = '') {
        const leadIndex = leadsData.findIndex(lead => lead.id === leadId);
        if (leadIndex === -1) return;

        if (!leadsData[leadIndex].auto_chat_logs) {
            leadsData[leadIndex].auto_chat_logs = [];
        }

        leadsData[leadIndex].auto_chat_logs.push({
            timestamp: new Date().toISOString(),
            type: type,
            message: message,
            prompt: prompt // Include the full prompt used
        });

        // Keep only last 50 logs
        if (leadsData[leadIndex].auto_chat_logs.length > 50) {
            leadsData[leadIndex].auto_chat_logs = leadsData[leadIndex].auto_chat_logs.slice(-50);
        }

        // Save to server
        saveLeadsData(leadsData);
        
        // Update display
        leadsFilteredData = [...leadsData];
        renderLeadsList();
    }

    async function callGeminiAPI(systemPrompt, context, lead, chatHistory = '') {
        let fullPrompt = systemPrompt;
        
        if (context) {
            fullPrompt += `\n\nLead Context:\n${context}`;
        }
        
        if (chatHistory) {
            fullPrompt += `\n\nChat History:\n${chatHistory}`;
        }
        
        if (autoChatConfig.autoReply && autoChatConfig.autoReplyPrompt) {
            fullPrompt += `\n\nAuto Reply Instructions:\n${autoChatConfig.autoReplyPrompt}`;
        }

        const response = await fetch('/api/gemini/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                systemPrompt: fullPrompt,
                context: context,
                lead: lead,
                autoReply: autoChatConfig.autoReply,
                autoReplyPrompt: autoChatConfig.autoReplyPrompt,
                chatHistory: chatHistory
            })
        });

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        return data.response;
    }

    async function sendWhatsAppMessage(mobile, message) {
        try {
            const formattedNumber = formatPhoneForWhatsApp(mobile);
            const chatId = formattedNumber + '@c.us';
            
            const response = await fetch('/api/messages/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    number: chatId,
                    message: message
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to send message: ${response.statusText}`);
            }

            console.log(`WhatsApp message sent to ${mobile}:`, message);
        } catch (err) {
            console.error('Failed to send WhatsApp message:', err);
            throw err;
        }
    }

    // Start auto fetch every 5 minutes
    function startAutoFetch() {
        if (fetchInterval) {
            clearInterval(fetchInterval);
        }
        
        fetchInterval = setInterval(() => {
            // Silent fetch for auto updates (no alerts for errors)
            silentFetchLeadsFromAPI();
        }, 5 * 60 * 1000); // 5 minutes
    }

    // Silent fetch for auto updates (no error alerts)
    function silentFetchLeadsFromAPI() {
        fetch('/api/proxy/leads', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (data.success && data.data) {
                processNewLeadsSilent(data.data);
                console.log(`Auto-fetch: Found ${data.data.length} leads from API`);
            } else {
                console.error('Auto-fetch: API returned error:', data);
            }
        })
        .catch(err => {
            console.error('Auto-fetch: Failed to fetch leads from API:', err);
        });
    }

    // Silent processing for auto updates
    function processNewLeadsSilent(apiLeads) {
        try {
            const existingLeads = [...leadsData];
            const newLeads = [];
            const mobileMap = new Map();

            // Create mobile map for existing leads (prefer latest)
            existingLeads.forEach(lead => {
                const mobile = lead.mobile;
                if (!mobileMap.has(mobile) || new Date(lead.created_on) > new Date(mobileMap.get(mobile).created_on)) {
                    mobileMap.set(mobile, lead);
                }
            });

            // Process new leads - only add if mobile doesn't exist or if newer
            apiLeads.forEach(lead => {
                const mobile = lead.mobile;
                const existingLead = mobileMap.get(mobile);
                
                if (!existingLead || new Date(lead.created_on) > new Date(existingLead.created_on)) {
                    const newLead = {
                        ...lead,
                        id: `${lead.email}-${lead.mobile}-${lead.created_on}`,
                        processed: false,
                        chat_started: false,
                        auto_chat_enabled: false,
                        auto_chat_logs: [],
                        last_updated: new Date().toISOString()
                    };
                    
                    // Remove old entry if exists
                    if (existingLead) {
                        const oldIndex = existingLeads.findIndex(l => l.mobile === mobile);
                        if (oldIndex !== -1) {
                            existingLeads.splice(oldIndex, 1);
                        }
                    }
                    
                    newLeads.push(newLead);
                    mobileMap.set(mobile, newLead);
                }
            });

            if (newLeads.length > 0) {
                console.log(`Auto-fetch: Found ${newLeads.length} new/updated leads`);
                
                // Add new leads to the beginning
                const updatedLeads = [...newLeads, ...existingLeads];
                
                // Keep only latest 200 records
                const limitedLeads = updatedLeads.slice(0, 200);
                
                // Save to server silently
                saveLeadsDataSilent(limitedLeads);
                
                // Update local data
                leadsData = limitedLeads;
                leadsFilteredData = [...leadsData];
                renderLeadsList();
                updateLeadsCount();
                
                // Process auto chat for new leads if enabled (only for leads created in last 30 minutes)
                if (autoChatConfig.enabled) {
                    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
                    newLeads.forEach(lead => {
                        const leadDate = new Date(lead.created_on);
                        if (leadDate > thirtyMinutesAgo && (!lead.auto_chat_logs || lead.auto_chat_logs.length === 0)) {
                            processAutoChat(lead);
                        }
                    });
                }
            }
        } catch (err) {
            console.error('Auto-fetch: Error processing leads:', err);
        }
    }

    // Silent save for auto updates
    function saveLeadsDataSilent(leads) {
        fetch('/api/leads', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ leads: leads })
        })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            if (data.success) {
                console.log('Auto-fetch: Leads data saved successfully');
            } else {
                throw new Error(data.error || 'Failed to save leads data');
            }
        })
        .catch(err => {
            console.error('Auto-fetch: Failed to save leads data:', err);
        });
    }

    // Stop auto fetch
    function stopAutoFetch() {
        if (fetchInterval) {
            clearInterval(fetchInterval);
            fetchInterval = null;
        }
    }

    // Contact Management Functions
    async function checkContactStatus(mobile) {
        try {
            const response = await fetch('/api/contacts/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ mobile })
            });
            
            if (!response.ok) {
                throw new Error('Failed to check contact status');
            }
            
            const result = await response.json();
            return result.exists;
        } catch (err) {
            console.error('Error checking contact status:', err);
            return false;
        }
    }

    async function addContact(mobile, name = '') {
        try {
            const response = await fetch('/api/contacts/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ mobile, name })
            });
            
            if (!response.ok) {
                throw new Error('Failed to add contact');
            }
            
            const result = await response.json();
            return result.success;
        } catch (err) {
            console.error('Error adding contact:', err);
            return false;
        }
    }

    async function addAllLeadsToContacts() {
        const leadsToAdd = leadsFilteredData.filter(lead => !contactsCache.get(lead.mobile));
        
        if (leadsToAdd.length === 0) {
            showLeadsStatus('All leads are already in contacts!', 'success');
            return;
        }

        showLeadsStatus(`Adding ${leadsToAdd.length} leads to contacts...`, 'info');
        
        let successCount = 0;
        let failCount = 0;
        
        for (const lead of leadsToAdd) {
            try {
                const success = await addContact(lead.mobile, lead.name);
                if (success) {
                    contactsCache.set(lead.mobile, true);
                    successCount++;
                } else {
                    failCount++;
                }
                
                // Small delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                console.error(`Failed to add contact for ${lead.mobile}:`, err);
                failCount++;
            }
        }
        
        if (successCount > 0) {
            showLeadsStatus(`Successfully added ${successCount} contacts${failCount > 0 ? `, ${failCount} failed` : ''}`, 'success');
        } else {
            showLeadsStatus(`Failed to add any contacts. ${failCount} errors.`, 'error');
        }
        
        // Refresh the list to update contact status icons
        renderLeadsList();
    }

    // Toggle contact status (add if not in contacts)
    window.toggleContactStatus = async function(mobile, name) {
        const isInContacts = contactsCache.get(mobile);
        
        if (isInContacts) {
            showLeadsStatus('Contact already exists in WhatsApp', 'info');
            return;
        }
        
        try {
            const success = await addContact(mobile, name);
            if (success) {
                contactsCache.set(mobile, true);
                showLeadsStatus('Contact added successfully!', 'success');
                
                // Update the icon color
                const btn = document.querySelector(`[data-mobile="${mobile}"]`);
                if (btn) {
                    const icon = btn.querySelector('.contact-status-icon');
                    if (icon) {
                        icon.classList.remove('text-red-600');
                        icon.classList.add('text-green-600');
                    }
                }
            } else {
                showLeadsStatus('Failed to add contact', 'error');
            }
        } catch (err) {
            console.error('Error adding contact:', err);
            showLeadsStatus('Error adding contact', 'error');
        }
    }

    // Check contact status for all leads
    async function checkAllContactStatuses() {
        const promises = leadsFilteredData.map(async (lead) => {
            const exists = await checkContactStatus(lead.mobile);
            contactsCache.set(lead.mobile, exists);
            return { mobile: lead.mobile, exists };
        });
        
        await Promise.all(promises);
        
        // Update the contact status icons
        updateContactStatusIcons();
    }

    // Update contact status icons based on cache
    function updateContactStatusIcons() {
        const contactButtons = document.querySelectorAll('.contact-status-btn');
        contactButtons.forEach(btn => {
            const mobile = btn.getAttribute('data-mobile');
            const icon = btn.querySelector('.contact-status-icon');
            const isInContacts = contactsCache.get(mobile);
            
            if (icon) {
                if (isInContacts) {
                    icon.classList.remove('text-red-600');
                    icon.classList.add('text-green-600');
                } else {
                    icon.classList.remove('text-green-600');
                    icon.classList.add('text-red-600');
                }
            }
        });
    }

    // Initialize when DOM is loaded
    document.addEventListener('DOMContentLoaded', initLeadsTab);
})(); 