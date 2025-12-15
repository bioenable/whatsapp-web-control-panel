const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

function setupTemplatesRoutes(app, { readJson, writeJson, getAccountPaths, TEMPLATES_FILE, templateUpload }) {
    // Get all templates
    app.get('/api/templates', (req, res) => {
        const accountPaths = getAccountPaths();
        res.json(readJson(accountPaths ? accountPaths.templatesFile : TEMPLATES_FILE));
    });

    // Create new template
    app.post('/api/templates', templateUpload.single('media'), (req, res) => {
        try {
            const { name, text, removeMedia } = req.body;
            if (!name || !text) {
                return res.status(400).json({ error: 'Name and text are required' });
            }
            
            const accountPaths = getAccountPaths();
            const templates = readJson(accountPaths ? accountPaths.templatesFile : TEMPLATES_FILE);
            const template = {
                id: require('crypto').randomUUID(),
                name: name.trim(),
                text: text.trim(),
                media: null,
                createdAt: new Date().toISOString()
            };
            
            // Handle media upload
            if (req.file) {
                const mediaDir = path.join(__dirname, '../../public', 'message-templates');
                if (!fs.existsSync(mediaDir)) {
                    fs.mkdirSync(mediaDir, { recursive: true });
                }
                
                const fileExt = path.extname(req.file.originalname);
                const fileName = `${template.id}${fileExt}`;
                const filePath = path.join(mediaDir, fileName);
                
                fs.writeFileSync(filePath, req.file.buffer);
                template.media = `/message-templates/${fileName}`;
            }
            
            templates.push(template);
            writeJson(accountPaths ? accountPaths.templatesFile : TEMPLATES_FILE, templates);
            res.json(template);
        } catch (err) {
            console.error('Create template error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // Update existing template
    app.put('/api/templates/:id', templateUpload.single('media'), (req, res) => {
        try {
            const { id } = req.params;
            const { name, text, removeMedia } = req.body;
            if (!name || !text) {
                return res.status(400).json({ error: 'Name and text are required' });
            }
            
            const accountPaths = getAccountPaths();
            const templates = readJson(accountPaths ? accountPaths.templatesFile : TEMPLATES_FILE);
            const templateIndex = templates.findIndex(t => t.id === id);
            if (templateIndex === -1) {
                return res.status(404).json({ error: 'Template not found' });
            }
            
            const template = templates[templateIndex];
            template.name = name.trim();
            template.text = text.trim();
            template.updatedAt = new Date().toISOString();
            
            // Handle media removal
            if (removeMedia === 'true' && template.media) {
                const oldMediaPath = path.join(__dirname, '../../public', template.media);
                if (fs.existsSync(oldMediaPath)) {
                    fs.unlinkSync(oldMediaPath);
                }
                template.media = null;
            }
            
            // Handle new media upload
            if (req.file) {
                // Remove old media if exists
                if (template.media) {
                    const oldMediaPath = path.join(__dirname, '../../public', template.media);
                    if (fs.existsSync(oldMediaPath)) {
                        fs.unlinkSync(oldMediaPath);
                    }
                }
                
                const mediaDir = path.join(__dirname, '../../public', 'message-templates');
                if (!fs.existsSync(mediaDir)) {
                    fs.mkdirSync(mediaDir, { recursive: true });
                }
                
                const fileExt = path.extname(req.file.originalname);
                const fileName = `${template.id}${fileExt}`;
                const filePath = path.join(mediaDir, fileName);
                
                fs.writeFileSync(filePath, req.file.buffer);
                template.media = `/message-templates/${fileName}`;
            }
            
            templates[templateIndex] = template;
            writeJson(accountPaths ? accountPaths.templatesFile : TEMPLATES_FILE, templates);
            res.json(template);
        } catch (err) {
            console.error('Update template error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // Delete template
    app.delete('/api/templates/:id', (req, res) => {
        try {
            const { id } = req.params;
            const accountPaths = getAccountPaths();
            const templates = readJson(accountPaths ? accountPaths.templatesFile : TEMPLATES_FILE);
            const templateIndex = templates.findIndex(t => t.id === id);
            if (templateIndex === -1) {
                return res.status(404).json({ error: 'Template not found' });
            }
            
            const template = templates[templateIndex];
            
            // Remove media file if exists
            if (template.media) {
                const mediaPath = path.join(__dirname, '../../public', template.media);
                if (fs.existsSync(mediaPath)) {
                    fs.unlinkSync(mediaPath);
                }
            }
            
            templates.splice(templateIndex, 1);
            writeJson(accountPaths ? accountPaths.templatesFile : TEMPLATES_FILE, templates);
            res.json({ success: true });
        } catch (err) {
            console.error('Delete template error:', err);
            res.status(500).json({ error: err.message });
        }
    });
}

module.exports = { setupTemplatesRoutes };

