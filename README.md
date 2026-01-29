# WhatsApp Web Control System

A comprehensive WhatsApp automation and management system that works in both **standalone mode** (local only) and **Cloudflare mode** (multi-user with cloud sync).

## 🚀 Features

### **Core Features (Available in Both Modes)**
- **WhatsApp Web Integration**: Full WhatsApp Web functionality
- **Web Interface**: Modern responsive UI for managing messages and contacts
- **Bulk Messaging**: Send messages to multiple contacts with scheduling
- **Automation**: Scheduled message sending and auto-replies
- **Local Data Storage**: All data stored locally on your machine
- **QR Code Authentication**: Easy WhatsApp Web login

### **Cloudflare Mode Features (Optional)**
- **Multi-User Support**: Isolated user sessions with separate message queues
- **Real-time Message Processing**: Event-driven message handling with webhook support
- **Channel Management**: Automatic detection and syncing of WhatsApp channels/newsletters
- **Cloud Sync**: Data synchronized to Cloudflare Workers
- **Channel Webpages**: Public webpages for viewing channel messages
- **User Isolation**: Complete separation of user data and sessions
- **Event-Driven Sync**: Immediate processing when messages are received

## 🎯 **Two Operating Modes**

### **1. Standalone Mode (Default)**
- **No Cloudflare required** - works completely offline
- All features work locally on your machine
- Perfect for personal use or single-user scenarios
- No external dependencies or API keys needed

### **2. Cloudflare Mode (Optional)**
- **Requires Cloudflare setup** - see `cloudflare/` folder
- Multi-user support with cloud synchronization
- Channel management and public webpages
- Real-time message processing across multiple devices

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- WhatsApp account
- Cloudflare account (only for Cloudflare mode)

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd whatsappweb1
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   
   **For Standalone Mode (Default):**
   - No configuration needed! Just run `npm start`
   - All features work locally without any external services
   
   **For Cloudflare Mode (Optional):**
   - Uncomment and configure Cloudflare settings in `.env`:
   ```env
   CLOUDFLARE_BASE_URL=https://your-worker-url.workers.dev
   CLOUDFLARE_API_KEY=your-api-key-here
   CLOUDFLARE_SYNC_INTERVAL=600000
   CLOUDFLARE_QUEUE_INTERVAL=60000
   ```
   - See `cloudflare/` folder for deployment instructions

   **For Leads API Integration (Optional):**
   - Configure external leads API in `.env`:
   ```env
   LEADS_API_URL=https://dashboard.geosquare.in/api/get_registrations
   LEADS_API_KEY=your-leads-api-key-here
   ```
   - This enables fetching leads from external APIs

4. **Start the application**
   ```bash
   npm start
   ```

## ☁️ **Cloudflare Setup (Optional)**

If you want to use Cloudflare mode for multi-user support and cloud sync:

1. **Navigate to Cloudflare folder**
   ```bash
   cd cloudflare
   ```

2. **Follow the deployment guide**
   - Read `deploy-cloudflare.md` for detailed instructions
   - Run `./deploy-cloudflare.sh` for automated deployment

3. **Configure your app**
   - Update `.env` with your Cloudflare URL and API key
   - Restart the application

**Note**: The app works perfectly without Cloudflare in standalone mode!

## 🔧 Configuration

### Cloudflare Workers Setup

1. **Deploy the Cloudflare Worker**
   ```bash
   cd cloudflare-workers
   npm install
   npm run deploy
   ```

2. **Update configuration**
   - Replace `your-worker-url.workers.dev` with your actual Cloudflare Worker URL
   - Replace `your-api-key-here` with your secure API key

### WhatsApp Authentication

1. **First Run**: The app will generate a QR code for WhatsApp Web authentication
2. **Scan QR Code**: Use your WhatsApp mobile app to scan the QR code
3. **Session Storage**: Authentication data is stored locally for future use

## 📱 Usage

### Web Interface

Access the web interface at `http://localhost:5014` after starting the server.

**Features:**
- Contact management
- Bulk message sending
- Channel monitoring
- Automation setup
- Message templates

### API Endpoints

#### Local Server Endpoints (Standalone Mode)

**Send Text Message**
```bash
# Send a simple text message (phone number will be auto-formatted)
curl -X POST "http://localhost:5014/api/messages/send" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "+1234567890",
    "message": "Hello from WhatsApp!"
  }'

# Using WhatsApp ID format (also accepted)
curl -X POST "http://localhost:5014/api/messages/send" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "1234567890@c.us",
    "message": "Hello from WhatsApp!"
  }'
```

**Send Message with Image/Video/PDF**
```bash
# Send an image with caption
curl -X POST "http://localhost:5014/api/messages/send" \
  -F "number=+1234567890" \
  -F "message=Check out this image!" \
  -F "media=@/path/to/image.jpg"

# Send a video with caption
curl -X POST "http://localhost:5014/api/messages/send" \
  -F "number=+1234567890" \
  -F "message=Watch this video!" \
  -F "media=@/path/to/video.mp4"

# Send a PDF document
curl -X POST "http://localhost:5014/api/messages/send" \
  -F "number=+1234567890" \
  -F "message=Please review this document" \
  -F "media=@/path/to/document.pdf"
```

**Send Message Using Template Media (from server storage)**
```bash
# Send message using media file stored in public/message-templates/
curl -X POST "http://localhost:5014/api/messages/send" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "+1234567890",
    "message": "Template message with media",
    "media_path": "/message-templates/template-image.jpg"
  }'
```

**Send to Group Chat**
```bash
# Send message to a WhatsApp group
curl -X POST "http://localhost:5014/api/messages/send" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "GROUP_ID@g.us",
    "message": "Hello group!"
  }'
```

**Check Server Status**
```bash
# Check if WhatsApp is ready and connected
curl "http://localhost:5014/api/status"
```

**Get Sent Messages History**
```bash
# Retrieve all sent messages
curl "http://localhost:5014/api/messages/sent"
```

**Send Message to Channel (if admin)**
```bash
# Send text message to a specific channel
curl -X POST "http://localhost:5014/api/channels/CHANNEL_ID@newsletter/send" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Channel announcement!"
  }'

# Send media to channel
curl -X POST "http://localhost:5014/api/channels/CHANNEL_ID@newsletter/send" \
  -F "message=Channel update with image" \
  -F "media=@/path/to/image.jpg"
```

**Send to Multiple Channels**
```bash
# Send to all channels where you are admin
curl -X POST "http://localhost:5014/api/channels/send" \
  -F "message=Broadcast message to all channels" \
  -F "sendToAll=true"

# Send to specific channel
curl -X POST "http://localhost:5014/api/channels/send" \
  -F "message=Message to specific channel" \
  -F "channelId=CHANNEL_ID@newsletter"
```

#### Cloudflare Worker Endpoints (Cloudflare Mode)

**Send Message via Queue (Primary Method)**

The Cloudflare service queues messages that are then processed by your local WhatsApp client. Messages are sent to `/api/messages/queue` endpoint.

**Basic Text Message (Anonymous Sender)**
```bash
curl -X POST "https://your-worker-url.workers.dev/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{
    "to": "1234567890@c.us",
    "message": "Hello from WhatsApp!"
  }'
```

**Text Message with Sender ID (User-Specific Queue)**
```bash
# Include sender ID for user-specific message queues
curl -X POST "https://your-worker-url.workers.dev/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{
    "to": "1234567890@c.us",
    "message": "Hello from WhatsApp!",
    "from": "9876543210@c.us",
    "contactName": "John Doe",
    "senderName": "Jane Smith",
    "priority": "normal"
  }'
```

**Note:** 
- `contactName`: Name of the recipient (who receives the message)
- `senderName`: Name of the sender (shown in response as "User: [senderName]")
- If `senderName` is not provided, response will show "User: Unknown User"

**High Priority Message**
```bash
# High priority messages are processed first
curl -X POST "https://your-worker-url.workers.dev/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{
    "to": "1234567890@c.us",
    "message": "Urgent message!",
    "priority": "high",
    "from": "9876543210@c.us",
    "contactName": "Jane Smith"
  }'
```

**Low Priority Message**
```bash
# Low priority messages are processed last
curl -X POST "https://your-worker-url.workers.dev/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{
    "to": "1234567890@c.us",
    "message": "Non-urgent update",
    "priority": "low",
    "from": "9876543210@c.us"
  }'
```

**Send Message with Image (Base64 Encoded)**
```bash
# First, encode your image to base64:
# On macOS/Linux:
IMAGE_BASE64=$(base64 -i /path/to/image.jpg)

# Then send the message:
curl -X POST "https://your-worker-url.workers.dev/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d "{
    \"to\": \"1234567890@c.us\",
    \"message\": \"Check out this image!\",
    \"media\": {
      \"mimetype\": \"image/jpeg\",
      \"data\": \"${IMAGE_BASE64}\",
      \"filename\": \"image.jpg\"
    },
    \"from\": \"9876543210@c.us\",
    \"priority\": \"normal\"
  }"
```

**Send Message with Video**
```bash
# Encode video to base64:
VIDEO_BASE64=$(base64 -i /path/to/video.mp4)

curl -X POST "https://your-worker-url.workers.dev/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d "{
    \"to\": \"1234567890@c.us\",
    \"message\": \"Watch this video!\",
    \"media\": {
      \"mimetype\": \"video/mp4\",
      \"data\": \"${VIDEO_BASE64}\",
      \"filename\": \"video.mp4\"
    },
    \"from\": \"9876543210@c.us\"
  }"
```

**Send Message with PDF Document**
```bash
# Encode PDF to base64:
PDF_BASE64=$(base64 -i /path/to/document.pdf)

curl -X POST "https://your-worker-url.workers.dev/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d "{
    \"to\": \"1234567890@c.us\",
    \"message\": \"Please review this document\",
    \"media\": {
      \"mimetype\": \"application/pdf\",
      \"data\": \"${PDF_BASE64}\",
      \"filename\": \"document.pdf\"
    },
    \"from\": \"9876543210@c.us\"
  }"
```

**Send Message to Group Chat**
```bash
# Use @g.us suffix for group chats
curl -X POST "https://your-worker-url.workers.dev/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{
    "to": "GROUP_ID@g.us",
    "message": "Hello group members!",
    "from": "9876543210@c.us"
  }'
```

**Complete Example with Error Handling**
```bash
#!/bin/bash
# Example script to send a message with error handling

WORKER_URL="https://your-worker-url.workers.dev"
API_KEY="your-api-key-here"
TO="1234567890@c.us"
MESSAGE="Hello from WhatsApp!"
FROM="9876543210@c.us"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${WORKER_URL}/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${API_KEY}" \
  -d "{
    \"to\": \"${TO}\",
    \"message\": \"${MESSAGE}\",
    \"from\": \"${FROM}\",
    \"priority\": \"normal\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
  echo "Message queued successfully!"
  echo "$BODY" | jq .
else
  echo "Error: HTTP $HTTP_CODE"
  echo "$BODY" | jq .
fi
```

**Get Queued Messages**
```bash
# Get all queued messages (pending delivery)
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/messages/queue"

# Get queued messages for specific user
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/messages/queue?from=9876543210@c.us"

# Pretty print JSON response
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/messages/queue" | jq .
```

**Process Message Queue**
```bash
# Manually trigger queue processing (marks messages as sent)
# Note: This endpoint expects a JSON body with processedMessages array
curl -X POST "https://your-worker-url.workers.dev/api/messages/queue/process" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{
    "processedMessages": [
      {
        "id": "msg_1234567890_abc123",
        "status": "sent",
        "sentAt": "2024-01-01T12:00:00Z"
      }
    ],
    "from": "9876543210@c.us"
  }'
```

**Channel Management**
```bash
# Get all channels
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/channels"

# Get channel messages
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/channels/CHANNEL_ID@newsletter/messages"
```

**Check Status**
```bash
# Check Cloudflare worker status
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/status"

# Health check (no auth required)
curl "https://your-worker-url.workers.dev/health"
```

**User Management**
```bash
# Get all active users
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/users"

# Get specific user session
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/users/9876543210@c.us"

# Register a new user
curl -X POST "https://your-worker-url.workers.dev/api/users/register" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{
    "id": "9876543210@c.us",
    "name": "John Doe"
  }'
```

**API Request/Response Format**

**Request Format:**
```json
{
  "to": "1234567890@c.us",           // Required: WhatsApp ID (ends with @c.us for contacts, @g.us for groups)
  "message": "Your message text",     // Required: Message content
  "from": "9876543210@c.us",         // Optional: Sender ID (must end with @c.us)
  "contactName": "John Doe",         // Optional: Recipient name (who will receive the message)
  "senderName": "Jane Smith",       // Optional: Sender name (who is sending, for display in response)
  "userName": "Jane Smith",          // Optional: Alias for senderName (same purpose)
  "priority": "normal",              // Optional: "normal" (default), "high", or "low"
  "media": {                         // Optional: Media attachment
    "mimetype": "image/jpeg",        // Required if media: MIME type
    "data": "base64_encoded_data",    // Required if media: Base64 encoded file data
    "filename": "image.jpg"          // Required if media: Original filename
  }
}
```

**Field Explanations:**
- `to`: The recipient's WhatsApp ID (who will receive the message)
- `contactName`: The recipient's display name (used by client to add/identify contact)
- `from`: The sender's WhatsApp ID (identifies which WhatsApp account is sending)
- `senderName` or `userName`: The sender's display name (shown in API response as "User: [name]")

**Success Response (200 OK):**
```json
{
  "success": true,
  "messageId": "msg_1234567890_abc123",
  "status": "queued",
  "from": "9876543210@c.us",
  "userDisplay": "User: John Doe"
}
```

**Error Response (400 Bad Request):**
```json
{
  "error": "to and message are required"
}
```

**Error Response (401 Unauthorized):**
```json
{
  "error": "Unauthorized",
  "message": "Valid API key required"
}
```

**Common Media MIME Types:**
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Videos: `video/mp4`, `video/3gpp`, `video/quicktime`
- Documents: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Audio: `audio/mpeg`, `audio/ogg`, `audio/wav`

**Important Notes:**
- All API endpoints require `x-api-key` header (except `/health`)
- The `to` field must be a valid WhatsApp ID format (ending with `@c.us` for contacts or `@g.us` for groups)
- The `from` field is optional; if provided, must end with `@c.us` (not `@g.us`)
- Messages are queued and processed by the local WhatsApp client via webhook
- Priority can be: `"normal"` (default), `"high"`, or `"low"`
- Media must be base64 encoded in the format: `{ "mimetype": "...", "data": "base64...", "filename": "..." }`
- Base64 encoding: Use `base64 -i file.jpg` on macOS/Linux or `certutil -encode file.jpg file.b64` on Windows
- Maximum message length: ~4096 characters
- Maximum media size: Depends on WhatsApp limits (typically 16MB for images, 64MB for videos)

**Backward Compatibility:**
- ✅ **Text-only messages**: Work with both old and new client versions
- ⚠️ **Messages with media**: Require updated client code (v1.33.1+) to handle base64 media format
- Old clients will gracefully skip media and send text-only if media format is unsupported

**Quick Reference: Cloudflare Service curl Commands**

Replace `https://your-worker-url.workers.dev` with your actual Cloudflare Worker URL and `your-api-key-here` with your API key.

| Action | Method | Endpoint | Description |
|--------|--------|----------|-------------|
| **Send Text Message** | POST | `/api/messages/queue` | Queue a text message for sending |
| **Send Message with Media** | POST | `/api/messages/queue` | Queue a message with image/video/document |
| **Get Queued Messages** | GET | `/api/messages/queue` | Get all pending messages |
| **Get User Messages** | GET | `/api/messages/queue?from=USER_ID@c.us` | Get queued messages for specific user |
| **Process Queue** | POST | `/api/messages/queue/process` | Mark messages as processed |
| **Get Channels** | GET | `/api/channels` | List all channels |
| **Get Channel Messages** | GET | `/api/channels/CHANNEL_ID@newsletter/messages` | Get messages from a channel |
| **Get Status** | GET | `/api/status` | Get system status and statistics |
| **Health Check** | GET | `/health` | Check if service is running (no auth) |
| **Get Users** | GET | `/api/users` | List all active users |
| **Get User Session** | GET | `/api/users/USER_ID@c.us` | Get user session details |
| **Register User** | POST | `/api/users/register` | Register a new user |

**Example: One-Line Commands**

```bash
# Set variables for easier use
export WORKER_URL="https://your-worker-url.workers.dev"
export API_KEY="your-api-key-here"

# Send a simple text message
curl -X POST "${WORKER_URL}/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${API_KEY}" \
  -d '{"to":"1234567890@c.us","message":"Hello!"}'

# Check service health
curl "${WORKER_URL}/health"

# Get all queued messages
curl -H "x-api-key: ${API_KEY}" "${WORKER_URL}/api/messages/queue"

# Get system status
curl -H "x-api-key: ${API_KEY}" "${WORKER_URL}/api/status"
```

## 🏗️ Architecture

### Multi-User System

- **User Isolation**: Each user has their own message queue and session
- **Session Management**: Automatic user registration and activity tracking
- **Webhook Support**: Real-time message processing with fallback polling

### Sync System

- **Event-Driven**: Immediate sync when messages are received
- **Auto Sync**: Periodic sync of chats and contacts (10 minutes)
- **Channel Sync**: Real-time channel message archiving

### Data Flow

1. **WhatsApp Client** → Detects messages and user activity
2. **Local Server** → Processes and queues messages
3. **Cloudflare Worker** → Stores and manages data with Durable Objects
4. **Web Interface** → Displays data and manages operations

## 🔒 Security

- **API Key Authentication**: All endpoints require valid API keys
- **User Isolation**: Complete separation of user data and sessions
- **Environment Variables**: Sensitive data stored in environment variables
- **Input Validation**: All inputs are validated and sanitized

## 📊 Monitoring

### Health Checks

```bash
# Local server status
curl http://localhost:5014/api/status

# Cloudflare worker status
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/status"
```

### Logs

- **Server Logs**: Real-time logging in console
- **User Activity**: Tracked in Cloudflare Durable Objects
- **Message History**: Stored with timestamps and user attribution

## 🚀 Deployment

### Local Development

```bash
npm start
```

### Production (Cloudflare Workers)

```bash
cd cloudflare-workers
npm run deploy
```

### Environment Variables

Required environment variables:
- `CLOUDFLARE_BASE_URL`: Your Cloudflare Worker URL
- `CLOUDFLARE_API_KEY`: Your secure API key
- `CLOUDFLARE_SYNC_INTERVAL`: Sync interval in milliseconds
- `CLOUDFLARE_QUEUE_INTERVAL`: Queue processing interval in milliseconds
- `MESSAGE_EXPIRY_HOURS`: Default message expiry time in hours (default: 24, 0 = no expiry)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the documentation in the `/docs` folder
- Review the API endpoints in the source code

## 🔄 Changelog

### v1.34.0
- **Queue Management System**: New Queue tab in Messages section
  - View pending messages in Cloudflare queue
  - Clear all or selected messages from queue
  - View processing history with status (sent, failed, expired, rejected)
  - Statistics dashboard for queue monitoring
- **Message Expiry Feature**: Prevent spam after downtime
  - Configurable expiry time (default: 24 hours)
  - Messages older than expiry time are automatically marked as expired
  - Per-message expiry support via `expiresAt` field
  - UI control to adjust expiry hours
- **Enhanced Queue Processing**
  - Detailed logging of all queue message states
  - Automatic expiry detection during processing
  - Better error tracking and reporting

### v1.33.1
- Multi-user system implementation
- Event-driven message processing
- Channel management system
- Cloudflare Workers integration
- Web interface improvements
- Security enhancements

---

**Note**: This system is designed for legitimate business use cases. Please ensure compliance with WhatsApp's Terms of Service and applicable laws in your jurisdiction.