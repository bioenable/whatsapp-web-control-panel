// === BULK TAB MODULE ===
// All functionality related to the Bulk Messaging tab
// Based on the working implementation from old-main.js

(function() {
    'use strict';
    
    // DOM Elements for Bulk Tab
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
    const downloadSampleCsvBtn = document.getElementById('download-sample-csv');
    
    // Bulk Form Elements
    const bulkFormBtn = document.getElementById('bulk-form-btn');
    const bulkFormModal = document.getElementById('bulk-form-modal');
    const closeBulkFormModal = document.getElementById('close-bulk-form-modal');
    const bulkScheduleForm = document.getElementById('bulk-schedule-form');
    const bulkNumbers = document.getElementById('bulk-numbers');
    const bulkMessage = document.getElementById('bulk-message');
    const bulkMedia = document.getElementById('bulk-media');
    const bulkStartDatetime = document.getElementById('bulk-start-datetime');
    const bulkDelay = document.getElementById('bulk-delay');
    const bulkPreviewBtn = document.getElementById('bulk-preview-btn');
    const bulkPreviewSection = document.getElementById('bulk-preview-section');
    const bulkPreviewContent = document.getElementById('bulk-preview-content');
    const cancelBulkForm = document.getElementById('cancel-bulk-form');

    // Bulk Tab State Variables
    let bulkRecords = [];
    let bulkPage = 1;
    let bulkLimit = 100;
    let bulkTotal = 0;
    let bulkCurrentImport = '';
    let bulkTimezone = 'Asia/Kolkata';
    let bulkNow = new Date();
    let bulkTestDropdown;

    // Initialize Bulk Tab
    function initBulkTab() {
        if (!bulkImportForm) return;

        // Set up event listeners
        const bulkTabBtn = document.getElementById('bulk-tab');
        if (bulkTabBtn) {
            bulkTabBtn.addEventListener('click', () => {
                bulkPage = 1;
                loadBulkImports();
                loadBulkImportFilenames();
                updateBulkTimezoneInfo();
            });
        }

        bulkImportForm.addEventListener('submit', handleBulkImport);
        
        if (bulkImportFilter) {
            bulkImportFilter.addEventListener('change', () => {
                bulkCurrentImport = bulkImportFilter.value;
                bulkPage = 1;
                loadBulkImports();
            });
        }

        if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', handleBulkDelete);
        if (bulkCancelBtn) bulkCancelBtn.addEventListener('click', handleBulkCancel);
        
        if (bulkPrevPage) {
            bulkPrevPage.addEventListener('click', () => {
                if (bulkPage > 1) {
                    bulkPage--;
                    loadBulkImports();
                }
            });
        }
        
        if (bulkNextPage) {
            bulkNextPage.addEventListener('click', () => {
                if (bulkPage * bulkLimit < bulkTotal) {
                    bulkPage++;
                    loadBulkImports();
                }
            });
        }

        if (downloadSampleCsvBtn) {
            downloadSampleCsvBtn.addEventListener('click', downloadSampleCsv);
        }

        // Bulk Form Event Listeners
        if (bulkFormBtn) {
            bulkFormBtn.addEventListener('click', openBulkForm);
        }
        
        if (closeBulkFormModal) {
            closeBulkFormModal.addEventListener('click', closeBulkForm);
        }
        
        if (cancelBulkForm) {
            cancelBulkForm.addEventListener('click', closeBulkForm);
        }
        
        if (bulkScheduleForm) {
            bulkScheduleForm.addEventListener('submit', handleBulkScheduleSubmit);
        }
        
        if (bulkNumbers) {
            bulkNumbers.addEventListener('input', updateBulkFormCounts);
        }
        
        if (bulkDelay) {
            bulkDelay.addEventListener('input', updateBulkScheduleSummary);
        }
        
        if (bulkStartDatetime) {
            bulkStartDatetime.addEventListener('change', updateBulkScheduleSummary);
        }
        
        if (bulkPreviewBtn) {
            bulkPreviewBtn.addEventListener('click', showBulkPreview);
        }
        
        if (bulkMedia) {
            bulkMedia.addEventListener('change', (e) => {
                updateBulkScheduleSummary();
                showBulkMediaPreview(e.target.files[0]);
            });
        }

        // Update timezone info
        updateBulkTimezoneInfo();
    }

    // Update Bulk Timezone Info
    function updateBulkTimezoneInfo() {
        fetch('/api/time')
            .then(res => res.json())
            .then(data => {
                bulkTimezone = data.timezone || 'Asia/Kolkata';
                bulkNow = new Date(data.iso);
                const bulkTimezoneInfo = document.getElementById('bulk-timezone-info');
                if (bulkTimezoneInfo) {
                    bulkTimezoneInfo.textContent = `Current time: ${data.now} (${bulkTimezone})`;
                }
            })
            .catch(err => console.error('Failed to get timezone info:', err));
    }

    // Download Sample CSV
    function downloadSampleCsv() {
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
    }

    // Handle Bulk Import
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

    // Load Bulk Imports
    function loadBulkImports() {
        let url = `/api/bulk?page=${bulkPage}&limit=${bulkLimit}`;
        if (bulkCurrentImport) url += `&import_filename=${encodeURIComponent(bulkCurrentImport)}`;
        
        fetch(url)
            .then(res => res.json())
            .then(data => {
                bulkRecords = data.records;
                bulkTotal = data.total;
                renderBulkList();
                updateBulkPagination();
            })
            .catch(err => {
                if (bulkListContainer) {
                    bulkListContainer.innerHTML = `<div class="text-red-600">Failed to load records: ${escapeHtml(err.message)}</div>`;
                }
            });
    }

    // Render Bulk List
    function renderBulkList() {
        if (!bulkList) return;
        
        if (!bulkRecords || bulkRecords.length === 0) {
            bulkList.innerHTML = '<tr><td colspan="9" class="text-center text-gray-400 py-4">No records found.</td></tr>';
            if (bulkPageInfo) bulkPageInfo.textContent = '';
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
        
        updateBulkPagination();
        
        // Add event listeners for Test buttons
        bulkList.querySelectorAll('.test-bulk-btn').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                const uid = this.getAttribute('data-uid');
                showBulkTestOptions(this, uid);
            });
        });
    }

    // Render Bulk Status
    function renderBulkStatus(status) {
        if (status === 'pending') return '<span class="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded text-xs">Pending</span>';
        if (status === 'sent') return '<span class="bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs">Sent</span>';
        if (status === 'canceled') return '<span class="bg-gray-200 text-gray-600 px-2 py-0.5 rounded text-xs">Canceled</span>';
        if (status === 'cancelled') return '<span class="bg-gray-200 text-gray-600 px-2 py-0.5 rounded text-xs">Cancelled</span>';
        if (status === 'failed') return '<span class="bg-red-100 text-red-800 px-2 py-0.5 rounded text-xs">Failed</span>';
        return escapeHtml(status);
    }

    // Update Bulk Pagination
    function updateBulkPagination() {
        if (bulkPageInfo) {
            const start = (bulkPage - 1) * bulkLimit + 1;
            const end = Math.min(bulkPage * bulkLimit, bulkTotal);
            bulkPageInfo.textContent = `Showing ${start}-${end} of ${bulkTotal}`;
        }
        
        if (bulkPrevPage) bulkPrevPage.disabled = bulkPage <= 1;
        if (bulkNextPage) bulkNextPage.disabled = bulkPage * bulkLimit >= bulkTotal;
    }

    // Load Bulk Import Filenames
    function loadBulkImportFilenames() {
        fetch('/api/bulk?page=1&limit=10000')
            .then(res => res.json())
            .then(data => {
                if (bulkImportFilter) {
                    const filenames = Array.from(new Set(data.records.map(r => r.import_filename)));
                    bulkImportFilter.innerHTML = '<option value="">-- All --</option>';
                    filenames.forEach(f => {
                        const opt = document.createElement('option');
                        opt.value = f;
                        opt.textContent = f;
                        bulkImportFilter.appendChild(opt);
                    });
                }
            })
            .catch(err => console.error('Failed to load import filenames:', err));
    }

    // Handle Bulk Delete
    function handleBulkDelete() {
        const filename = bulkImportFilter ? bulkImportFilter.value : '';
        if (!filename) return alert('Select an import filename to delete.');
        if (!confirm('Delete all records for this import?')) return;
        
        fetch(`/api/bulk/${encodeURIComponent(filename)}`, { method: 'DELETE' })
            .then(res => res.json())
            .then(() => {
                loadBulkImports();
                loadBulkImportFilenames();
            })
            .catch(err => alert(`Delete failed: ${err.message}`));
    }

    // Handle Bulk Cancel
    function handleBulkCancel() {
        const filename = bulkImportFilter ? bulkImportFilter.value : '';
        if (!filename) return alert('Select an import filename to cancel.');
        if (!confirm('Cancel all pending records for this import?')) return;
        
        fetch(`/api/bulk/cancel/${encodeURIComponent(filename)}`, { method: 'POST' })
            .then(res => res.json())
            .then(() => {
                loadBulkImports();
            })
            .catch(err => alert(`Cancel failed: ${err.message}`));
    }

    // Show Bulk Test Options Dropdown
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

    // Close Bulk Test Dropdown
    function closeBulkTestDropdown(e) {
        if (bulkTestDropdown) bulkTestDropdown.remove();
    }

    // === BULK FORM FUNCTIONS ===
    
    // Utility function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function openBulkForm() {
        if (!bulkFormModal) return;
        
        // Set default datetime to 5 minutes from now
        const now = new Date();
        const defaultTime = new Date(now.getTime() + 5 * 60 * 1000);
        const defaultDatetime = defaultTime.toISOString().slice(0, 16);
        
        if (bulkStartDatetime) {
            bulkStartDatetime.value = defaultDatetime;
        }
        
        // Reset form
        if (bulkScheduleForm) {
            bulkScheduleForm.reset();
        }
        
        // Reset preview
        if (bulkPreviewSection) {
            bulkPreviewSection.classList.add('hidden');
        }
        
        // Clear media preview
        const mediaPreview = document.getElementById('bulk-media-preview');
        if (mediaPreview) {
            mediaPreview.innerHTML = '';
        }
        
        // Update counts
        updateBulkFormCounts();
        updateBulkScheduleSummary();
        
        // Show modal
        bulkFormModal.classList.remove('hidden');
        
        // Close modal when clicking outside
        bulkFormModal.addEventListener('click', (e) => {
            if (e.target === bulkFormModal) {
                closeBulkForm();
            }
        });
    }
    
    function closeBulkForm() {
        if (bulkFormModal) {
            bulkFormModal.classList.add('hidden');
        }
    }
    
    function updateBulkFormCounts() {
        if (!bulkNumbers) return;
        
        const text = bulkNumbers.value;
        const charCount = text.length;
        const numbers = parsePhoneNumbers(text);
        const numberCount = numbers.length;
        
        const charCountEl = document.getElementById('bulk-numbers-count');
        const numberCountEl = document.getElementById('bulk-numbers-count-display');
        
        if (charCountEl) {
            charCountEl.textContent = charCount;
            charCountEl.className = charCount > 7000 ? 'text-red-600' : 'text-gray-500';
        }
        
        if (numberCountEl) {
            numberCountEl.textContent = numberCount;
            numberCountEl.className = numberCount > 500 ? 'text-red-600' : 'text-gray-500';
        }
        
        updateBulkScheduleSummary();
    }
    
    function parsePhoneNumbers(text) {
        if (!text) return [];
        
        return text.split(',')
            .map(num => num.trim())
            .filter(num => num.length > 0)
            .map(num => {
                // Remove any non-digit characters except + at the beginning
                let cleaned = num.replace(/[^\d+]/g, '');
                // Ensure it starts with country code (add 91 if not present)
                if (!cleaned.startsWith('+') && !cleaned.startsWith('91')) {
                    cleaned = '91' + cleaned;
                }
                return cleaned;
            })
            .filter(num => num.length >= 10);
    }
    
    function updateBulkScheduleSummary() {
        if (!bulkNumbers || !bulkDelay || !bulkStartDatetime) return;
        
        const numbers = parsePhoneNumbers(bulkNumbers.value);
        const delay = parseInt(bulkDelay.value) || 1;
        const startTime = new Date(bulkStartDatetime.value);
        
        const totalNumbers = numbers.length;
        const totalDelay = (totalNumbers - 1) * delay; // No delay for first message
        const endTime = new Date(startTime.getTime() + totalDelay * 1000);
        
        const summaryCount = document.getElementById('summary-count');
        const summaryDuration = document.getElementById('summary-duration');
        const summaryEndTime = document.getElementById('summary-end-time');
        
        if (summaryCount) {
            summaryCount.textContent = totalNumbers;
        }
        
        if (summaryDuration) {
            const minutes = Math.floor(totalDelay / 60);
            const seconds = totalDelay % 60;
            summaryDuration.textContent = `${minutes}m ${seconds}s`;
        }
        
        if (summaryEndTime) {
            summaryEndTime.textContent = endTime.toLocaleString();
        }
    }
    
    function showBulkMediaPreview(file) {
        const previewDiv = document.getElementById('bulk-media-preview');
        if (!previewDiv) return;
        
        if (!file) {
            previewDiv.innerHTML = '';
            return;
        }
        
        let previewHtml = '<div class="border rounded p-2 bg-gray-50">';
        previewHtml += `<div class="text-xs text-gray-600 mb-1">Selected: ${file.name}</div>`;
        
        if (file.type.startsWith('image/')) {
            previewHtml += `<img src="${URL.createObjectURL(file)}" class="max-w-full h-32 object-contain rounded" alt="Preview">`;
        } else if (file.type.startsWith('video/')) {
            previewHtml += `<video src="${URL.createObjectURL(file)}" class="max-w-full h-32 object-contain rounded" controls></video>`;
        } else {
            previewHtml += `<div class="flex items-center p-2 bg-white rounded">📎 ${file.name}</div>`;
        }
        
        previewHtml += '</div>';
        previewDiv.innerHTML = previewHtml;
    }
    
    function showBulkPreview() {
        if (!bulkMessage || !bulkPreviewContent) return;
        
        const message = bulkMessage.value;
        const mediaFile = bulkMedia.files[0];
        
        let previewHtml = '<div class="max-w-sm mx-auto bg-white rounded-lg shadow-lg p-4">';
        previewHtml += '<div class="flex items-center mb-3">';
        previewHtml += '<div class="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white font-bold">W</div>';
        previewHtml += '<div class="ml-3">';
        previewHtml += '<div class="font-semibold text-sm">WhatsApp</div>';
        previewHtml += '<div class="text-xs text-gray-500">now</div>';
        previewHtml += '</div>';
        previewHtml += '</div>';
        
        if (mediaFile) {
            if (mediaFile.type.startsWith('image/')) {
                previewHtml += `<img src="${URL.createObjectURL(mediaFile)}" class="w-full rounded mb-2" alt="Preview">`;
            } else if (mediaFile.type.startsWith('video/')) {
                previewHtml += `<video src="${URL.createObjectURL(mediaFile)}" class="w-full rounded mb-2" controls></video>`;
            } else {
                previewHtml += `<div class="bg-gray-100 p-3 rounded mb-2">📎 ${mediaFile.name}</div>`;
            }
        }
        
        if (message) {
            previewHtml += `<div class="bg-green-100 p-3 rounded-lg text-sm">${escapeHtml(message)}</div>`;
        }
        
        previewHtml += '</div>';
        
        bulkPreviewContent.innerHTML = previewHtml;
        bulkPreviewSection.classList.remove('hidden');
    }
    
    function handleBulkScheduleSubmit(e) {
        e.preventDefault();
        
        if (!bulkNumbers || !bulkMessage || !bulkStartDatetime || !bulkDelay) return;
        
        const numbers = parsePhoneNumbers(bulkNumbers.value);
        const message = bulkMessage.value.trim();
        const startDatetime = bulkStartDatetime.value;
        const delay = parseInt(bulkDelay.value);
        const mediaFile = bulkMedia.files[0];
        
        // Handle media file upload first if present
        let mediaUrl = '';
        if (mediaFile) {
            const mediaFormData = new FormData();
            mediaFormData.append('media', mediaFile);
            
            // Upload media file first
            return fetch('/api/upload-media', {
                method: 'POST',
                body: mediaFormData
            })
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    throw new Error('Media upload failed: ' + data.error);
                }
                mediaUrl = data.url;
                return createAndSubmitBulkSchedule(numbers, message, startDatetime, delay, mediaUrl);
            })
            .catch(err => {
                alert('Failed to upload media: ' + err.message);
            });
        } else {
            return createAndSubmitBulkSchedule(numbers, message, startDatetime, delay, '');
        }
    }
    
    function createAndSubmitBulkSchedule(numbers, message, startDatetime, delay, mediaUrl) {
        
        // Validation
        if (numbers.length === 0) {
            alert('Please enter at least one valid phone number.');
            return;
        }
        
        if (numbers.length > 500) {
            alert('Maximum 500 phone numbers allowed.');
            return;
        }
        
        if (bulkNumbers.value.length > 7000) {
            alert('Phone numbers text exceeds 7000 characters limit.');
            return;
        }
        
        if (!message) {
            alert('Please enter a message.');
            return;
        }
        
        if (!startDatetime) {
            alert('Please select a start date and time.');
            return;
        }
        
        if (delay < 1 || delay > 3600) {
            alert('Delay must be between 1 and 3600 seconds.');
            return;
        }
        
        // Create CSV content
        const csvContent = createBulkCsvContent(numbers, message, startDatetime, delay, mediaUrl);
        
        // Create form data for upload
        const formData = new FormData();
        const csvBlob = new Blob([csvContent], { type: 'text/csv' });
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `bulk-form-${timestamp}.csv`;
        formData.append('csv', csvBlob, filename);
        
        // Show loading state
        const submitBtn = bulkScheduleForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating Schedule...';
        
        // Upload the generated CSV
        fetch('/api/bulk/import', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(data => {
            if (data.errors > 0) {
                alert(`${data.errors} record(s) were not imported due to missing or invalid fields.`);
            } else {
                alert(`Successfully created bulk schedule for ${numbers.length} numbers!`);
            }
            
            // Close modal and refresh
            closeBulkForm();
            loadBulkImports();
            loadBulkImportFilenames();
        })
        .catch(err => {
            alert('Failed to create bulk schedule: ' + err.message);
        })
        .finally(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        });
    }
    
    function createBulkCsvContent(numbers, message, startDatetime, delay, mediaUrl = '') {
        const startTime = new Date(startDatetime);
        let csv = 'number,message,media,send_datetime\n';
        
        numbers.forEach((number, index) => {
            const messageTime = new Date(startTime.getTime() + index * delay * 1000);
            const formattedTime = messageTime.toLocaleString('sv-SE', { timeZone: bulkTimezone }).replace(' ', 'T');
            
            csv += `"${number}","${message.replace(/"/g, '""')}","${mediaUrl}",${formattedTime}\n`;
        });
        
        return csv;
    }

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBulkTab);
    } else {
        initBulkTab();
    }

    // Expose functions to global scope
    window.BulkTab = {
        init: initBulkTab,
        loadBulkImports,
        updateBulkTimezoneInfo
    };

})(); 