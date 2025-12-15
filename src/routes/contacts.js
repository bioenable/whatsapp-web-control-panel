const path = require('path');
const fs = require('fs');

// Default contacts file path (fallback if accountPaths not available)
const CONTACTS_FILE = path.join(__dirname, '../../contacts.json');

function setupContactsRoutes(app, { client, getReady, readJson, writeJson, getAccountPaths }) {
    // Don't cache ready state - check it each time
    
    // Helper to get contacts file path
    function getContactsFilePath() {
        const accountPathsObj = getAccountPaths ? getAccountPaths() : null;
        return accountPathsObj && accountPathsObj.contactsFile ? accountPathsObj.contactsFile : CONTACTS_FILE;
    }
    
    // Helper to sync contacts from WhatsApp to local JSON
    async function syncContactsToLocal() {
        const ready = getReady();
        if (!ready) {
            console.log('[CONTACTS-SYNC] WhatsApp not ready, skipping sync');
            return null;
        }
        
        try {
            console.log('[CONTACTS-SYNC] Starting sync from WhatsApp...');
            const waContacts = await client.getContacts();
            console.log(`[CONTACTS-SYNC] Fetched ${waContacts.length} contacts from WhatsApp`);
            
            // Read existing local contacts
            const contactsFilePath = getContactsFilePath();
            let localData = { contacts: [], lastSync: null };
            if (readJson) {
                localData = readJson(contactsFilePath, { contacts: [], lastSync: null });
            } else if (fs.existsSync(contactsFilePath)) {
                try {
                    localData = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
                } catch (e) {
                    console.error('[CONTACTS-SYNC] Error reading local contacts:', e);
                }
            }
            
            // Create a map of existing local contacts by ID for quick lookup
            const localContactsMap = new Map();
            (localData.contacts || []).forEach(c => {
                localContactsMap.set(c.id, c);
            });
            
            // Get IDs of all WhatsApp contacts
            const waContactIds = new Set();
            
            // Process WhatsApp contacts
            const syncedContacts = waContacts
                .filter(contact => {
                    // Filter valid contacts (has user ID, not status broadcast, etc.)
                    return contact.id && 
                           contact.id.user && 
                           contact.id._serialized && 
                           !contact.id._serialized.includes('status@broadcast') &&
                           !contact.id._serialized.includes('@g.us') && // Exclude groups
                           !contact.id._serialized.includes('@newsletter'); // Exclude channels
                })
                .map(contact => {
                    const id = contact.id._serialized;
                    waContactIds.add(id);
                    
                    // Get existing local data for this contact (to preserve tags)
                    const existingLocal = localContactsMap.get(id);
                    
                    return {
                        id: id,
                        number: contact.id.user,
                        name: contact.name || null,
                        pushname: contact.pushname || null,
                        shortName: contact.shortName || null,
                        isMyContact: contact.isMyContact || false,
                        isWAContact: contact.isWAContact || false,
                        isBlocked: contact.isBlocked || false,
                        isBusiness: contact.isBusiness || false,
                        isEnterprise: contact.isEnterprise || false,
                        verified: contact.isVerified || false,
                        // Preserve additional fields from local storage
                        tags: existingLocal ? existingLocal.tags || '' : '',
                        notes: existingLocal ? existingLocal.notes || '' : '',
                        // Timestamps
                        firstSeen: existingLocal ? existingLocal.firstSeen : new Date().toISOString(),
                        lastUpdated: new Date().toISOString()
                    };
                });
            
            // Save synced contacts (removes contacts no longer in WhatsApp)
            const newLocalData = {
                contacts: syncedContacts,
                lastSync: new Date().toISOString(),
                totalContacts: syncedContacts.length,
                removedCount: localData.contacts ? localData.contacts.length - syncedContacts.length : 0
            };
            
            // Count removed contacts
            let removedCount = 0;
            if (localData.contacts) {
                localData.contacts.forEach(c => {
                    if (!waContactIds.has(c.id)) {
                        removedCount++;
                        console.log(`[CONTACTS-SYNC] Removed contact no longer in WhatsApp: ${c.name || c.number} (${c.id})`);
                    }
                });
            }
            newLocalData.removedCount = removedCount;
            
            // Write to file
            if (writeJson) {
                writeJson(contactsFilePath, newLocalData);
            } else {
                fs.writeFileSync(contactsFilePath, JSON.stringify(newLocalData, null, 2));
            }
            
            console.log(`[CONTACTS-SYNC] Sync complete. Total: ${syncedContacts.length}, Removed: ${removedCount}`);
            
            return newLocalData;
        } catch (err) {
            console.error('[CONTACTS-SYNC] Error syncing contacts:', err);
            throw err;
        }
    }
    
    // Get all contacts from local JSON (fast, no WhatsApp call)
    app.get('/api/contacts', (req, res) => {
        try {
            const contactsFilePath = getContactsFilePath();
            let localData = { contacts: [], lastSync: null };
            
            if (readJson) {
                localData = readJson(contactsFilePath, { contacts: [], lastSync: null });
            } else if (fs.existsSync(contactsFilePath)) {
                try {
                    localData = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
                } catch (e) {
                    console.error('[CONTACTS] Error reading local contacts:', e);
                }
            }
            
            const contacts = localData.contacts || [];
            
            // Extract unique tags for filtering
            const allTags = new Set();
            contacts.forEach(c => {
                if (c.tags) {
                    c.tags.split(',').forEach(tag => {
                        const trimmed = tag.trim();
                        if (trimmed) allTags.add(trimmed);
                    });
                }
            });
            
            res.json({
                contacts: contacts,
                total: contacts.length,
                lastSync: localData.lastSync,
                uniqueTags: Array.from(allTags).sort()
            });
        } catch (err) {
            console.error('[CONTACTS] Failed to fetch contacts:', err);
            res.status(500).json({ error: 'Failed to fetch contacts', details: err.message });
        }
    });
    
    // Sync contacts from WhatsApp to local JSON
    app.post('/api/contacts/sync', async (req, res) => {
        try {
            const ready = getReady();
            if (!ready) {
                return res.status(503).json({ error: 'WhatsApp client not ready' });
            }
            
            const result = await syncContactsToLocal();
            
            res.json({
                success: true,
                message: `Synced ${result.totalContacts} contacts`,
                totalContacts: result.totalContacts,
                removedCount: result.removedCount,
                lastSync: result.lastSync
            });
        } catch (err) {
            console.error('[CONTACTS] Failed to sync contacts:', err);
            res.status(500).json({ error: 'Failed to sync contacts', details: err.message });
        }
    });
    
    // Update tags for multiple contacts
    app.post('/api/contacts/tags', (req, res) => {
        try {
            const { contactIds, tags, action } = req.body;
            
            if (!contactIds || !Array.isArray(contactIds) || contactIds.length === 0) {
                return res.status(400).json({ error: 'Contact IDs are required' });
            }
            
            if (tags === undefined) {
                return res.status(400).json({ error: 'Tags are required' });
            }
            
            const contactsFilePath = getContactsFilePath();
            let localData = { contacts: [], lastSync: null };
            
            if (readJson) {
                localData = readJson(contactsFilePath, { contacts: [], lastSync: null });
            } else if (fs.existsSync(contactsFilePath)) {
                try {
                    localData = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
                } catch (e) {
                    console.error('[CONTACTS] Error reading local contacts:', e);
                }
            }
            
            const contactIdSet = new Set(contactIds);
            let updatedCount = 0;
            
            localData.contacts = localData.contacts.map(contact => {
                if (contactIdSet.has(contact.id)) {
                    if (action === 'add') {
                        // Add tags to existing tags
                        const existingTags = contact.tags ? contact.tags.split(',').map(t => t.trim()).filter(t => t) : [];
                        const newTags = tags.split(',').map(t => t.trim()).filter(t => t);
                        const combinedTags = [...new Set([...existingTags, ...newTags])];
                        contact.tags = combinedTags.join(', ');
                    } else if (action === 'remove') {
                        // Remove specific tags
                        const existingTags = contact.tags ? contact.tags.split(',').map(t => t.trim()).filter(t => t) : [];
                        const tagsToRemove = new Set(tags.split(',').map(t => t.trim().toLowerCase()));
                        const filteredTags = existingTags.filter(t => !tagsToRemove.has(t.toLowerCase()));
                        contact.tags = filteredTags.join(', ');
                    } else {
                        // Replace tags
                        contact.tags = tags;
                    }
                    contact.lastUpdated = new Date().toISOString();
                    updatedCount++;
                }
                return contact;
            });
            
            // Write to file
            if (writeJson) {
                writeJson(contactsFilePath, localData);
            } else {
                fs.writeFileSync(contactsFilePath, JSON.stringify(localData, null, 2));
            }
            
            // Get unique tags for response
            const allTags = new Set();
            localData.contacts.forEach(c => {
                if (c.tags) {
                    c.tags.split(',').forEach(tag => {
                        const trimmed = tag.trim();
                        if (trimmed) allTags.add(trimmed);
                    });
                }
            });
            
            res.json({
                success: true,
                message: `Updated tags for ${updatedCount} contacts`,
                updatedCount: updatedCount,
                uniqueTags: Array.from(allTags).sort()
            });
        } catch (err) {
            console.error('[CONTACTS] Failed to update tags:', err);
            res.status(500).json({ error: 'Failed to update tags', details: err.message });
        }
    });
    
    // Get unique tags
    app.get('/api/contacts/tags', (req, res) => {
        try {
            const contactsFilePath = getContactsFilePath();
            let localData = { contacts: [], lastSync: null };
            
            if (readJson) {
                localData = readJson(contactsFilePath, { contacts: [], lastSync: null });
            } else if (fs.existsSync(contactsFilePath)) {
                try {
                    localData = JSON.parse(fs.readFileSync(contactsFilePath, 'utf8'));
                } catch (e) {
                    console.error('[CONTACTS] Error reading local contacts:', e);
                }
            }
            
            const allTags = new Set();
            (localData.contacts || []).forEach(c => {
                if (c.tags) {
                    c.tags.split(',').forEach(tag => {
                        const trimmed = tag.trim();
                        if (trimmed) allTags.add(trimmed);
                    });
                }
            });
            
            res.json({
                tags: Array.from(allTags).sort(),
                total: allTags.size
            });
        } catch (err) {
            console.error('[CONTACTS] Failed to get tags:', err);
            res.status(500).json({ error: 'Failed to get tags', details: err.message });
        }
    });

    // Update contacts from WhatsApp (legacy endpoint - now uses sync)
    app.post('/api/contacts/update', async (req, res) => {
        try {
            const ready = getReady();
            if (!ready) {
                return res.status(503).json({ error: 'WhatsApp client not ready' });
            }
            
            const result = await syncContactsToLocal();
            
            res.json({
                success: true,
                message: `Successfully synced ${result.totalContacts} contacts from WhatsApp`,
                contacts: result.contacts,
                totalContacts: result.totalContacts,
                removedCount: result.removedCount
            });
        } catch (err) {
            console.error('Failed to update contacts:', err);
            res.status(500).json({ error: 'Failed to update contacts', details: err.message });
        }
    });

    // Check if contact exists in WhatsApp
    app.post('/api/contacts/check', async (req, res) => {
        const ready = getReady();
        if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
        
        try {
            const { mobile } = req.body;
            if (!mobile) {
                return res.status(400).json({ error: 'Mobile number is required' });
            }

            // Normalize mobile number
            const normalizedNumber = mobile.replace(/[^0-9]/g, '');
            const chatId = normalizedNumber + '@c.us';
            
            try {
                const contact = await client.getContactById(chatId._serialized || chatId);
                
                if (contact) {
                    const hasProperName = contact.name && 
                                        contact.name !== normalizedNumber && 
                                        contact.name !== `Contact ${normalizedNumber}` &&
                                        contact.name !== 'undefined' &&
                                        contact.name !== undefined &&
                                        contact.name.length > 0;
                    
                    const exists = contact.isMyContact || contact.isWAContact;
                    
                    res.json({ 
                        exists: exists,
                        hasProperName: hasProperName,
                        contact: {
                            id: contact.id,
                            name: contact.name,
                            number: contact.number,
                            isMyContact: contact.isMyContact,
                            isWAContact: contact.isWAContact,
                            pushname: contact.pushname,
                            shortName: contact.shortName
                        }
                    });
                } else {
                    res.json({ exists: false, hasProperName: false });
                }
            } catch (contactErr) {
                // Fallback: try to get the chat
                try {
                    const chat = await client.getChatById(chatId);
                    if (chat) {
                        res.json({ exists: true, hasProperName: false, contact: { id: chat.id } });
                    } else {
                        res.json({ exists: false, hasProperName: false });
                    }
                } catch (chatErr) {
                    res.json({ exists: false, hasProperName: false });
                }
            }
        } catch (err) {
            console.error('Error checking contact status:', err);
            res.status(500).json({ error: 'Failed to check contact status', details: err.message });
        }
    });

    // Test endpoint for debugging
    app.get('/api/contacts/test', (req, res) => {
        res.json({ success: true, message: 'Contacts API is working' });
    });

    // Add contact to WhatsApp (simplified, non-blocking)
    app.post('/api/contacts/add', async (req, res) => {
        const ready = getReady();
        if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
        
        try {
            const { mobile, name } = req.body;
            if (!mobile) {
                return res.status(400).json({ error: 'Mobile number is required' });
            }

            const normalizedNumber = mobile.replace(/[^0-9]/g, '');
            
            // Parse name
            let firstName = normalizedNumber;
            let lastName = '';
            
            if (name && name.trim()) {
                const nameParts = name.trim().split(' ').filter(p => p);
                if (nameParts.length === 1) {
                    firstName = nameParts[0];
                } else if (nameParts.length >= 2) {
                    firstName = nameParts[0];
                    lastName = nameParts.slice(1).join(' ');
                }
            }
            
            // Attempt to add contact (non-blocking, ignore errors)
            await client.saveOrEditAddressbookContact(normalizedNumber, firstName, lastName, true)
                .catch(() => { /* Silently ignore */ });
            
            res.json({ 
                success: true, 
                message: 'Contact addition attempted',
                note: 'WhatsApp Web.js has limitations - name may not persist'
            });
        } catch (err) {
            console.error('Error adding contact:', err);
            res.status(500).json({ error: 'Failed to add contact', details: err.message });
        }
    });

    // Add multiple contacts (simplified, fast batch processing)
    app.post('/api/contacts/add-multiple', async (req, res) => {
        const ready = getReady();
        if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
        
        try {
            const { contacts } = req.body;
            
            if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
                return res.status(400).json({ error: 'Contacts array is required' });
            }
            
            if (contacts.length > 1000) {
                return res.status(400).json({ error: 'Maximum 1000 contacts allowed per request' });
            }
            
            // Process in parallel batches
            const BATCH_SIZE = 10;
            let processedCount = 0;
            
            for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
                const batch = contacts.slice(i, i + BATCH_SIZE);
                
                await Promise.all(batch.map(async (contact) => {
                    const { number, firstName, lastName } = contact;
                    if (!number) return;
                    
                    const normalizedNumber = number.replace(/[^0-9]/g, '');
                    const finalFirstName = (firstName && firstName.trim()) ? firstName.trim() : normalizedNumber;
                    const finalLastName = (lastName && lastName.trim()) ? lastName.trim() : '';
                    
                    await client.saveOrEditAddressbookContact(normalizedNumber, finalFirstName, finalLastName, true)
                        .catch(() => { /* Silently ignore */ });
                    
                    processedCount++;
                }));
            }
            
            res.json({
                success: true,
                message: `Processed ${processedCount} contacts`,
                processedCount: processedCount,
                note: 'WhatsApp Web.js has limitations - names may not persist'
            });
        } catch (err) {
            console.error('Error adding multiple contacts:', err);
            res.status(500).json({ error: 'Failed to add contacts', details: err.message });
        }
    });
}

module.exports = { setupContactsRoutes };
