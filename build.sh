#!/bin/bash
cd "$(dirname "$0")"

# bump patch version in package.json
current=$(node -p "require('./package.json').version")
IFS='.' read -r major minor patch <<< "$current"
new_version="$major.$minor.$((patch + 1))"
npm version "$new_version" --no-git-tag-version

npm run package && code --install-extension intelligit-*.vsix
