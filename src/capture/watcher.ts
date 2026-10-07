import { execSync } from 'child_process';
import { TaskDB } from '../db/index.js';
import { TaskExtractor } from '../extractor/ai.js';

export class LineMacWatcher {
  private db: TaskDB;
  private extractor: TaskExtractor;
  private lastClipboard: string = '';
  private isRunning: boolean = false;

  constructor() {
    this.db = new TaskDB();
    this.extractor = new TaskExtractor();
  }

  start() {
    this.isRunning = true;
    console.log('👀 LINE Mac Live Watcher started.');
    console.log('   Whenever you copy (Cmd+C) a message in LINE, it will be automatically analyzed and captured.\n');

    // Initial clipboard sync to avoid capturing existing clipboard on boot
    try {
      this.lastClipboard = execSync('pbpaste', { encoding: 'utf8' }).trim();
    } catch {}

    const loop = async () => {
      if (!this.isRunning) return;
      await this.checkClipboard();
      setTimeout(loop, 600);
    };

    loop();
  }

  stop() {
    this.isRunning = false;
  }

  private async checkClipboard() {
    try {
      const currentClipboard = execSync('pbpaste', { encoding: 'utf8' }).trim();
      if (!currentClipboard || currentClipboard === this.lastClipboard) {
        return;
      }
      this.lastClipboard = currentClipboard;

      // Check frontmost application
      let frontmostApp = '';
      try {
        frontmostApp = execSync(
          `osascript -e 'tell application "System Events" to name of first process whose frontmost is true'`,
          { encoding: 'utf8' }
        ).trim();
      } catch {}

      // Get LINE active window title if LINE is running
      let activeChatName = 'LINE Direct Message';
      try {
        const winTitle = execSync(
          `osascript -e 'tell application "System Events" to tell process "LINE" to if (count of windows) > 0 then return name of window 1'`,
          { encoding: 'utf8' }
        ).trim();
        if (winTitle && winTitle !== 'missing value' && winTitle !== 'LINE') {
          activeChatName = winTitle;
        }
      } catch {}

      // If frontmost app is LINE or the text contains Thai action keywords
      const isFromLine = frontmostApp.toLowerCase().includes('line');

      console.log(`\n📋 Detected copy event (Frontmost: "${frontmostApp}", Chat: "${activeChatName}")`);
      console.log(`   Text: "${currentClipboard.slice(0, 60)}..."`);

      // Check if group is allowed
      const group = this.db.registerGroup(activeChatName);
      if (!group.capture_enabled) {
        console.log(`   ⛔ Ignored: Group "${activeChatName}" is toggled OFF in LINE MCP.`);
        return;
      }

      // Analyze text
      const extracted = await this.extractor.extract(currentClipboard, 'LINE Sender', activeChatName);
      if (!extracted.is_actionable || !extracted.title) {
        console.log(`   ℹ️ No actionable task found in text (${extracted.reason || 'คุยทั่วไป'}).`);
        return;
      }

      // Save task
      const task = this.db.insertTask({
        group_id: group.id,
        group_name: activeChatName,
        sender: 'LINE Sender',
        title: extracted.title,
        details: extracted.details,
        deadline: extracted.deadline,
        priority: extracted.priority || 'medium',
        status: 'pending',
        raw_snippet: currentClipboard,
      });

      console.log(`   ✨ Task captured: "${task.title}" (Priority: ${task.priority})`);

      // Show native macOS notification banner
      try {
        const cleanTitle = task.title.replace(/"/g, '\\"');
        const cleanDeadline = task.deadline ? `⏳ กำหนดส่ง: ${task.deadline}` : `กลุ่ม: ${activeChatName}`;
        execSync(
          `osascript -e 'display notification "${cleanDeadline}" with title "LINE MCP" subtitle "✅ บันทึกงาน: ${cleanTitle}"'`
        );
      } catch {}

    } catch (err: any) {
      // Ignore transient clipboard errors
    }
  }
}
