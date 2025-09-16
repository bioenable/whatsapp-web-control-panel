#!/bin/bash

# Cloudflare Workers Deployment Script
# This script deploys the WhatsApp Cloudflare integration

set -e

echo "🚀 Starting Cloudflare Workers deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if wrangler is installed
check_wrangler() {
    if ! command -v wrangler &> /dev/null; then
        print_error "Wrangler CLI is not installed. Please install it first:"
        echo "npm install -g wrangler"
        exit 1
    fi
    print_success "Wrangler CLI found"
}

# Check if we're in the right directory
check_directory() {
    if [ ! -f "cloudflare/cloudflare-workers/wrangler.toml" ]; then
        print_error "Please run this script from the project root directory"
        exit 1
    fi
    print_success "Directory structure looks good"
}

# Login to Cloudflare
login_cloudflare() {
    print_status "Logging in to Cloudflare..."
    if wrangler whoami &> /dev/null; then
        print_success "Already logged in to Cloudflare"
    else
        print_warning "Please login to Cloudflare when prompted"
        wrangler login
    fi
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    cd cloudflare/cloudflare-workers
    npm install
    cd ../..
    print_success "Dependencies installed"
}

# Deploy to staging
deploy_staging() {
    print_status "Deploying to staging environment..."
    cd cloudflare/cloudflare-workers
    wrangler deploy --env staging
    cd ../..
    print_success "Staging deployment completed"
}

# Deploy to production
deploy_production() {
    print_status "Deploying to production environment..."
    cd cloudflare/cloudflare-workers
    wrangler deploy --env production
    cd ../..
    print_success "Production deployment completed"
}

# Test deployment
test_deployment() {
    print_status "Testing deployment..."
    
    # Get the worker URL from wrangler
    cd cloudflare/cloudflare-workers
    WORKER_URL=$(wrangler whoami | grep -o 'https://[^[:space:]]*' || echo "")
    cd ../..
    
    if [ -z "$WORKER_URL" ]; then
        print_warning "Could not determine worker URL automatically"
        print_status "Please test manually using the test app"
        return
    fi
    
    # Test health endpoint
    print_status "Testing health endpoint..."
    if curl -s "$WORKER_URL/health" | grep -q "healthy"; then
        print_success "Health check passed"
    else
        print_error "Health check failed"
    fi
    
    # Test API endpoint (with generic API key)
    print_status "Testing API endpoint..."
    if curl -s -H "x-api-key: your-api-key-here" "$WORKER_URL/api/status" | grep -q "success"; then
        print_success "API test passed"
    else
        print_error "API test failed - make sure to set your API key secret"
    fi
}

# Show deployment info
show_info() {
    print_status "Deployment completed!"
    echo ""
    echo "📋 Next steps:"
    echo "1. Update your .env file with the Cloudflare URL"
    echo "2. Restart your desktop app"
    echo "3. Test the integration using test-cloudflare-app.html"
    echo ""
    echo "🔧 Configuration:"
    echo "CLOUDFLARE_BASE_URL=https://your-worker-url.workers.dev"
    echo "CLOUDFLARE_API_KEY=whatsapp-sync-key-2025"
    echo "CLOUDFLARE_SYNC_INTERVAL=30000"
    echo "CLOUDFLARE_QUEUE_INTERVAL=10000"
    echo ""
    echo "📖 Documentation:"
    echo "- CLOUDFLARE_INTEGRATION.md"
    echo "- deploy-cloudflare.md"
    echo ""
    echo "🧪 Test App:"
    echo "- test-cloudflare-app.html"
}

# Main deployment function
main() {
    echo "=========================================="
    echo "WhatsApp Cloudflare Workers Deployment"
    echo "=========================================="
    echo ""
    
    # Check prerequisites
    check_wrangler
    check_directory
    
    # Install dependencies
    install_dependencies
    
    # Login to Cloudflare
    login_cloudflare
    
    # Deploy to staging first
    deploy_staging
    
    # Ask for production deployment
    echo ""
    read -p "Deploy to production? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        deploy_production
    else
        print_warning "Skipping production deployment"
    fi
    
    # Test deployment
    test_deployment
    
    # Show info
    show_info
}

# Handle command line arguments
case "${1:-}" in
    "staging")
        check_wrangler
        check_directory
        install_dependencies
        login_cloudflare
        deploy_staging
        test_deployment
        ;;
    "production")
        check_wrangler
        check_directory
        install_dependencies
        login_cloudflare
        deploy_production
        test_deployment
        ;;
    "test")
        test_deployment
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [staging|production|test|help]"
        echo ""
        echo "Commands:"
        echo "  staging   - Deploy to staging environment only"
        echo "  production - Deploy to production environment only"
        echo "  test      - Test existing deployment"
        echo "  help      - Show this help message"
        echo ""
        echo "If no command is provided, deploys to staging and asks for production"
        ;;
    "")
        main
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac 