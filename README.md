# WhatsApp Web Control Panel

A professional, robust WhatsApp Web Control Panel built with Express.js, whatsapp-web.js, and a modern Bootstrap/Tailwind UI (no React). Designed for advanced message management, bulk messaging, and template workflows.

## Features

- **Templates Tab**: Create, edit, preview, and delete message templates (text + media). Media is uploaded and stored locally. Templates can be used in Send Message and Chats tabs.
- **Bulk Messaging Tab**: Import CSVs with number, message, media, and send_datetime. Robust CSV parsing (handles quotes/commas). Schedule, test, and manage bulk messages. Includes a "Test" button for instant or scheduled testing.
- **Send Message Tab**: Multi-recipient sending, media attachments, template selection, live preview, and persistent sent messages log.
- **Chats Tab**: WhatsApp Web-style chat list, message area, and input bar. Supports template selection and media preview.
- **UI/UX**: Built with Tailwind CSS and shadcn/ui patterns. Responsive, professional, and user-friendly.
- **Debugging & Persistence**: All data is stored in JSON files. Debug logs for sent messages and file writes.
- **Timezone Handling**: All times are shown and generated in the system/server timezone (or IST fallback). Bulk CSV sample and imports use local time for clarity.

## Setup Instructions

### Requirements
- Node.js 16+
- npm
- WhatsApp account (for whatsapp-web.js authentication)

### Installation
```sh
npm install
```

### Running the App
```sh
npm start
```
- The server will run at [http://localhost:5014](http://localhost:5014)
- On first run, scan the QR code with your WhatsApp app.

### File Structure
- `server.js` — Main Express backend and WhatsApp integration
- `public/` — Static frontend (HTML, JS, CSS)
- `public/message-templates/` — Uploaded template media
- `templates.json` — Template data
- `bulk_messages.json` — Bulk message records
- `sent_messages.json` — Sent message log

## Bulk Messaging Testing
- Use the **Download Sample CSV** button in the Bulk tab to get a ready-to-import CSV with tech jokes and public domain images.
- All sample send times are 20+ minutes in the future (buffer for import delay).
- After import, use the **Test** button to send immediately or reschedule for 1 min.
- All times are shown in your system/server timezone for clarity.

## Advanced Features
- Robust CSV import (handles quoted fields, commas, and timezones)
- Media can be uploaded or referenced by URL (for bulk)
- Scheduler ensures no double-sending; only pending messages are sent
- Test actions update status and scheduling as expected

## Contributing
Pull requests and issues are welcome! Please open an issue for bugs or feature requests.

## License
MIT License 