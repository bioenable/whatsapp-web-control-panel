const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenAI } = require('@google/genai');

function setupAutomationRoutes(app, { 
    readJson, 
    writeJson, 
    getAccountPaths, 
    AUTOMATIONS_FILE,
    client,
    getReady,
    callGenAI,
    readAutomations,
    writeAutomations,
    appendAutomationLog
}) {

    // List all automations
    app.get('/api/automations', (req, res) => {
        try {
            const automations = readAutomations();
            res.json(automations);
        } catch (err) {
            res.status(500).json({ error: 'Failed to read automations', details: err.message });
        }
    });

    // Add new automation
    app.post('/api/automations', (req, res) => {
        try {
            const automations = readAutomations();
            const { chatId, chatName, systemPrompt, schedule, status, automationType } = req.body;
            
            // Validation based on automation type
            if (!chatId || !chatName || !systemPrompt) {
                return res.status(400).json({ error: 'Missing required fields' });
            }
            
            const isChannel = automationType === 'channel' || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast');
            
            if (isChannel && !schedule) {
                return res.status(400).json({ error: 'Schedule is required for channel automations' });
            }
            
            const id = uuidv4();
            const newAutomation = {
                id, chatId, chatName, systemPrompt, schedule: schedule || null, status: status || 'active',
                lastSent: null, nextScheduled: null, logFile: `automation_log_${id}.json`, automationType: isChannel ? 'channel' : 'chat'
            };
            automations.push(newAutomation);
            writeAutomations(automations);
            res.json(newAutomation);
        } catch (err) {
            res.status(500).json({ error: 'Failed to add automation', details: err.message });
        }
    });

    // Edit automation
    app.put('/api/automations/:id', (req, res) => {
        try {
            const automations = readAutomations();
            const idx = automations.findIndex(a => a.id === req.params.id);
            if (idx === -1) return res.status(404).json({ error: 'Automation not found' });
            const { chatId, chatName, systemPrompt, schedule, status, automationType } = req.body;
            
            // Validation based on automation type
            const isChannel = automationType === 'channel' || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast');
            
            if (isChannel && !schedule) {
                return res.status(400).json({ error: 'Schedule is required for channel automations' });
            }
            
            Object.assign(automations[idx], { 
                chatId, chatName, systemPrompt, schedule: schedule || null, status,
                automationType: isChannel ? 'channel' : 'chat'
            });
            writeAutomations(automations);
            res.json(automations[idx]);
        } catch (err) {
            res.status(500).json({ error: 'Failed to update automation', details: err.message });
        }
    });

    // Delete automation
    app.delete('/api/automations/:id', (req, res) => {
        try {
            let automations = readAutomations();
            const idx = automations.findIndex(a => a.id === req.params.id);
            if (idx === -1) return res.status(404).json({ error: 'Automation not found' });
            const [removed] = automations.splice(idx, 1);
            writeAutomations(automations);
            // Optionally delete log file
            const accountPaths = getAccountPaths();
            if (removed.logFile && accountPaths) {
                const logPath = path.join(accountPaths.logsDir, removed.logFile);
                if (fs.existsSync(logPath)) {
                    fs.unlinkSync(logPath);
                }
            }
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to delete automation', details: err.message });
        }
    });

    // Get automation log (paginated) - supports multiple log files
    app.get('/api/automations/:id/log', (req, res) => {
        try {
            const automations = readAutomations();
            const automation = automations.find(a => a.id === req.params.id);
            if (!automation) return res.status(404).json({ error: 'Automation not found' });
            
            // Get all log files for this automation (including rotated ones)
            const accountPaths = getAccountPaths();
            if (!accountPaths) {
                return res.status(500).json({ error: 'Account paths not initialized' });
            }
            
            const baseName = automation.logFile.replace('.json', '');
            const logFiles = [];
            
            // Find all log files for this automation
            const files = fs.readdirSync(accountPaths.logsDir);
            files.forEach(file => {
                if (file.startsWith(baseName) && file.endsWith('.json') && !file.includes('_corrupted_')) {
                    logFiles.push(file);
                }
            });
            
            // Sort log files: base file first, then numbered files in order
            logFiles.sort((a, b) => {
                if (a === automation.logFile) return -1;
                if (b === automation.logFile) return 1;
                const aNum = parseInt(a.match(/_(\d+)\.json$/)?.[1] || '0');
                const bNum = parseInt(b.match(/_(\d+)\.json$/)?.[1] || '0');
                return bNum - aNum; // Newest first
            });
            
            // Read all log files and merge
            let allLogs = [];
            for (const logFile of logFiles) {
                const logPath = path.join(accountPaths.logsDir, logFile);
                if (fs.existsSync(logPath)) {
                    try {
                        const fileContent = fs.readFileSync(logPath, 'utf8');
                        if (fileContent.trim()) {
                            const logs = JSON.parse(fileContent);
                            if (Array.isArray(logs)) {
                                // Add source file info to each log entry
                                logs.forEach(log => {
                                    if (!log.sourceFile) {
                                        log.sourceFile = logFile;
                                    }
                                });
                                allLogs = allLogs.concat(logs);
                            }
                        }
                    } catch (parseErr) {
                        console.error(`[AUTOMATION] Failed to parse log file ${logFile}:`, parseErr.message);
                    }
                }
            }
            
            // Sort by timestamp (most recent first)
            allLogs.sort((a, b) => {
                const timeA = new Date(a.timestamp || a.time || 0).getTime();
                const timeB = new Date(b.timestamp || b.time || 0).getTime();
                return timeB - timeA;
            });
            
            // Pagination
            const page = parseInt(req.query.page) || 1;
            const pageSize = parseInt(req.query.pageSize) || 20;
            const start = (page - 1) * pageSize;
            const end = start + pageSize;
            
            res.json({ 
                logs: allLogs.slice(start, end), 
                total: allLogs.length,
                totalFiles: logFiles.length,
                currentFile: automation.logFile
            });
        } catch (err) {
            console.error('[AUTOMATION] Error fetching logs:', err);
            res.status(500).json({ error: 'Failed to fetch log', details: err.message });
        }
    });

    // Test GenAI integration (grounded)
    app.post('/api/automations/test-genai', async (req, res) => {
        try {
            const { systemPrompt, autoReplyPrompt, userMessage } = req.body;
            if (!systemPrompt || !autoReplyPrompt || !userMessage) {
                return res.status(400).json({ error: 'Missing required fields' });
            }
            if (!callGenAI) {
                return res.status(500).json({ error: 'GenAI service not available' });
            }
            const result = await callGenAI({ systemPrompt, autoReplyPrompt, chatHistory: '', userMessage });
            if (!result) return res.status(500).json({ error: 'GenAI call failed' });
            res.json({ result });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Test automation execution (triggers immediately with detailed logging)
    app.post('/api/automations/:id/test', async (req, res) => {
        const ready = getReady();
        if (!ready) {
            return res.status(503).json({ error: 'WhatsApp not ready' });
        }

        try {
            const automations = readAutomations();
            const automation = automations.find(a => a.id === req.params.id);
            if (!automation) {
                return res.status(404).json({ error: 'Automation not found' });
            }

            const accountPaths = getAccountPaths();
            if (!accountPaths) {
                return res.status(500).json({ error: 'Account paths not initialized' });
            }

            console.log(`[AUTOMATION TEST] Triggering test execution for ${automation.chatName}`);

            // Create detailed test log with ALL information
            const testLog = {
                testId: require('crypto').randomBytes(8).toString('hex'),
                automationId: automation.id,
                automationName: automation.chatName,
                automationType: automation.automationType,
                chatId: automation.chatId,
                timestamp: new Date().toISOString(),
                config: {
                    systemPrompt: automation.systemPrompt,
                    scheduledPrompt: automation.scheduledPrompt || ''
                },
                step1: {
                    success: false,
                    prompt: '',
                    model: '',
                    response: '',
                    responseLength: 0,
                    timestamp: ''
                },
                step2: {
                    success: false,
                    prompt: '',
                    model: '',
                    response: '',
                    parsed: null,
                    timestamp: ''
                },
                final: {
                    message: '',
                    hasNewMessage: false,
                    notes: '',
                    sent: false,
                    messageLength: 0
                }
            };

            // Get chat history for context
            let chatHistory = '';
            try {
                const chat = await client.getChatById(automation.chatId);
                const msgs = await chat.fetchMessages({ limit: 100 });
                chatHistory = msgs.map(m => `${m.fromMe ? 'Me' : 'User'}: ${m.body}`).join('\n');
                testLog.chatHistoryLength = chatHistory.length;
            } catch (err) {
                console.error(`[AUTOMATION TEST] Failed to get chat history:`, err.message);
                testLog.chatHistoryError = err.message;
                chatHistory = '(No chat history available)';
            }

            // Step 1: Call GenAI with tools enabled - INCREASED TOKEN LIMIT
            const step1Prompt = `${automation.systemPrompt}\n\nChat history:\n${chatHistory}\n\nUser: Generate a scheduled message for today\n\n${automation.scheduledPrompt || ''}`;
            
            testLog.step1.prompt = step1Prompt;
            testLog.step1.promptLength = step1Prompt.length;
            testLog.step1.model = process.env.GOOGLE_MODEL || 'gemini-2.5-flash';
            testLog.step1.timestamp = new Date().toISOString();

            let step1ResponseText = '';

            try {
                const genAI = new GoogleGenAI({});
                const groundingTool = { googleSearch: {} };
                // INCREASED maxOutputTokens from 512 to 2048 for full responses
                const genAIConfig = { tools: [groundingTool], maxOutputTokens: 2048 };

                console.log(`[AUTOMATION TEST] Step 1: Calling ${testLog.step1.model} with grounding...`);
                
                const step1Response = await genAI.models.generateContent({
                    model: process.env.GOOGLE_MODEL || 'gemini-2.5-flash',
                    contents: step1Prompt,
                    config: genAIConfig
                });

                step1ResponseText = step1Response.text || '';
                testLog.step1.response = step1ResponseText;
                testLog.step1.responseLength = step1ResponseText.length;
                testLog.step1.success = true;
                
                console.log(`[AUTOMATION TEST] Step 1 completed. Response length: ${step1ResponseText.length} chars`);

                // Step 2: Parse response to JSON - Extract ONLY the final message, detect "no news" scenarios
                const parsePrompt = `You are extracting the FINAL WhatsApp message from an AI response.

AI Response:
---
${step1ResponseText}
---

TASK: Determine if there is a VALID message to send, and extract it if so.

SET hasNewMessage = FALSE if the response contains ANY of these:
- The exact text "NO_NEW_CONTENT" (this is a special signal meaning no news found)
- "no new content found" or similar phrases
- "all content has been covered" or similar
- Only a list of previously sent titles without new news
- Commentary about lack of new information
- Error messages or system responses
- Internal thinking without a final message
- Meta-commentary like "I checked all sources...", "The search results confirm..."
- Word count checks, draft iterations
- Any text that is NOT a proper subscriber-facing message

SET hasNewMessage = TRUE only if there is a CLEAR, POLISHED message with:
- An emoji-decorated title (e.g., "🚀 *Title Here!*" or "✨ Title Here 🚀")
- Substantive news/update body text (not just a list of old titles)
- A call-to-action URL at the end like "For more updates visit https://..."
- Content that is clearly meant for subscribers (not admin/system notes)

EXTRACT the message ONLY if hasNewMessage = TRUE:
- The FINAL formatted message with emoji title, body text, and URL
- Usually appears at the END of the response
- Must be a complete, polished message ready to send

Return JSON:
{
  "message": "The clean message to send (empty string if hasNewMessage is false)",
  "hasNewMessage": true/false,
  "notes": "Reason for decision (e.g., 'No new content found' or 'Valid news message extracted')"
}

CRITICAL: 
- When in doubt, set hasNewMessage = FALSE (better to skip than send garbage)
- The "message" field should be EMPTY ("") if hasNewMessage is false
- Do NOT include AI reasoning, search analysis, word count checks, or draft iterations
Return ONLY the JSON object.`;

                testLog.step2.prompt = parsePrompt;
                testLog.step2.promptLength = parsePrompt.length;
                testLog.step2.model = 'gemini-2.5-flash-lite';
                testLog.step2.timestamp = new Date().toISOString();

                console.log(`[AUTOMATION TEST] Step 2: Parsing response to JSON...`);

                try {
                    const step2Response = await genAI.models.generateContent({
                        model: 'gemini-2.5-flash-lite',
                        contents: parsePrompt,
                        config: {
                            responseMimeType: 'application/json',
                            maxOutputTokens: 2048 // INCREASED for full message content
                        }
                    });

                    const step2ResponseText = step2Response.text.trim();
                    testLog.step2.response = step2ResponseText;
                    testLog.step2.responseLength = step2ResponseText.length;

                    // Parse JSON
                    let jsonText = step2ResponseText;
                    if (jsonText.startsWith('```json')) {
                        jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                    } else if (jsonText.startsWith('```')) {
                        jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
                    }

                    const parsed = JSON.parse(jsonText);
                    testLog.step2.parsed = parsed;
                    testLog.step2.success = true;

                    console.log(`[AUTOMATION TEST] Step 2 completed. Parsed message length: ${(parsed.message || '').length} chars`);

                    // Final message - prefer step 1 response if step 2 truncated it
                    let finalMessage = parsed.message || step1ResponseText;
                    
                    // If step 2 message is significantly shorter than step 1, it may have been truncated
                    // Use step 1 response in that case
                    if (parsed.message && step1ResponseText.length > 100 && parsed.message.length < step1ResponseText.length * 0.3) {
                        console.log(`[AUTOMATION TEST] Step 2 appears to have truncated the message. Using step 1 response.`);
                        finalMessage = step1ResponseText;
                        testLog.final.truncationDetected = true;
                        testLog.final.usedStep1Response = true;
                    }
                    
                    const hasNewMessage = parsed.hasNewMessage !== false;
                    const notes = parsed.notes || '';

                    testLog.final.message = finalMessage;
                    testLog.final.hasNewMessage = hasNewMessage;
                    testLog.final.notes = notes;
                    testLog.final.messageLength = finalMessage.length;

                    // Send the message if hasNewMessage is true
                    if (hasNewMessage) {
                        const isChannel = automation.automationType === 'channel' || automation.chatId.endsWith('@newsletter') || automation.chatId.endsWith('@broadcast');
                        
                        if (isChannel) {
                            try {
                                const channel = await client.getChatById(automation.chatId);
                                if (!channel.isChannel) {
                                    throw new Error('Not a channel');
                                }
                                if (channel.isReadOnly) {
                                    throw new Error('Not a channel admin');
                                }
                                await channel.sendMessage(finalMessage);
                                testLog.final.sent = true;
                                testLog.final.sentTo = 'channel';
                            } catch (sendErr) {
                                testLog.final.sent = false;
                                testLog.final.sendError = sendErr.message;
                            }
                        } else {
                            try {
                                await client.sendMessage(automation.chatId, finalMessage);
                                testLog.final.sent = true;
                                testLog.final.sentTo = 'chat';
                            } catch (sendErr) {
                                testLog.final.sent = false;
                                testLog.final.sendError = sendErr.message;
                            }
                        }
                    } else {
                        testLog.final.sent = false;
                        testLog.final.reason = 'hasNewMessage is false';
                    }

                } catch (step2Err) {
                    testLog.step2.success = false;
                    testLog.step2.error = step2Err.message;
                    testLog.final.fallback = true;
                    testLog.final.message = step1ResponseText;
                    testLog.final.reason = 'Step 2 failed, using step 1 response';
                }

            } catch (step1Err) {
                testLog.step1.success = false;
                testLog.step1.error = step1Err.message;
                testLog.step1.errorStack = step1Err.stack;
                testLog.final.error = 'Step 1 failed';
                testLog.final.message = 'Step 1 failed - no message generated';
            }

            // Save detailed test log to file
            const testLogFileName = `automation_test_${automation.id}_${Date.now()}.json`;
            const testLogPath = path.join(accountPaths.logsDir, testLogFileName);
            
            try {
                fs.writeFileSync(testLogPath, JSON.stringify(testLog, null, 2));
                testLog.logFile = testLogFileName;
                console.log(`[AUTOMATION TEST] Detailed log saved to ${testLogFileName}`);
            } catch (writeErr) {
                console.error(`[AUTOMATION TEST] Failed to save test log:`, writeErr.message);
                testLog.logFileError = writeErr.message;
            }

            // Also append to regular automation log
            if (appendAutomationLog && typeof appendAutomationLog === 'function') {
                appendAutomationLog(automation, {
                    type: 'test',
                    message: testLog.final.message || 'Test execution',
                    notes: `Test execution - ${testLog.final.sent ? 'Message sent' : 'Message not sent'}`,
                    timestamp: testLog.timestamp
                });
            }

            res.json({
                success: true,
                testLog: testLog,
                message: testLog.final.sent ? 'Test executed and message sent successfully' : 'Test executed but message not sent'
            });

        } catch (err) {
            console.error('[AUTOMATION TEST] Error:', err);
            res.status(500).json({ error: 'Test execution failed', details: err.message });
        }
    });
}

module.exports = { setupAutomationRoutes };

