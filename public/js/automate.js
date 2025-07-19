// === AUTOMATE TAB MODULE ===
// All functionality related to the Automate tab

(function() {
    'use strict';
    
    // DOM Elements for Automate Tab
    const automateTabBtn = document.getElementById('automate-tab');
    const automateListContainer = document.getElementById('automate-list-container');
    const addAutomationBtn = document.getElementById('add-automation-btn');
    const automationModal = document.getElementById('automation-modal');
    const closeAutomationModal = document.getElementById('close-automation-modal');
    const cancelAutomationBtn = document.getElementById('cancel-automation-btn');
    const automationForm = document.getElementById('automation-form');
    const automationModalTitle = document.getElementById('automation-modal-title');
    const automationSystemPrompt = document.getElementById('automation-system-prompt');
    const automationAutoReplyPrompt = document.getElementById('automation-auto-reply-prompt');
    const automationScheduledPrompt = document.getElementById('automation-scheduled-prompt');
    const automationSchedule = document.getElementById('automation-schedule');
    const automationStatus = document.getElementById('automation-status');
    const automationChatSelect = document.getElementById('automation-chat-select');
    const automationTypeSelect = document.getElementById('automation-type-select');
    const automationChannelSelect = document.getElementById('automation-channel-select');
    const automationChatSection = document.getElementById('automation-chat-section');
    const automationChannelSection = document.getElementById('automation-channel-section');
    const automationAutoReplySection = document.getElementById('automation-auto-reply-section');
    const scheduleOptional = document.getElementById('schedule-optional');
    const scheduleRequired = document.getElementById('schedule-required');

    // Test GenAI Modal Elements
    const testGenaiBtn = document.getElementById('test-genai-btn');
    const testGenaiModal = document.getElementById('test-genai-modal');
    const closeTestGenaiModal = document.getElementById('close-test-genai-modal');
    const cancelTestGenaiBtn = document.getElementById('cancel-test-genai-btn');
    const testGenaiForm = document.getElementById('test-genai-form');
    const testGenaiSystemPrompt = document.getElementById('test-genai-system-prompt');
    const testGenaiAutoReplyPrompt = document.getElementById('test-genai-auto-reply-prompt');
    const testGenaiUserMessage = document.getElementById('test-genai-user-message');
    const testGenaiResult = document.getElementById('test-genai-result');
    const testGenaiStatusDot = document.getElementById('test-genai-status-dot');

    // State Variables
    let lastGenaiError = '';

    // Utility function to escape HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Initialize Automate Tab
    function initAutomateTab() {
        if (!automateTabBtn) return;

        // Event Listeners
        automateTabBtn.addEventListener('click', () => {
            loadAutomations();
            quickTestGenai();
        });

        if (addAutomationBtn) addAutomationBtn.addEventListener('click', openAddAutomationModal);
        if (closeAutomationModal) closeAutomationModal.addEventListener('click', closeAutomationModalFn);
        if (cancelAutomationBtn) cancelAutomationBtn.addEventListener('click', closeAutomationModalFn);
        
        if (testGenaiBtn) testGenaiBtn.addEventListener('click', openTestGenaiModal);
        if (closeTestGenaiModal) closeTestGenaiModal.addEventListener('click', closeTestGenaiModalFn);
        if (cancelTestGenaiBtn) cancelTestGenaiBtn.addEventListener('click', closeTestGenaiModalFn);

        // Form submit is now handled in the initAutomateTab function above

        if (testGenaiForm) {
            testGenaiForm.addEventListener('submit', handleTestGenaiSubmit);
        }

        // Add event listener for automation type selection
        if (automationTypeSelect) {
            automationTypeSelect.addEventListener('change', handleAutomationTypeChange);
        }

        // Override form validation to handle dynamic required fields
        if (automationForm) {
            automationForm.addEventListener('submit', function(e) {
                // Prevent default form validation
                e.preventDefault();
                
                // Call our custom submit handler
                handleAutomationSubmit(e);
            });
        }
    }

    // Automation Action Functions
    function handleAutomationTypeChange() {
        const automationType = automationTypeSelect?.value;
        
        if (automationType === 'channel') {
            // Show channel section, hide chat section
            if (automationChannelSection) automationChannelSection.classList.remove('hidden');
            if (automationChatSection) automationChatSection.classList.add('hidden');
            if (automationAutoReplySection) automationAutoReplySection.classList.add('hidden');
            if (scheduleOptional) scheduleOptional.classList.add('hidden');
            if (scheduleRequired) scheduleRequired.classList.remove('hidden');
            
            // Make auto-reply prompt not required for channels and disable it
            if (automationAutoReplyPrompt) {
                automationAutoReplyPrompt.removeAttribute('required');
                automationAutoReplyPrompt.value = '';
                automationAutoReplyPrompt.disabled = true;
            }
            
            // Make schedule required for channels
            if (automationSchedule) {
                automationSchedule.setAttribute('required', 'required');
                automationSchedule.disabled = false;
            }
            
            // Remove required from chat select and disable it
            if (automationChatSelect) {
                automationChatSelect.removeAttribute('required');
                automationChatSelect.disabled = true;
                automationChatSelect.value = '';
            }
            
            // Add required to channel select and enable it
            if (automationChannelSelect) {
                automationChannelSelect.setAttribute('required', 'required');
                automationChannelSelect.disabled = false;
            }
            
            // Load channels for selection
            loadChannelsForAutomation();
        } else {
            // Show chat section, hide channel section
            if (automationChannelSection) automationChannelSection.classList.add('hidden');
            if (automationChatSection) automationChatSection.classList.remove('hidden');
            if (automationAutoReplySection) automationAutoReplySection.classList.remove('hidden');
            if (scheduleOptional) scheduleOptional.classList.remove('hidden');
            if (scheduleRequired) scheduleRequired.classList.add('hidden');
            
            // Make auto-reply prompt required for chats and enable it
            if (automationAutoReplyPrompt) {
                automationAutoReplyPrompt.setAttribute('required', 'required');
                automationAutoReplyPrompt.disabled = false;
            }
            
            // Make schedule optional for chats
            if (automationSchedule) {
                automationSchedule.removeAttribute('required');
                automationSchedule.disabled = false;
            }
            
            // Add required to chat select and enable it
            if (automationChatSelect) {
                automationChatSelect.setAttribute('required', 'required');
                automationChatSelect.disabled = false;
            }
            
            // Remove required from channel select and disable it
            if (automationChannelSelect) {
                automationChannelSelect.removeAttribute('required');
                automationChannelSelect.disabled = true;
                automationChannelSelect.value = '';
            }
            
            // Load chats for selection
            loadChatsForAutomation();
        }
    }

    function loadChannelsForAutomation() {
        return fetch('/api/detected-channels')
            .then(res => res.json())
            .then(data => {
                if (automationChannelSelect && data.channels) {
                    automationChannelSelect.innerHTML = '<option value="">-- Select channel --</option>' +
                        data.channels.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</option>`).join('');
                }
            })
            .catch(err => {
                console.error('Failed to load channels for automation:', err);
                if (automationChannelSelect) {
                    automationChannelSelect.innerHTML = '<option value="">-- Failed to load channels --</option>';
                }
            });
    }

    function loadChatsForAutomation() {
        return fetch('/api/chats')
            .then(res => res.json())
            .then(chats => {
                if (automationChatSelect) {
                    automationChatSelect.innerHTML = '<option value="">-- Select chat --</option>' +
                        chats.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
                }
            })
            .catch(err => {
                console.error('Failed to load chats for automation:', err);
                if (automationChatSelect) {
                    automationChatSelect.innerHTML = '<option value="">-- Failed to load chats --</option>';
                }
            });
    }

    function openEditAutomationModal(id) {
        fetch('/api/automations')
            .then(res => res.json())
            .then(automations => {
                const a = automations.find(x => x.id === id);
                if (!a) return alert('Automation not found');
                
                if (automationModalTitle) automationModalTitle.textContent = 'Edit Automation';
                if (document.getElementById('automation-id')) document.getElementById('automation-id').value = a.id;
                if (automationSystemPrompt) automationSystemPrompt.value = a.systemPrompt;
                if (automationAutoReplyPrompt) automationAutoReplyPrompt.value = a.autoReplyPrompt;
                if (automationSchedule) automationSchedule.value = a.schedule ? JSON.stringify(a.schedule) : '';
                if (automationStatus) automationStatus.value = a.status || 'active';
                
                // Set automation type based on whether it's a channel or chat
                const isChannel = a.chatId && (a.chatId.endsWith('@newsletter') || a.chatId.endsWith('@broadcast'));
                if (automationTypeSelect) {
                    automationTypeSelect.value = isChannel ? 'channel' : 'chat';
                    handleAutomationTypeChange(); // This will load the appropriate options and set required attributes
                }
                
                // Set the selected chat/channel after a short delay to ensure options are loaded
                setTimeout(() => {
                    if (isChannel) {
                        // Load channels and set selected
                        loadChannelsForAutomation().then(() => {
                            if (automationChannelSelect) automationChannelSelect.value = a.chatId;
                        });
                    } else {
                        // Load chats and set selected
                        loadChatsForAutomation().then(() => {
                            if (automationChatSelect) automationChatSelect.value = a.chatId;
                        });
                    }
                }, 100);
                
                if (automationModal) automationModal.classList.remove('hidden');
            });
    }

    function handleDeleteAutomation(id) {
        if (!confirm('Delete this automation?')) return;
        fetch(`/api/automations/${id}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(data => {
                if (data.error) throw new Error(data.error);
                loadAutomations();
            })
            .catch(err => alert('Failed to delete automation: ' + err.message));
    }

    function handlePauseAutomation(id, action) {
        fetch('/api/automations')
            .then(res => res.json())
            .then(automations => {
                const a = automations.find(x => x.id === id);
                if (!a) return alert('Automation not found');
                const newStatus = a.status === 'paused' ? 'active' : 'paused';
                fetch(`/api/automations/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...a, status: newStatus })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.error) throw new Error(data.error);
                    loadAutomations();
                })
                .catch(err => alert('Failed to update status: ' + err.message));
            });
    }

    function openAutomationLogModal(id) {
        // Find the automation container and check if logs are already expanded
        const automationContainer = document.querySelector(`[data-automation-id="${id}"]`);
        if (!automationContainer) return;
        
        const existingLogContainer = automationContainer.querySelector('.automation-log-container');
        if (existingLogContainer) {
            // Collapse logs if already expanded
            existingLogContainer.remove();
            return;
        }
        
        // Create log container
        const logContainer = document.createElement('div');
        logContainer.className = 'automation-log-container mt-4 p-4 bg-gray-50 border rounded';
        logContainer.innerHTML = '<div class="text-blue-600">Loading logs...</div>';
        
        // Insert after the automation info
        const automationInfo = automationContainer.querySelector('.automation-info');
        if (automationInfo) {
            automationInfo.parentNode.insertBefore(logContainer, automationInfo.nextSibling);
        }
        
        loadAutomationLogInline(id, logContainer);
    }

    function loadAutomationLogInline(automationId, container, page = 1) {
        const pageSize = 10;
        
        fetch(`/api/automations/${automationId}/log?page=${page}&pageSize=${pageSize}`)
            .then(res => res.json())
            .then(data => {
                const logs = data.logs || [];
                const total = data.total || 0;
                const totalPages = Math.ceil(total / pageSize) || 1;
                
                if (logs.length === 0) {
                    container.innerHTML = '<div class="text-gray-500">No log entries found.</div>';
                    return;
                }
                
                // Function to truncate text and add "show more" link
                function truncateWithShowMore(text, maxWords = 10, fieldName = '', logIndex = 0) {
                    if (!text) return '';
                    const words = text.split(' ');
                    if (words.length <= maxWords) return escapeHtml(text);
                    
                    const truncated = words.slice(0, maxWords).join(' ');
                    const uniqueId = `${fieldName}-${logIndex}-${Date.now()}`;
                    return `
                        <span id="short-${uniqueId}">${escapeHtml(truncated)}...
                            <button class="text-blue-600 hover:underline ml-1" onclick="toggleText('${uniqueId}')">show more</button>
                        </span>
                        <span id="full-${uniqueId}" class="hidden">${escapeHtml(text)}
                            <button class="text-blue-600 hover:underline ml-1" onclick="toggleText('${uniqueId}')">show less</button>
                        </span>
                    `;
                }
                
                const logsHtml = `
                    <div class="mb-4">
                        <h4 class="font-semibold text-gray-700 mb-2">Automation Logs (${total} total)</h4>
                        <div class="overflow-x-auto">
                            <table class="min-w-full bg-white border border-gray-200 text-sm">
                                <thead class="bg-gray-100">
                                    <tr>
                                        <th class="px-3 py-2 text-left font-semibold border-b">Date/Time</th>
                                        <th class="px-3 py-2 text-left font-semibold border-b">Type</th>
                                        <th class="px-3 py-2 text-left font-semibold border-b">Message</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${logs.map((log, index) => `
                                        <tr class="border-b hover:bg-gray-50">
                                            <td class="px-3 py-2">${escapeHtml(log.time || '')}</td>
                                            <td class="px-3 py-2">
                                                <span class="px-2 py-1 text-xs rounded ${
                                                    log.type === 'auto_reply' ? 'bg-green-100 text-green-800' :
                                                    log.type === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                                                    log.type === 'error' ? 'bg-red-100 text-red-800' :
                                                    'bg-gray-100 text-gray-800'
                                                }">
                                                    ${escapeHtml(log.type || '')}
                                                </span>
                                            </td>
                                            <td class="px-3 py-2">
                                                ${truncateWithShowMore(log.message, 10, 'message', index)}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        ${totalPages > 1 ? `
                            <div class="flex items-center justify-between mt-4">
                                <div class="text-sm text-gray-600">
                                    Page ${page} of ${totalPages} (${total} total logs)
                                </div>
                                <div class="flex gap-2">
                                    <button 
                                        class="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50" 
                                        ${page <= 1 ? 'disabled' : ''} 
                                        onclick="loadAutomationLogInline('${automationId}', this.closest('.automation-log-container'), ${page - 1})">
                                        Previous
                                    </button>
                                    <button 
                                        class="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50" 
                                        ${page >= totalPages ? 'disabled' : ''} 
                                        onclick="loadAutomationLogInline('${automationId}', this.closest('.automation-log-container'), ${page + 1})">
                                        Next
                                    </button>
                                </div>
                            </div>
                        ` : ''}
                        <div class="mt-2">
                            <button class="text-red-600 hover:underline text-sm" onclick="this.closest('.automation-log-container').remove()">
                                Close Logs
                            </button>
                        </div>
                    </div>
                `;
                
                container.innerHTML = logsHtml;
            })
            .catch(err => {
                container.innerHTML = `<div class="text-red-600">Error loading logs: ${err.message}</div>`;
            });
    }

    // Render Automations List
    function renderAutomationsList(automations) {
        if (!Array.isArray(automations) || automations.length === 0) {
            if (automateListContainer) {
                automateListContainer.innerHTML = `<div class='text-gray-500'>No automations found. Click 'Add Automation' to create one.</div>`;
            }
            return;
        }
        
        if (automateListContainer) {
            automateListContainer.innerHTML = automations.map(a => {
                const isChannel = a.chatId && (a.chatId.endsWith('@newsletter') || a.chatId.endsWith('@broadcast'));
                const automationType = isChannel ? 'Channel' : 'Chat';
                const typeColor = isChannel ? 'text-purple-700' : 'text-green-700';
                const typeBg = isChannel ? 'bg-purple-100' : 'bg-green-100';
                
                return `
                    <div class="border rounded p-4 mb-2 w-full" data-automation-id="${a.id}">
                        <div class="flex flex-col md:flex-row md:items-center justify-between automation-info">
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-1">
                                    <div class="font-semibold ${typeColor}">${escapeHtml(a.chatName)}</div>
                                    <span class="px-2 py-1 rounded text-xs font-semibold ${typeBg} ${typeColor}">${automationType}</span>
                                </div>
                                <div class="text-xs text-gray-500">ID: ${escapeHtml(a.chatId)}</div>
                                <div class="text-xs text-gray-500">Status: <span class="font-semibold">${escapeHtml(a.status || 'active')}</span></div>
                                <div class="text-xs text-gray-500">System Prompt: <span class="font-mono">${escapeHtml(a.systemPrompt).slice(0, 60)}${a.systemPrompt.length > 60 ? '...' : ''}</span></div>
                                <div class="text-xs text-gray-500">Auto Reply: <span class="font-mono">${isChannel ? 'Not Available' : (escapeHtml(a.autoReplyPrompt || 'None').slice(0, 60) + (a.autoReplyPrompt && a.autoReplyPrompt.length > 60 ? '...' : ''))}</span></div>
                                <div class="text-xs text-gray-400">Schedule: ${escapeHtml(JSON.stringify(a.schedule))}</div>
                            </div>
                            <div class="flex gap-2 mt-2 md:mt-0">
                                <button class="automation-edit-btn bg-blue-600 text-white px-3 py-1 rounded text-xs" data-id="${a.id}">Edit</button>
                                <button class="automation-delete-btn bg-red-600 text-white px-3 py-1 rounded text-xs" data-id="${a.id}">Delete</button>
                                <button class="automation-pause-btn bg-yellow-500 text-white px-3 py-1 rounded text-xs" data-id="${a.id}">${a.status === 'paused' ? 'Resume' : 'Pause'}</button>
                                <button class="automation-log-btn bg-gray-600 text-white px-3 py-1 rounded text-xs" data-id="${a.id}">Logs</button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Attach event listeners - functions are now defined above
            document.querySelectorAll('.automation-edit-btn').forEach(btn => {
                btn.addEventListener('click', () => openEditAutomationModal(btn.dataset.id));
            });
            document.querySelectorAll('.automation-delete-btn').forEach(btn => {
                btn.addEventListener('click', () => handleDeleteAutomation(btn.dataset.id));
            });
            document.querySelectorAll('.automation-pause-btn').forEach(btn => {
                btn.addEventListener('click', () => handlePauseAutomation(btn.dataset.id, btn.textContent));
            });
            document.querySelectorAll('.automation-log-btn').forEach(btn => {
                btn.addEventListener('click', () => openAutomationLogModal(btn.dataset.id));
            });
        }
    }

    // Load Automations
    function loadAutomations() {
        fetch('/api/automations')
            .then(res => res.json())
            .then(data => {
                console.log('[DEBUG] /api/automations response:', data);
                if (Array.isArray(data)) {
                    renderAutomationsList(data);
                } else if (data && data.error) {
                    if (automateListContainer) {
                        automateListContainer.innerHTML = `<div class='text-red-600'>API error: ${data.error}</div>`;
                    }
                } else {
                    if (automateListContainer) {
                        automateListContainer.innerHTML = `<div class='text-red-600'>Unexpected API response. See console for details.</div>`;
                    }
                }
            })
            .catch(err => {
                if (automateListContainer) {
                    automateListContainer.innerHTML = `<div class='text-red-600'>Failed to load automations: ${err.message}</div>`;
                }
                console.error('[ERROR] Failed to load automations:', err);
            });
    }

    // Modal Functions
    function openAddAutomationModal() {
        if (automationModalTitle) automationModalTitle.textContent = 'Add Automation';
        if (document.getElementById('automation-id')) document.getElementById('automation-id').value = '';
        if (automationForm) automationForm.reset();
        
        // Reset automation type to chat by default and ensure proper required attributes
        if (automationTypeSelect) {
            automationTypeSelect.value = 'chat';
            handleAutomationTypeChange();
        }
        
        // Ensure proper disabled/enabled state for default chat type
        if (automationChatSelect) {
            automationChatSelect.disabled = false;
        }
        if (automationChannelSelect) {
            automationChannelSelect.disabled = true;
        }
        if (automationAutoReplyPrompt) {
            automationAutoReplyPrompt.disabled = false;
        }
        
        if (automationModal) automationModal.classList.remove('hidden');
    }

    function closeAutomationModalFn() {
        if (automationModal) automationModal.classList.add('hidden');
    }

    function openTestGenaiModal() {
        if (testGenaiForm) testGenaiForm.reset();
        if (testGenaiResult) testGenaiResult.textContent = '';
        if (testGenaiModal) testGenaiModal.classList.remove('hidden');
    }

    function closeTestGenaiModalFn() {
        if (testGenaiModal) testGenaiModal.classList.add('hidden');
    }

    // Form Handlers
    function handleAutomationSubmit(e) {
        e.preventDefault();
        
        // Temporarily enable all fields to prevent form validation errors
        const wasChatSelectDisabled = automationChatSelect?.disabled;
        const wasChannelSelectDisabled = automationChannelSelect?.disabled;
        const wasAutoReplyDisabled = automationAutoReplyPrompt?.disabled;
        
        if (automationChatSelect) automationChatSelect.disabled = false;
        if (automationChannelSelect) automationChannelSelect.disabled = false;
        if (automationAutoReplyPrompt) automationAutoReplyPrompt.disabled = false;
        
        const id = document.getElementById('automation-id')?.value;
        const automationType = automationTypeSelect?.value;
        const chatId = automationType === 'channel' ? automationChannelSelect?.value : automationChatSelect?.value;
        const chatName = automationType === 'channel' ? 
            (automationChannelSelect?.options[automationChannelSelect.selectedIndex]?.text || '') :
            (automationChatSelect?.options[automationChatSelect.selectedIndex]?.text || '');
        const systemPrompt = automationSystemPrompt?.value.trim();
        const autoReplyPrompt = automationAutoReplyPrompt?.value.trim();
        const scheduleStr = automationSchedule?.value.trim();
        let schedule = null;
        
        if (scheduleStr) {
            try {
                schedule = JSON.parse(scheduleStr);
            } catch (err) {
                if (automationSchedule) {
                    automationSchedule.classList.add('border-red-500');
                    automationSchedule.focus();
                }
                return alert('Invalid schedule JSON');
            }
        }
        
        const status = automationStatus?.value;
        
        // Validation based on automation type
        if (!chatId || !systemPrompt) {
            return alert('Please fill all required fields.');
        }
        
        if (automationType === 'chat' && !autoReplyPrompt) {
            return alert('Auto Reply Prompt is required for chat automations.');
        }
        
        if (automationType === 'channel' && !schedule) {
            return alert('Schedule is required for channel automations.');
        }
        
        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/automations/${id}` : '/api/automations';
        
        fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                chatId, 
                chatName, 
                systemPrompt, 
                autoReplyPrompt, 
                schedule, 
                status,
                automationType 
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            closeAutomationModalFn();
            loadAutomations();
        })
        .catch(err => {
            alert('Failed to save automation: ' + err.message);
        })
        .finally(() => {
            // Restore the disabled state of fields
            if (automationChatSelect) automationChatSelect.disabled = wasChatSelectDisabled;
            if (automationChannelSelect) automationChannelSelect.disabled = wasChannelSelectDisabled;
            if (automationAutoReplyPrompt) automationAutoReplyPrompt.disabled = wasAutoReplyDisabled;
        });
    }

    function handleTestGenaiSubmit(e) {
        e.preventDefault();
        const systemPrompt = testGenaiSystemPrompt?.value.trim();
        const autoReplyPrompt = testGenaiAutoReplyPrompt?.value.trim();
        const userMessage = testGenaiUserMessage?.value.trim();
        
        if (!systemPrompt || !autoReplyPrompt || !userMessage) {
            if (testGenaiResult) testGenaiResult.textContent = 'Please fill all fields.';
            return;
        }
        
        if (testGenaiResult) testGenaiResult.innerHTML = '<span class="text-blue-600">Testing GenAI...</span>';
        
        fetch('/api/automations/test-genai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemPrompt, autoReplyPrompt, userMessage })
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                // Show alert for GenAI failure
                alert(`GenAI Test Failed: ${data.error}\n\nPlease check your GOOGLE_API_KEY in .env file and ensure it's valid.`);
                throw new Error(data.error);
            }
            if (testGenaiResult) {
                testGenaiResult.innerHTML = `<div class='font-semibold mb-1'>GenAI Response:</div><div class='bg-gray-100 border rounded p-2 whitespace-pre-line'>${escapeHtml(data.result || data.message || '')}</div>`;
            }
        })
        .catch(err => {
            if (testGenaiResult) {
                testGenaiResult.innerHTML = `<span class='text-red-600'>Error: ${escapeHtml(err.message)}</span>`;
            }
            // Show alert for network/connection failure
            if (!err.message.includes('GenAI Test Failed')) {
                alert(`GenAI Test Failed: ${err.message}\n\nPlease check your internet connection and GOOGLE_API_KEY configuration.`);
            }
        });
    }

    // Test GenAI Status Functions
    function updateTestGenaiStatus(success, errorMsg) {
        if (testGenaiStatusDot) {
            testGenaiStatusDot.classList.remove('bg-gray-400', 'bg-green-500', 'bg-red-500');
            if (success) {
                testGenaiStatusDot.classList.add('bg-green-500');
                testGenaiStatusDot.title = 'GenAI API is working.';
            } else {
                testGenaiStatusDot.classList.add('bg-red-500');
                testGenaiStatusDot.title = errorMsg || 'GenAI API error.';
            }
        }
        lastGenaiError = errorMsg || '';
    }

    function quickTestGenai() {
        if (testGenaiStatusDot) testGenaiStatusDot.classList.add('bg-gray-400');
        
        fetch('/api/automations/test-genai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                systemPrompt: 'You are a helpful assistant.', 
                autoReplyPrompt: 'Reply with a short joke.', 
                userMessage: 'Tell me a joke.' 
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.result) {
                updateTestGenaiStatus(true);
            } else {
                const errorMsg = data.error || data.message || 'Unknown error';
                updateTestGenaiStatus(false, errorMsg);
                // Show alert for GenAI failure in quick test
                alert(`GenAI Quick Test Failed: ${errorMsg}\n\nPlease check your GOOGLE_API_KEY in .env file and ensure it's valid.`);
            }
        })
        .catch(err => {
            updateTestGenaiStatus(false, err.message);
            // Show alert for network/connection failure in quick test
            alert(`GenAI Quick Test Failed: ${err.message}\n\nPlease check your internet connection and GOOGLE_API_KEY configuration.`);
        });
    }

    // Expose functions to global scope
    window.AutomateTab = {
        init: initAutomateTab,
        loadAutomations,
        quickTestGenai,
        openEditAutomationModal,
        handleDeleteAutomation,
        handlePauseAutomation,
        openAutomationLogModal,
        loadAutomationLogInline
    };

    // Make log functions globally available
    window.loadAutomationLogInline = loadAutomationLogInline;

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAutomateTab);
    } else {
        initAutomateTab();
    }

})(); 