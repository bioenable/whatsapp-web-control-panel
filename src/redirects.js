// Geosquare.in Subdomain Redirects Configuration
export default [
  // City-specific redirects
  {
    path: "/",
    hostname: "pune.geosquare.in",
    redirect: "https://www.geosquare.in/real-estate-pune-news-category",
    status: 301
  },
  {
    path: "/",
    hostname: "mumbai.geosquare.in", 
    redirect: "https://www.geosquare.in/real-estate-mumbai-news-category",
    status: 301
  },
  
  // Additional city redirects (easily expandable)
  {
    path: "/",
    hostname: "delhi.geosquare.in",
    redirect: "https://www.geosquare.in/real-estate-delhi-news-category",
    status: 301
  },
  {
    path: "/",
    hostname: "bangalore.geosquare.in",
    redirect: "https://www.geosquare.in/real-estate-bangalore-news-category", 
    status: 301
  },
  {
    path: "/",
    hostname: "chennai.geosquare.in",
    redirect: "https://www.geosquare.in/real-estate-chennai-news-category",
    status: 301
  },
  {
    path: "/",
    hostname: "hyderabad.geosquare.in",
    redirect: "https://www.geosquare.in/real-estate-hyderabad-news-category",
    status: 301
  },
  
  // Catch-all for any other subdomain - redirect to main site
  {
    path: "/:path*",
    redirect: "https://www.geosquare.in/:path*",
    status: 301
  }
] 