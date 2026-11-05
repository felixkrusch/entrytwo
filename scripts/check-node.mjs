const [major, minor] = process.versions.node.split('.').map(Number)
if (!((major === 22 && minor >= 12) || major === 24)) {
  console.error(`entrytwo requires Node.js 22.12+ (22.x) or 24.x; found ${process.versions.node}. Install a supported version from https://nodejs.org/en/download or run nvm install && nvm use.`)
  process.exit(1)
}
