#!/usr/bin/env bash
set -euo pipefail

# bump-devforge-version.sh
# Bump DevForge version (patch by default) in backend/config/constants.php
# and backend/versions.json
#
# Usage:
#   ./scripts/bump-devforge-version.sh          # bump patch (4.1.3 -> 4.1.4)
#   ./scripts/bump-devforge-version.sh minor    # bump minor (4.1.3 -> 4.2.0)
#   ./scripts/bump-devforge-version.sh major    # bump major (4.1.3 -> 5.0.0)
#
# Note: This script is for LOCAL development. The CI workflow automatically
# bumps versions on every Docker Images build. See docs/VERSIONING.md

BUMP_TYPE="${1:-patch}"

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Error: Invalid bump type '$BUMP_TYPE'. Use patch, minor, or major."
  exit 1
fi

# Read current version from constants.php (coolify.version only)
CURRENT=$(awk -F"'" '/coolify.*=>.*\[/,/\]/ { if (/'\''version'\''/) { print $4; exit } }' backend/config/constants.php)

if [ -z "$CURRENT" ]; then
  echo "Error: Could not extract coolify.version from constants.php"
  exit 1
fi

echo "Current version: $CURRENT"

# Parse semver
if [[ "$CURRENT" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  MAJOR="${BASH_REMATCH[1]}"
  MINOR="${BASH_REMATCH[2]}"
  PATCH="${BASH_REMATCH[3]}"
else
  echo "Error: Invalid version format in constants.php: $CURRENT"
  exit 1
fi

# Increment according to bump type
case "$BUMP_TYPE" in
  major)
    NEW_VERSION="$((MAJOR + 1)).0.0"
    ;;
  minor)
    NEW_VERSION="${MAJOR}.$((MINOR + 1)).0"
    ;;
  patch)
    NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
    ;;
esac

echo "New version: $NEW_VERSION"

# Update backend/config/constants.php (coolify.version only, using awk for precision)
awk -v old="$CURRENT" -v new="$NEW_VERSION" '
  /coolify.*=>.*\[/,/\]/ {
    if (/'\''version'\'' =>/) {
      sub(old, new)
    }
  }
  { print }
' backend/config/constants.php > backend/config/constants.php.tmp
mv backend/config/constants.php.tmp backend/config/constants.php

# Update backend/versions.json (devforge.version and coolify.v4.version)
sed -i "s/\"version\": \"${CURRENT}\"/\"version\": \"${NEW_VERSION}\"/g" backend/versions.json

echo ""
echo "Updated files:"
git diff backend/config/constants.php backend/versions.json

echo ""
echo "✓ Version bumped to $NEW_VERSION"
echo ""
echo "Next steps:"
echo "  git add backend/config/constants.php backend/versions.json"
echo "  git commit -m 'chore: bump version to $NEW_VERSION'"
echo "  git push"
