import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { TaskDB } from './db/index.js';
import { TaskExtractor } from './extractor/ai.js';
import url from 'url';

const db = new TaskDB();
const extractor = new TaskExtractor();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3741;

// Seed fictional demo groups if empty; posting stays disabled
if (db.listGroups().length === 0) {
  const g1 = db.registerGroup('Demo Operations (ทีมตัวอย่าง)');
  db.updateGroupToggles(g1.id, { capture_enabled: true, post_enabled: false });

  const g2 = db.registerGroup('Demo Project Team');
  db.updateGroupToggles(g2.id, { capture_enabled: true, post_enabled: false });

  const g3 = db.registerGroup('Demo Customer Project');
  db.updateGroupToggles(g3.id, { capture_enabled: true, post_enabled: false });

  const g4 = db.registerGroup('ห้องเพื่อนสนิท / Family');
  db.updateGroupToggles(g4.id, { capture_enabled: false, post_enabled: false });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '/';

  // API: Ingest message from background observer
  if (req.method === 'POST' && pathname === '/api/ingest') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { text, sender, groupName } = JSON.parse(body || '{}');
        if (!text || !sender) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing text or sender' }));
          return;
        }
        const gName = groupName || 'Direct Message';
        const group = db.registerGroup(gName);
        if (!group.capture_enabled) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ captured: false, reason: 'group_capture_disabled' }));
          return;
        }
        const extracted = await extractor.extract(text, sender, gName);
        if (extracted.is_actionable && extracted.title) {
          const task = db.insertTask({
            group_id: group.id,
            group_name: gName,
            sender,
            title: extracted.title,
            details: extracted.details,
            deadline: extracted.deadline,
            priority: extracted.priority || 'medium',
            status: 'pending',
            raw_snippet: text,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ captured: true, task }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ captured: false, reason: 'not_actionable' }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: List ranked groups
  if (req.method === 'GET' && pathname === '/api/groups') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(db.listGroups()));
    return;
  }

  // API: Toggle group
  if (req.method === 'POST' && pathname === '/api/groups/toggle') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = JSON.parse(body || '{}');
      const updated = db.updateGroupToggles(data.id, {
        capture_enabled: data.capture_enabled,
        post_enabled: data.post_enabled,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, group: updated }));
    });
    return;
  }

  // Serve Minimal UI
  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getMinimalUIHTML());
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

function getMinimalUIHTML(): string {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LINE MCP</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Prompt', sans-serif; }
    /* iOS Style Toggle Switch */
    .switch {
      position: relative;
      display: inline-block;
      width: 46px;
      height: 26px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #334155;
      transition: .25s cubic-bezier(0.4, 0, 0.2, 1);
      border-radius: 9999px;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .25s cubic-bezier(0.4, 0, 0.2, 1);
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
    }
    input:checked + .slider {
      background-color: #06C755;
    }
    input:checked + .slider:before {
      transform: translateX(20px);
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col items-center justify-start p-4 sm:p-6 antialiased selection:bg-emerald-500 selection:text-white">

  <div class="w-full max-w-xl space-y-6">

    <!-- Minimal Header -->
    <header class="flex items-center justify-between pt-2 pb-1 border-b border-slate-800/80">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-[#06C755] flex items-center justify-center font-bold text-slate-950 text-lg shadow-lg shadow-emerald-950/50">
          L
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-lg font-bold tracking-tight text-white">LINE MCP</h1>
            <span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Claude / Codex Ready
            </span>
          </div>
          <p class="text-xs text-slate-400">Toggle chats ON to let AI extract tasks & sync</p>
        </div>
      </div>
      <button onclick="copyMcpConfig()" id="btnCopyConfig" class="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 transition flex items-center gap-1.5">
        <span>🔌 MCP Setup</span>
      </button>
    </header>

    <!-- Search / Filter Input -->
    <div class="relative">
      <input
        id="searchBox"
        type="text"
        oninput="filterGroups()"
        placeholder="ค้นหาแชตหรือกลุ่ม LINE..."
        class="w-full bg-slate-900/90 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
      >
      <span class="absolute right-3.5 top-3 text-slate-500 text-xs">⌘K</span>
    </div>

    <!-- Ranked Chat List -->
    <div class="space-y-2.5">
      <div class="flex items-center justify-between text-xs text-slate-400 px-1 font-medium">
        <span>อันดับแชตที่พบบนเครื่อง (Ranked Chats)</span>
        <span id="activeCountBadge" class="text-emerald-400">0 กำลังเปิดใช้งาน</span>
      </div>

      <div id="rankedChatList" class="space-y-2">
        <!-- Rendered via JS -->
        <div class="text-center py-12 text-slate-500 text-xs">กำลังโหลดรายชื่อแชต...</div>
      </div>
    </div>

    <!-- Minimal Footnote -->
    <div class="text-center pt-4 pb-8 text-xs text-slate-500">
      <p>💡 ทุกคำถาม การสรุปงาน และการสั่งงาน ทำผ่าน <strong>Claude Desktop</strong> หรือ <strong>Codex</strong> ได้โดยตรง</p>
      <p class="mt-1 text-[11px] text-slate-600">ตัวกรองทำงานแบบ Local-first ข้อมูลไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์ภายนอก</p>
    </div>

  </div>

  <script>
    let allGroups = [];

    async function loadGroups() {
      try {
        const res = await fetch('/api/groups');
        allGroups = await res.json();
        renderList(allGroups);
      } catch (err) {
        console.error(err);
      }
    }

    function renderList(groups) {
      const container = document.getElementById('rankedChatList');
      const activeCount = groups.filter(g => g.capture_enabled).length;
      document.getElementById('activeCountBadge').innerText = \`\${activeCount} แชตเปิดใช้งานอยู่\`;

      if (groups.length === 0) {
        container.innerHTML = '<div class="text-center py-10 text-slate-500 text-xs">ไม่พบแชตที่ค้นหา</div>';
        return;
      }

      container.innerHTML = groups.map((g, idx) => {
        const isEnabled = Boolean(g.capture_enabled);
        const rank = idx + 1;
        const rankColor = rank === 1 ? 'bg-amber-400 text-slate-950 font-bold' : (rank === 2 ? 'bg-slate-300 text-slate-950 font-bold' : (rank === 3 ? 'bg-amber-700 text-white font-bold' : 'bg-slate-800 text-slate-400'));

        return \`
          <div class="group flex items-center justify-between p-3.5 rounded-2xl border transition \${isEnabled ? 'bg-slate-900/90 border-slate-800 hover:border-slate-700' : 'bg-slate-900/40 border-slate-900 opacity-60 hover:opacity-80'}">

            <!-- Left: Rank & Group Info -->
            <div class="flex items-center gap-3.5 min-w-0 pr-3">
              <span class="w-6 h-6 rounded-lg \${rankColor} text-[11px] flex items-center justify-center shrink-0">
                \${rank}
              </span>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-semibold text-slate-100 truncate \${!isEnabled && 'line-through text-slate-400'}">
                    \${g.name}
                  </h3>
                  \${g.task_count > 0 ? \`<span class="shrink-0 text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">\${g.task_count} งาน</span>\` : ''}
                </div>
                <div class="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                  <span class="\${isEnabled ? 'text-emerald-400 font-medium' : 'text-slate-500'}">
                    \${isEnabled ? '● เปิดให้ AI อ่าน' : '○ ปิดการเข้าถึง'}
                  </span>
                  \${isEnabled ? \`
                    <span class="text-slate-600">•</span>
                    <button onclick="togglePost('\${g.id}', \${!g.post_enabled})" class="hover:underline \${g.post_enabled ? 'text-amber-400 font-medium' : 'text-slate-500'}">
                      \${g.post_enabled ? '🤖 ให้ AI โพสต์ได้' : '⛔ ห้าม AI โพสต์'}
                    </button>
                  \` : ''}
                </div>
              </div>
            </div>

            <!-- Right: Single Clean iOS Toggle -->
            <div class="shrink-0">
              <label class="switch">
                <input type="checkbox" \${isEnabled ? 'checked' : ''} onchange="toggleGroup('\${g.id}', this.checked)">
                <span class="slider"></span>
              </label>
            </div>

          </div>
        \`;
      }).join('');
    }

    async function toggleGroup(id, checked) {
      await fetch('/api/groups/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, capture_enabled: checked })
      });
      loadGroups();
    }

    async function togglePost(id, checked) {
      await fetch('/api/groups/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, post_enabled: checked })
      });
      loadGroups();
    }

    function filterGroups() {
      const q = document.getElementById('searchBox').value.toLowerCase().trim();
      if (!q) {
        renderList(allGroups);
        return;
      }
      const filtered = allGroups.filter(g => g.name.toLowerCase().includes(q));
      renderList(filtered);
    }

    function copyMcpConfig() {
      const config = {
        "mcpServers": {
          "line-mcp": {
            "command": "node",
            "args": ["${process.cwd()}/dist/mcp/server.js"]
          }
        }
      };
      navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      const btn = document.getElementById('btnCopyConfig');
      const original = btn.innerHTML;
      btn.innerHTML = '<span class="text-emerald-400">✓ Copied!</span>';
      setTimeout(() => btn.innerHTML = original, 2000);
    }

    // Keyboard shortcut ⌘K to focus search
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('searchBox').focus();
      }
    });

    loadGroups();
    // Poll every 3 seconds for fresh chats
    setInterval(loadGroups, 3000);
  </script>
</body>
</html>`;
}

server.listen(PORT, () => {
  console.log(`LINE MCP Dashboard running at http://localhost:${PORT}`);

  // Auto-spawn line-observer binary if present
  const observerCandidates = [
    path.join(__dirname, 'bin', 'line-observer'),
    path.join(__dirname, '..', 'dist', 'bin', 'line-observer')
  ];
  for (const bin of observerCandidates) {
    if (fs.existsSync(bin)) {
      try {
        const child = spawn(bin, [], { stdio: 'ignore', detached: true });
        child.unref();
        console.log(`Background LINE Observer daemon spawned (${bin}).`);
        break;
      } catch (e) {
        console.warn('Could not spawn background line-observer:', e);
      }
    }
  }
});
