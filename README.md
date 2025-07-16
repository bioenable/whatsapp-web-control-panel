# WhatsApp Web Control Panel

A modern, user-friendly Express.js and Bootstrap-based web control panel for WhatsApp automation, built on top of [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).

## Features
- Beautiful, responsive web UI with Bootstrap 5
- Tabs for Chats and Send Message
- Multi-recipient selection and direct chat/group messaging
- Media support (images, videos, PDFs) with live preview
- Live WhatsApp status and QR code login
- REST API endpoints for status, chats, messages, and sending messages
- Robust backend with Express.js

## Installation

1. **Clone the repository:**
   ```sh
   git clone https://github.com/bioenable/whatsapp-web-control-panel.git
   cd whatsapp-web-control-panel
   ```
2. **Install dependencies:**
   ```sh
   npm install
   ```
3. **Start the server:**
   ```sh
   npm start
   # or
   node server.js
   ```
4. **Open your browser:**
   Visit [http://localhost:5014](http://localhost:5014)

## Usage
- Scan the QR code with your WhatsApp mobile app to log in.
- Use the Chats tab to view and send messages directly in any chat or group.
- Use the Send Message tab to send messages or media to one or more recipients.

## Project Structure
```
/               # Main app code and assets
|-- public/     # Frontend (HTML, JS, CSS)
|-- server.js   # Express.js backend
|-- whatsapp-web/ # whatsapp-web.js library (submodule or dependency)
|-- package.json
|-- .gitignore
```

## API Endpoints
- `GET /api/status` — WhatsApp client status and QR code
- `GET /api/chats` — List all chats
- `GET /api/chats/:id/messages` — Get messages for a chat
- `POST /api/messages/send` — Send message (with optional media)

## Contributing
Pull requests are welcome! For major changes, please open an issue first to discuss what you would like to change.

## License
This project is licensed under the Apache 2.0 License. See [LICENSE](whatsapp-web/LICENSE) for details.

---

*This project is not affiliated with WhatsApp Inc. Use at your own risk.* 