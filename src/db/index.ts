import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

import crypto from 'crypto';

export interface GroupRecord {
  id: string;
  name: string;
  capture_enabled: number; // 0 or 1
  post_enabled: number;    // 0 or 1
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface TaskRecord {
  id: string;
  group_id: string | null;
  group_name: string;
  sender: string;
  title: string;
  details?: string;
  deadline?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed';
  raw_snippet: string;
  created_at: string;
  completed_at?: string;
}

export interface MessageRecord {
  id: string;
  chat_id: string;
  chat_name: string;
  sender: string;
  text: string;
  timestamp: string;
  is_from_me: number;
  created_at: string;
}

export class TaskDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultDir = path.join(process.env.HOME || '.', '.linetask');
    if (!fs.existsSync(defaultDir)) {
      fs.mkdirSync(defaultDir, { recursive: true });
    }
    const resolvedPath = dbPath || path.join(defaultDir, 'linetask.db');
    this.db = new Database(resolvedPath);
    this.initTables();
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        capture_enabled INTEGER NOT NULL DEFAULT 0,
        post_enabled INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        group_id TEXT,
        group_name TEXT NOT NULL,
        sender TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT,
        deadline TEXT,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'pending',
        raw_snippet TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (group_id) REFERENCES groups(id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        chat_name TEXT NOT NULL,
        sender TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        is_from_me INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_name, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_text ON messages(text);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // --- Group Operations ---

  registerGroup(name: string): GroupRecord {
    const existing = this.getGroupByName(name);
    const now = new Date().toISOString();
    if (existing) {
      this.db.prepare('UPDATE groups SET last_seen_at = ? WHERE id = ?').run(now, existing.id);
      return { ...existing, last_seen_at: now };
    }

    const id = 'grp_' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 16);
    // By default, capture is 0 (off) or 1? Let's check settings or default to 0 for strict privacy
    const defaultCapture = 1; // Auto-capture default, but user can toggle off
    const defaultPost = 0;    // Posting default is ALWAYS OFF until explicitly toggled ON!

    const stmt = this.db.prepare(`
      INSERT INTO groups (id, name, capture_enabled, post_enabled, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, name, defaultCapture, defaultPost, now, now, now);
    return {
      id,
      name,
      capture_enabled: defaultCapture,
      post_enabled: defaultPost,
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    };
  }

  getGroupByName(name: string): GroupRecord | undefined {
    return this.db.prepare('SELECT * FROM groups WHERE name = ?').get(name) as GroupRecord | undefined;
  }

  getGroupById(id: string): GroupRecord | undefined {
    return this.db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRecord | undefined;
  }

  listGroups(): (GroupRecord & { task_count: number })[] {
    return this.db.prepare(`
      SELECT
        g.*,
        COUNT(t.id) as task_count
      FROM groups g
      LEFT JOIN tasks t ON g.id = t.group_id AND t.status = 'pending'
      GROUP BY g.id
      ORDER BY g.last_seen_at DESC
    `).all() as (GroupRecord & { task_count: number })[];
  }

  updateGroupToggles(id: string, toggles: { capture_enabled?: boolean; post_enabled?: boolean }): GroupRecord | undefined {
    const group = this.getGroupById(id);
    if (!group) return undefined;

    const capture = toggles.capture_enabled !== undefined ? (toggles.capture_enabled ? 1 : 0) : group.capture_enabled;
    const post = toggles.post_enabled !== undefined ? (toggles.post_enabled ? 1 : 0) : group.post_enabled;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE groups
      SET capture_enabled = ?, post_enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(capture, post, now, id);

    return this.getGroupById(id);
  }

  isGroupPostAllowed(groupName: string): boolean {
    const group = this.getGroupByName(groupName);
    return group ? Boolean(group.post_enabled) : false;
  }

  isGroupCaptureAllowed(groupName: string): boolean {
    const group = this.getGroupByName(groupName);
    return group ? Boolean(group.capture_enabled) : true; // if not registered yet, we register and check
  }

  // --- Task Operations ---

  insertTask(task: Omit<TaskRecord, 'id' | 'created_at'> & { id?: string }): TaskRecord {
    const id = task.id || 'tsk_' + Math.random().toString(36).substring(2, 9);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, group_id, group_name, sender, title, details, deadline, priority, status, raw_snippet, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      task.group_id || null,
      task.group_name,
      task.sender,
      task.title,
      task.details || null,
      task.deadline || null,
      task.priority || 'medium',
      task.status || 'pending',
      task.raw_snippet,
      now
    );

    return {
      ...task,
      id,
      created_at: now,
    };
  }

  listTasks(filters?: { status?: string; group_name?: string; limit?: number }): TaskRecord[] {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];

    if (filters?.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.group_name) {
      query += ' AND group_name = ?';
      params.push(filters.group_name);
    }

    query += ' ORDER BY created_at DESC';

    if (filters?.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    return this.db.prepare(query).all(...params) as TaskRecord[];
  }

  updateTaskStatus(id: string, status: 'pending' | 'in_progress' | 'completed' | 'dismissed'): boolean {
    const now = new Date().toISOString();
    const completedAt = status === 'completed' ? now : null;

    const result = this.db.prepare(`
      UPDATE tasks
      SET status = ?, completed_at = ?
      WHERE id = ?
    `).run(status, completedAt, id);

    return result.changes > 0;
  }

  getTodayStats(): { total: number; pending: number; completed: number } {
    const today = new Date().toISOString().split('T')[0];
    const rows = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM tasks
      WHERE created_at LIKE ?
    `).get(`${today}%`) as any;

    return {
      total: rows.total || 0,
      pending: rows.pending || 0,
      completed: rows.completed || 0,
    };
  }

  // --- Slack-style Message History Operations ---

  insertMessage(msg: Omit<MessageRecord, 'id' | 'created_at'> & { id?: string }): MessageRecord {
    const id = msg.id || 'msg_' + crypto.randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    const timestamp = msg.timestamp || now;
    const isFromMe = msg.is_from_me ? 1 : 0;

    this.db.prepare(`
      INSERT INTO messages (id, chat_id, chat_name, sender, text, timestamp, is_from_me, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, msg.chat_id, msg.chat_name, msg.sender, msg.text, timestamp, isFromMe, now);

    // Also update group last_seen_at
    const grp = this.registerGroup(msg.chat_name);

    return {
      id,
      chat_id: grp.id,
      chat_name: msg.chat_name,
      sender: msg.sender,
      text: msg.text,
      timestamp,
      is_from_me: isFromMe,
      created_at: now,
    };
  }

  getChatHistory(chatName: string, limit = 20): MessageRecord[] {
    return this.db.prepare(`
      SELECT * FROM messages
      WHERE chat_name LIKE ? OR chat_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(`%${chatName}%`, chatName, limit) as MessageRecord[];
  }

  searchMessages(query: string, limit = 20): MessageRecord[] {
    return this.db.prepare(`
      SELECT * FROM messages
      WHERE text LIKE ? OR sender LIKE ? OR chat_name LIKE ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as MessageRecord[];
  }

  listChatsWithLastMessage(): any[] {
    return this.db.prepare(`
      SELECT
        g.id,
        g.name as chat_name,
        g.capture_enabled,
        g.post_enabled,
        g.last_seen_at,
        (SELECT text FROM messages WHERE chat_id = g.id OR chat_name = g.name ORDER BY timestamp DESC LIMIT 1) as last_message,
        (SELECT sender FROM messages WHERE chat_id = g.id OR chat_name = g.name ORDER BY timestamp DESC LIMIT 1) as last_sender,
        (SELECT timestamp FROM messages WHERE chat_id = g.id OR chat_name = g.name ORDER BY timestamp DESC LIMIT 1) as last_message_time,
        COUNT(t.id) as pending_task_count
      FROM groups g
      LEFT JOIN tasks t ON g.id = t.group_id AND t.status = 'pending'
      GROUP BY g.id
      ORDER BY g.last_seen_at DESC
    `).all();
  }
}
