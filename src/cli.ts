#!/usr/bin/env node
import { TaskDB } from './db/index.js';
import { TaskExtractor } from './extractor/ai.js';
import { runServer as runMcpServer } from './mcp/server.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const db = new TaskDB();
const extractor = new TaskExtractor();

const command = process.argv[2] || 'dashboard';

async function main() {
  switch (command) {
    case 'mcp': {
      await runMcpServer();
      break;
    }

    case 'watch': {
      const observerBin = path.join(path.resolve(__dirname, '..'), 'dist', 'bin', 'line-observer');
      if (fs.existsSync(observerBin)) {
        const { spawn } = await import('child_process');
        const child = spawn(observerBin, [], { stdio: 'inherit' });
        child.on('exit', (code) => process.exit(code || 0));
      } else {
        const { LineMacWatcher } = await import('./capture/watcher.js');
        const watcher = new LineMacWatcher();
        watcher.start();
      }
      break;
    }

    case 'dashboard': {
      import('./server.js');
      break;
    }

    case 'list': {
      const tasks = db.listTasks({ status: 'pending' });
      console.log(`\n📋 งานที่รอดำเนินการจาก LINE (${tasks.length} รายการ):\n`);
      if (tasks.length === 0) {
        console.log('  ไม่มีงานค้าง 🎉');
      } else {
        tasks.forEach((t, idx) => {
          console.log(`  ${idx + 1}. [${t.priority.toUpperCase()}] ${t.title}`);
          console.log(`     จากกลุ่ม: ${t.group_name} | ผู้ส่ง: ${t.sender} ${t.deadline ? `| กำหนดส่ง: ${t.deadline}` : ''}`);
          console.log(`     ID: ${t.id}\n`);
        });
      }
      break;
    }

    case 'groups': {
      const groups = db.listGroups();
      console.log(`\n🛡️ รายชื่อกลุ่ม LINE และการตั้งค่าความปลอดภัย (${groups.length} กลุ่ม):\n`);
      groups.forEach((g, idx) => {
        const capture = g.capture_enabled ? '✅ สกัดงาน' : '❌ ปิดสกัด';
        const post = g.post_enabled ? '🤖 อนุญาต AI โพสต์' : '⛔ ห้าม AI โพสต์';
        console.log(`  ${idx + 1}. ${g.name}`);
        console.log(`     สถานะ: [ ${capture} ] | [ ${post} ]\n`);
      });
      break;
    }

    case 'add': {
      const text = process.argv[3];
      const sender = process.argv[4] || 'Direct Message';
      const groupName = process.argv[5] || 'General';

      if (!text) {
        console.error('Usage: line-task add "<thai message text>" [sender] [groupName]');
        process.exit(1);
      }

      const group = db.registerGroup(groupName);
      if (!group.capture_enabled) {
        console.log(`❌ Capturing is disabled for group "${groupName}". Enable it first.`);
        process.exit(1);
      }

      console.log(`🔍 กำลังวิเคราะห์ข้อความ: "${text}"...`);
      const extracted = await extractor.extract(text, sender, groupName);

      if (!extracted.is_actionable || !extracted.title) {
        console.log(`ℹ️ ไม่พบงานที่ต้องทำในข้อความนี้: ${extracted.reason || 'คุยเล่นทั่วไป'}`);
      } else {
        const task = db.insertTask({
          group_id: group.id,
          group_name: groupName,
          sender,
          title: extracted.title,
          details: extracted.details,
          deadline: extracted.deadline,
          priority: extracted.priority || 'medium',
          status: 'pending',
          raw_snippet: text,
        });
        console.log(`\n✅ บันทึกงานสำเร็จ:`);
        console.log(`  หัวข้องาน: ${task.title}`);
        console.log(`  ความเร่งด่วน: ${task.priority}`);
        if (task.deadline) console.log(`  กำหนดส่ง: ${task.deadline}`);
        console.log(`  รหัสงาน: ${task.id}\n`);
      }
      break;
    }

    case 'setup':
    case 'install-claude': {
      await setupAllAgents();
      break;
    }

    default: {
      console.log(`
LINE MCP CLI
-------------
Usage:
  line-mcp setup           Auto-detect & wire into Claude Desktop, Claude Code CLI, Codex, Cursor, etc.
  line-mcp dashboard       Start the local web dashboard (default: http://localhost:3741)
  line-mcp mcp             Run stdio MCP server for Claude / Codex / CoWorks
  line-mcp list            View pending tasks
  line-mcp groups          View detected groups and AI posting toggles
  line-mcp add "<text>"    Analyze and add a task from raw chat text
      `);
      break;
    }
  }
}

async function setupAllAgents() {
  const home = os.homedir();
  const projectDir = path.resolve(__dirname, '..');
  const serverJsPath = path.join(projectDir, 'dist', 'mcp', 'server.js');
  const mcpEntry = {
    command: process.execPath,
    args: [serverJsPath],
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || ''
    }
  };

  console.log('\n🔍 Auto-detecting and configuring AI agents on this machine...\n');
  let configuredCount = 0;

  // 1. Claude Desktop & CoWorks
  const claudeDesktopPaths = [
    path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
  ];
  for (const p of claudeDesktopPaths) {
    if (fs.existsSync(path.dirname(p))) {
      patchMcpConfig(p, 'line-mcp', mcpEntry, 'Claude Desktop / CoWorks');
      configuredCount++;
      break;
    }
  }

  // 2. Claude Code CLI (~/.claude.json)
  const claudeCliPath = path.join(home, '.claude.json');
  if (fs.existsSync(claudeCliPath) || fs.existsSync(path.join(home, '.claude'))) {
    patchMcpConfig(claudeCliPath, 'line-mcp', mcpEntry, 'Claude Code CLI');
    configuredCount++;
  }

  // 3. Cursor (~/.cursor/mcp.json)
  const cursorPaths = [
    path.join(home, '.cursor', 'mcp.json'),
    path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'mcp.json'),
  ];
  for (const p of cursorPaths) {
    if (fs.existsSync(path.dirname(p))) {
      patchMcpConfig(p, 'line-mcp', mcpEntry, 'Cursor IDE');
      configuredCount++;
      break;
    }
  }

  // 4. Codex CLI (~/.codex/config.json or ~/.codex/mcp.json)
  const codexPaths = [
    path.join(home, '.codex', 'mcp.json'),
    path.join(home, '.codex', 'config.json'),
  ];
  for (const p of codexPaths) {
    if (fs.existsSync(path.dirname(p))) {
      patchMcpConfig(p, 'line-mcp', mcpEntry, 'Codex');
      configuredCount++;
      break;
    }
  }

  // 5. Windsurf (~/.codeium/windsurf/mcp_config.json)
  const windsurfPath = path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
  if (fs.existsSync(path.dirname(windsurfPath))) {
    patchMcpConfig(windsurfPath, 'line-mcp', mcpEntry, 'Windsurf IDE');
    configuredCount++;
  }

  if (configuredCount === 0) {
    // Default fallback: create Claude Desktop config
    patchMcpConfig(claudeDesktopPaths[0], 'line-mcp', mcpEntry, 'Claude Desktop (Default)');
  }

  console.log(`\n🎉 LINE MCP successfully configured across your AI agents!`);
  console.log(`Next step: Restart your agent (Claude Desktop, Claude Code, Codex, or Cursor) and ask:`);
  console.log(`   "What are my LINE tasks today?" or "List my LINE chats"\n`);
}

function patchMcpConfig(filePath: string, serverKey: string, entry: any, appName: string) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    let config: any = { mcpServers: {} };
    if (fs.existsSync(filePath)) {
      try {
        config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        fs.copyFileSync(filePath, filePath + '.bak');
      }
    }
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers[serverKey] = entry;
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`  ✅ [${appName}] Configured at: ${filePath}`);
  } catch (err: any) {
    console.warn(`  ⚠️ Could not patch ${appName}: ${err.message}`);
  }
}

main().catch(console.error);
