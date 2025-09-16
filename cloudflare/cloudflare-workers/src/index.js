import { WhatsAppDataStore } from './whatsapp-store.js';

// Export the Durable Object for Cloudflare
export { WhatsAppDataStore };

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  'Access-Control-Max-Age': '86400',
};

function authenticateRequest(request, env) {
  const apiKey = request.headers.get('x-api-key');
  const validKeys = [
    'your-api-key-here',
    env.API_KEY // Cloudflare secret
  ].filter(Boolean);
  return apiKey && validKeys.includes(apiKey);
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: corsHeaders
      });
    }

    // Add CORS headers to all responses
    const addCorsHeaders = (response) => {
      const newHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    };

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Health check endpoint (no auth required)
      if (path === '/health') {
        return addCorsHeaders(new Response(JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        }), {
          headers: { 'Content-Type': 'application/json' }
        }));
      }

      // API endpoints require authentication
      if (path.startsWith('/api/')) {
        if (!authenticateRequest(request, env)) {
          return addCorsHeaders(new Response(JSON.stringify({
            error: 'Unauthorized',
            message: 'Valid API key required'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
      }

      // Route to Durable Object
      const id = env.WHATSAPP_STORE.idFromName('whatsapp-data');
      const obj = env.WHATSAPP_STORE.get(id);
      
      const response = await obj.fetch(request);
      return addCorsHeaders(response);

    } catch (error) {
      console.error('Worker error:', error);
      return addCorsHeaders(new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
  }
}; 