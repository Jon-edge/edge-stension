#!/bin/bash
set -e

# Release script for edge-stension
# Follows the process documented in README.md

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PACKAGE_JSON="$ROOT_DIR/package.json"

# Get current version from package.json
CURRENT_VERSION=$(grep '"version"' "$PACKAGE_JSON" | sed 's/.*"version": "\([^"]*\)".*/\1/')

echo "Current version: $CURRENT_VERSION"
echo ""

# Prompt for new version
read -p "Enter new version (e.g., 0.0.2): " NEW_VERSION

# Validate version format (semver-ish)
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Invalid version format. Use semver (e.g., 0.0.2)"
  exit 1
fi

# Check if version is different
if [[ "$NEW_VERSION" == "$CURRENT_VERSION" ]]; then
  echo "Error: New version must be different from current version"
  exit 1
fi

# Check for uncommitted changes
if [[ -n $(git -C "$ROOT_DIR" status --porcelain) ]]; then
  echo "Error: You have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Check if tag already exists
if git -C "$ROOT_DIR" rev-parse "v$NEW_VERSION" >/dev/null 2>&1; then
  echo "Error: Tag v$NEW_VERSION already exists"
  exit 1
fi

echo ""
echo "Will release version $NEW_VERSION"
echo "This will:"
echo "  1. Update version in package.json"
echo "  2. Commit the change"
echo "  3. Create and push tag v$NEW_VERSION"
echo ""
read -p "Continue? (y/N): " CONFIRM

if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# Update version in package.json
echo "Updating package.json..."
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"

# Commit the change
echo "Committing..."
git -C "$ROOT_DIR" add "$PACKAGE_JSON"
git -C "$ROOT_DIR" commit -m "Release v$NEW_VERSION"

# Push to main
echo "Pushing to main..."
git -C "$ROOT_DIR" push origin main

# Create and push tag
echo "Creating tag v$NEW_VERSION..."
git -C "$ROOT_DIR" tag "v$NEW_VERSION"
git -C "$ROOT_DIR" push origin "v$NEW_VERSION"

echo ""
echo "✅ Release v$NEW_VERSION created!"
echo ""
echo "GitHub Actions will now build and publish the release."
echo "View releases at: https://github.com/Jon-edge/edge-stension/releases"

