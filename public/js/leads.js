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
        initAutoChatToggle();
        
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

        // Data configuration form
        const leadsDataConfigForm = document.getElementById('leads-data-config-form');
        if (leadsDataConfigForm) {
            leadsDataConfigForm.addEventListener('submit', saveDataConfig);
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

        // Tab switching functionality
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');
                
                // Update active tab button
                tabButtons.forEach(b => {
                    b.classList.remove('active', 'border-blue-500', 'text-blue-600');
                    b.classList.add('border-transparent', 'text-gray-500');
                });
                btn.classList.add('active', 'border-blue-500', 'text-blue-600');
                btn.classList.remove('border-transparent', 'text-gray-500');
                
                // Show target tab content
                tabContents.forEach(content => {
                    content.classList.add('hidden');
                });
                document.getElementById(`${targetTab}-tab`).classList.remove('hidden');
            });
        });

        // API test functionality
        const testApiBtn = document.getElementById('test-api-btn');
        const viewDataBtn = document.getElementById('view-data-btn');
        const apiTestResult = document.getElementById('api-test-result');
        
        if (testApiBtn) {
            testApiBtn.addEventListener('click', testApiConfiguration);
        }
        
        if (viewDataBtn) {
            viewDataBtn.addEventListener('click', viewSampleData);
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

    // Fetch leads from API
    async function fetchLeadsFromAPI() {
        if (leadsRefreshBtn) {
            leadsRefreshBtn.textContent = 'Loading...';
            leadsRefreshBtn.disabled = true;
        }

        try {
            // Load configuration
            const configResponse = await fetch('/api/leads-config');
            const config = await configResponse.json();
            
            if (!config.apiConfig) {
                throw new Error('API configuration not found');
            }
            
            const { url, method, headers, body } = config.apiConfig;
            
            const requestOptions = {
                method: method || 'GET',
                headers: headers || {}
            };
            
            if (method === 'POST' && body) {
                requestOptions.body = JSON.stringify(body);
                if (!requestOptions.headers['Content-Type']) {
                    requestOptions.headers['Content-Type'] = 'application/json';
                }
            }
            
            const response = await fetch(url, requestOptions);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Process data with field mapping
            const processedData = processLeadsDataWithMapping(data, config.apiConfig.fieldMapping);
            
            // Process new leads
            processNewLeads(processedData);
            
            showLeadsStatus(`Successfully fetched ${processedData.length} leads`, 'success');
        } catch (err) {
            console.error('Error fetching leads:', err);
            showLeadsStatus(`Error fetching leads: ${err.message}`, 'error');
        } finally {
            if (leadsRefreshBtn) {
                leadsRefreshBtn.textContent = 'Refresh';
                leadsRefreshBtn.disabled = false;
            }
        }
    }

    // Process leads data with field mapping
    function processLeadsDataWithMapping(data, fieldMapping) {
        if (!Array.isArray(data)) {
            return [];
        }
        
        return data.map(item => ({
            name: item[fieldMapping.name] || '',
            email: item[fieldMapping.email] || '',
            mobile: item[fieldMapping.mobile] || '',
            inquiry: item[fieldMapping.inquiry] || '',
            source_url: item[fieldMapping.source_url] || '',
            created_on: item[fieldMapping.created_on] || new Date().toISOString(),
            Type: item[fieldMapping.Type] || 'Inquiry',
            additional_details: item[fieldMapping.additional_details] || {}
        }));
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

        // Render the leads list
        const leadsListContainer = document.getElementById('leads-list-container');
        if (!leadsListContainer) {
            console.error('Leads list container not found');
            return;
        }
        
        leadsListContainer.innerHTML = `
            <table class="min-w-full bg-white">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lead</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mobile</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Inquiry</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Auto Chat</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    ${leadsFilteredData.map(lead => {
                        const contactIconColor = contactsCache.get(lead.mobile) ? 'text-green-600' : 'text-red-600';
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
                                                    data-mobile="${lead.mobile}"
                                                    class="contact-status-btn p-1 rounded hover:bg-gray-50" 
                                                    title="${contactsCache.get(lead.mobile) ? 'Contact exists in WhatsApp' : 'Click to add to WhatsApp contacts'}">
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
                                <td colspan="7" class="px-4 py-4">
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
                    }).join('')}
                </tbody>
            </table>
        `;
        
        // Update leads count
        const leadsCount = document.getElementById('leads-count');
        if (leadsCount) {
            leadsCount.textContent = `${leadsFilteredData.length} of ${leadsData.length} leads`;
        }
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
        const toggle = document.getElementById('leads-auto-chat-toggle');
        if (!toggle) return;
        
        const enabled = toggle.checked;
        
        // Fetch current config
        fetch('/api/leads-config')
            .then(response => response.json())
            .then(config => {
                // Update only the enabled state
                config.enabled = enabled;
                
                // Save updated config
                return fetch('/api/leads-config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(config)
                });
            })
            .then(response => {
                if (response.ok) {
                    console.log('Auto chat config saved:', enabled);
                    showLeadsStatus(`Auto chat ${enabled ? 'enabled' : 'disabled'}`, 'success');
                    
                    // Start or stop auto fetch based on state
                    if (enabled) {
                        startAutoFetch();
                    } else {
                        stopAutoFetch();
                    }
                } else {
                    throw new Error('Failed to save config');
                }
            })
            .catch(error => {
                console.error('Error saving auto chat config:', error);
                // Revert the toggle if save failed
                toggle.checked = !enabled;
                showLeadsStatus('Failed to save auto chat config', 'error');
            });
    }

    // Initialize auto chat toggle
    function initAutoChatToggle() {
        const toggle = document.getElementById('leads-auto-chat-toggle');
        const container = document.getElementById('auto-chat-container');
        
        if (!toggle || !container) {
            console.error('Auto chat toggle elements not found');
            return;
        }
        
        // Load initial state
        loadAutoChatConfig();
        
        // Add change listener
        toggle.addEventListener('change', function() {
            toggleAutoChat();
        });
        
        // Add click handler for the container to toggle the checkbox
        container.addEventListener('click', function(e) {
            // Prevent double-toggling if clicking directly on checkbox
            if (e.target.type === 'checkbox') return;
            toggle.checked = !toggle.checked;
            toggleAutoChat();
        });
        
        // Update background color based on checkbox state
        function updateBackgroundColor() {
            if (toggle.checked) {
                container.classList.remove('bg-gray-50', 'border-gray-300');
                container.classList.add('bg-red-100', 'border-red-300');
            } else {
                container.classList.remove('bg-red-100', 'border-red-300');
                container.classList.add('bg-gray-50', 'border-gray-300');
            }
        }
        
        // Initial color update
        updateBackgroundColor();
        
        // Update color when checkbox changes
        toggle.addEventListener('change', updateBackgroundColor);
    }

    // Open auto chat configuration modal
    async function openAutoChatConfig() {
        if (leadsAutoChatModal) {
            leadsAutoChatModal.classList.remove('hidden');
            
            // Populate forms with current configuration
            await populateAutoChatForm();
            
            // Populate test record select
            populateTestRecordSelect();
        }
    }

    function closeAutoChatConfig() {
        if (leadsAutoChatModal) {
            leadsAutoChatModal.classList.add('hidden');
        }
    }

    // Populate auto chat form with current configuration
    async function populateAutoChatForm() {
        try {
            console.log('Loading configuration...');
            const configResponse = await fetch('/api/leads-config');
            if (!configResponse.ok) {
                throw new Error(`Failed to load config: ${configResponse.status}`);
            }
            const config = await configResponse.json();
            console.log('Loaded config:', config);
            
            // Populate auto chat form
            if (leadsAutoChatForm) {
                const systemPromptField = leadsAutoChatForm.querySelector('[name="systemPrompt"]');
                const includeJsonContextField = leadsAutoChatForm.querySelector('[name="includeJsonContext"]');
                const autoReplyField = leadsAutoChatForm.querySelector('[name="autoReply"]');
                const autoReplyPromptField = leadsAutoChatForm.querySelector('[name="autoReplyPrompt"]');
                
                console.log('Populating auto chat form fields...');
                if (systemPromptField) {
                    systemPromptField.value = config.systemPrompt || '';
                    console.log('System prompt set:', config.systemPrompt ? 'yes' : 'no');
                }
                if (includeJsonContextField) {
                    includeJsonContextField.checked = config.includeJsonContext || false;
                    console.log('Include JSON context set:', config.includeJsonContext);
                }
                if (autoReplyField) {
                    autoReplyField.checked = config.autoReply || false;
                    console.log('Auto reply set:', config.autoReply);
                }
                if (autoReplyPromptField) {
                    autoReplyPromptField.value = config.autoReplyPrompt || '';
                    console.log('Auto reply prompt set:', config.autoReplyPrompt ? 'yes' : 'no');
                }
                
                // Show/hide auto reply section
                const autoReplySection = document.getElementById('autoReplySection');
                if (autoReplySection) {
                    if (config.autoReply) {
                        autoReplySection.classList.remove('hidden');
                    } else {
                        autoReplySection.classList.add('hidden');
                    }
                }
            }
            
            // Populate data configuration form
            const leadsDataConfigForm = document.getElementById('leads-data-config-form');
            if (leadsDataConfigForm) {
                const apiConfig = config.apiConfig || {};
                const fieldMapping = apiConfig.fieldMapping || {};
                
                console.log('Populating data config form...');
                console.log('API config:', apiConfig);
                console.log('Field mapping:', fieldMapping);
                
                const apiUrlField = leadsDataConfigForm.querySelector('[name="apiUrl"]');
                const apiMethodField = leadsDataConfigForm.querySelector('[name="apiMethod"]');
                const refreshFrequencyField = leadsDataConfigForm.querySelector('[name="refreshFrequency"]');
                const apiHeadersField = leadsDataConfigForm.querySelector('[name="apiHeaders"]');
                const apiBodyField = leadsDataConfigForm.querySelector('[name="apiBody"]');
                
                if (apiUrlField) {
                    apiUrlField.value = apiConfig.url || '';
                    console.log('API URL set:', apiConfig.url);
                }
                if (apiMethodField) {
                    apiMethodField.value = apiConfig.method || 'POST';
                    console.log('API method set:', apiConfig.method);
                }
                if (refreshFrequencyField) {
                    refreshFrequencyField.value = Math.floor((apiConfig.refreshFrequency || 300000) / 1000);
                    console.log('Refresh frequency set:', Math.floor((apiConfig.refreshFrequency || 300000) / 1000));
                }
                if (apiHeadersField) {
                    apiHeadersField.value = JSON.stringify(apiConfig.headers || {}, null, 2);
                    console.log('API headers set');
                }
                if (apiBodyField) {
                    apiBodyField.value = JSON.stringify(apiConfig.body || {}, null, 2);
                    console.log('API body set');
                }
                
                // Populate field mapping
                const fieldNameField = leadsDataConfigForm.querySelector('[name="fieldName"]');
                const fieldEmailField = leadsDataConfigForm.querySelector('[name="fieldEmail"]');
                const fieldMobileField = leadsDataConfigForm.querySelector('[name="fieldMobile"]');
                const fieldInquiryField = leadsDataConfigForm.querySelector('[name="fieldInquiry"]');
                const fieldSourceUrlField = leadsDataConfigForm.querySelector('[name="fieldSourceUrl"]');
                const fieldCreatedOnField = leadsDataConfigForm.querySelector('[name="fieldCreatedOn"]');
                const fieldTypeField = leadsDataConfigForm.querySelector('[name="fieldType"]');
                const fieldAdditionalDetailsField = leadsDataConfigForm.querySelector('[name="fieldAdditionalDetails"]');
                
                if (fieldNameField) fieldNameField.value = fieldMapping.name || 'name';
                if (fieldEmailField) fieldEmailField.value = fieldMapping.email || 'email';
                if (fieldMobileField) fieldMobileField.value = fieldMapping.mobile || 'mobile';
                if (fieldInquiryField) fieldInquiryField.value = fieldMapping.inquiry || 'inquiry';
                if (fieldSourceUrlField) fieldSourceUrlField.value = fieldMapping.source_url || 'source_url';
                if (fieldCreatedOnField) fieldCreatedOnField.value = fieldMapping.created_on || 'created_on';
                if (fieldTypeField) fieldTypeField.value = fieldMapping.Type || 'Type';
                if (fieldAdditionalDetailsField) fieldAdditionalDetailsField.value = fieldMapping.additional_details || 'additional_details';
                
                console.log('Field mapping populated');
            }
            
            console.log('Configuration forms populated successfully');
            
        } catch (err) {
            console.error('Error populating configuration forms:', err);
            showLeadsStatus('Error loading configuration: ' + err.message, 'error');
        }
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

    // Save auto chat configuration
    async function saveAutoChatConfig(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const autoChatConfig = {
            enabled: autoChatConfig.enabled,
            systemPrompt: formData.get('systemPrompt'),
            includeJsonContext: formData.get('includeJsonContext') === 'on',
            autoReply: formData.get('autoReply') === 'on',
            autoReplyPrompt: formData.get('autoReplyPrompt')
        };
        
        try {
            // Load existing config
            const configResponse = await fetch('/api/leads-config');
            const config = await configResponse.json();
            
            // Update auto chat config
            config.enabled = autoChatConfig.enabled;
            config.systemPrompt = autoChatConfig.systemPrompt;
            config.includeJsonContext = autoChatConfig.includeJsonContext;
            config.autoReply = autoChatConfig.autoReply;
            config.autoReplyPrompt = autoChatConfig.autoReplyPrompt;
            
            // Save updated config
            const saveResponse = await fetch('/api/leads-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
            
            if (!saveResponse.ok) {
                throw new Error('Failed to save configuration');
            }
            
            showLeadsStatus('Auto chat configuration saved successfully!', 'success');
            closeAutoChatConfig();
            
            // Update local config
            autoChatConfig = autoChatConfig;
            
        } catch (err) {
            console.error('Error saving auto chat config:', err);
            showLeadsStatus('Failed to save auto chat configuration', 'error');
        }
    }

    // Save data configuration
    async function saveDataConfig(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const dataConfig = {
            url: formData.get('apiUrl'),
            method: formData.get('apiMethod'),
            headers: JSON.parse(formData.get('apiHeaders') || '{}'),
            body: JSON.parse(formData.get('apiBody') || '{}'),
            refreshFrequency: parseInt(formData.get('refreshFrequency')) * 1000, // Convert to milliseconds
            fieldMapping: {
                name: formData.get('fieldName'),
                email: formData.get('fieldEmail'),
                mobile: formData.get('fieldMobile'),
                inquiry: formData.get('fieldInquiry'),
                source_url: formData.get('fieldSourceUrl'),
                created_on: formData.get('fieldCreatedOn'),
                Type: formData.get('fieldType'),
                additional_details: formData.get('fieldAdditionalDetails')
            }
        };
        
        try {
            // Load existing config
            const configResponse = await fetch('/api/leads-config');
            const config = await configResponse.json();
            
            // Update API config
            config.apiConfig = dataConfig;
            
            // Save updated config
            const saveResponse = await fetch('/api/leads-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });
            
            if (!saveResponse.ok) {
                throw new Error('Failed to save configuration');
            }
            
            showLeadsStatus('Data configuration saved successfully!', 'success');
            
        } catch (err) {
            console.error('Error saving data config:', err);
            showLeadsStatus('Failed to save data configuration', 'error');
        }
    }

    // Load auto chat configuration
    function loadAutoChatConfig() {
        fetch('/api/leads-config')
            .then(response => response.json())
            .then(config => {
                console.log('Loaded auto chat config:', config);
                const toggle = document.getElementById('leads-auto-chat-toggle');
                if (toggle) {
                    toggle.checked = config.enabled || false;
                    // Trigger the background color update
                    const event = new Event('change');
                    toggle.dispatchEvent(event);
                }
            })
            .catch(error => {
                console.error('Error loading auto chat config:', error);
            });
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
    // Check contact status for a specific mobile number
    async function checkContactStatus(mobile) {
        try {
            console.log('Checking contact status for:', mobile);
            const response = await fetch('/api/contacts/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ mobile })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log('Contact check result for', mobile, ':', result);
            
            // Return true if contact exists AND has proper name
            return result.exists && result.hasProperName;
        } catch (err) {
            console.error('Error checking contact status for', mobile, ':', err);
            return false;
        }
    }

    // Add contact to WhatsApp
    async function addContact(mobile, name) {
        try {
            console.log('Adding contact:', { mobile, name });
            const response = await fetch('/api/contacts/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ mobile, name })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            console.log('Add contact result:', result);
            
            if (result.success) {
                console.log('Contact status:', result.message);
                return true;
            } else {
                console.log('Contact operation result:', result.message);
                if (result.error) {
                    console.error('Contact operation error:', result.error);
                    showLeadsStatus('Error: ' + result.error, 'error');
                } else if (result.guidance) {
                    console.log('Guidance:', result.guidance);
                    // Show guidance to user
                    showLeadsStatus(result.message + ' - ' + result.guidance, 'warning');
                }
                // Return true if contact exists (even if it needs manual update)
                return result.message.includes('already exists') || result.message.includes('Contact exists') || result.message.includes('Contact exists but needs name update') || result.message.includes('Contact updated successfully') || result.message.includes('Contact created successfully');
            }
        } catch (err) {
            console.error('Error adding contact:', err);
            return false;
        }
    }

    // Make addAllLeadsToContacts globally accessible
    window.addAllLeadsToContacts = async function() {
        console.log('addAllLeadsToContacts called');
        
        const addContactsBtn = document.getElementById('leads-add-contacts-btn');
        if (!addContactsBtn) {
            console.error('Add contacts button not found');
            return;
        }
        
        if (!leadsFilteredData || leadsFilteredData.length === 0) {
            showLeadsStatus('No leads available to add to contacts', 'warning');
            return;
        }
        
        const leadsToAdd = leadsFilteredData.filter(lead => !contactsCache.get(lead.mobile));
        
        console.log('Leads to add:', leadsToAdd.length);
        console.log('Total filtered leads:', leadsFilteredData.length);
        console.log('Contacts cache size:', contactsCache.size);
        
        if (leadsToAdd.length === 0) {
            showLeadsStatus('All leads are already in contacts!', 'success');
            return;
        }

        // Start animation
        addContactsBtn.disabled = true;
        addContactsBtn.innerHTML = `
            <svg class="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Adding Contacts...
        `;
        
        showLeadsStatus(`Adding/updating contacts for ${leadsToAdd.length} leads...`, 'info');
        
        let successCount = 0;
        let failCount = 0;
        
        // Set timeout for 15 seconds
        const timeout = setTimeout(() => {
            addContactsBtn.disabled = false;
            addContactsBtn.innerHTML = `
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                </svg>
                <svg class="w-4 h-4 absolute -top-1 -right-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
            `;
            showLeadsStatus('Operation timed out after 15 seconds', 'error');
        }, 15000);
        
        try {
            for (const lead of leadsToAdd) {
                try {
                    console.log(`Adding contact for ${lead.mobile} (${lead.name})`);
                    const success = await addContact(lead.mobile, lead.name);
                    if (success) {
                        contactsCache.set(lead.mobile, true);
                        successCount++;
                        console.log(`Successfully added ${lead.mobile}`);
                    } else {
                        failCount++;
                        console.log(`Failed to add ${lead.mobile}`);
                    }
                    
                    // Small delay to avoid overwhelming the server
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (err) {
                    console.error(`Failed to add contact for ${lead.mobile}:`, err);
                    failCount++;
                }
            }
            
            clearTimeout(timeout);
            
            if (successCount > 0) {
                showLeadsStatus(`Successfully added/updated ${successCount} contacts${failCount > 0 ? `, ${failCount} failed` : ''}`, 'success');
            } else {
                showLeadsStatus(`Failed to add/update any contacts. Please try again.`, 'error');
            }
            
            // Refresh the list to update contact status icons
            renderLeadsList();
            
        } catch (err) {
            clearTimeout(timeout);
            console.error('Error in addAllLeadsToContacts:', err);
            showLeadsStatus('Error adding contacts: ' + err.message, 'error');
        } finally {
            // Reset button
            addContactsBtn.disabled = false;
            addContactsBtn.innerHTML = `
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                </svg>
                <svg class="w-4 h-4 absolute -top-1 -right-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                </svg>
            `;
        }
    }

    // Toggle contact status (add if not in contacts) - INDIVIDUAL CONTACT ONLY
    window.toggleContactStatus = async function(mobile, name) {
        console.log('toggleContactStatus called for:', mobile, name);
        
        // Check if this specific contact exists with proper name
        const isInContacts = contactsCache.get(mobile);
        console.log('Contact in cache for', mobile, ':', isInContacts);
        
        if (isInContacts) {
            showLeadsStatus('Contact already exists in WhatsApp with proper name', 'info');
            return;
        }
        
        try {
            showLeadsStatus('Adding/updating contact in WhatsApp...', 'info');
            const success = await addContact(mobile, name);
            if (success) {
                // Update cache for this specific contact only
                contactsCache.set(mobile, true);
                showLeadsStatus('Contact added/updated successfully!', 'success');
                
                // Update only this specific icon
                const btn = document.querySelector(`[data-mobile="${mobile}"]`);
                if (btn) {
                    const icon = btn.querySelector('.contact-status-icon');
                    if (icon) {
                        icon.classList.remove('text-red-600');
                        icon.classList.add('text-green-600');
                        console.log('Updated icon color for', mobile);
                    }
                }
            } else {
                showLeadsStatus('Failed to add/update contact', 'error');
            }
        } catch (err) {
            console.error('Error adding contact:', err);
            showLeadsStatus('Error adding contact: ' + err.message, 'error');
        }
    }

    // Check contact status for all leads - ONLY CALLED FROM "ADD ALL TO CONTACTS" BUTTON
    async function checkAllContactStatuses() {
        if (!leadsFilteredData || leadsFilteredData.length === 0) {
            console.log('No leads data to check contacts for');
            return;
        }
        
        console.log('Checking contact statuses for', leadsFilteredData.length, 'leads');
        
        // Clear the cache first
        contactsCache.clear();
        
        for (const lead of leadsFilteredData) {
            try {
                const exists = await checkContactStatus(lead.mobile);
                contactsCache.set(lead.mobile, exists);
                console.log(`Contact ${lead.mobile}: ${exists ? 'EXISTS' : 'NOT FOUND'}`);
                
                // Small delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                console.error('Error checking contact for', lead.mobile, ':', err);
                contactsCache.set(lead.mobile, false);
            }
        }
        
        console.log('Contact status check completed. Cache size:', contactsCache.size);
        updateContactStatusIcons();
    }

    // Update contact status icons based on cache
    function updateContactStatusIcons() {
        const contactButtons = document.querySelectorAll('[data-mobile]');
        contactButtons.forEach(btn => {
            const mobile = btn.getAttribute('data-mobile');
            const icon = btn.querySelector('.contact-status-icon');
            if (icon) {
                const exists = contactsCache.get(mobile);
                if (exists) {
                    icon.classList.remove('text-red-600');
                    icon.classList.add('text-green-600');
                } else {
                    icon.classList.remove('text-green-600');
                    icon.classList.add('text-red-600');
                }
            }
        });
    }

    // Test API configuration
    async function testApiConfiguration() {
        const leadsDataConfigForm = document.getElementById('leads-data-config-form');
        if (!leadsDataConfigForm) {
            console.error('Data config form not found');
            return;
        }
        
        const formData = new FormData(leadsDataConfigForm);
        const apiUrl = formData.get('apiUrl');
        const apiMethod = formData.get('apiMethod');
        const refreshFrequency = formData.get('refreshFrequency');
        const apiHeaders = formData.get('apiHeaders');
        const apiBody = formData.get('apiBody');
        
        if (!apiUrl) {
            showLeadsStatus('Please enter API URL', 'error');
            return;
        }
        
        try {
            showLeadsStatus('Testing API configuration...', 'info');
            
            const requestData = {
                url: apiUrl,
                method: apiMethod || 'POST',
                headers: apiHeaders ? JSON.parse(apiHeaders) : {},
                body: apiBody ? JSON.parse(apiBody) : {},
                fieldMapping: null // We'll get the raw response
            };
            
            // Show request details
            const requestDetails = document.getElementById('request-details');
            if (requestDetails) {
                requestDetails.value = JSON.stringify(requestData, null, 2);
            }
            
            const response = await fetch('/api/test-leads-api', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            
            // Show response details
            const responseDetails = document.getElementById('response-details');
            if (responseDetails) {
                responseDetails.value = JSON.stringify(result, null, 2);
            }
            
            // Show field detection if data is available
            const fieldDetection = document.getElementById('field-detection');
            const detectedFields = document.getElementById('detected-fields');
            
            if (result.success && result.data && Array.isArray(result.data) && result.data.length > 0) {
                const sampleRecord = result.data[0];
                const fields = Object.keys(sampleRecord);
                
                if (fieldDetection && detectedFields) {
                    fieldDetection.classList.remove('hidden');
                    detectedFields.innerHTML = `
                        <div class="text-green-600 font-medium mb-2">✓ Fields detected in response:</div>
                        <div class="grid grid-cols-2 gap-2">
                            ${fields.map(field => `<div class="text-sm">• ${field}</div>`).join('')}
                        </div>
                        <div class="mt-2 text-xs text-gray-600">
                            Sample record has ${fields.length} fields. Use these field names in the mapping section above.
                        </div>
                    `;
                }
                
                showLeadsStatus(`API test successful! Found ${result.data.length} records with ${fields.length} fields each.`, 'success');
            } else if (result.success) {
                if (fieldDetection) fieldDetection.classList.add('hidden');
                showLeadsStatus('API test successful but no data found or invalid response format.', 'warning');
            } else {
                if (fieldDetection) fieldDetection.classList.add('hidden');
                showLeadsStatus('API test failed: ' + (result.error || 'Unknown error'), 'error');
            }
            
            // Show the result area
            const apiTestResult = document.getElementById('api-test-result');
            if (apiTestResult) {
                apiTestResult.classList.remove('hidden');
            }
            
        } catch (err) {
            console.error('API test error:', err);
            showLeadsStatus('API test failed: ' + err.message, 'error');
            
            // Show error in response details
            const responseDetails = document.getElementById('response-details');
            if (responseDetails) {
                responseDetails.value = JSON.stringify({ error: err.message }, null, 2);
            }
            
            // Hide field detection
            const fieldDetection = document.getElementById('field-detection');
            if (fieldDetection) {
                fieldDetection.classList.add('hidden');
            }
            
            // Show the result area
            const apiTestResult = document.getElementById('api-test-result');
            if (apiTestResult) {
                apiTestResult.classList.remove('hidden');
            }
        }
    }

    // View sample data with field mapping
    async function viewSampleData() {
        const leadsDataConfigForm = document.getElementById('leads-data-config-form');
        if (!leadsDataConfigForm) {
            console.error('Data config form not found');
            return;
        }
        
        const formData = new FormData(leadsDataConfigForm);
        const apiUrl = formData.get('apiUrl');
        const apiMethod = formData.get('apiMethod');
        const apiHeaders = formData.get('apiHeaders');
        const apiBody = formData.get('apiBody');
        
        // Get field mapping
        const fieldMapping = {
            name: formData.get('fieldName') || 'name',
            email: formData.get('fieldEmail') || 'email',
            mobile: formData.get('fieldMobile') || 'mobile',
            inquiry: formData.get('fieldInquiry') || 'inquiry',
            source_url: formData.get('fieldSourceUrl') || 'source_url',
            created_on: formData.get('fieldCreatedOn') || 'created_on',
            Type: formData.get('fieldType') || 'Type',
            additional_details: formData.get('fieldAdditionalDetails') || 'additional_details'
        };
        
        if (!apiUrl) {
            showLeadsStatus('Please enter API URL', 'error');
            return;
        }
        
        try {
            showLeadsStatus('Fetching sample data with field mapping...', 'info');
            
            const requestData = {
                url: apiUrl,
                method: apiMethod || 'POST',
                headers: apiHeaders ? JSON.parse(apiHeaders) : {},
                body: apiBody ? JSON.parse(apiBody) : {},
                fieldMapping: fieldMapping
            };
            
            // Show request details
            const requestDetails = document.getElementById('request-details');
            if (requestDetails) {
                requestDetails.value = JSON.stringify(requestData, null, 2);
            }
            
            const response = await fetch('/api/test-leads-api', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            
            // Show response details
            const responseDetails = document.getElementById('response-details');
            if (responseDetails) {
                responseDetails.value = JSON.stringify(result, null, 2);
            }
            
            // Show field detection
            const fieldDetection = document.getElementById('field-detection');
            const detectedFields = document.getElementById('detected-fields');
            
            if (result.success && result.processedData && Array.isArray(result.processedData) && result.processedData.length > 0) {
                const sampleRecord = result.processedData[0];
                const fields = Object.keys(sampleRecord);
                
                if (fieldDetection && detectedFields) {
                    fieldDetection.classList.remove('hidden');
                    detectedFields.innerHTML = `
                        <div class="text-green-600 font-medium mb-2">✓ Processed data with field mapping:</div>
                        <div class="grid grid-cols-2 gap-2">
                            ${fields.map(field => `<div class="text-sm">• ${field}: ${sampleRecord[field] || 'N/A'}</div>`).join('')}
                        </div>
                        <div class="mt-2 text-xs text-gray-600">
                            Sample processed record with ${fields.length} mapped fields. This is how the data will appear in the leads list.
                        </div>
                    `;
                }
                
                showLeadsStatus(`Sample data processed successfully! Found ${result.processedData.length} records with field mapping.`, 'success');
            } else if (result.success) {
                if (fieldDetection) fieldDetection.classList.add('hidden');
                showLeadsStatus('Sample data fetch successful but no processed data found.', 'warning');
            } else {
                if (fieldDetection) fieldDetection.classList.add('hidden');
                showLeadsStatus('Sample data fetch failed: ' + (result.error || 'Unknown error'), 'error');
            }
            
            // Show the result area
            const apiTestResult = document.getElementById('api-test-result');
            if (apiTestResult) {
                apiTestResult.classList.remove('hidden');
            }
            
        } catch (err) {
            console.error('Sample data error:', err);
            showLeadsStatus('Sample data fetch failed: ' + err.message, 'error');
            
            // Show error in response details
            const responseDetails = document.getElementById('response-details');
            if (responseDetails) {
                responseDetails.value = JSON.stringify({ error: err.message }, null, 2);
            }
            
            // Hide field detection
            const fieldDetection = document.getElementById('field-detection');
            if (fieldDetection) {
                fieldDetection.classList.add('hidden');
            }
            
            // Show the result area
            const apiTestResult = document.getElementById('api-test-result');
            if (apiTestResult) {
                apiTestResult.classList.remove('hidden');
            }
        }
    }

    // Initialize when DOM is loaded
    document.addEventListener('DOMContentLoaded', initLeadsTab);

    // Toggle functions for expandable content
    window.toggleSystemPrompt = function(index) {
        const content = document.querySelector(`.system-prompt-content-${index}`);
        const button = document.querySelector(`.show-more-system-${index}`);
        
        if (content.classList.contains('max-h-16')) {
            content.classList.remove('max-h-16', 'overflow-hidden');
            content.classList.add('max-h-96', 'overflow-y-auto');
            button.textContent = 'Show less';
        } else {
            content.classList.remove('max-h-96', 'overflow-y-auto');
            content.classList.add('max-h-16', 'overflow-hidden');
            button.textContent = 'Show more';
        }
    };

    window.toggleAutoReplyPrompt = function(index) {
        const content = document.querySelector(`.auto-reply-content-${index}`);
        const button = document.querySelector(`.show-more-auto-reply-${index}`);
        
        if (content.classList.contains('max-h-16')) {
            content.classList.remove('max-h-16', 'overflow-hidden');
            content.classList.add('max-h-96', 'overflow-y-auto');
            button.textContent = 'Show less';
        } else {
            content.classList.remove('max-h-96', 'overflow-y-auto');
            content.classList.add('max-h-16', 'overflow-hidden');
            button.textContent = 'Show more';
        }
    };
})(); 