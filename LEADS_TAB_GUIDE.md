# Leads Tab - User Guide

## Overview
The Leads tab provides a comprehensive system for managing leads from website registrations and inquiries. It automatically fetches data from the external API, stores it locally, and provides tools for lead management and automated chat responses.

## Features

### 1. Automatic Data Fetching
- **API Integration**: Connects to `https://dashboard.geosquare.in/api/get_registrations`
- **Auto Refresh**: Fetches new leads every 5 minutes
- **Data Storage**: Stores up to 200 latest leads in `leads.json`
- **Duplicate Prevention**: Prevents duplicate entries based on email, mobile, and creation time

### 2. Lead Management Interface
- **Tabular List View**: Clean, organized display of all leads
- **Search & Filter**: Search by name, email, mobile, or inquiry text
- **Type Filtering**: Filter by Registration or Inquiry types
- **Real-time Count**: Shows current number of leads

### 3. Lead Details
- **Expandable Records**: Click "View Details" to see full information
- **Source URL Display**: Shows domain only in list view, full URL in details
- **Inquiry Preview**: Shows first 10 words in list, full text in details
- **Time Display**: Shows relative time (e.g., "2h ago", "1d ago")
- **Additional Details**: JSON metadata in formatted view

### 4. WhatsApp Integration
- **Chat Status**: Shows if chat has been started with the lead
- **Start Chat**: Button to initiate WhatsApp conversation
- **Restart Chat**: Option to restart conversation
- **Message Count**: Shows number of messages if chat exists

### 5. Auto Chat System
- **Toggle Control**: Enable/disable automatic chat responses
- **Configuration**: Customizable system prompts and settings
- **AI Integration**: Uses Google Gemini API for intelligent responses
- **Testing**: Test configuration with existing leads

## How to Use

### Accessing the Leads Tab
1. Open the WhatsApp Web Control application
2. Click on the "Leads" tab in the navigation
3. The leads list will automatically load

### Viewing Leads
- **List View**: All leads are displayed in a clean table format
- **Search**: Use the search box to find specific leads
- **Filter**: Use the dropdown to filter by lead type
- **Details**: Click "View Details" to expand and see full information

### Managing Auto Chat

#### Enabling Auto Chat
1. Check the "Start Auto Chat" toggle
2. Click "Configure" to set up the system
3. Fill in the configuration form:
   - **System Prompt**: Define how the AI should behave
   - **Include JSON Context**: Whether to include lead data in AI prompts
   - **Enable Auto Reply**: Turn on automatic responses to customer replies
   - **Auto Reply Prompt**: Instructions for handling customer responses

#### Configuration Options
- **System Prompt**: Main instructions for the AI (required)
- **JSON Context**: Include lead data for more personalized responses
- **Auto Reply**: Enable automatic responses to customer messages
- **Auto Reply Prompt**: Specific instructions for reply handling

#### Testing Auto Chat
1. Open the configuration modal
2. Select a test record from the dropdown
3. Click "Test" to simulate the auto chat process
4. Review the generated response

### Manual Actions
- **Refresh**: Click "Refresh" to manually fetch new leads
- **Start Chat**: Click the chat icon to initiate WhatsApp conversation
- **Restart Chat**: Use this option to begin a new conversation thread

## Data Structure

### Lead Record Format
```json
{
  "id": "unique-identifier",
  "name": "Lead Name",
  "email": "email@example.com",
  "mobile": "+1234567890",
  "inquiry": "Customer inquiry message",
  "source_url": "https://source-website.com/page",
  "additional_details": "JSON string with metadata",
  "created_on": "2025-07-23 10:00:00",
  "Type": "Registration|Inquiry",
  "processed": false,
  "chat_started": false,
  "last_updated": "2025-07-23T10:00:00.000Z"
}
```

### Additional Details Structure
```json
{
  "Enquiry Source": "Download Brochure",
  "source_url": "https://example.com",
  "submission_form": "Contact Form",
  "geolocation": {
    "latitude": 18.5148,
    "longitude": 73.926
  },
  "device": "Desktop|Mobile",
  "browser": "Chrome|Firefox|Safari",
  "project": "Project Name",
  "district": "District Name",
  "village": "Village Name",
  "source": "Request Details Button",
  "otp_verified": true
}
```

## Auto Chat Workflow

### For New Leads
1. System detects new lead added to JSON
2. If auto chat is enabled, calls Gemini API with:
   - System prompt
   - Lead JSON data (if context enabled)
   - Instructions to generate initial message
3. Sends generated message to lead's WhatsApp number
4. Marks lead as processed

### For Customer Replies
1. Customer sends message to WhatsApp
2. System detects the message
3. Calls Gemini API with:
   - System prompt
   - Auto reply prompt
   - Lead JSON data
   - Chat history (up to 100 messages)
4. Sends AI-generated response to customer

## Best Practices

### System Prompt Examples
```
You are a helpful sales assistant for a real estate company. Your goal is to engage with leads and convert them into customers. Be friendly, professional, and helpful. Ask relevant questions about their property needs and provide valuable information.
```

### Auto Reply Prompt Examples
```
When the customer replies, respond naturally and helpfully. Ask follow-up questions to understand their needs better. Provide relevant property information and guide them toward making an inquiry or booking a site visit.
```

### Configuration Tips
- **Keep prompts concise**: Clear, specific instructions work better
- **Include context**: Enable JSON context for more personalized responses
- **Test regularly**: Use the test feature to verify your configuration
- **Monitor responses**: Check generated messages to ensure quality

## Troubleshooting

### Common Issues
1. **No leads appearing**: Check if the API is accessible and returning data
2. **Auto chat not working**: Verify Gemini API key is configured in `.env`
3. **Messages not sending**: Ensure WhatsApp is connected and ready
4. **Configuration not saving**: Check browser console for errors

### API Requirements
- **Google API Key**: Required for auto chat functionality
- **WhatsApp Connection**: Must be authenticated for sending messages
- **Internet Connection**: Required for API calls and data fetching

## Technical Details

### Files Created/Modified
- `public/js/leads.js` - Frontend functionality
- `public/index.html` - UI components
- `server.js` - Backend API endpoints
- `leads.json` - Data storage
- `.gitignore` - Added temp directory

### API Endpoints
- `GET /api/leads` - Retrieve leads data
- `POST /api/leads` - Save leads data
- `POST /api/gemini/chat` - Generate AI responses

### Data Limits
- **Maximum leads**: 200 records (oldest removed automatically)
- **Chat history**: 100 messages for context
- **File size**: 10MB for CSV uploads
- **Auto fetch**: Every 5 minutes

This leads management system provides a complete solution for tracking, managing, and automatically engaging with website leads through intelligent AI-powered conversations. 