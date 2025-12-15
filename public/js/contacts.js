// === CONTACTS TAB MODULE (Advanced) ===
// Contacts management with sync, tags, filtering, and bulk actions

(function() {
    'use strict';
    
    // State
    let allContacts = [];
    let filteredContacts = [];
    let selectedContacts = new Set();
    let currentPage = 1;
    const contactsPerPage = 500;
    let lastSync = null;
    let uniqueTags = [];
    let currentSort = { field: 'name', direction: 'asc' };
    
    // DOM Elements
    const elements = {};
    
    // Initialize DOM elements
    function initElements() {
        elements.contactsList = document.getElementById('contacts-list');
        elements.contactsSearch = document.getElementById('contacts-search');
        elements.contactsTagFilter = document.getElementById('contacts-tag-filter');
        elements.contactsTypeFilter = document.getElementById('contacts-type-filter');
        elements.contactsClearFilters = document.getElementById('contacts-clear-filters');
        elements.contactsSyncBtn = document.getElementById('contacts-sync-btn');
        elements.contactsSyncText = document.getElementById('contacts-sync-text');
        elements.contactsSyncTime = document.getElementById('contacts-sync-time');
        elements.contactsSyncStatus = document.getElementById('contacts-sync-status');
        elements.contactsTotalCount = document.getElementById('contacts-total-count');
        elements.contactsDownloadCsv = document.getElementById('contacts-download-csv-btn');
        elements.contactsSelectAll = document.getElementById('contacts-select-all');
        elements.contactsBulkActions = document.getElementById('contacts-bulk-actions');
        elements.contactsSelectedCount = document.getElementById('contacts-selected-count');
        elements.contactsCopyNumbers = document.getElementById('contacts-copy-numbers');
        elements.contactsTagInput = document.getElementById('contacts-tag-input');
        elements.contactsAssignTags = document.getElementById('contacts-assign-tags');
        elements.contactsRemoveTags = document.getElementById('contacts-remove-tags');
        elements.contactsDeselectAll = document.getElementById('contacts-deselect-all');
        elements.contactsPrevPage = document.getElementById('contacts-prev-page');
        elements.contactsNextPage = document.getElementById('contacts-next-page');
        elements.contactsPageInfo = document.getElementById('contacts-page-info');
        elements.contactsShowingRange = document.getElementById('contacts-showing-range');
        elements.contactsFilteredCount = document.getElementById('contacts-filtered-count');
        elements.contactsLoading = document.getElementById('contacts-loading');
        elements.contactsError = document.getElementById('contacts-error');
        elements.contactsEmpty = document.getElementById('contacts-empty');
        elements.editTagsModal = document.getElementById('contacts-edit-tags-modal');
        elements.editTagsContactName = document.getElementById('edit-tags-contact-name');
        elements.editTagsInput = document.getElementById('edit-tags-input');
        elements.editTagsContactId = document.getElementById('edit-tags-contact-id');
        elements.editTagsCancel = document.getElementById('edit-tags-cancel');
        elements.editTagsSave = document.getElementById('edit-tags-save');
    }
    
    // Initialize contacts tab
    function initContactsTab() {
        initElements();
        
        if (!elements.contactsList) return;
        
        // Setup event listeners
        setupEventListeners();
        
        // Load contacts on tab visibility
        const contactsPane = document.getElementById('contacts');
        if (contactsPane) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        if (!contactsPane.classList.contains('hidden')) {
                            loadContacts();
                        }
                    }
                });
            });
            observer.observe(contactsPane, { attributes: true, attributeFilter: ['class'] });
        }
        
        // Also listen for hash changes
        window.addEventListener('hashchange', () => {
            if (window.location.hash === '#contacts') {
                loadContacts();
            }
        });
        
        // Check if contacts tab is already visible
        if (window.location.hash === '#contacts' || (contactsPane && !contactsPane.classList.contains('hidden'))) {
            setTimeout(loadContacts, 100);
        }
    }
    
    // Setup all event listeners
    function setupEventListeners() {
        // Search input
        if (elements.contactsSearch) {
            elements.contactsSearch.addEventListener('input', debounce(applyFilters, 300));
        }
        
        // Filters
        if (elements.contactsTagFilter) {
            elements.contactsTagFilter.addEventListener('change', applyFilters);
        }
        if (elements.contactsTypeFilter) {
            elements.contactsTypeFilter.addEventListener('change', applyFilters);
        }
        if (elements.contactsClearFilters) {
            elements.contactsClearFilters.addEventListener('click', clearFilters);
        }
        
        // Sync button
        if (elements.contactsSyncBtn) {
            elements.contactsSyncBtn.addEventListener('click', syncContacts);
        }
        
        // Download CSV
        if (elements.contactsDownloadCsv) {
            elements.contactsDownloadCsv.addEventListener('click', downloadContactsCSV);
        }
        
        // Select all checkbox
        if (elements.contactsSelectAll) {
            elements.contactsSelectAll.addEventListener('change', handleSelectAll);
        }
        
        // Bulk actions
        if (elements.contactsCopyNumbers) {
            elements.contactsCopyNumbers.addEventListener('click', copySelectedNumbers);
        }
        if (elements.contactsAssignTags) {
            elements.contactsAssignTags.addEventListener('click', () => updateSelectedTags('add'));
        }
        if (elements.contactsRemoveTags) {
            elements.contactsRemoveTags.addEventListener('click', () => updateSelectedTags('remove'));
        }
        if (elements.contactsDeselectAll) {
            elements.contactsDeselectAll.addEventListener('click', deselectAll);
        }
        
        // Pagination
        if (elements.contactsPrevPage) {
            elements.contactsPrevPage.addEventListener('click', () => changePage(-1));
        }
        if (elements.contactsNextPage) {
            elements.contactsNextPage.addEventListener('click', () => changePage(1));
        }
        
        // Edit tags modal
        if (elements.editTagsCancel) {
            elements.editTagsCancel.addEventListener('click', closeEditTagsModal);
        }
        if (elements.editTagsSave) {
            elements.editTagsSave.addEventListener('click', saveContactTags);
        }
        
        // Sort headers
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => handleSort(th.dataset.sort));
        });
    }
    
    // Load contacts from local JSON
    async function loadContacts() {
        showLoading();
        
        try {
            const response = await fetch('/api/contacts');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            allContacts = data.contacts || [];
            uniqueTags = data.uniqueTags || [];
            lastSync = data.lastSync;
            
            console.log(`[CONTACTS] Loaded ${allContacts.length} contacts from local JSON`);
            
            // Update tag filter options
            updateTagFilterOptions();
            
            // Update sync info
            updateSyncInfo();
            
            // Apply filters and render
            applyFilters();
            
            hideLoading();
            
            if (allContacts.length === 0) {
                showEmpty();
            }
            
        } catch (err) {
            console.error('[CONTACTS] Failed to load contacts:', err);
            showError('Failed to load contacts: ' + err.message);
        }
    }
    
    // Sync contacts from WhatsApp
    async function syncContacts() {
        if (!elements.contactsSyncBtn) return;
        
        elements.contactsSyncBtn.disabled = true;
        if (elements.contactsSyncText) elements.contactsSyncText.textContent = 'Syncing...';
        if (elements.contactsSyncStatus) elements.contactsSyncStatus.classList.remove('hidden');
        
        try {
            const response = await fetch('/api/contacts/sync', { method: 'POST' });
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Sync failed');
            }
            
            console.log(`[CONTACTS] Synced ${data.totalContacts} contacts, removed ${data.removedCount}`);
            
            // Reload contacts
            await loadContacts();
            
            alert(`Sync complete! ${data.totalContacts} contacts synced, ${data.removedCount} removed.`);
            
        } catch (err) {
            console.error('[CONTACTS] Sync failed:', err);
            alert('Sync failed: ' + err.message);
        } finally {
            elements.contactsSyncBtn.disabled = false;
            if (elements.contactsSyncText) elements.contactsSyncText.textContent = 'Sync from WhatsApp';
            if (elements.contactsSyncStatus) elements.contactsSyncStatus.classList.add('hidden');
        }
    }
    
    // Update tag filter dropdown
    function updateTagFilterOptions() {
        if (!elements.contactsTagFilter) return;
        
        const currentValue = elements.contactsTagFilter.value;
        
        elements.contactsTagFilter.innerHTML = '<option value="">All Tags</option>';
        uniqueTags.forEach(tag => {
            const option = document.createElement('option');
            option.value = tag;
            option.textContent = tag;
            elements.contactsTagFilter.appendChild(option);
        });
        
        // Restore selection if still valid
        if (uniqueTags.includes(currentValue)) {
            elements.contactsTagFilter.value = currentValue;
        }
    }
    
    // Update sync info display
    function updateSyncInfo() {
        if (elements.contactsSyncTime) {
            elements.contactsSyncTime.textContent = lastSync 
                ? new Date(lastSync).toLocaleString() 
                : 'Never';
        }
        if (elements.contactsTotalCount) {
            elements.contactsTotalCount.textContent = allContacts.length.toString();
        }
    }
    
    // Apply filters and search
    function applyFilters() {
        const searchTerm = (elements.contactsSearch?.value || '').toLowerCase().trim();
        const tagFilter = elements.contactsTagFilter?.value || '';
        const typeFilter = elements.contactsTypeFilter?.value || '';
        
        filteredContacts = allContacts.filter(contact => {
            // Search filter
            if (searchTerm) {
                const searchFields = [
                    contact.name || '',
                    contact.number || '',
                    contact.pushname || '',
                    contact.tags || ''
                ].join(' ').toLowerCase();
                
                if (!searchFields.includes(searchTerm)) {
                    return false;
                }
            }
            
            // Tag filter
            if (tagFilter) {
                const contactTags = (contact.tags || '').toLowerCase().split(',').map(t => t.trim());
                if (!contactTags.includes(tagFilter.toLowerCase())) {
                    return false;
                }
            }
            
            // Type filter
            if (typeFilter) {
                switch (typeFilter) {
                    case 'mycontacts':
                        if (!contact.isMyContact) return false;
                        break;
                    case 'business':
                        if (!contact.isBusiness) return false;
                        break;
                    case 'tagged':
                        if (!contact.tags || !contact.tags.trim()) return false;
                        break;
                    case 'untagged':
                        if (contact.tags && contact.tags.trim()) return false;
                        break;
                }
            }
            
            return true;
        });
        
        // Sort
        sortContacts();
        
        // Reset to first page
        currentPage = 1;
        
        // Clear selection
        selectedContacts.clear();
        updateBulkActionsVisibility();
        
        // Render
        renderContacts();
        updatePagination();
    }
    
    // Sort contacts
    function sortContacts() {
        filteredContacts.sort((a, b) => {
            let aVal = a[currentSort.field] || '';
            let bVal = b[currentSort.field] || '';
            
            if (typeof aVal === 'string') aVal = aVal.toLowerCase();
            if (typeof bVal === 'string') bVal = bVal.toLowerCase();
            
            if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    // Handle sort header click
    function handleSort(field) {
        if (currentSort.field === field) {
            currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.field = field;
            currentSort.direction = 'asc';
        }
        
        sortContacts();
        renderContacts();
    }
    
    // Clear all filters
    function clearFilters() {
        if (elements.contactsSearch) elements.contactsSearch.value = '';
        if (elements.contactsTagFilter) elements.contactsTagFilter.value = '';
        if (elements.contactsTypeFilter) elements.contactsTypeFilter.value = '';
        applyFilters();
    }
    
    // Render contacts table
    function renderContacts() {
        if (!elements.contactsList) return;
        
        const start = (currentPage - 1) * contactsPerPage;
        const end = start + contactsPerPage;
        const pageContacts = filteredContacts.slice(start, end);
        
        if (pageContacts.length === 0) {
            elements.contactsList.innerHTML = '<tr><td colspan="7" class="text-center text-gray-400 py-8">No contacts match your filters.</td></tr>';
            return;
        }
        
        elements.contactsList.innerHTML = pageContacts.map(contact => {
            const isSelected = selectedContacts.has(contact.id);
            const displayName = contact.name || contact.pushname || contact.number;
            const tags = contact.tags ? contact.tags.split(',').map(t => t.trim()).filter(t => t) : [];
            
            let typeLabel = '';
            if (contact.isBusiness) {
                typeLabel = '<span class="text-xs bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">Business</span>';
            } else if (contact.isMyContact) {
                typeLabel = '<span class="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded">Contact</span>';
            } else if (contact.isWAContact) {
                typeLabel = '<span class="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">WhatsApp</span>';
            }
            
            return `
                <tr class="hover:bg-gray-50 ${isSelected ? 'bg-yellow-50' : ''}" data-contact-id="${contact.id}">
                    <td class="px-2 py-1.5">
                        <input type="checkbox" class="contact-checkbox rounded" data-id="${contact.id}" ${isSelected ? 'checked' : ''}>
                    </td>
                    <td class="px-2 py-1.5 truncate max-w-[180px]" title="${escapeHtml(displayName)}">
                        ${escapeHtml(displayName)}
                    </td>
                    <td class="px-2 py-1.5 font-mono text-xs">${escapeHtml(contact.number || '')}</td>
                    <td class="px-2 py-1.5 text-gray-500 truncate max-w-[120px]" title="${escapeHtml(contact.pushname || '')}">
                        ${escapeHtml(contact.pushname || '-')}
                    </td>
                    <td class="px-2 py-1.5">
                        <div class="flex flex-wrap gap-1">
                            ${tags.length > 0 
                                ? tags.map(tag => `<span class="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">${escapeHtml(tag)}</span>`).join('')
                                : '<span class="text-gray-400 text-xs">-</span>'
                            }
                        </div>
                    </td>
                    <td class="px-2 py-1.5">${typeLabel}</td>
                    <td class="px-2 py-1.5 text-center">
                        <button class="edit-tags-btn text-blue-600 hover:text-blue-800 text-xs" data-id="${contact.id}" data-name="${escapeHtml(displayName)}" data-tags="${escapeHtml(contact.tags || '')}">
                            Edit Tags
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        // Add checkbox event listeners
        document.querySelectorAll('.contact-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', handleCheckboxChange);
        });
        
        // Add edit tags button listeners
        document.querySelectorAll('.edit-tags-btn').forEach(btn => {
            btn.addEventListener('click', openEditTagsModal);
        });
        
        // Update select all checkbox state
        updateSelectAllState();
    }
    
    // Update pagination UI
    function updatePagination() {
        const totalPages = Math.ceil(filteredContacts.length / contactsPerPage) || 1;
        const start = filteredContacts.length > 0 ? (currentPage - 1) * contactsPerPage + 1 : 0;
        const end = Math.min(currentPage * contactsPerPage, filteredContacts.length);
        
        if (elements.contactsShowingRange) {
            elements.contactsShowingRange.textContent = `${start}-${end}`;
        }
        if (elements.contactsFilteredCount) {
            elements.contactsFilteredCount.textContent = filteredContacts.length.toString();
        }
        if (elements.contactsPageInfo) {
            elements.contactsPageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        }
        if (elements.contactsPrevPage) {
            elements.contactsPrevPage.disabled = currentPage <= 1;
        }
        if (elements.contactsNextPage) {
            elements.contactsNextPage.disabled = currentPage >= totalPages;
        }
    }
    
    // Change page
    function changePage(delta) {
        const totalPages = Math.ceil(filteredContacts.length / contactsPerPage) || 1;
        const newPage = currentPage + delta;
        
        if (newPage >= 1 && newPage <= totalPages) {
            currentPage = newPage;
            renderContacts();
            updatePagination();
            
            // Scroll to top of table
            elements.contactsList?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
    
    // Handle checkbox change
    function handleCheckboxChange(e) {
        const checkbox = e.target;
        const contactId = checkbox.dataset.id;
        
        if (checkbox.checked) {
            selectedContacts.add(contactId);
        } else {
            selectedContacts.delete(contactId);
        }
        
        updateBulkActionsVisibility();
        updateSelectAllState();
        
        // Update row highlight
        const row = checkbox.closest('tr');
        if (row) {
            row.classList.toggle('bg-yellow-50', checkbox.checked);
        }
    }
    
    // Handle select all
    function handleSelectAll(e) {
        const isChecked = e.target.checked;
        const start = (currentPage - 1) * contactsPerPage;
        const end = start + contactsPerPage;
        const pageContacts = filteredContacts.slice(start, end);
        
        pageContacts.forEach(contact => {
            if (isChecked) {
                selectedContacts.add(contact.id);
            } else {
                selectedContacts.delete(contact.id);
            }
        });
        
        // Update all checkboxes on current page
        document.querySelectorAll('.contact-checkbox').forEach(checkbox => {
            checkbox.checked = isChecked;
            const row = checkbox.closest('tr');
            if (row) {
                row.classList.toggle('bg-yellow-50', isChecked);
            }
        });
        
        updateBulkActionsVisibility();
    }
    
    // Update select all checkbox state
    function updateSelectAllState() {
        if (!elements.contactsSelectAll) return;
        
        const start = (currentPage - 1) * contactsPerPage;
        const end = start + contactsPerPage;
        const pageContacts = filteredContacts.slice(start, end);
        
        const allSelected = pageContacts.length > 0 && pageContacts.every(c => selectedContacts.has(c.id));
        const someSelected = pageContacts.some(c => selectedContacts.has(c.id));
        
        elements.contactsSelectAll.checked = allSelected;
        elements.contactsSelectAll.indeterminate = someSelected && !allSelected;
    }
    
    // Update bulk actions visibility
    function updateBulkActionsVisibility() {
        if (!elements.contactsBulkActions) return;
        
        if (selectedContacts.size > 0) {
            elements.contactsBulkActions.classList.remove('hidden');
            if (elements.contactsSelectedCount) {
                elements.contactsSelectedCount.textContent = selectedContacts.size.toString();
            }
        } else {
            elements.contactsBulkActions.classList.add('hidden');
        }
    }
    
    // Deselect all contacts
    function deselectAll() {
        selectedContacts.clear();
        
        document.querySelectorAll('.contact-checkbox').forEach(checkbox => {
            checkbox.checked = false;
            const row = checkbox.closest('tr');
            if (row) {
                row.classList.remove('bg-yellow-50');
            }
        });
        
        if (elements.contactsSelectAll) {
            elements.contactsSelectAll.checked = false;
            elements.contactsSelectAll.indeterminate = false;
        }
        
        updateBulkActionsVisibility();
    }
    
    // Copy selected numbers
    function copySelectedNumbers() {
        if (selectedContacts.size === 0) {
            alert('No contacts selected');
            return;
        }
        
        const selectedNumbers = allContacts
            .filter(c => selectedContacts.has(c.id))
            .map(c => c.number)
            .filter(Boolean);
        
        const numbersText = selectedNumbers.join('\n');
        
        navigator.clipboard.writeText(numbersText)
            .then(() => {
                alert(`Copied ${selectedNumbers.length} numbers to clipboard!\n\nYou can paste these in a spreadsheet or use them in the Bulk Messages section.`);
            })
            .catch(err => {
                console.error('Copy failed:', err);
                // Fallback
                const textArea = document.createElement('textarea');
                textArea.value = numbersText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert(`Copied ${selectedNumbers.length} numbers to clipboard!`);
            });
    }
    
    // Update tags for selected contacts
    async function updateSelectedTags(action) {
        const tagsInput = elements.contactsTagInput?.value.trim();
        
        if (!tagsInput) {
            alert('Please enter tags to ' + (action === 'add' ? 'assign' : 'remove'));
            return;
        }
        
        if (selectedContacts.size === 0) {
            alert('No contacts selected');
            return;
        }
        
        try {
            const response = await fetch('/api/contacts/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contactIds: Array.from(selectedContacts),
                    tags: tagsInput,
                    action: action
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to update tags');
            }
            
            // Update local data
            allContacts.forEach(contact => {
                if (selectedContacts.has(contact.id)) {
                    if (action === 'add') {
                        const existingTags = contact.tags ? contact.tags.split(',').map(t => t.trim()).filter(t => t) : [];
                        const newTags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
                        const combinedTags = [...new Set([...existingTags, ...newTags])];
                        contact.tags = combinedTags.join(', ');
                    } else {
                        const existingTags = contact.tags ? contact.tags.split(',').map(t => t.trim()).filter(t => t) : [];
                        const tagsToRemove = new Set(tagsInput.split(',').map(t => t.trim().toLowerCase()));
                        const filteredTags = existingTags.filter(t => !tagsToRemove.has(t.toLowerCase()));
                        contact.tags = filteredTags.join(', ');
                    }
                }
            });
            
            // Update unique tags
            uniqueTags = data.uniqueTags || [];
            updateTagFilterOptions();
            
            // Clear input
            if (elements.contactsTagInput) elements.contactsTagInput.value = '';
            
            // Re-render
            renderContacts();
            
            alert(`Tags ${action === 'add' ? 'assigned to' : 'removed from'} ${data.updatedCount} contacts`);
            
        } catch (err) {
            console.error('[CONTACTS] Failed to update tags:', err);
            alert('Failed to update tags: ' + err.message);
        }
    }
    
    // Open edit tags modal
    function openEditTagsModal(e) {
        const btn = e.target;
        const contactId = btn.dataset.id;
        const contactName = btn.dataset.name;
        const currentTags = btn.dataset.tags;
        
        if (elements.editTagsContactName) elements.editTagsContactName.textContent = contactName;
        if (elements.editTagsInput) elements.editTagsInput.value = currentTags;
        if (elements.editTagsContactId) elements.editTagsContactId.value = contactId;
        if (elements.editTagsModal) elements.editTagsModal.classList.remove('hidden');
    }
    
    // Close edit tags modal
    function closeEditTagsModal() {
        if (elements.editTagsModal) elements.editTagsModal.classList.add('hidden');
    }
    
    // Save contact tags from modal
    async function saveContactTags() {
        const contactId = elements.editTagsContactId?.value;
        const newTags = elements.editTagsInput?.value.trim() || '';
        
        if (!contactId) return;
        
        try {
            const response = await fetch('/api/contacts/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contactIds: [contactId],
                    tags: newTags,
                    action: 'replace'
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to save tags');
            }
            
            // Update local data
            const contact = allContacts.find(c => c.id === contactId);
            if (contact) {
                contact.tags = newTags;
            }
            
            // Update unique tags
            uniqueTags = data.uniqueTags || [];
            updateTagFilterOptions();
            
            // Close modal and re-render
            closeEditTagsModal();
            renderContacts();
            
        } catch (err) {
            console.error('[CONTACTS] Failed to save tags:', err);
            alert('Failed to save tags: ' + err.message);
        }
    }
    
    // Download contacts as CSV (Google Contacts format)
    function downloadContactsCSV() {
        const contactsToExport = selectedContacts.size > 0 
            ? allContacts.filter(c => selectedContacts.has(c.id))
            : filteredContacts;
        
        if (contactsToExport.length === 0) {
            alert('No contacts to export');
            return;
        }
        
        // Google Contacts CSV format
        const headers = [
            'Name',
            'Given Name',
            'Family Name',
            'Phone 1 - Type',
            'Phone 1 - Value',
            'Notes'
        ];
        
        const rows = contactsToExport.map(contact => {
            const name = contact.name || contact.pushname || contact.number;
            const nameParts = name.split(' ');
            const givenName = nameParts[0] || '';
            const familyName = nameParts.slice(1).join(' ') || '';
            
            // Notes include tags and other metadata
            const notes = [
                contact.tags ? `Tags: ${contact.tags}` : '',
                contact.isBusiness ? 'Business Account' : '',
                contact.pushname && contact.pushname !== name ? `Push Name: ${contact.pushname}` : ''
            ].filter(Boolean).join('; ');
            
            return [
                name,
                givenName,
                familyName,
                'Mobile',
                '+' + contact.number,
                notes
            ];
        });
        
        // Create CSV content
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
        ].join('\n');
        
        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        alert(`Downloaded ${contactsToExport.length} contacts as CSV`);
    }
    
    // Utility functions
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }
    
    function showLoading() {
        if (elements.contactsLoading) elements.contactsLoading.classList.remove('hidden');
        if (elements.contactsError) elements.contactsError.classList.add('hidden');
        if (elements.contactsEmpty) elements.contactsEmpty.classList.add('hidden');
    }
    
    function hideLoading() {
        if (elements.contactsLoading) elements.contactsLoading.classList.add('hidden');
    }
    
    function showError(message) {
        if (elements.contactsError) {
            elements.contactsError.textContent = message;
            elements.contactsError.classList.remove('hidden');
        }
        hideLoading();
    }
    
    function showEmpty() {
        if (elements.contactsEmpty) elements.contactsEmpty.classList.remove('hidden');
    }
    
    // Global functions
    window.copyToClipboard = function(number) {
        navigator.clipboard.writeText(number)
            .then(() => alert('Number copied!'))
            .catch(() => {
                const textArea = document.createElement('textarea');
                textArea.value = number;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert('Number copied!');
            });
    };
    
    window.sendMessageToContact = function(number) {
        const sendTab = document.querySelector('[data-tab="send"]');
        const recipientInput = document.getElementById('recipient-input');
        
        if (sendTab && recipientInput) {
            sendTab.click();
            recipientInput.value = number;
            recipientInput.dispatchEvent(new Event('input'));
        } else {
            window.copyToClipboard(number);
        }
    };
    
    // Expose module
    window.ContactsTab = {
        init: initContactsTab,
        loadContacts,
        syncContacts
    };
    
    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initContactsTab);
    } else {
        initContactsTab();
    }
    
})();
