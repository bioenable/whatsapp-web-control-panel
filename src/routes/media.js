const path = require('path');
const fs = require('fs');

function setupMediaRoutes(app, { upload }) {
    // Upload media for message templates
    app.post('/api/upload-media', upload.single('media'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No media file provided' });
        }
        
        try {
            // Validate file type
            const allowedTypes = ['image/', 'video/', 'application/pdf'];
            if (!allowedTypes.some(t => req.file.mimetype.startsWith(t))) {
                return res.status(400).json({ error: 'Unsupported media type. Only images, videos, and PDFs are allowed.' });
            }
            
            // Validate file size (100MB max)
            if (req.file.size > 100 * 1024 * 1024) {
                return res.status(400).json({ error: 'File too large. Maximum size is 100MB.' });
            }
            
            // Generate a unique filename
            const timestamp = Date.now();
            const originalName = req.file.originalname;
            const extension = originalName.split('.').pop();
            const filename = `bulk-media-${timestamp}.${extension}`;
            
            // Ensure the message-templates directory exists
            const messageTemplatesDir = path.join(__dirname, '../../public', 'message-templates');
            if (!fs.existsSync(messageTemplatesDir)) {
                fs.mkdirSync(messageTemplatesDir, { recursive: true });
            }
            
            // Move file to public directory
            const destinationPath = path.join(messageTemplatesDir, filename);
            
            // If file is already on disk (from multer diskStorage), rename it
            // Otherwise, write the buffer
            if (req.file.path && fs.existsSync(req.file.path)) {
                fs.renameSync(req.file.path, destinationPath);
            } else if (req.file.buffer) {
                fs.writeFileSync(destinationPath, req.file.buffer);
            } else {
                throw new Error('No file data available');
            }
            
            // Return the public URL
            const publicUrl = `/message-templates/${filename}`;
            console.log(`[MEDIA] Media uploaded successfully: ${filename} (${req.file.size} bytes)`);
            res.json({ url: publicUrl, filename: filename });
        } catch (err) {
            console.error('[MEDIA] Media upload error:', err);
            
            // Clean up temp file if it exists
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (cleanupErr) {
                    console.error('[MEDIA] Failed to cleanup temp file:', cleanupErr);
                }
            }
            
            res.status(500).json({ error: 'Failed to upload media: ' + err.message });
        }
    });
}

module.exports = { setupMediaRoutes };

