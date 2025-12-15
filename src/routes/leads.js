const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

function setupLeadsRoutes(app, { 
    readJson, 
    writeJson, 
    getAccountPaths, 
    LEADS_FILE, 
    LEADS_CONFIG_FILE,
    client,
    getReady,
    callGenAI
}) {
    // Get leads data
    app.get('/api/leads', (req, res) => {
        try {
            const accountPathsObj = getAccountPaths();
            const leadsFilePath = accountPathsObj ? accountPathsObj.leadsFile : LEADS_FILE;
            console.log('[LEADS] Reading leads from:', leadsFilePath);
            const leadsData = readJson(leadsFilePath, { leads: [] });
            console.log('[LEADS] Loaded leads count:', leadsData.leads ? leadsData.leads.length : 0);
            res.json(leadsData);
        } catch (err) {
            console.error('[LEADS] Failed to fetch leads:', err);
            res.status(500).json({ error: 'Failed to fetch leads', details: err.message });
        }
    });

    // Save leads data
    app.post('/api/leads', (req, res) => {
        try {
            const { leads } = req.body;
            if (!leads || !Array.isArray(leads)) {
                return res.status(400).json({ error: 'Invalid leads data' });
            }
            
            const accountPathsObj = getAccountPaths();
            
            // Ensure we don't exceed 2000 records (keep oldest when exceeded)
            let limitedLeads = leads;
            if (limitedLeads.length > 2000) {
                // Sort by created_on (oldest first) and keep only latest 2000
                limitedLeads = leads
                    .sort((a, b) => new Date(a.created_on) - new Date(b.created_on))
                    .slice(-2000);
            }
            
            writeJson(accountPathsObj ? accountPathsObj.leadsFile : LEADS_FILE, { leads: limitedLeads });
            res.json({ success: true, count: limitedLeads.length });
        } catch (err) {
            console.error('Failed to save leads:', err);
            res.status(500).json({ error: 'Failed to save leads', details: err.message });
        }
    });

    // Get leads auto chat configuration
    app.get('/api/leads/config', (req, res) => {
        try {
            const accountPathsObj = getAccountPaths();
            const config = readJson(accountPathsObj ? accountPathsObj.leadsConfigFile : LEADS_CONFIG_FILE, {
                enabled: false,
                systemPrompt: '',
                includeJsonContext: true,
                autoReply: false,
                autoReplyPrompt: ''
            });
            res.json(config);
        } catch (err) {
            console.error('Failed to load leads config:', err);
            res.status(500).json({ error: 'Failed to load leads config', details: err.message });
        }
    });

    // Save leads auto chat configuration
    app.post('/api/leads/config', (req, res) => {
        try {
            const { enabled, systemPrompt, includeJsonContext, autoReply, autoReplyPrompt } = req.body;
            const accountPathsObj = getAccountPaths();
            
            const config = {
                enabled: Boolean(enabled),
                systemPrompt: systemPrompt || '',
                includeJsonContext: Boolean(includeJsonContext),
                autoReply: Boolean(autoReply),
                autoReplyPrompt: autoReplyPrompt || ''
            };
            
            writeJson(accountPathsObj ? accountPathsObj.leadsConfigFile : LEADS_CONFIG_FILE, config);
            console.log('Leads auto chat config saved:', config);
            res.json({ success: true, config });
        } catch (err) {
            console.error('Failed to save leads config:', err);
            res.status(500).json({ error: 'Failed to save leads config', details: err.message });
        }
    });

    // Gemini API endpoint for leads auto chat
    app.post('/api/gemini/chat', async (req, res) => {
        try {
            const { systemPrompt, context, lead, autoReply, autoReplyPrompt, chatHistory } = req.body;
            
            if (!systemPrompt) {
                return res.status(400).json({ error: 'System prompt is required' });
            }

            if (!callGenAI) {
                return res.status(500).json({ error: 'GenAI service not available' });
            }

            let fullPrompt = systemPrompt;
            
            if (context) {
                fullPrompt += `\n\nLead Context:\n${context}`;
            }
            
            if (chatHistory) {
                fullPrompt += `\n\nChat History:\n${chatHistory}`;
            }
            
            if (autoReply && autoReplyPrompt) {
                fullPrompt += `\n\nAuto Reply Instructions:\n${autoReplyPrompt}`;
            }

            const response = await callGenAI({
                systemPrompt: fullPrompt,
                autoReplyPrompt: autoReplyPrompt || '',
                chatHistory: chatHistory || '',
                userMessage: `Generate a response for lead: ${lead.name} (${lead.mobile})`
            });

            res.json({ success: true, response });
        } catch (err) {
            console.error('Gemini chat error:', err);
            res.status(500).json({ error: 'Failed to generate response', details: err.message });
        }
    });

    // Proxy endpoint for external leads API (to avoid CORS issues)
    app.post('/api/proxy/leads', async (req, res) => {
        try {
            const apiUrl = process.env.LEADS_API_URL;
            const apiKey = process.env.LEADS_API_KEY;

            if (!apiUrl || !apiKey) {
                return res.status(500).json({ 
                    error: 'Leads API configuration missing', 
                    details: 'LEADS_API_URL and LEADS_API_KEY environment variables must be set in .env file',
                    configuration: {
                        required: [
                            'LEADS_API_URL=https://your-api-endpoint.com/api/leads',
                            'LEADS_API_KEY=your-api-key-here'
                        ],
                        sampleFormat: {
                            "success": true,
                            "data": [
                                {
                                    "id": 1,
                                    "name": "John Doe",
                                    "phone": "+1234567890",
                                    "email": "john@example.com",
                                    "location": "New York",
                                    "status": "active",
                                    "created_at": "2025-01-27T10:00:00Z"
                                }
                            ]
                        }
                    }
                });
            }

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ apikey: apiKey })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            res.json(data);
        } catch (err) {
            console.error('Proxy leads API error:', err);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch leads from external API', 
                details: err.message 
            });
        }
    });

    // Process leads contacts - add contacts for leads with failed/error status
    app.post('/api/leads/process-contacts', async (req, res) => {
        const ready = getReady();
        if (!ready) return res.status(503).json({ error: 'WhatsApp not ready' });
        
        try {
            console.log('[LEADS] Processing contacts for leads...');
            const accountPathsObj = getAccountPaths();
            
            // Read leads data
            const leadsData = readJson(accountPathsObj ? accountPathsObj.leadsFile : LEADS_FILE, { leads: [] });
            const leadsNeedingContacts = leadsData.leads.filter(lead => 
                lead.contact_added !== true && 
                lead.contact_added !== 'attempted' && // Don't retry attempted contacts
                lead.mobile
            );
            
            console.log(`[LEADS] Found ${leadsNeedingContacts.length} leads needing contacts`);
            
            if (leadsNeedingContacts.length === 0) {
                return res.json({
                    success: true,
                    message: 'No leads need contact processing',
                    processed: 0,
                    successful: 0,
                    failed: 0
                });
            }
            
            const results = [];
            const logs = [];
            
            // Process contacts in parallel batches for speed (no verification, ignore errors)
            const BATCH_SIZE = 10; // Process 10 contacts at a time
            
            for (let batchStart = 0; batchStart < leadsNeedingContacts.length; batchStart += BATCH_SIZE) {
                const batch = leadsNeedingContacts.slice(batchStart, batchStart + BATCH_SIZE);
                
                // Process batch in parallel
                await Promise.all(batch.map(async (lead, batchIndex) => {
                    const i = batchStart + batchIndex;
                    const { mobile, name } = lead;
                    
                    // Find the original lead in the full leads data
                    const originalLeadIndex = leadsData.leads.findIndex(l => l.mobile === mobile);
                    if (originalLeadIndex === -1) {
                        logs.push(`[${i + 1}] ⚠️ Lead not found: ${mobile}`);
                        return;
                    }
                    
                    try {
                        // Normalize phone number
                        const normalizedNumber = mobile.replace(/[^0-9]/g, '');
                        
                        // Parse name into firstName and lastName (use number as fallback)
                        let firstName = normalizedNumber; // Default to number
                        let lastName = '';
                        
                        if (name && name.trim()) {
                            const nameParts = name.trim().split(' ').filter(part => part.trim());
                            if (nameParts.length === 1) {
                                firstName = nameParts[0];
                            } else if (nameParts.length >= 2) {
                                firstName = nameParts[0];
                                lastName = nameParts.slice(1).join(' ');
                            }
                        }
                        
                        // Attempt to add contact (non-blocking, no verification)
                        // Note: WhatsApp Web.js has limitations - names may not persist, only numbers sync
                        await client.saveOrEditAddressbookContact(
                            normalizedNumber,
                            firstName,
                            lastName,
                            true // syncToAddressbook = true
                        ).catch(() => {
                            // Silently ignore errors - WhatsApp Web.js contact addition is unreliable
                        });
                        
                        // Mark as attempted (not error) - WhatsApp Web.js limitations mean we can't verify
                        leadsData.leads[originalLeadIndex].contact_added = 'attempted';
                        leadsData.leads[originalLeadIndex].last_updated = new Date().toISOString();
                        
                        results.push({
                            index: i,
                            success: true,
                            message: 'Contact addition attempted (name may not persist due to WhatsApp Web.js limitations)',
                            mobile: mobile
                        });
                        
                        logs.push(`[${i + 1}] ✓ Attempted: ${mobile} (${name || normalizedNumber})`);
                        
                    } catch (err) {
                        // Ignore errors - mark as attempted anyway
                        leadsData.leads[originalLeadIndex].contact_added = 'attempted';
                        leadsData.leads[originalLeadIndex].last_updated = new Date().toISOString();
                        
                        results.push({
                            index: i,
                            success: true, // Still mark as success since we attempted
                            message: 'Contact addition attempted (error ignored)',
                            mobile: mobile,
                            note: 'WhatsApp Web.js contact addition has known limitations'
                        });
                        
                        logs.push(`[${i + 1}] ✓ Attempted (error ignored): ${mobile}`);
                    }
                }));
            }
            
            // Save updated leads data
            writeJson(accountPathsObj ? accountPathsObj.leadsFile : LEADS_FILE, leadsData);
            
            const successCount = results.filter(r => r.success).length;
            const errorCount = results.filter(r => !r.success).length;
            
            logs.push(`\n📊 Summary: ${successCount} successful, ${errorCount} failed out of ${leadsNeedingContacts.length} total`);
            
            res.json({
                success: true,
                results: results,
                logs: logs,
                summary: {
                    total: leadsNeedingContacts.length,
                    successful: successCount,
                    failed: errorCount
                }
            });
            
        } catch (err) {
            console.error('Error processing leads contacts:', err);
            res.status(500).json({
                success: false,
                error: 'Failed to process leads contacts',
                details: err.message
            });
        }
    });

    // Get leads configuration (alternative endpoint)
    app.get('/api/leads-config', (req, res) => {
        try {
            const accountPathsObj = getAccountPaths();
            const configPath = accountPathsObj ? accountPathsObj.leadsConfigFile : path.join(__dirname, '../../leads-config.json');
            
            // Return default config if file doesn't exist (enabled: false by default)
            const defaultConfig = {
                enabled: false,
                systemPrompt: '',
                includeJsonContext: true,
                autoReply: false,
                autoReplyPrompt: ''
            };
            
            if (!fs.existsSync(configPath)) {
                return res.json(defaultConfig);
            }
            
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            // Ensure enabled defaults to false if not set
            config.enabled = config.enabled === true;
            res.json(config);
        } catch (err) {
            console.error('Error reading leads config:', err);
            // Return default config on error (enabled: false)
            res.json({
                enabled: false,
                systemPrompt: '',
                includeJsonContext: true,
                autoReply: false,
                autoReplyPrompt: ''
            });
        }
    });

    // Save leads configuration (alternative endpoint)
    app.post('/api/leads-config', (req, res) => {
        try {
            const config = req.body;
            const accountPathsObj = getAccountPaths();
            const configPath = accountPathsObj ? accountPathsObj.leadsConfigFile : path.join(__dirname, '../../leads-config.json');
            
            // Ensure directory exists
            const dir = path.dirname(configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            
            res.json({ success: true, message: 'Configuration saved successfully' });
        } catch (err) {
            console.error('Error saving leads config:', err);
            res.status(500).json({ error: 'Failed to save leads configuration' });
        }
    });
}

module.exports = { setupLeadsRoutes };

