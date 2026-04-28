#!/bin/bash

# deploy.sh - Script to deploy with cache busting

echo "Deploying with cache busting..."

# Get current version from _config.yml
CURRENT_VERSION=$(grep "version:" _config.yml | sed 's/version: "*\([^"]*\)"*/\1/')
echo "Current version: $CURRENT_VERSION"

# Increment version (simple increment, you can make this more sophisticated)
NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')
echo "New version: $NEW_VERSION"

# Update version in _config.yml
sed -i "s/version: .*/version: \"$NEW_VERSION\"/" _config.yml

echo "Version updated to $NEW_VERSION"

# Add, commit, and push
git add .
git commit -m "Deploy version $NEW_VERSION - cache bust"
git push origin main

