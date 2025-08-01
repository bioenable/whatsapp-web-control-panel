# WhatsApp Web Control

A comprehensive WhatsApp Web automation and management tool built with Node.js and WhatsApp Web JS.

<div align="center">
    <br />
    <p>
        <a href="https://wwebjs.dev"><img src="https://github.com/wwebjs/logos/blob/main/4_Full%20Logo%20Lockup_Small/small_banner_blue.png?raw=true" title="whatsapp-web.js" alt="WWebJS Website" width="500" /></a>
    </p>
    <br />
    <p>
		<a href="https://www.npmjs.com/package/whatsapp-web.js"><img src="https://img.shields.io/npm/v/whatsapp-web.js.svg" alt="npm" /></a>
        <a href="https://depfu.com/github/pedroslopez/whatsapp-web.js?project_id=9765"><img src="https://badges.depfu.com/badges/4a65a0de96ece65fdf39e294e0c8dcba/overview.svg" alt="Depfu" /></a>
        <img src="https://img.shields.io/badge/WhatsApp_Web-2.3000.1017054665-brightgreen.svg" alt="WhatsApp_Web 2.2346.52" />
        <a href="https://discord.gg/H7DqQs4"><img src="https://img.shields.io/discord/698610475432411196.svg?logo=discord" alt="Discord server" /></a>
	</p>
    <br />
</div>

## About

**A WhatsApp API client that connects through the WhatsApp Web browser app**

The library works by launching the WhatsApp Web browser application and managing it using Puppeteer to create an instance of WhatsApp Web, thereby mitigating the risk of being blocked. The WhatsApp API client connects through the WhatsApp Web browser app, accessing its internal functions. This grants you access to nearly all the features available on WhatsApp Web, enabling dynamic handling similar to any other Node.js application.

> [!IMPORTANT]
> **It is not guaranteed you will not be blocked by using this method. WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe.**

## Features

- **Chat Management**: View and interact with all your WhatsApp chats
- **Message Sending**: Send messages to individual or multiple recipients
- **Template System**: Create and manage message templates with media support
- **Bulk Messaging**: Import CSV files and send bulk messages with scheduling
- **Channel Management**: Comprehensive channel management with multiple fetch methods
- **AI Automation**: Automated responses using Google GenAI with web search grounding
- **Leads Management**: Complete leads management system with auto-chat functionality
- **Auto-Reply System**: Intelligent auto-reply to customer messages with context awareness
- **Enhanced Logging**: Comprehensive logging with prompts and responses for debugging
- **Media Support**: Send images, videos, and PDF files
- **Real-time Status**: Live connection status and QR code authentication
- **Contact Management**: Live contact fetching and search functionality
- **Auto File Creation**: Automatic creation of required JSON files with proper structure

## Recent Updates

### v1.32.0 - Enhanced Contact Management & Bulk Messaging
- ✅ **Leads Tab Contact Processing**: New "Add Contacts" button for processing failed leads
- ✅ **Bulk Tab Contact Integration**: Automatic contact checking and addition before sending messages
- ✅ **Robust Contact Verification**: Enhanced contact addition with proper name verification
- ✅ **Random Name Generation**: Auto-generate names for contacts without names (firstName: random 6-char, lastName: "bulk")
- ✅ **Enhanced Error Handling**: Fail-safe contact addition with clear error messages
- ✅ **Real-time Progress Alerts**: Inline alerts with progress updates and closable UI components
- ✅ **Contact Status Tracking**: Persistent contact status in leads.json with proper error handling
- ✅ **Server Startup Fix**: Fixed route parsing error that prevented server startup

### v1.31.0 - Leads Management System
- ✅ **Complete Leads Management**: Full CRUD operations for leads
- ✅ **Auto Chat Configuration**: Configurable system prompts and auto-reply settings
- ✅ **CSV Import/Export**: Bulk import and export of leads data
- ✅ **Individual Auto Chat**: Per-lead auto chat enable/disable functionality

## Installation

### Prerequisites

- **Node.js v18+** is required
- Google Chrome (for video sending support)

### Installation Options

#### Option 1: Install from Latest Release (Recommended)
```bash
# Download the latest stable release
wget https://github.com/bioenable/whatsapp-web-control-panel/archive/refs/tags/v1.32.0.zip
unzip v1.32.0.zip
cd whatsapp-web-control-panel-1.32.0
npm install
```

#### Option 2: Install from Main Branch (Development Version)
```bash
# Clone the repository and get the latest development version
git clone https://github.com/bioenable/whatsapp-web-control-panel.git
cd whatsapp-web-control-panel
npm install
```

#### Option 3: Install Specific Version
```bash
# Clone and checkout a specific version
git clone https://github.com/bioenable/whatsapp-web-control-panel.git
cd whatsapp-web-control-panel
git checkout v1.32.0  # or any other version tag
npm install
```

### Quick Steps to Upgrade Node

#### Windows

**Manual**: Get the latest LTS from the [official node website][nodejs].

**npm**:
```powershell
sudo npm install -g n
sudo n stable
```

**Choco**:
```powershell
choco install nodejs-lts
```

**Winget**:
```powershell
winget install OpenJS.NodeJS.LTS
```

#### Ubuntu / Debian
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - &&\
sudo apt-get install -y nodejs
```

### Installation Steps

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables (see Configuration section)
4. Start the server: `npm start`
5. Open your browser to `http://localhost:5014`
6. Scan the QR code with WhatsApp Web

## Upgrading Existing Installations

### Quick Upgrade (Git Users)
```bash
# Run the automatic upgrade script
./upgrade.sh
```

### Manual Upgrade
See [UPGRADE_GUIDE.md](UPGRADE_GUIDE.md) for detailed upgrade instructions.

**Important**: Your data (JSON files, configurations, WhatsApp auth) is automatically preserved during upgrades.

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
PORT=5014
GOOGLE_API_KEY=your_google_genai_api_key
GOOGLE_MODEL=gemini-2.0-flash
```

### Required Files

The application automatically creates the following JSON files if they don't exist:

- `templates.json` - Message templates storage
- `bulk_messages.json` - Bulk message queue
- `sent_messages.json` - Sent message logs
- `automations.json` - Automation rules storage
- `detected_channels.json` - Detected channel information

### File Structure

```
whatsappweb/
├── server.js                    # Main server file
├── package.json                 # Dependencies and scripts
├── .env                        # Environment variables
├── public/                     # Frontend files
│   ├── index.html             # Main UI
│   ├── js/
│   │   ├── main.js           # Core functionality
│   │   ├── channels.js       # Channel management
│   │   ├── bulk.js           # Bulk messaging
│   │   ├── automate.js       # AI automation
│   │   └── contacts.js       # Contact management
│   └── message-templates/    # Template media files
├── whatsapp-web/              # WhatsApp Web.js library
├── templates.json             # Auto-created
├── bulk_messages.json         # Auto-created
├── sent_messages.json         # Auto-created
├── automations.json           # Auto-created
├── detected_channels.json     # Auto-created
└── automation_log_*.json      # Auto-created log files
```

## Usage

### Basic Usage

1. **Connect**: Scan the QR code to connect your WhatsApp account
2. **Navigate**: Use the tabs to access different features
3. **Send Messages**: Use the "Send Message" tab for individual or bulk messaging
4. **Manage Templates**: Create and use message templates in the "Templates" tab
5. **Bulk Operations**: Import CSV files and schedule bulk messages
6. **Channel Management**: Use the "Channels" tab to manage WhatsApp channels
7. **Automation**: Set up AI-powered automated responses
8. **Contacts**: View and search through all your WhatsApp contacts

### Channel Management

The Channels tab provides comprehensive management of WhatsApp channels with the following features:

#### Multiple Fetch Methods

- **All Channels**: View all channels you have access to
- **Followed Only**: Show only channels you're following
- **Subscribed Only**: Display channels where you're a subscriber
- **Admin Only**: Show channels where you have admin privileges

#### Channel Features

- **Channel List**: View all channels with detailed information including:
  - Channel name and description
  - Admin/Read-only status
  - Unread message count
  - Mute status
  - Last message preview
  - Channel ID for reference

- **Message Viewing**: 
  - View all messages in selected channels
  - See detailed message information including sender ID, message type, and media details
  - Messages are sorted by timestamp (newest first)

- **Message Sending**: 
  - Send text messages to channels where you're an admin
  - Attach media files (images, videos, PDFs)
  - Real-time message status updates

#### @newsletter Message Recognition

- Automatically detects messages from channels ending with `@newsletter`
- Visual highlighting in the incoming messages section (blue background)
- Special handling and display options for newsletter content
- `@newsletter` badge for easy identification

#### Channel Message Sending

- **Send to All**: Send message to all channels where user is admin
- **Send to Specific**: Send message to a specific channel by ID
- **Media Support**: Attach images, videos, or PDFs (max 100MB)
- **Error Handling**: Comprehensive error reporting and success tracking

#### Incoming Channel Messages

The system automatically detects and displays incoming messages from channels that are not from regular users (@c.us) or groups (@g.us). This includes:

- **Message Details**: Full sender ID, message content, timestamp, and media information
- **Reply Functionality**: Quick reply buttons that open the send message tab with pre-filled recipient
- **Message History**: View all incoming channel messages with detailed metadata

### Contact Management

- **Live Contact Fetching**: Always fetches fresh contacts from WhatsApp
- **Search Functionality**: Search across all contacts with loading animation
- **Contact Information**: View contact details including name, number, and avatar
- **Copy Functionality**: Copy contact numbers to clipboard
- **Pagination**: Navigate through large contact lists

### AI Automation

- **Auto-Reply**: Automated responses using Google GenAI
- **Web Search Grounding**: AI responses grounded with real-time web search
- **Chat History**: Context-aware responses using recent chat history
- **Scheduled Messages**: Automated scheduled messaging for channels

## API Endpoints

### Core Endpoints

- `GET /api/status` - Server and WhatsApp connection status
- `GET /api/chats` - Get all chats
- `GET /api/chats/:id/messages` - Get messages for a specific chat
- `POST /api/chats/:id/send` - Send message to a chat

### Channel Endpoints

- `GET /api/channels` - Get all channels
- `GET /api/channels/detailed?method={method}` - Get detailed channel information with filtering
- `GET /api/channels/:id/messages` - Get messages for a specific channel
- `POST /api/channels/:id/send` - Send message to a channel (admin only)
- `POST /api/channels/send` - Send message to multiple channels
- `GET /api/incoming-channel-messages` - Get incoming messages from channels

### Contact Endpoints

- `GET /api/contacts` - Get all contacts with search and pagination
- `POST /api/contacts/update` - Update contacts from WhatsApp

### Template Endpoints

- `GET /api/templates` - Get all message templates
- `POST /api/templates` - Create new template
- `PUT /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template

### Bulk Messaging Endpoints

- `GET /api/bulk` - Get bulk message records
- `POST /api/bulk` - Create bulk message record
- `PUT /api/bulk/:id` - Update bulk message record
- `DELETE /api/bulk/:id` - Delete bulk message record
- `POST /api/bulk/import` - Import CSV file for bulk messaging

### Automation Endpoints

- `GET /api/automations` - Get all automations
- `POST /api/automations` - Create new automation
- `PUT /api/automations/:id` - Update automation
- `DELETE /api/automations/:id` - Delete automation

## Supported Features

| Feature  | Status |
| ------------- | ------------- |
| Multi Device  | ✅  |
| Send messages  | ✅  |
| Receive messages  | ✅  |
| Send media (images/audio/documents)  | ✅  |
| Send media (video)  | ✅ [(requires Google Chrome)][google-chrome]  |
| Send stickers | ✅ |
| Receive media (images/audio/video/documents)  | ✅  |
| Send contact cards | ✅ |
| Send location | ✅ |
| Send buttons | ❌  [(DEPRECATED)][deprecated-video] |
| Send lists | ❌  [(DEPRECATED)][deprecated-video] |
| Receive location | ✅ | 
| Message replies | ✅ |
| Join groups by invite  | ✅ |
| Get invite for group  | ✅ |
| Modify group info (subject, description)  | ✅  |
| Modify group settings (send messages, edit info)  | ✅  |
| Add group participants  | ✅  |
| Kick group participants  | ✅  |
| Promote/demote group participants | ✅ |
| Mention users | ✅ |
| Mention groups | ✅ |
| Mute/unmute chats | ✅ |
| Block/unblock contacts | ✅ |
| Get contact info | ✅ |
| Get profile pictures | ✅ |
| Set user status message | ✅ |
| React to messages | ✅ |
| Create polls | ✅ |
| Channels | ✅ |
| Vote in polls | 🔜 |
| Communities | 🔜 |

## Example Usage

### Basic Client Setup

```js
const { Client } = require('whatsapp-web.js');

const client = new Client();

client.on('qr', (qr) => {
    // Generate and scan this code with your phone
    console.log('QR RECEIVED', qr);
});

client.on('ready', () => {
    console.log('Client is ready!');
});

client.on('message', msg => {
    if (msg.body == '!ping') {
        msg.reply('pong');
    }
});

client.initialize();
```

### Channel Management

```js
// Get all channels
const channels = await client.getChats();
const channelChats = channels.filter(chat => chat.isChannel);

// Send message to channel (admin only)
await client.sendMessage('channel_id@newsletter', 'Hello channel!');
```

## Troubleshooting

### Common Issues

1. **Connection Problems**: Ensure WhatsApp Web is working in your browser
2. **QR Code Issues**: Try refreshing the page or restarting the server
3. **Channel Loading**: Check your internet connection and WhatsApp Web status
4. **Message Sending**: Verify you have admin privileges for the channel
5. **Missing JSON Files**: The app automatically creates required files on startup

### Channel-Specific Issues

1. **No Channels Showing**: Make sure you're following or subscribed to channels
2. **Can't Send Messages**: Verify you have admin privileges in the channel
3. **Incoming Messages Not Showing**: Check if the messages are actually from channels (not @c.us or @g.us)

### Server Issues

1. **Server Won't Start**: Clear Puppeteer cache and lock files
   ```bash
   rm -rf .wwebjs_auth/session/SingletonLock
   rm -rf .wwebjs_cache
   ```

2. **Missing Functions**: Ensure all JavaScript files are loaded in HTML

3. **DOM Elements Not Found**: Verify HTML structure matches DOM references

### Testing

#### Server Status
```bash
curl http://localhost:5014/api/status
```

#### Channels API
```bash
curl http://localhost:5014/api/channels
```

#### Testing
All functionality can be tested directly in the main application interface at `http://localhost:5014`.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

Feel free to open pull requests; we welcome contributions! However, for significant changes, it's best to open an issue beforehand. Make sure to review our [contribution guidelines][contributing] before creating a pull request.

## Supporting the Project

You can support the maintainer of this project through the links below

- [Support via GitHub Sponsors][gitHub-sponsors]
- [Support via PayPal][support-payPal]
- [Sign up for DigitalOcean][digitalocean] and get $200 in credit when you sign up (Referral)

## Links

* [Website][website]
* [Guide][guide] ([source][guide-source]) _(work in progress)_
* [Documentation][documentation] ([source][documentation-source])
* [WWebJS Discord][discord]
* [GitHub][gitHub]
* [npm][npm]

## Disclaimer

This project is not affiliated, associated, authorized, endorsed by, or in any way officially connected with WhatsApp or any of its subsidiaries or its affiliates. The official WhatsApp website can be found at [whatsapp.com][whatsapp]. "WhatsApp" as well as related names, marks, emblems and images are registered trademarks of their respective owners. Also it is not guaranteed you will not be blocked by using this method. WhatsApp does not allow bots or unofficial clients on their platform, so this shouldn't be considered totally safe.

## License

Copyright 2019 Pedro S Lopez  

Licensed under the Apache License, Version 2.0 (the "License");  
you may not use this project except in compliance with the License.  
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.  

Unless required by applicable law or agreed to in writing, software  
distributed under the License is distributed on an "AS IS" BASIS,  
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.  
See the License for the specific language governing permissions and  
limitations under the License.  

[website]: https://wwebjs.dev
[guide]: https://guide.wwebjs.dev/guide
[guide-source]: https://github.com/wwebjs/wwebjs.dev/tree/main
[documentation]: https://docs.wwebjs.dev/
[documentation-source]: https://github.com/pedroslopez/whatsapp-web.js/tree/main/docs
[discord]: https://discord.gg/H7DqQs4
[gitHub]: https://github.com/pedroslopez/whatsapp-web.js
[npm]: https://npmjs.org/package/whatsapp-web.js
[nodejs]: https://nodejs.org/en/download/
[examples]: https://github.com/pedroslopez/whatsapp-web.js/blob/master/example.js
[auth-strategies]: https://wwebjs.dev/guide/creating-your-bot/authentication.html
[google-chrome]: https://wwebjs.dev/guide/creating-your-bot/handling-attachments.html#caveat-for-sending-videos-and-gifs
[deprecated-video]: https://www.youtube.com/watch?v=hv1R1rLeVVE
[gitHub-sponsors]: https://github.com/sponsors/pedroslopez
[support-payPal]: https://www.paypal.me/psla/
[digitalocean]: https://m.do.co/c/73f906a36ed4
[contributing]: https://github.com/pedroslopez/whatsapp-web.js/blob/main/CODE_OF_CONDUCT.md
[whatsapp]: https://whatsapp.com 