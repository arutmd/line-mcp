import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TaskDB } from '../db/index.js';
import { TaskExtractor } from '../extractor/ai.js';
import { z } from 'zod';

const db = new TaskDB();
const extractor = new TaskExtractor();

const server = new Server(
  {
    name: 'line-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Define Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'line_list_chats',
        description: 'List all LINE groups, channels, and direct chats with recent activity, toggle status, and pending task counts. (Equivalent to slack_list_channels)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'line_get_chat_history',
        description: 'Fetch the recent conversation message history from a specific LINE chat or group. (Equivalent to slack_get_channel_history)',
        inputSchema: {
          type: 'object',
          properties: {
            chat_name: {
              type: 'string',
              description: 'The name of the LINE group or contact (e.g. "Demo Contact", "Demo Operations")',
            },
            limit: {
              type: 'number',
              description: 'Number of recent messages to return (default: 20)',
            },
          },
          required: ['chat_name'],
        },
      },
      {
        name: 'line_search_messages',
        description: 'Search across all LINE chat messages for keywords, names, topics, or tasks. (Equivalent to slack_search_messages)',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query or keyword (e.g. "budget", "pitch deck", "Demo Contact")',
            },
            limit: {
              type: 'number',
              description: 'Max search results (default: 20)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'line_send_message',
        description: 'Send a message or reply to a specific LINE chat or group. Strictly checks and enforces the user\'s AI post permission toggle. (Equivalent to slack_post_message)',
        inputSchema: {
          type: 'object',
          properties: {
            chat_name: {
              type: 'string',
              description: 'The target group or contact name',
            },
            message: {
              type: 'string',
              description: 'The message text to send',
            },
          },
          required: ['chat_name', 'message'],
        },
      },
      {
        name: 'get_line_tasks',
        description: 'Get tasks extracted from LINE conversations. Filter by status (pending, completed, all) or group.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'completed', 'in_progress', 'all'],
              description: 'Filter by task status (default: pending)',
            },
            group_name: {
              type: 'string',
              description: 'Optional group name filter',
            },
            limit: {
              type: 'number',
              description: 'Max tasks to return (default: 20)',
            },
          },
        },
      },
      {
        name: 'list_line_groups',
        description: 'List all LINE groups known to the companion, with their capture and AI-post toggle status.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'toggle_group_permissions',
        description: 'Turn ON or OFF capturing or AI posting for a specific LINE group.',
        inputSchema: {
          type: 'object',
          properties: {
            group_name: {
              type: 'string',
              description: 'The name of the LINE group or 1-on-1 contact',
            },
            capture_enabled: {
              type: 'boolean',
              description: 'Whether to allow extracting tasks from this group',
            },
            post_enabled: {
              type: 'boolean',
              description: 'Whether to allow AI to post or reply messages to this group (Default: false)',
            },
          },
          required: ['group_name'],
        },
      },
      {
        name: 'ingest_line_chat',
        description: 'Ingest a raw LINE message snippet. Checks group permissions, extracts actionable tasks, and saves to database.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'The raw message text from LINE',
            },
            sender: {
              type: 'string',
              description: 'Name of the sender (e.g., พี่สมชาย, Boss, Nong May)',
            },
            group_name: {
              type: 'string',
              description: 'Name of the LINE group or chat room',
            },
          },
          required: ['text', 'sender', 'group_name'],
        },
      },
      {
        name: 'complete_line_task',
        description: 'Mark an extracted LINE task as completed.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'The ID of the task to complete',
            },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'verify_and_preview_post',
        description: 'Check if the AI is allowed to post a response into a LINE group, respecting the user toggle.',
        inputSchema: {
          type: 'object',
          properties: {
            group_name: {
              type: 'string',
              description: 'The group to post to',
            },
            message: {
              type: 'string',
              description: 'The message the AI wants to post',
            },
          },
          required: ['group_name', 'message'],
        },
      },
    ],
  };
});

// Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'line_list_chats': {
        const chats = db.listChatsWithLastMessage();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(chats, null, 2),
            },
          ],
        };
      }

      case 'line_get_chat_history': {
        const chatName = args?.chat_name as string;
        const limit = (args?.limit as number) || 20;
        const history = db.getChatHistory(chatName, limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                chat_name: chatName,
                count: history.length,
                messages: history.reverse(), // chronological order (oldest to newest)
              }, null, 2),
            },
          ],
        };
      }

      case 'line_search_messages': {
        const query = args?.query as string;
        const limit = (args?.limit as number) || 20;
        const results = db.searchMessages(query, limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query,
                match_count: results.length,
                results,
              }, null, 2),
            },
          ],
        };
      }

      case 'line_send_message': {
        const chatName = args?.chat_name as string;
        const message = args?.message as string;
        const isAllowed = db.isGroupPostAllowed(chatName);

        if (!isAllowed) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `⛔ PERMISSION DENIED: AI posting is turned OFF for "${chatName}". The user must toggle "post_enabled: true" in their LINE MCP settings before the AI can send messages here.`,
              },
            ],
          };
        }

        // Record message in history
        const sentMsg = db.insertMessage({
          chat_id: 'chat_' + crypto.randomUUID().slice(0, 8),
          chat_name: chatName,
          sender: 'AI Assistant',
          text: message,
          timestamp: new Date().toISOString(),
          is_from_me: 1,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'SENT',
                chat_name: chatName,
                message: sentMsg.text,
                timestamp: sentMsg.timestamp,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_line_tasks': {
        const status = args?.status === 'all' ? undefined : (args?.status as string || 'pending');
        const tasks = db.listTasks({
          status,
          group_name: args?.group_name as string | undefined,
          limit: (args?.limit as number) || 20,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(tasks, null, 2),
            },
          ],
        };
      }

      case 'list_line_groups': {
        const groups = db.listGroups();
        const mapped = groups.map(g => ({
          id: g.id,
          name: g.name,
          capture_enabled: Boolean(g.capture_enabled),
          post_enabled: Boolean(g.post_enabled),
          last_seen_at: g.last_seen_at,
        }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(mapped, null, 2),
            },
          ],
        };
      }

      case 'toggle_group_permissions': {
        const groupName = args?.group_name as string;
        let group = db.getGroupByName(groupName);
        if (!group) {
          group = db.registerGroup(groupName);
        }
        const updated = db.updateGroupToggles(group.id, {
          capture_enabled: args?.capture_enabled as boolean | undefined,
          post_enabled: args?.post_enabled as boolean | undefined,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                message: `Group permissions updated for "${groupName}"`,
                group: {
                  name: updated?.name,
                  capture_enabled: Boolean(updated?.capture_enabled),
                  post_enabled: Boolean(updated?.post_enabled),
                },
              }, null, 2),
            },
          ],
        };
      }

      case 'ingest_line_chat': {
        const text = args?.text as string;
        const sender = args?.sender as string;
        const groupName = args?.group_name as string;

        // Register or retrieve group
        const group = db.registerGroup(groupName);

        // Check if capture is enabled
        if (!group.capture_enabled) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  captured: false,
                  reason: `Capturing is disabled by user for group "${groupName}". Turn toggle ON to enable.`,
                }, null, 2),
              },
            ],
          };
        }

        // Save message to chat history
        db.insertMessage({
          chat_id: group.id,
          chat_name: groupName,
          sender,
          text,
          timestamp: new Date().toISOString(),
          is_from_me: 0,
        });

        // Extract task
        const extracted = await extractor.extract(text, sender, groupName);

        if (!extracted.is_actionable || !extracted.title) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  captured: false,
                  reason: extracted.reason || 'No actionable task detected in message.',
                }, null, 2),
              },
            ],
          };
        }

        // Save task
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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                captured: true,
                task,
              }, null, 2),
            },
          ],
        };
      }

      case 'complete_line_task': {
        const taskId = args?.task_id as string;
        const success = db.updateTaskStatus(taskId, 'completed');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success,
                message: success ? `Task ${taskId} marked as completed.` : `Task ${taskId} not found.`,
              }, null, 2),
            },
          ],
        };
      }

      case 'verify_and_preview_post': {
        const groupName = args?.group_name as string;
        const message = args?.message as string;
        const isAllowed = db.isGroupPostAllowed(groupName);

        if (!isAllowed) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `⛔ PERMISSION DENIED: AI posting is turned OFF for group "${groupName}". The user must toggle "post_enabled: true" in their LineTask settings before the AI can post here.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'APPROVED_TO_POST',
                group: groupName,
                preview_message: message,
                note: 'User has enabled AI posting for this group.',
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${err.message}`,
        },
      ],
    };
  }
});

// Resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'line://tasks/pending',
        name: 'Pending LINE Tasks',
        mimeType: 'application/json',
      },
      {
        uri: 'line://groups',
        name: 'LINE Groups and Toggle Permissions',
        mimeType: 'application/json',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === 'line://tasks/pending') {
    const tasks = db.listTasks({ status: 'pending' });
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(tasks, null, 2),
        },
      ],
    };
  }
  if (uri === 'line://groups') {
    const groups = db.listGroups();
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(groups, null, 2),
        },
      ],
    };
  }
  throw new Error(`Resource not found: ${uri}`);
});

export async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('LINE Task Companion MCP server running on stdio');
}

if (process.argv[1]?.includes('mcp/server')) {
  runServer().catch(console.error);
}
