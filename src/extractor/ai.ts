import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

export interface ExtractedTask {
  is_actionable: boolean;
  title?: string;
  details?: string;
  deadline?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  reason?: string;
}

export class TaskExtractor {
  private openai?: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
  }

  async extract(text: string, sender: string, groupName: string): Promise<ExtractedTask> {
    if (this.openai) {
      try {
        return await this.extractWithLLM(text, sender, groupName);
      } catch (err) {
        console.error('LLM extraction error, falling back to heuristic:', err);
      }
    }
    return this.extractHeuristic(text, sender);
  }

  private async extractWithLLM(text: string, sender: string, groupName: string): Promise<ExtractedTask> {
    const prompt = `คุณคือ AI ผู้ช่วยสกัดงาน (Task Extractor) จากแชต LINE ของคนไทยในที่ทำงาน
ข้อความมาจากกลุ่ม/แชต: "${groupName}"
ผู้ส่ง: "${sender}"
ข้อความ:
"""${text}"""

โปรดวิเคราะห์ว่าข้อความนี้มี "งานหรือสิ่งที่ต้องทำ (Actionable Task/Request)" หรือไม่:
- ถ้าเป็นแค่การคุยเล่น ทักทาย สติกเกอร์ ขอบคุณ ตอบรับทั่วไป ("โอเคค่า", "รับทราบ", "555") -> is_actionable = false
- ถ้ามีการสั่งงาน ไหว้วาน ติดตาม ทวงงาน นัดหมาย หรือส่งไฟล์ให้ตรวจ -> is_actionable = true พร้อมสกัด:
  - title: สรุปสิ่งที่ต้องทำสั้นๆ กระชับ ชัดเจน เป็นภาษาไทย
  - details: รายละเอียดเพิ่มเติมที่สำคัญ (ถ้ามี)
  - deadline: กำหนดส่งหรือเวลานัดหมาย (เช่น "วันนี้ 14:00", "พรุ่งนี้เช้า", "ศุกร์นี้", หรือระบุไม่ได้ให้เว้นว่าง)
  - priority: ความเร่งด่วน ('low', 'medium', 'high', 'urgent')

ตอบกลับเป็น JSON เท่านั้นในรูปแบบนี้:
{
  "is_actionable": true | false,
  "title": "...",
  "details": "...",
  "deadline": "...",
  "priority": "low" | "medium" | "high" | "urgent",
  "reason": "..."
}`;

    const res = await this.openai!.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const content = res.choices[0]?.message?.content || '{}';
    return JSON.parse(content) as ExtractedTask;
  }

  /**
   * Fast offline heuristic rule engine for Thai office keywords
   */
  private extractHeuristic(text: string, sender: string): ExtractedTask {
    const lower = text.toLowerCase();

    // High signal Thai action indicators
    const actionKeywords = [
      'รบกวน', 'ช่วย', 'ฝาก', 'ส่งให้', 'ตรวจ', 'เคาะ', 'ทำสรุป',
      'อัปเดต', 'ติดตาม', 'แก้งาน', 'เตรียม', 'นัดหมาย', 'ประชุม',
      'ตามนี้', 'ส่งไฟล์', 'เซ็น', 'แจ้ง', 'ด่วน', 'ขอทราบ', 'โอน'
    ];

    const hasActionKeyword = actionKeywords.some(kw => lower.includes(kw));

    // Casual/Non-action filters
    const casualOnly = ['ขอบคุณ', '555', 'ครับผม', 'ค่ะ', 'โอเค', 'ok', 'รับทราบครับ', 'รับทราบค่ะ', 'ยินดีครับ'];
    const isOnlyCasual = casualOnly.some(c => text.trim() === c);

    if (!hasActionKeyword || isOnlyCasual) {
      return {
        is_actionable: false,
        reason: 'No clear actionable request found (heuristic)',
      };
    }

    // Determine priority
    let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';
    if (lower.includes('ด่วน') || lower.includes('asap') || lower.includes('ทันที') || lower.includes('เร่ง')) {
      priority = 'urgent';
    }

    // Attempt deadline detection
    let deadline: string | undefined = undefined;
    if (lower.includes('วันนี้')) deadline = 'วันนี้';
    else if (lower.includes('พรุ่งนี้')) deadline = 'พรุ่งนี้';
    else if (lower.includes('เย็นนี้')) deadline = 'เย็นนี้';
    else if (lower.includes('ก่อนเที่ยง')) deadline = 'ก่อนเที่ยง';

    // Build title
    let title = text.replace(/\n+/g, ' ').slice(0, 60);
    if (text.length > 60) title += '...';

    return {
      is_actionable: true,
      title: `${sender ? `[จาก ${sender}] ` : ''}${title}`,
      details: text,
      deadline,
      priority,
      reason: 'Matched Thai office action keywords',
    };
  }
}
