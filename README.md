# LINE MCP

An experimental macOS desktop companion that extracts tasks from Thai LINE message snippets and exposes locally stored tasks and chat history through the Model Context Protocol (MCP).

This is an independent project, not an official LINE integration. It reads supplied snippets or desktop notifications; it does not synchronize your full LINE account or fetch historical conversations from LINE servers.

## Run from source

Requires Node.js 22 and npm. Desktop capture requires macOS and LINE Desktop.

```bash
git clone https://github.com/arutmd/line-mcp.git
cd line-mcp
npm ci
npm run build
npm run dashboard
```

Open **http://localhost:3741** to manage capture and posting toggles for known groups. The dashboard includes demo groups; their names are fictional. New groups currently have capture enabled and posting disabled by default.

For offline task extraction, leave `OPENAI_API_KEY` unset. To use OpenAI extraction, copy `.env.example` to `.env` and supply your own key. That mode sends message text, sender, and group name to OpenAI's `gpt-4o-mini` model.

## Connect an MCP client

After building, add this entry to a client that accepts JSON MCP configuration. Replace the path with your absolute checkout path:

```json
{
  "mcpServers": {
    "line-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/line-mcp/dist/mcp/server.js"]
    }
  }
}
```

For Codex CLI:

```bash
codex mcp add line-mcp -- node /absolute/path/to/line-mcp/dist/mcp/server.js
```

The optional `node dist/cli.js setup` command edits detected client configuration files. Its Codex auto-setup uses legacy JSON paths; use the explicit command above for current Codex versions. If using OpenAI extraction, configure the key in the MCP server's environment as well.

## Tools

| Tool | Current behavior |
| --- | --- |
| `line_list_chats` | List locally known chats, toggles, and pending task counts |
| `line_get_chat_history` | Read messages previously ingested into the local database |
| `line_search_messages` | Search locally stored messages |
| `get_line_tasks` | List tasks by status or group |
| `list_line_groups` | List capture and posting settings |
| `toggle_group_permissions` | Change capture or posting settings through MCP |
| `ingest_line_chat` | Store a supplied snippet and extract a task when capture is enabled |
| `complete_line_task` | Mark a task completed |
| `verify_and_preview_post` | Check a group's posting toggle and return a preview |
| `line_send_message` | Check the posting toggle and record a message locally; **does not deliver it to LINE** |

`line_send_message` currently returns `SENT` for a local database write. Treat this as a prototype status, not confirmation of delivery. The posting toggle is also editable through MCP, so it is not an independent human approval boundary.

## Desktop capture (experimental)

The Swift observer scans visible LINE notification content through macOS Accessibility APIs. Xcode Command Line Tools and Accessibility permission are required. Capture depends on notification visibility and macOS/LINE versions.

```bash
mkdir -p dist/bin
swiftc native/line-observer.swift -o dist/bin/line-observer
npm run dashboard
```

The dashboard automatically starts this observer when the binary exists. The observer currently sends captured snippets to port 3741. Those snippets are used for task extraction; the notification ingestion endpoint does not populate full message history.

`node dist/cli.js watch` starts the observer if built, otherwise it uses an experimental clipboard watcher. The clipboard fallback currently processes clipboard changes from other applications too; avoid using it with sensitive clipboard contents.

## Data and limitations

- SQLite data is stored in `~/.linetask/linetask.db` in plaintext. Database files, credentials, logs, dependencies, and compiled artifacts are excluded from Git.
- Offline extraction uses Thai keyword rules. OpenAI extraction and any connected AI client may send chat content to their providers.
- The dashboard has no authentication and currently listens on all network interfaces. Use it only on a trusted machine/network; do not expose it to the internet. Its styling also loads external CDN assets.
- Capture is enabled for newly registered groups. Disabling capture stops new ingestion; it does not erase stored messages or tasks.
- Desktop observers can log message contents. This prototype makes no guarantee about LINE account restrictions, capture completeness, or task-extraction accuracy.

## Development

```bash
npm run build
OPENAI_API_KEY='' npm test
```

The test suite uses synthetic messages and temporary databases to check task extraction, group toggles, task lifecycle, and MCP calls. It does not test live LINE capture or delivery.

`bin/install.sh` is the legacy macOS installer for the prebuilt download. Use the source setup above for this repository; a fresh clone must be built before using that installer.
