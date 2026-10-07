import { TaskDB } from '../src/db/index.js';
import { TaskExtractor } from '../src/extractor/ai.js';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// Helper for assertions
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runTests() {
  console.log('\n========================================');
  console.log('🧪 RUNNING LINE MCP TEST SUITE');
  console.log('========================================\n');

  const testDbDir = path.join('/tmp', 'linetask-test-' + Date.now());
  fs.mkdirSync(testDbDir, { recursive: true });
  const testDbPath = path.join(testDbDir, 'test.db');

  const db = new TaskDB(testDbPath);
  const extractor = new TaskExtractor();

  // ----------------------------------------------------
  // Test 1: Group Registration & Default Toggles
  // ----------------------------------------------------
  console.log('📋 Test 1: Group Permissions & Defaults');
  const groupA = db.registerGroup('ห้องผู้บริหาร (VIP)');
  assert(groupA.name === 'ห้องผู้บริหาร (VIP)', 'Group registered with exact Thai name');
  assert(groupA.capture_enabled === 1, 'Default capture is ON');
  assert(groupA.post_enabled === 0, 'Default AI post gate is strictly OFF');

  // ----------------------------------------------------
  // Test 2: AI Post Gate Enforcement
  // ----------------------------------------------------
  console.log('\n🛡️ Test 2: AI Post Gate Enforcement');
  const postAllowedBefore = db.isGroupPostAllowed('ห้องผู้บริหาร (VIP)');
  assert(postAllowedBefore === false, 'AI post blocked when toggle is OFF');

  // Toggle post ON
  db.updateGroupToggles(groupA.id, { post_enabled: true });
  const postAllowedAfter = db.isGroupPostAllowed('ห้องผู้บริหาร (VIP)');
  assert(postAllowedAfter === true, 'AI post allowed after explicit user toggle');

  // ----------------------------------------------------
  // Test 3: Capture Gate (Opt-Out / Disabled Groups)
  // ----------------------------------------------------
  console.log('\n🚫 Test 3: Capture Gate for Private/Family Groups');
  const familyGroup = db.registerGroup('ครอบครัว');
  db.updateGroupToggles(familyGroup.id, { capture_enabled: false });
  assert(db.isGroupCaptureAllowed('ครอบครัว') === false, 'Capture is blocked when toggle is OFF');

  // ----------------------------------------------------
  // Test 4: Thai Task Extraction Heuristics & Filtering
  // ----------------------------------------------------
  console.log('\n🇹🇭 Test 4: Thai Task Extraction & Casual Chat Filtering');

  // 4a. Casual chat should NOT create task
  const casualChat = '55555 โอเคครับพี่ ขอบคุณมากครับ';
  const casualResult = await extractor.extract(casualChat, 'น้องเมย์', 'General');
  assert(casualResult.is_actionable === false, 'Casual Thai banter/thanks correctly ignored');

  // 4b. Urgent actionable task
  const urgentChat = 'รบกวนทีมงานช่วยดูไฟล์สรุปงบกำไรขาดทุนให้ก่อนเที่ยงด้วยครับ ด่วนมาก';
  const taskResult = await extractor.extract(urgentChat, 'พี่สมชาย', 'Demo Finance');
  assert(taskResult.is_actionable === true, 'Urgent Thai work request correctly classified as actionable');
  assert(taskResult.priority === 'urgent', 'Urgent priority correctly identified from "ด่วนมาก"');
  assert(taskResult.deadline === 'ก่อนเที่ยง', 'Deadline correctly identified as "ก่อนเที่ยง"');

  // ----------------------------------------------------
  // Test 5: Task Storage & Lifecycle (Insert, List, Complete)
  // ----------------------------------------------------
  console.log('\n💾 Test 5: Task Storage & Lifecycle');
  const savedTask = db.insertTask({
    group_id: groupA.id,
    group_name: groupA.name,
    sender: 'พี่สมชาย',
    title: taskResult.title || 'ตรวจงบ',
    details: taskResult.details,
    deadline: taskResult.deadline,
    priority: taskResult.priority || 'medium',
    status: 'pending',
    raw_snippet: urgentChat,
  });

  assert(savedTask.id.startsWith('tsk_'), 'Task ID generated properly');
  const pendingTasks = db.listTasks({ status: 'pending' });
  assert(pendingTasks.length === 1, 'Task retrieved in pending list');
  assert(pendingTasks[0].title === savedTask.title, 'Task title preserved exactly');

  // Mark done
  const completed = db.updateTaskStatus(savedTask.id, 'completed');
  assert(completed === true, 'Task successfully marked completed');
  const remainingPending = db.listTasks({ status: 'pending' });
  assert(remainingPending.length === 0, 'Pending list empty after completion');

  // ----------------------------------------------------
  // Test 6: Full MCP Protocol JSON-RPC Over Stdio
  // ----------------------------------------------------
  console.log('\n🔌 Test 6: Full MCP Stdio Protocol & Tool Calls');

  await new Promise<void>((resolve, reject) => {
    const serverPath = path.resolve(__dirname, '..', 'dist', 'mcp', 'server.js');
    const proc = spawn('node', [serverPath], {
      env: { ...process.env, HOME: testDbDir }, // use test DB
    });

    let buffer = '';
    let step = 0;

    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);

        if (step === 0 && msg.id === 1) {
          // Initialize response
          assert(msg.result?.serverInfo?.name === 'line-mcp', 'MCP handshake returned name: line-mcp');
          assert(msg.result?.protocolVersion === '2024-11-05', 'MCP protocol version matched');

          // Send tools/list request
          step = 1;
          proc.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          }) + '\n');
        } else if (step === 1 && msg.id === 2) {
          // Tools list response
          const toolNames = msg.result.tools.map((t: any) => t.name);
          assert(toolNames.includes('line_list_chats'), 'Tool line_list_chats available');
          assert(toolNames.includes('line_get_chat_history'), 'Tool line_get_chat_history available');
          assert(toolNames.includes('line_search_messages'), 'Tool line_search_messages available');
          assert(toolNames.includes('line_send_message'), 'Tool line_send_message available');
          assert(toolNames.includes('get_line_tasks'), 'Tool get_line_tasks available');
          assert(toolNames.includes('list_line_groups'), 'Tool list_line_groups available');
          assert(toolNames.includes('toggle_group_permissions'), 'Tool toggle_group_permissions available');
          assert(toolNames.includes('ingest_line_chat'), 'Tool ingest_line_chat available');
          assert(toolNames.includes('verify_and_preview_post'), 'Tool verify_and_preview_post available');

          // Test Tool Call: Ingest chat
          step = 2;
          proc.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: 'ingest_line_chat',
              arguments: {
                text: 'รบกวนช่วยตรวจ PR #1 เรื่อง Webhook idempotency ให้หน่อยครับ ส่งก่อนบ่ายสอง',
                sender: 'Demo Reviewer',
                group_name: 'Demo Dev Team',
              },
            },
          }) + '\n');
        } else if (step === 2 && msg.id === 3) {
          const content = JSON.parse(msg.result.content[0].text);
          assert(content.captured === true, 'ingest_line_chat tool successfully extracted task');
          assert(content.task.group_name === 'Demo Dev Team', 'Task assigned to correct group');

          // Test Tool Call: verify_and_preview_post on unapproved group
          step = 3;
          proc.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
              name: 'verify_and_preview_post',
              arguments: {
                group_name: 'Demo Dev Team',
                message: 'กำลังตรวจสอบ PR ครับ',
              },
            },
          }) + '\n');
        } else if (step === 3 && msg.id === 4) {
          // AI Post gate should block because post_enabled defaults to 0
          assert(msg.result.isError === true, 'verify_and_preview_post BLOCKED unapproved group');
          assert(msg.result.content[0].text.includes('PERMISSION DENIED'), 'Permission Denied message returned');

          // Test Tool Call: Toggle post_enabled to TRUE
          step = 4;
          proc.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: {
              name: 'toggle_group_permissions',
              arguments: {
                group_name: 'Demo Dev Team',
                post_enabled: true,
              },
            },
          }) + '\n');
        } else if (step === 4 && msg.id === 5) {
          const toggleRes = JSON.parse(msg.result.content[0].text);
          assert(toggleRes.group.post_enabled === true, 'toggle_group_permissions successfully enabled posting');

          // Re-test verify_and_preview_post now that it is allowed
          step = 5;
          proc.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 6,
            method: 'tools/call',
            params: {
              name: 'verify_and_preview_post',
              arguments: {
                group_name: 'Demo Dev Team',
                message: 'กำลังตรวจสอบ PR ครับ',
              },
            },
          }) + '\n');
        } else if (step === 5 && msg.id === 6) {
          const postRes = JSON.parse(msg.result.content[0].text);
          assert(postRes.status === 'APPROVED_TO_POST', 'verify_and_preview_post successfully APPROVED after toggle');

          // Step 6: Test line_get_chat_history
          step = 6;
          proc.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: {
              name: 'line_get_chat_history',
              arguments: {
                chat_name: 'Demo Dev Team',
                limit: 5,
              },
            },
          }) + '\n');
        } else if (step === 6 && msg.id === 7) {
          const histRes = JSON.parse(msg.result.content[0].text);
          assert(histRes.chat_name === 'Demo Dev Team', 'line_get_chat_history returned correct chat');
          assert(histRes.messages.length > 0, 'line_get_chat_history returned messages');
          assert(histRes.messages[0].text.includes('Webhook idempotency'), 'Message text matches ingested chat');

          // Step 7: Test line_search_messages
          step = 7;
          proc.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 8,
            method: 'tools/call',
            params: {
              name: 'line_search_messages',
              arguments: {
                query: 'idempotency',
              },
            },
          }) + '\n');
        } else if (step === 7 && msg.id === 8) {
          const searchRes = JSON.parse(msg.result.content[0].text);
          assert(searchRes.match_count > 0, 'line_search_messages found matching keyword');
          assert(searchRes.results[0].text.includes('idempotency'), 'Search result contains query term');

          // Clean finish
          proc.kill();
          resolve();
        }
      }
    });

    proc.stderr.on('data', () => {}); // ignore stderr logs

    proc.on('error', reject);

    // Initial message
    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-runner', version: '1.0.0' },
      },
    }) + '\n');
  });

  // Cleanup test DB
  fs.rmSync(testDbDir, { recursive: true, force: true });

  console.log('\n========================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! (100%)');
  console.log('========================================\n');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
