# Cloudflare Workers Deployment Guide

## 🚀 **Deployment Steps**

### **1. Prerequisites**

- Cloudflare account (free tier available)
- Node.js and npm installed
- Wrangler CLI installed globally

### **2. Setup Cloudflare Account**

1. **Create Cloudflare Account**
   - Go to [cloudflare.com](https://cloudflare.com)
   - Sign up for a free account
   - Verify your email

2. **Get Account ID**
   - Go to Cloudflare Dashboard
   - Copy your Account ID from the right sidebar

3. **Create API Token**
   - Go to "My Profile" → "API Tokens"
   - Create a new token with "Cloudflare Workers" permissions
   - Copy the token

### **3. Configure Wrangler**

```bash
# Navigate to cloudflare directory
cd cloudflare/cloudflare-workers

# Login to Cloudflare
wrangler login

# The wrangler.toml is already configured with generic settings
# No account ID needed - it will use your logged-in account
```

### **4. Deploy to Cloudflare**

```bash
# Deploy the worker
wrangler deploy

# Your worker will be available at:
# https://whatsapp-sync-worker.your-subdomain.workers.dev
```

### **5. Set API Key Secret**

```bash
# Set your API key as a secret
wrangler secret put API_KEY
# Enter your custom API key when prompted
```

### **6. Update Desktop App Configuration**

Update your `.env` file with your worker details:

```bash
# Add these to your .env file
CLOUDFLARE_BASE_URL=https://whatsapp-sync-worker.your-subdomain.workers.dev
CLOUDFLARE_API_KEY=your-custom-api-key
CLOUDFLARE_SYNC_INTERVAL=600000
CLOUDFLARE_QUEUE_INTERVAL=60000
```

### **7. Test the Deployment**

1. **Test Health Endpoint**
   ```bash
   curl https://your-worker-url.workers.dev/health
   ```

2. **Test API with Authentication**
   ```bash
   curl -H "x-api-key: whatsapp-sync-key-2025" \
        https://your-worker-url.workers.dev/api/status
   ```

3. **Use the Test App**
   - Open `test-cloudflare-app.html` in your browser
   - Update the Cloudflare URL
   - Test all functionality

## 🔧 **Configuration Options**

### **Environment Variables**

| Variable | Default | Description |
|----------|---------|-------------|
| `CLOUDFLARE_BASE_URL` | `https://whatsapp-sync.your-subdomain.workers.dev` | Your Worker URL |
| `CLOUDFLARE_API_KEY` | `whatsapp-sync-key-2025` | API key for authentication |
| `CLOUDFLARE_SYNC_INTERVAL` | `30000` | Sync interval in milliseconds |
| `CLOUDFLARE_QUEUE_INTERVAL` | `10000` | Queue processing interval |

### **Custom API Keys**

To use a custom API key:

1. **Set Environment Variable**
   ```bash
   wrangler secret put API_KEY
   # Enter your custom API key when prompted
   ```

2. **Update Desktop App**
   ```bash
   # Update your .env file
   CLOUDFLARE_API_KEY=your-custom-api-key
   ```

## 📊 **Monitoring & Logs**

### **Cloudflare Dashboard**

1. Go to Cloudflare Dashboard
2. Navigate to "Workers & Pages"
3. Select your worker
4. View analytics and logs

### **Real-time Logs**

```bash
# View real-time logs
wrangler tail --env production
```

### **Performance Metrics**

- **Requests per day**: Free tier allows 100,000 requests/day
- **Durable Object requests**: Free tier allows 1,000 requests/day
- **Storage**: Unlimited (within reasonable limits)

## 🔒 **Security**

### **API Key Management**

- Use strong, unique API keys
- Rotate keys regularly
- Never commit API keys to version control

### **CORS Configuration**

The worker is configured with permissive CORS for development. For production:

1. **Update CORS in `src/index.js`**
   ```javascript
   const corsHeaders = {
     'Access-Control-Allow-Origin': 'https://your-domain.com',
     'Access-Control-Allow-Methods': 'GET, POST',
     'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
   };
   ```

### **Rate Limiting**

Consider implementing rate limiting for production use:

```javascript
// Add to your worker
const rateLimit = new Map();
const MAX_REQUESTS = 100;
const WINDOW_MS = 60000; // 1 minute
```

## 🚨 **Troubleshooting**

### **Common Issues**

1. **Worker Not Deploying**
   ```bash
   # Check wrangler configuration
   wrangler whoami
   wrangler config
   ```

2. **Authentication Errors**
   - Verify API key is correct
   - Check `x-api-key` header is present
   - Ensure worker is deployed

3. **CORS Errors**
   - Check browser console for CORS errors
   - Verify CORS headers in worker response

4. **Data Not Syncing**
   - Check desktop app logs
   - Verify Cloudflare client initialization
   - Test connection manually

### **Debug Commands**

```bash
# Test worker locally
wrangler dev

# View worker logs
wrangler tail

# Check worker status
wrangler status
```

## 📈 **Scaling Considerations**

### **Free Tier Limits**

- **Workers**: 100,000 requests/day
- **Durable Objects**: 1,000 requests/day
- **CPU time**: 10ms per request
- **Memory**: 128MB per request

### **Upgrading to Paid Plan**

When you need more capacity:

1. **Upgrade to Workers Paid Plan**
   - $5/month for 10M requests
   - $0.50 per additional 1M requests

2. **Update Configuration**
   ```bash
   # Update wrangler.toml for paid plan
   [env.production]
   name = "whatsapp-sync-prod"
   # Add paid plan configuration
   ```

## 🔄 **Updates & Maintenance**

### **Updating the Worker**

```bash
# Pull latest changes
git pull origin main

# Deploy updates
wrangler deploy --env production
```

### **Database Migrations**

If you need to update the Durable Object schema:

1. **Create Migration**
   ```bash
   # Update wrangler.toml with new migration
   [[migrations]]
   tag = "v2"
   new_classes = ["WhatsAppDataStore"]
   ```

2. **Deploy Migration**
   ```bash
   wrangler deploy --env production
   ```

## 📞 **Support**

### **Getting Help**

- **Cloudflare Documentation**: [developers.cloudflare.com](https://developers.cloudflare.com)
- **Workers Community**: [community.cloudflare.com](https://community.cloudflare.com)
- **GitHub Issues**: Report bugs in your project repository

### **Useful Commands**

```bash
# Check worker status
wrangler status

# View worker analytics
wrangler analytics

# Test worker locally
wrangler dev

# Deploy to specific environment
wrangler deploy --env staging
wrangler deploy --env production
```

---

**Note**: This deployment guide assumes you're using the free tier. For production applications with high traffic, consider upgrading to a paid plan for better performance and higher limits. 