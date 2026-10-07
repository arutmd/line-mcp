#!/bin/bash
set -e

# ==============================================================================
# LINE MCP — Universal 1-Line Installer for macOS & AI Agents
# Supports: Claude Desktop, Claude Code CLI, Codex CLI, Cursor, Windsurf, CoWorks
# ==============================================================================

BOLD="\033[1m"
GREEN="\033[32m"
BLUE="\033[34m"
YELLOW="\033[33m"
RESET="\033[0m"

echo ""
echo -e "${GREEN}${BOLD}🚀 Installing LINE MCP Desktop Companion...${RESET}"
echo -e "${BLUE}Privacy-first Slack-style MCP for LINE (Desktop Task Extractor & Assistant)${RESET}"
echo ""

INSTALL_DIR="$HOME/.linetask/app"
mkdir -p "$HOME/.linetask"

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️ Node.js is not installed.${RESET}"
    if command -v brew >/dev/null 2>&1; then
        echo "Installing Node.js via Homebrew..."
        brew install node
    else
        echo "Please install Node.js (https://nodejs.org) or Homebrew first."
        exit 1
    fi
fi

NODE_PATH=$(command -v node)
echo -e "  ✓ Node.js detected: ${BOLD}$NODE_PATH${RESET}"

# 2. Unpack application
mkdir -p "$INSTALL_DIR"
if [ -f "$(dirname "$0")/../package.json" ]; then
    echo -e "  ✓ Installing from local source to $INSTALL_DIR..."
    cp -R "$(dirname "$0")/.."/* "$INSTALL_DIR/"
else
    echo -e "  ✓ Fetching prebuilt release from arut.md..."
    curl -fsSL "https://arut.md/downloads/line-mcp.tar.gz" | tar -xz -C "$INSTALL_DIR"
fi

# 3. Install production dependencies
echo -e "  ✓ Installing dependencies..."
cd "$INSTALL_DIR"
npm install --omit=dev --silent 2>/dev/null || npm install --silent 2>/dev/null

# 4. Auto-configure all AI clients (Claude Desktop, Claude Code, Codex, Cursor, Windsurf)
echo -e "  ✓ Auto-configuring AI agents and MCP settings..."
"$NODE_PATH" "$INSTALL_DIR/dist/cli.js" setup

# 5. Set up macOS LaunchAgent for background auto-start on login
PLIST_PATH="$HOME/Library/LaunchAgents/me.palm.line-mcp.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat <<EOF > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>me.palm.line-mcp</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$INSTALL_DIR/dist/server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/line-mcp.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/line-mcp.err</string>
</dict>
</plist>
EOF

# Restart LaunchAgent cleanly
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH" 2>/dev/null || true

echo -e "  ✓ Background service registered and started"
echo ""
echo -e "${GREEN}${BOLD}🎉 Installation Complete!${RESET}"
echo ""
echo -e "1. ${BOLD}Dashboard is live:${RESET} ${BLUE}http://localhost:3741${RESET}"
echo -e "2. ${BOLD}In your AI agent (Claude, Codex, Cursor):${RESET}"
echo -e "   Ask: ${YELLOW}\"What are my LINE tasks today?\"${RESET} or ${YELLOW}\"List my LINE chats\"${RESET}"
echo ""

# Open dashboard in default browser if interactive shell
if [ -t 1 ]; then
    open "http://localhost:3741" 2>/dev/null || true
fi
