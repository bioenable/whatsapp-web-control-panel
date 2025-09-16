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

**Message Queue**
```bash
# Send message
curl -X POST "https://your-worker-url.workers.dev/api/messages/queue" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key-here" \
  -d '{
    "to": "919876543210@c.us",
    "message": "Hello from WhatsApp!",
    "priority": "normal",
    "userId": "919822218111@c.us",
    "userInfo": {
      "name": "User Name",
      "phone": "919822218111",
      "platform": "iphone"
    }
  }'
```

**Channel Management**
```bash
# Get all channels
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/channels"

# Get channel messages
curl -H "x-api-key: your-api-key-here" \
  "https://your-worker-url.workers.dev/api/channels/CHANNEL_ID/messages"
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

### v1.33.1
- Multi-user system implementation
- Event-driven message processing
- Channel management system
- Cloudflare Workers integration
- Web interface improvements
- Security enhancements

---

**Note**: This system is designed for legitimate business use cases. Please ensure compliance with WhatsApp's Terms of Service and applicable laws in your jurisdiction.