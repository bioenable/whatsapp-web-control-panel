// Geosquare.in Subdomain Redirector
// City-specific redirects mapping
const cityMappings = {
  'pune.geosquare.in': 'https://www.geosquare.in/real-estate-pune-news-category',
  'mumbai.geosquare.in': 'https://www.geosquare.in/real-estate-mumbai-news-category',
  'delhi.geosquare.in': 'https://www.geosquare.in/real-estate-delhi-news-category',
  'bangalore.geosquare.in': 'https://www.geosquare.in/real-estate-bangalore-news-category',
  'chennai.geosquare.in': 'https://www.geosquare.in/real-estate-chennai-news-category',
  'hyderabad.geosquare.in': 'https://www.geosquare.in/real-estate-hyderabad-news-category'
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const hostname = url.hostname
    
    console.log(`Processing request for: ${hostname}${url.pathname}`)
    
    // Check if this is a city subdomain we want to redirect
    if (cityMappings[hostname]) {
      const redirectUrl = cityMappings[hostname]
      console.log(`Redirecting ${hostname} to ${redirectUrl}`)
      return Response.redirect(redirectUrl, 301)
    }
    
    // Handle management interface at /_redirects
    if (url.pathname.startsWith('/_redirects')) {
      return new Response(generateManagementUI(), {
        headers: { 'Content-Type': 'text/html' }
      })
    }
    
    // Default fallback - redirect any other geosquare.in subdomain to main site
    if (hostname.endsWith('.geosquare.in')) {
      const fallbackUrl = `https://www.geosquare.in${url.pathname}${url.search}`
      console.log(`Fallback redirect: ${hostname} to ${fallbackUrl}`)
      return Response.redirect(fallbackUrl, 301)
    }
    
    // If not a geosquare.in subdomain, return 404
    return new Response('Not Found', { status: 404 })
  }
}

// Simple management UI
function generateManagementUI() {
  const cities = Object.keys(cityMappings).map(hostname => {
    const city = hostname.split('.')[0]
    return `
      <tr>
        <td><a href="https://${hostname}" target="_blank">${hostname}</a></td>
        <td><a href="${cityMappings[hostname]}" target="_blank">${cityMappings[hostname]}</a></td>
        <td><span style="color: green;">Active</span></td>
      </tr>
    `
  }).join('')
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Geosquare.in Redirector Management</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; }
        h1 { color: #333; }
        .status { margin: 20px 0; padding: 15px; background: #e8f5e8; border-radius: 5px; }
      </style>
    </head>
    <body>
      <h1>🏢 Geosquare.in Redirector Management</h1>
      
      <div class="status">
        <strong>Status:</strong> Redirector is active and handling *.geosquare.in subdomains
      </div>
      
      <h2>Active Redirects</h2>
      <table>
        <thead>
          <tr>
            <th>Subdomain</th>
            <th>Redirect To</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${cities}
        </tbody>
      </table>
      
      <h2>Test Your Redirects</h2>
      <p>Click on any subdomain above to test the redirect, or try these commands:</p>
      <pre>
curl -I https://pune.geosquare.in
curl -I https://mumbai.geosquare.in
      </pre>
      
      <p><em>Last updated: ${new Date().toISOString()}</em></p>
    </body>
    </html>
  `
} 