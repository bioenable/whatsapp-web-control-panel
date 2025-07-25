# Media Upload Fix for Bulk Schedule Form

## Issue Description
Users reported that media upload in the bulk schedule form was returning "failed to upload media" error. The issue was related to incorrect multer configuration and file path handling.

## Root Cause Analysis

### 1. Multer Configuration Issue
- The original code used `multer.memoryStorage()` for all uploads
- The bulk media upload endpoint tried to access `req.file.path` which doesn't exist with memory storage
- This caused the `fs.renameSync()` operation to fail

### 2. Developer Environment Path Issue
- The error was more likely to occur in development environments where file paths might be different
- The code assumed files had disk paths when they were stored in memory

### 3. Inconsistent Upload Handling
- Different endpoints needed different storage strategies:
  - Bulk media uploads: Need disk storage for file movement
  - Template uploads: Need memory storage for buffer access
  - Message media uploads: Need memory storage for buffer access
  - CSV uploads: Need memory storage for buffer access

## Solution Implemented

### 1. Separate Multer Configurations
Created different multer configurations for different use cases:

```javascript
// For bulk media uploads (disk storage)
const upload = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            cb(null, tempDir);
        },
        filename: (req, file, cb) => {
            const timestamp = Date.now();
            const originalName = file.originalname;
            const extension = originalName.split('.').pop();
            cb(null, `temp-${timestamp}.${extension}`);
        }
    }), 
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
});

// For template uploads (memory storage)
const templateUpload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// For message media uploads (memory storage)
const messageUpload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
});

// For CSV uploads (memory storage)
const csvUpload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});
```

### 2. Enhanced Error Handling
Added comprehensive error handling to the bulk media upload endpoint:

- File type validation (images, videos, PDFs only)
- File size validation (100MB max)
- Proper cleanup of temporary files on error
- Detailed error messages

### 3. Directory Management
- Ensures the `message-templates` directory exists before moving files
- Creates temporary directory for uploads
- Added cleanup function for old temporary files

### 4. Scheduled Cleanup
Added periodic cleanup of temporary files:
- Runs every 6 hours
- Removes files older than 24 hours
- Integrated with existing disk space cleanup

## Files Modified

1. **server.js**
   - Updated multer configurations
   - Enhanced media upload endpoint
   - Added cleanup functions
   - Updated all upload endpoints to use appropriate middleware

2. **.gitignore**
   - Added `temp/` directory to ignore temporary files

## Testing

To test the fix:

1. Start the server
2. Go to the Bulk tab
3. Click "Create Bulk Schedule"
4. Try uploading a media file
5. Verify the file uploads successfully and the URL is returned

## Error Messages

The fix provides more specific error messages:
- "Unsupported media type. Only images, videos, and PDFs are allowed."
- "File too large. Maximum size is 100MB."
- "Failed to upload media: [specific error]"

## Backward Compatibility

The fix maintains backward compatibility:
- All existing endpoints continue to work
- File size limits are preserved
- Supported file types remain the same
- API responses maintain the same structure 