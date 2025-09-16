#!/bin/bash

echo "🚀 Publishing WhatsApp Web Control System to GitHub"
echo "=================================================="

# Create main branch from current HEAD
echo "📝 Creating main branch..."
git checkout -b main

# Remove old remote (whatsapp-web.js repository)
echo "🗑️  Removing old remote..."
git remote remove origin

echo "✅ Ready for your new GitHub repository!"
echo ""
echo "Next steps:"
echo "1. Create a new repository on GitHub.com"
echo "2. Copy the repository URL (e.g., https://github.com/username/repo-name.git)"
echo "3. Run: git remote add origin YOUR_REPO_URL"
echo "4. Run: git push -u origin main"
echo ""
echo "Your repository will then be live on GitHub! 🎉"
