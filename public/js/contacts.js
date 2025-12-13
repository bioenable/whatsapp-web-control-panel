// === CONTACTS TAB MODULE ===
// All functionality related to the Contacts Management tab

(function() {
    'use strict';
    
    // DOM Elements for Contacts Tab
    const contactsTab = document.getElementById('contacts-tab');
    const contactsList = document.getElementById('contacts-list');
    const contactsSearch = document.getElementById('contacts-search');
    const contactsSearchBtn = document.getElementById('contacts-search-btn');
    const searchBtnText = document.getElementById('search-btn-text');
    const searchLoading = document.getElementById('search-loading');
    const contactsClearBtn = document.getElementById('contacts-clear-btn');
    const contactsCount = document.getElementById('contacts-count');
    const copyContactsBtn = document.getElementById('copy-contacts-btn');
    const contactsLoading = document.getElementById('contacts-loading');
    const contactsError = document.getElementById('contacts-error');
    const contactsEmpty = document.getElementById('contacts-empty');
    const contactsPrevPage = document.getElementById('contacts-prev-page');
    const contactsNextPage = document.getElementById('contacts-next-page');
    const contactsPageInfo = document.getElementById('contacts-page-info');
    
    // Add Contacts Form Elements
    const addContactsBtn = document.getElementById('add-contacts-btn');
    const addContactsForm = document.getElementById('add-contacts-form');
    const closeAddContactsBtn = document.getElementById('close-add-contacts-btn');
    const contactsInput = document.getElementById('contacts-input');
    const contactsCountDisplay = document.getElementById('contacts-count-display');
    const addContactsSubmitBtn = document.getElementById('add-contacts-submit-btn');
    const addContactsBtnText = document.getElementById('add-contacts-btn-text');
    const addContactsLoading = document.getElementById('add-contacts-loading');
    const addContactsResults = document.getElementById('add-contacts-results');
    const addContactsLogs = document.getElementById('add-contacts-logs');

    // Contacts Tab State Variables
    let allContacts = [];
    let currentPage = 1;
    let contactsPerPage = 1000;
    let totalContacts = 0;
    let totalPages = 1;
    let currentSearch = '';

    // Initialize Contacts Tab
    function initContactsTab() {
        if (!contactsTab) return;

        // Add click handler to load contacts when tab is clicked
        contactsTab.addEventListener('click', () => {
            // Always try to load contacts when tab is clicked (API will handle if not ready)
            loadContacts();
        });

        // Set up event listeners
        // Use MutationObserver to detect when contacts tab becomes visible
        const contactsPane = document.getElementById('contacts');
        if (contactsPane) {
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const isVisible = !contactsPane.classList.contains('hidden');
                        if (isVisible) {
                            loadContacts();
                        }
                    }
                });
            });
            
            observer.observe(contactsPane, {
                attributes: true,
                attributeFilter: ['class']
            });
        }

        if (copyContactsBtn) {
            copyContactsBtn.addEventListener('click', copyContactNumbers);
        }

        if (addContactsBtn) {
            addContactsBtn.addEventListener('click', showAddContactsForm);
        }

        if (closeAddContactsBtn) {
            closeAddContactsBtn.addEventListener('click', hideAddContactsForm);
        }

        if (contactsInput) {
            contactsInput.addEventListener('input', updateContactsCount);
        }

        if (addContactsSubmitBtn) {
            addContactsSubmitBtn.addEventListener('click', handleAddContactsSubmit);
        }

        if (contactsSearchBtn) {
            contactsSearchBtn.addEventListener('click', performSearch);
        }

        if (contactsClearBtn) {
            contactsClearBtn.addEventListener('click', clearSearch);
        }

        if (contactsSearch) {
            contactsSearch.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    performSearch();
                }
            });
        }
        
        if (contactsPrevPage) {
            contactsPrevPage.addEventListener('click', () => {
                if (currentPage > 1) {
                    loadContacts(currentPage - 1, currentSearch);
                }
            });
        }
        
        if (contactsNextPage) {
            contactsNextPage.addEventListener('click', () => {
                if (currentPage < totalPages) {
                    loadContacts(currentPage + 1, currentSearch);
                }
            });
        }
    }

    // Load contacts from JSON file with pagination
    function loadContacts(page = 1, search = '') {
        if (!contactsList) {
            console.error('Contacts list element not found');
            return Promise.reject(new Error('Contacts list element not found'));
        }
        
        showLoading();
        
        const params = new URLSearchParams({
            page: page,
            limit: contactsPerPage
        });
        
        if (search) {
            params.append('search', search);
        }
        
        return fetch(`/api/contacts?${params}`)
            .then(res => {
                if (!res.ok) {
                    if (res.status === 503) {
                        throw new Error('WhatsApp client not ready. Please wait...');
                    }
                    throw new Error(`HTTP error! status: ${res.status}`);
                }
                return res.json();
            })
            .then(data => {
                if (data.error) {
                    throw new Error(data.error);
                }
                
                if (!Array.isArray(data.contacts)) {
                    throw new Error('Invalid response format: expected contacts array');
                }
                
                allContacts = data.contacts || [];
                totalContacts = data.total || 0;
                currentPage = data.page || 1;
                totalPages = data.totalPages || 1;
                currentSearch = search;
                
                console.log(`Loaded ${allContacts.length} contacts (page ${currentPage}/${totalPages}, total: ${totalContacts})`);
                
                renderContacts();
                updateContactCount();
                updatePagination();
                hideLoading();
                
                return data;
            })
            .catch(err => {
                console.error('Failed to load contacts:', err);
                const errorMsg = err.message.includes('not ready') 
                    ? 'WhatsApp not ready. Waiting for connection...'
                    : `Failed to load contacts: ${err.message}`;
                showError(errorMsg);
                hideLoading();
                throw err;
            });
    }
    


    // Perform search with loading animation
    function performSearch() {
        if (!contactsSearch) return;
        
        const searchTerm = contactsSearch.value.toLowerCase().trim();
        
        // Show loading animation
        if (searchBtnText) searchBtnText.textContent = 'Searching...';
        if (searchLoading) searchLoading.classList.remove('hidden');
        if (contactsSearchBtn) contactsSearchBtn.disabled = true;
        
        // Always use server-side search
        currentPage = 1;
        loadContacts(1, searchTerm)
            .finally(() => {
                // Hide loading animation
                if (searchBtnText) searchBtnText.textContent = 'Search';
                if (searchLoading) searchLoading.classList.add('hidden');
                if (contactsSearchBtn) contactsSearchBtn.disabled = false;
            });
    }

    // Clear search and show all contacts
    function clearSearch() {
        if (!contactsSearch) return;
        
        contactsSearch.value = '';
        currentPage = 1;
        loadContacts(1, '');
    }

    // Render contacts table
    function renderContacts() {
        if (!contactsList) return;
        
        if (allContacts.length === 0) {
            contactsList.innerHTML = '<tr><td colspan="4" class="text-center text-gray-400 py-8">No contacts found.</td></tr>';
            return;
        }
        
        contactsList.innerHTML = '';
        
        allContacts.forEach(contact => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            
            // Avatar
            const avatarCell = document.createElement('td');
            avatarCell.className = 'px-4 py-3';
            if (contact.avatar) {
                avatarCell.innerHTML = `<img src="${contact.avatar}" class="w-10 h-10 rounded-full object-cover" alt="Avatar">`;
            } else {
                avatarCell.innerHTML = `<div class="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-semibold">${getInitials(contact.name || contact.pushname || contact.number)}</div>`;
            }
            
            // Name
            const nameCell = document.createElement('td');
            nameCell.className = 'px-4 py-3 text-sm';
            nameCell.textContent = contact.name || 'N/A';
            
            // Number
            const numberCell = document.createElement('td');
            numberCell.className = 'px-4 py-3 text-sm font-mono';
            numberCell.textContent = contact.number || 'N/A';
            
            // Actions
            const actionsCell = document.createElement('td');
            actionsCell.className = 'px-4 py-3 text-sm';
            actionsCell.innerHTML = `
                <button class="text-blue-600 hover:text-blue-800 text-xs mr-2" onclick="copyToClipboard('${contact.number}')">Copy Number</button>
                <button class="text-green-600 hover:text-green-800 text-xs" onclick="sendMessageToContact('${contact.number}')">Send Message</button>
            `;
            
            tr.appendChild(avatarCell);
            tr.appendChild(nameCell);
            tr.appendChild(numberCell);
            tr.appendChild(actionsCell);
            
            contactsList.appendChild(tr);
        });
    }

    // Update contact count display
    function updateContactCount() {
        if (!contactsCount) return;
        
        if (currentSearch) {
            // For search results, show current page info
            const start = (currentPage - 1) * contactsPerPage + 1;
            const end = Math.min(currentPage * contactsPerPage, totalContacts);
            contactsCount.textContent = `Showing ${start}-${end} of ${totalContacts} contacts`;
        } else {
            // For normal view, show total contacts
            contactsCount.textContent = `${totalContacts} contacts`;
        }
    }
    
    // Update pagination controls
    function updatePagination() {
        if (!contactsPageInfo) return;
        
        const start = (currentPage - 1) * contactsPerPage + 1;
        const end = Math.min(currentPage * contactsPerPage, totalContacts);
        
        contactsPageInfo.textContent = `Page ${currentPage} of ${totalPages} (${start}-${end} of ${totalContacts})`;
        
        if (contactsPrevPage) {
            contactsPrevPage.disabled = currentPage <= 1;
        }
        
        if (contactsNextPage) {
            contactsNextPage.disabled = currentPage >= totalPages;
        }
    }

    // Copy contact numbers to clipboard
    function copyContactNumbers() {
        // For server-side search, we need to get all contacts that match the current search
        const searchTerm = contactsSearch ? contactsSearch.value.toLowerCase().trim() : '';
        
        if (searchTerm) {
            // If there's a search term, we need to fetch all contacts and filter them
            fetch('/api/contacts?limit=100000') // Large limit to get all contacts
                .then(res => res.json())
                .then(data => {
                    if (data.contacts) {
                        const filtered = data.contacts.filter(contact => {
                            const name = (contact.name || '').toLowerCase();
                            const number = (contact.number || '').toLowerCase();
                            const pushname = (contact.pushname || '').toLowerCase();
                            
                            return name.includes(searchTerm) || 
                                   number.includes(searchTerm) || 
                                   pushname.includes(searchTerm);
                        });
                        
                        copyNumbersToClipboard(filtered);
                    }
                })
                .catch(err => {
                    console.error('Failed to fetch contacts for copying:', err);
                    alert('Failed to fetch contacts for copying');
                });
        } else {
            // If no search term, copy all contacts
            fetch('/api/contacts?limit=100000') // Large limit to get all contacts
                .then(res => res.json())
                .then(data => {
                    if (data.contacts) {
                        copyNumbersToClipboard(data.contacts);
                    }
                })
                .catch(err => {
                    console.error('Failed to fetch contacts for copying:', err);
                    alert('Failed to fetch contacts for copying');
                });
        }
    }
    
    // Helper function to copy numbers to clipboard
    function copyNumbersToClipboard(contacts) {
        const numbers = contacts.map(contact => contact.number).filter(Boolean);
        
        if (numbers.length === 0) {
            alert('No valid numbers found');
            return;
        }
        
        const numbersText = numbers.join(', ');
        
        // Copy to clipboard
        if (navigator.clipboard) {
            navigator.clipboard.writeText(numbersText).then(() => {
                alert(`Copied ${numbers.length} numbers to clipboard`);
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
                fallbackCopyTextToClipboard(numbersText);
            });
        } else {
            fallbackCopyTextToClipboard(numbersText);
        }
    }
    
    // Fallback copy function for older browsers
    function fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert(`Copied ${text.split(',').length} numbers to clipboard!`);
    }

    // Utility functions
    function getInitials(name) {
        if (!name) return '?';
        return name.split(' ')
            .map(word => word.charAt(0))
            .join('')
            .toUpperCase()
            .slice(0, 2);
    }

    function showLoading() {
        if (contactsLoading) contactsLoading.classList.remove('hidden');
        if (contactsError) contactsError.classList.add('hidden');
        if (contactsEmpty) contactsEmpty.classList.add('hidden');
    }

    function hideLoading() {
        if (contactsLoading) contactsLoading.classList.add('hidden');
    }

    function showError(message) {
        if (contactsError) {
            contactsError.textContent = message;
            contactsError.classList.remove('hidden');
        }
        if (contactsLoading) contactsLoading.classList.add('hidden');
        if (contactsEmpty) contactsEmpty.classList.add('hidden');
    }

    // Global functions for inline onclick handlers
    window.copyToClipboard = function(number) {
        navigator.clipboard.writeText(number)
            .then(() => {
                alert('Number copied to clipboard!');
            })
            .catch(err => {
                console.error('Failed to copy:', err);
                // Fallback
                const textArea = document.createElement('textarea');
                textArea.value = number;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert('Number copied to clipboard!');
            });
    };

    window.sendMessageToContact = function(number) {
        // Switch to Send tab and pre-fill the number
        const sendTab = document.querySelector('[data-tab="send"]');
        const recipientInput = document.getElementById('recipient-input');
        
        if (sendTab && recipientInput) {
            sendTab.click();
            recipientInput.value = number;
            recipientInput.dispatchEvent(new Event('input'));
        } else {
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(number)
                .then(() => {
                    alert(`Number ${number} copied to clipboard! You can paste it in the Send tab.`);
                })
                .catch(() => {
                    alert(`Number: ${number}\nPlease copy this number and use it in the Send tab.`);
                });
        }
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initContactsTab);
    } else {
        initContactsTab();
    }
    
    // Check if contacts tab is already visible on page load
    document.addEventListener('DOMContentLoaded', () => {
        const contactsPane = document.getElementById('contacts');
        if (contactsPane && !contactsPane.classList.contains('hidden')) {
            // Contacts tab is already visible, load contacts
            setTimeout(() => {
                loadContacts();
            }, 100);
        }
    });
    


    // Add Contacts Form Functions
    function showAddContactsForm() {
        if (addContactsForm) {
            addContactsForm.classList.remove('hidden');
            if (contactsInput) {
                contactsInput.focus();
            }
        }
    }

    function hideAddContactsForm() {
        if (addContactsForm) {
            addContactsForm.classList.add('hidden');
            if (contactsInput) {
                contactsInput.value = '';
            }
            if (addContactsResults) {
                addContactsResults.classList.add('hidden');
            }
            if (contactsCountDisplay) {
                contactsCountDisplay.textContent = '0 contacts detected';
            }
        }
    }

    function updateContactsCount() {
        if (!contactsInput || !contactsCountDisplay) return;
        
        const text = contactsInput.value.trim();
        if (!text) {
            contactsCountDisplay.textContent = '0 contacts detected';
            return;
        }
        
        const contacts = parseContactsFromText(text);
        
        contactsCountDisplay.textContent = `${contacts.length} contacts detected`;
        
        if (contacts.length > 1000) {
            contactsCountDisplay.textContent += ' (max 1000 allowed)';
            contactsCountDisplay.classList.add('text-red-600');
        } else {
            contactsCountDisplay.classList.remove('text-red-600');
        }
    }

    function parseContactsFromText(text) {
        const lines = text.split('\n').filter(line => line.trim());
        const contacts = [];
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // Split by comma and clean up
            const parts = trimmedLine.split(',').map(part => part.trim()).filter(part => part);
            
            if (parts.length < 2) continue; // Need at least number and name
            
            const number = parts[0];
            const nameParts = parts.slice(1);
            
            if (nameParts.length === 1) {
                // Format 1: number, fullname
                const fullName = nameParts[0];
                const nameSplit = fullName.split(' ').filter(part => part.trim());
                
                if (nameSplit.length === 1) {
                    // Single word name
                    contacts.push({
                        number: number,
                        firstName: nameSplit[0],
                        lastName: '',
                        originalName: fullName
                    });
                } else {
                    // Multiple word name - first word as firstName, rest as lastName
                    contacts.push({
                        number: number,
                        firstName: nameSplit[0],
                        lastName: nameSplit.slice(1).join(' '),
                        originalName: fullName
                    });
                }
            } else {
                // Format 2: number, firstname, lastname
                contacts.push({
                    number: number,
                    firstName: nameParts[0],
                    lastName: nameParts.slice(1).join(' '),
                    originalName: nameParts.join(' ')
                });
            }
        }
        
        return contacts;
    }

    async function handleAddContactsSubmit() {
        if (!contactsInput || !addContactsSubmitBtn || !addContactsLogs) return;
        
        const text = contactsInput.value.trim();
        if (!text) {
            alert('Please enter contacts to add.');
            return;
        }
        
        const contacts = parseContactsFromText(text);
        if (contacts.length === 0) {
            alert('No valid contacts found. Please check the format.');
            return;
        }
        
        if (contacts.length > 1000) {
            alert('Maximum 1000 contacts allowed per request.');
            return;
        }
        
        // Show loading state
        addContactsSubmitBtn.disabled = true;
        addContactsBtnText.textContent = 'Adding Contacts...';
        addContactsLoading.classList.remove('hidden');
        addContactsResults.classList.remove('hidden');
        addContactsLogs.innerHTML = 'Processing contacts...\n';
        
        try {
            const response = await fetch('/api/contacts/add-multiple', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ contacts })
            });
            
            // Check if response is ok
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Server error response:', errorText);
                addContactsLogs.innerHTML = `❌ Server error (${response.status}): ${errorText}`;
                return;
            }
            
            // Check content type
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const responseText = await response.text();
                console.error('Non-JSON response:', responseText);
                addContactsLogs.innerHTML = `❌ Server returned non-JSON response: ${responseText.substring(0, 200)}...`;
                return;
            }
            
            const data = await response.json();
            
            if (data.success) {
                // Display logs
                addContactsLogs.innerHTML = data.logs.join('\n');
                
                // Show summary
                const summary = data.summary;
                const summaryText = `\n📊 Summary: ${summary.successful} successful, ${summary.failed} failed out of ${summary.total} total`;
                addContactsLogs.innerHTML += summaryText;
                
                // Refresh contacts list
                loadContacts();
                
            } else {
                addContactsLogs.innerHTML = `❌ Error: ${data.error}`;
            }
            
        } catch (err) {
            console.error('Fetch error:', err);
            addContactsLogs.innerHTML = `❌ Failed to add contacts: ${err.message}`;
        } finally {
            // Reset loading state
            addContactsSubmitBtn.disabled = false;
            addContactsBtnText.textContent = 'Add Contacts';
            addContactsLoading.classList.add('hidden');
        }
    }

    // Expose functions to global scope
    window.ContactsTab = {
        init: initContactsTab,
        loadContacts,
        performSearch,
        clearSearch,
        showAddContactsForm,
        hideAddContactsForm
    };

})(); 