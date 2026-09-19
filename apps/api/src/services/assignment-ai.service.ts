import path from 'path';
import fs from 'fs';
import { config as dotenvConfig } from 'dotenv';

function findEnv(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
dotenvConfig({ path: findEnv(__dirname) });
import { randomUUID } from 'crypto';
import AiTaskDraftModel from '../models/ai-task-draft.model';
import { OfficeDocumentContextModel, UserModel, WorkDeclarationModel } from '../models';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';
import {
  createWorkDeclarationService,
  submitWorkDeclarationService,
} from './work-declaration.service';
import { officeDocumentProjection, officeDocumentScope } from './office-document-projection.service';
import {
  appendChatContent,
  cancelPendingTaskProposals,
  getChatMemory,
  getLatestTaskDraft,
  getOrCreatePrimaryChatSession,
  replacePendingTaskProposals,
  updateTaskProposal,
} from './chat-session.service';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type TaskExtraction = {
  intent?: 'TASK' | 'QUESTION' | string | null;
  title?: string | null;
  description?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | string | null;
  point?: number | string | null;
  assigneeUsername?: string | null;
  missingFields?: string[];
};

type StreamHandlers = {
  signal?: AbortSignal;
  delta: (text: string) => void;
  draft: (draft: Record<string, unknown>) => void;
  confirmed: (result: Record<string, unknown>) => void;
  cancelled: (result: Record<string, unknown>) => void;
};

const getModelUrl = () => {
  const baseUrl = process.env.BASE_URL?.trim();
  if (baseUrl) {
    const cleaned = baseUrl.replace(/\/+$/, '');
    return cleaned.endsWith('/chat/completions') ? cleaned : `${cleaned}/chat/completions`;
  }
  return process.env.ASSIGNMENT_AI_URL || 'http://100.94.148.68:8000/v1/chat/completions';
};

const getModelName = () => {
  return process.env.MODEL?.trim() || process.env.ASSIGNMENT_AI_MODEL?.trim() || 'qwen3.8-27b';
};

const getApiKey = () => {
  return process.env.API_KEY?.trim() || process.env.ASSIGNMENT_AI_API_KEY?.trim() || '';
};
const REQUIRED_FIELDS = ['title', 'date', 'startTime', 'endTime', 'point'] as const;
const CONFIRMATIONS = new Set([
  'xac nhan', 'ok', 'okay', 'dong y', 'trien', 'trien khai', 'tao viec', 'gui di', 'chot',
]);
const CANCELLATIONS = new Set([
  'huy', 'cancel', 'thoi', 'bo qua', 'khong tao', 'khong tao nua', 'dung lai', 'huy task', 'huy viec',
]);
const CONTEXT_EMPLOYEE_LIMIT = 80;
const CONTEXT_WORK_LIMIT = 50;
const CONTEXT_DOCUMENT_LIMIT = 30;

const normalizeConfirmation = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const isAiConfirmation = (value: unknown) => CONFIRMATIONS.has(normalizeConfirmation(value));
export const isAiCancellation = (value: unknown) => CANCELLATIONS.has(normalizeConfirmation(value));

const vietnamNow = () => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  weekday: 'long',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}).format(new Date());

const isAdmin = (actor: AuthUser) => actor.role.code === 'ADMIN';
const isSpecialist = (actor: AuthUser) => actor.role.code === 'SPECIALIST';
const isDepartmentLeader = (actor: AuthUser) => actor.role.code === 'DEPARTMENT_LEADER';
const idOf = (value: any) => String(value?._id ?? value ?? '');

const scopedEmployeeFilter = (actor: AuthUser) => {
  const filter: Record<string, unknown> = { status: 'ACTIVE' };
  if (!isAdmin(actor)) filter.organization = actor.organization;
  if (isSpecialist(actor)) filter._id = actor.id;
  if (isDepartmentLeader(actor)) filter.department = actor.department;
  return filter;
};

const scopedWorkFilter = (actor: AuthUser) => {
  const filter: Record<string, unknown> = { status: { $ne: 'CANCELLED' } };
  if (!isAdmin(actor)) filter.organization = actor.organization;
  if (isSpecialist(actor)) filter.createdBy = actor.id;
  if (isDepartmentLeader(actor)) {
    filter.$or = [
      { department: actor.department },
      { createdBy: actor.id },
      { 'approval.currentApprover': actor.id },
    ];
  }
  return filter;
};

const buildWorkspaceContext = async (actor: AuthUser) => {
  const [employees, workDeclarations, contexts] = await Promise.all([
    UserModel.find(scopedEmployeeFilter(actor))
      .select('username fullName position department role')
      .populate('department', 'name code')
      .populate('role', 'code name level')
      .sort({ fullName: 1 })
      .limit(CONTEXT_EMPLOYEE_LIMIT)
      .lean(),
    WorkDeclarationModel.find(scopedWorkFilter(actor))
      .select('title description workStartAt workEndAt durationMinutes declaredPoint status createdBy department approval')
      .populate('createdBy', 'username fullName position')
      .populate('department', 'name code')
      .populate('approval.currentApprover', 'username fullName position')
      .sort({ workStartAt: 1, updatedAt: -1 })
      .limit(CONTEXT_WORK_LIMIT)
      .lean(),
    OfficeDocumentContextModel.find(officeDocumentScope(actor))
      .select('externalDocumentId observation statusSync management observedAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(CONTEXT_DOCUMENT_LIMIT)
      .lean(),
  ]);
  const documents = contexts.map(officeDocumentProjection);

  return {
    scope: isSpecialist(actor)
      ? 'Chỉ dữ liệu của người dùng hiện tại.'
      : isDepartmentLeader(actor)
        ? 'Dữ liệu trong phòng ban, công việc của người dùng và việc đang chờ người dùng duyệt.'
        : 'Dữ liệu trong phạm vi tổ chức mà người dùng được phép xem.',
    employees: employees.map((employee: any) => ({
      username: employee.username,
      fullName: employee.fullName,
      position: employee.position ?? null,
      role: employee.role ? { code: employee.role.code, name: employee.role.name } : null,
      department: employee.department ? { name: employee.department.name, code: employee.department.code } : null,
    })),
    workDeclarations: workDeclarations.map((work: any) => ({
      title: work.title,
      description: String(work.description || '').slice(0, 280),
      startAt: work.workStartAt,
      endAt: work.workEndAt,
      durationMinutes: work.durationMinutes,
      point: work.declaredPoint,
      status: work.status,
      owner: work.createdBy ? { username: work.createdBy.username, fullName: work.createdBy.fullName, position: work.createdBy.position ?? null } : null,
      department: work.department ? work.department.name : null,
      currentApprover: work.approval?.currentApprover
        ? { username: work.approval.currentApprover.username, fullName: work.approval.currentApprover.fullName }
        : null,
    })),
    documents: documents.map((document: any) => ({
      soKyHieu: document.soKyHieu,
      trichYeu: String(document.trichYeu || '').slice(0, 320),
      deadline: document.deadline,
      point: document.point ?? 0,
      completed: document.completed,
      processingStatus: document.status,
      currentAssignee: document.owner?.fullName
        ? { username: '', fullName: document.owner.fullName }
        : null,
    })),
  };
};

const systemPrompt = (actor: AuthUser, currentDraft: unknown, workspaceContext: unknown) => `Bạn là trợ lý vận hành eWork. Bạn vừa có thể khai báo công việc, vừa trả lời câu hỏi về nhân sự, công việc và văn bản mà người dùng được phép xem.
Người dùng hiện tại: ${actor.fullName}.
Thời gian hiện tại tại Asia/Ho_Chi_Minh: ${vietnamNow()}.
${!actor.organization ? 'Người dùng hiện tại chưa thuộc tổ chức. Với TASK, bắt buộc phải nêu một người thực hiện thuộc danh sách employees.' : ''}
Draft đã ghi nhận từ các lượt trước: ${JSON.stringify(currentDraft ?? {})}.
Dữ liệu hệ thống đã phân quyền, là nguồn sự thật duy nhất để trả lời tra cứu: ${JSON.stringify(workspaceContext)}.

Phân loại ý định:
- QUESTION: người dùng hỏi về nhân viên, ai đang làm gì, lịch, task, tiến độ, người duyệt, điểm hoặc văn bản. Chỉ trả lời bằng dữ liệu trong context. Nếu context không đủ hoặc không có dữ liệu, nói rõ không có dữ liệu trong phạm vi được phép xem; không suy đoán.
- TASK: người dùng muốn tạo, sửa hoặc tiếp tục khai báo một công việc. Chỉ intent này mới cần thu thập trường tạo việc và có thể đề nghị xác nhận.

Khi intent là TASK, mục tiêu là thu thập chính xác các trường bắt buộc: title, date, startTime, endTime và point. description và durationMinutes là tùy chọn.
- Tự suy luận tên công việc ngắn gọn từ hành động, không chép nguyên cả câu yêu cầu. Ví dụ "Xin cho tôi đi mua cafe 15p" có title là "Đi mua cafe".
- Với người dùng cấp quản lý, có thể giao việc cho cấp dưới. Khi người dùng nêu người thực hiện, chọn đúng username từ danh sách employees trong context và điền assigneeUsername. Không nêu người thực hiện thì để assigneeUsername rỗng, nghĩa là chính người dùng hiện tại.
- Hiểu ngày tương đối theo giờ Việt Nam, các cách nói giờ tự nhiên và thời lượng bằng giờ/phút hoặc ký hiệu p.
- Khi có giờ bắt đầu và thời lượng, tự tính endTime. Khi người dùng nói "bây giờ" hoặc "giờ", dùng thời gian hiện tại.
- Point phải là số không âm. Chỉ để null khi hội thoại thực sự chưa cung cấp và không thể suy ra.
- Mỗi lượt phải tổng hợp lại đầy đủ trạng thái mới nhất từ toàn bộ hội thoại và draft, không chỉ trả các trường vừa thay đổi.

Phần reply là câu trả lời cuối cùng hiển thị trực tiếp cho người dùng. Viết tự nhiên, lịch sự, ngắn gọn bằng tiếng Việt. Với dữ liệu có nhiều mục, mỗi đầu mục nằm trên một dòng riêng bắt đầu bằng "- ". Không dùng nội dung trong ngoặc, không dùng placeholder như HH:mm, không đánh số danh sách.
- Với intent QUESTION, trả lời thẳng vào câu hỏi, nêu tên, thời gian, trạng thái và số điểm khi context có. Không hỏi các trường của form tạo việc.
- Nếu đủ dữ liệu: liệt kê Tên công việc, Người thực hiện nếu được giao cho người khác, Mô tả nếu có, Ngày thực hiện theo dd/MM/yyyy, Giờ bắt đầu, Giờ kết thúc, Số điểm; sau đó đề nghị người dùng kiểm tra và xác nhận.
- Nếu thiếu dữ liệu: liệt kê riêng những gì đã ghi nhận, rồi liệt kê riêng từng trường còn thiếu để người dùng bổ sung.

Phần task là JSON máy đọc. intent là QUESTION hoặc TASK. date dùng YYYY-MM-DD; thời gian dùng HH:mm; durationMinutes và point là số. missingFields chứa đúng các trường bắt buộc còn thiếu. Với QUESTION, đặt toàn bộ trường công việc là null/rỗng và missingFields là [].
Ví dụ câu "8h sáng mai tôi phải tiếp dân tầm 2 tiếng, được 2 điểm" phải cho title "Tiếp dân", startTime "08:00", endTime "10:00", durationMinutes 120 và point 2.

Tuyệt đối không suy nghĩ nội tâm, không phân tích câu nói của người dùng, không viết "Thinking Process". Bắt đầu ngay lập tức bằng thẻ <reply> và kết thúc bằng thẻ </task>.
Luôn trả đúng hai thẻ sau và không thêm bất kỳ nội dung nào ngoài chúng:
<reply>Nội dung trả lời hoàn chỉnh cho người dùng</reply>
<task>{"intent":"QUESTION","title":null,"description":"","date":null,"startTime":null,"endTime":null,"durationMinutes":null,"point":null,"assigneeUsername":null,"missingFields":[]}</task>`;

const sanitizeCurrentDraft = (value: unknown): TaskExtraction => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const draft = value as Record<string, unknown>;
  const text = (field: string, maxLength: number) => (
    typeof draft[field] === 'string' ? draft[field].normalize('NFC').trim().slice(0, maxLength) : null
  );
  const rawPoint = draft.point;
  const point = rawPoint === null || rawPoint === undefined || rawPoint === ''
    ? null
    : Number(rawPoint);
  return {
    title: text('title', 300),
    description: text('description', 1500),
    date: text('date', 10),
    startTime: text('startTime', 5),
    endTime: text('endTime', 5),
    durationMinutes: Number.isFinite(Number(draft.durationMinutes)) && Number(draft.durationMinutes) > 0
      ? Number(draft.durationMinutes)
      : null,
    point: Number.isFinite(point) && Number(point) >= 0 ? point : null,
    assigneeUsername: text('assigneeUsername', 120),
  };
};

class TaggedOutputParser {
  private rawAccumulated = '';
  private emittedReply = '';
  private insideThink = false;
  private insideReply = false;
  private insideTask = false;
  private replyFinished = false;
  private isDone = false;
  private buffer = '';

  constructor(private readonly onReplyDelta: (text: string) => void) { }

  push(chunk: string) {
    if (this.isDone || !chunk) return;
    this.rawAccumulated += chunk;
    this.buffer += chunk;
    this.processBuffer(false);
  }

  finish(): { raw: TaskExtraction; reply: string } {
    this.processBuffer(true);
    this.isDone = true;

    // 1. Resolve Reply Text
    let finalReply = this.emittedReply.trim();
    if (!finalReply) {
      let cleaned = this.rawAccumulated
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<task>[\s\S]*?<\/task>/gi, '')
        .replace(/```json[\s\S]*?```/gi, '')
        .trim();

      const replyMatch = this.rawAccumulated.match(/<reply>([\s\S]*?)<\/reply>/i);
      if (replyMatch && replyMatch[1]?.trim()) {
        finalReply = replyMatch[1].trim();
      } else if (cleaned) {
        finalReply = cleaned.replace(/<\/?reply>/gi, '').trim();
      } else {
        finalReply = 'Tôi có thể hỗ trợ gì cho bạn?';
      }

      if (!this.emittedReply) {
        this.onReplyDelta(finalReply);
      }
    }

    // 2. Resolve Task JSON
    let taskJson: TaskExtraction = { intent: 'QUESTION' };
    const taskMatch = this.rawAccumulated.match(/<task>([\s\S]*?)<\/task>/i);
    if (taskMatch && taskMatch[1]) {
      try {
        const jsonCandidate = taskMatch[1].match(/\{[\s\S]*\}/);
        if (jsonCandidate) {
          taskJson = JSON.parse(jsonCandidate[0]);
        }
      } catch (err) {
        console.warn('[AssignmentAI] Failed to parse <task> JSON:', err);
      }
    } else {
      const jsonBlockMatch = this.rawAccumulated.match(/```json\s*(\{[\s\S]*?\})\s*```/i)
        || this.rawAccumulated.match(/(\{[\s\S]*?"intent"[\s\S]*?\})/i);
      if (jsonBlockMatch && jsonBlockMatch[1]) {
        try {
          taskJson = JSON.parse(jsonBlockMatch[1]);
        } catch (_) { }
      }
    }

    return { raw: taskJson, reply: finalReply };
  }

  private processBuffer(isFinal: boolean) {
    while (this.buffer.length > 0) {
      // Handle <think>
      if (!this.insideThink && !this.insideReply && !this.insideTask) {
        const thinkIndex = this.buffer.toLowerCase().indexOf('<think>');
        if (thinkIndex === 0) {
          this.insideThink = true;
          this.buffer = this.buffer.slice('<think>'.length);
          continue;
        }
      }

      if (this.insideThink) {
        const endThinkIndex = this.buffer.toLowerCase().indexOf('</think>');
        if (endThinkIndex >= 0) {
          this.insideThink = false;
          this.buffer = this.buffer.slice(endThinkIndex + '</think>'.length);
          continue;
        } else {
          this.buffer = '';
          return;
        }
      }

      // Handle <reply>
      if (!this.insideReply && !this.insideTask && !this.replyFinished) {
        const replyIndex = this.buffer.toLowerCase().indexOf('<reply>');
        if (replyIndex >= 0) {
          this.insideReply = true;
          this.buffer = this.buffer.slice(replyIndex + '<reply>'.length);
          continue;
        }
      }

      if (this.insideReply) {
        const endReplyIndex = this.buffer.toLowerCase().indexOf('</reply>');
        if (endReplyIndex >= 0) {
          const delta = this.buffer.slice(0, endReplyIndex);
          if (delta) {
            this.emittedReply += delta;
            this.onReplyDelta(delta);
          }
          this.insideReply = false;
          this.replyFinished = true;
          this.buffer = this.buffer.slice(endReplyIndex + '</reply>'.length);
          continue;
        } else {
          const safeLen = isFinal ? this.buffer.length : Math.max(0, this.buffer.length - '</reply>'.length);
          if (safeLen > 0) {
            const delta = this.buffer.slice(0, safeLen);
            this.emittedReply += delta;
            this.onReplyDelta(delta);
            this.buffer = this.buffer.slice(safeLen);
          }
          return;
        }
      }

      // Handle insideTask
      if (this.insideTask) {
        const endTaskIndex = this.buffer.toLowerCase().indexOf('</task>');
        if (endTaskIndex >= 0) {
          this.insideTask = false;
          this.buffer = this.buffer.slice(endTaskIndex + '</task>'.length);
          continue;
        } else {
          this.buffer = '';
          return;
        }
      }

      // Handle <task>
      const taskIndex = this.buffer.toLowerCase().indexOf('<task>');
      if (taskIndex >= 0) {
        this.insideTask = true;
        this.buffer = this.buffer.slice(taskIndex + '<task>'.length);
        continue;
      }

      // If reply is finished, ignore any stray text between </reply> and <task>
      if (this.replyFinished) {
        const nextTaskIdx = this.buffer.toLowerCase().indexOf('<task>');
        if (nextTaskIdx >= 0) {
          this.buffer = this.buffer.slice(nextTaskIdx);
          continue;
        } else {
          this.buffer = '';
          return;
        }
      }

      // If reply hasn't started and we have potential tags ahead
      const tagIndex = this.buffer.indexOf('<');
      if (tagIndex >= 0) {
        if (tagIndex > 0) {
          this.buffer = this.buffer.slice(tagIndex);
          continue;
        }
        if (!isFinal) return;
      }

      if (isFinal) {
        this.buffer = '';
        return;
      }

      return;
    }
  }
}

const readModelStream = async (
  messages: ChatMessage[],
  actor: AuthUser,
  currentDraft: unknown,
  workspaceContext: unknown,
  handlers: StreamHandlers,
) => {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 90_000);
  const abort = () => timeout.abort();
  handlers.signal?.addEventListener('abort', abort, { once: true });

  const modelUrl = getModelUrl();
  const modelName = getModelName();
  const apiKey = getApiKey();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(modelUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemPrompt(actor, currentDraft, workspaceContext) },
          ...messages,
        ],
        temperature: 0,
        max_tokens: 2048,
        stream: true,
        reasoning_effort: 'none',
        chat_template_kwargs: { enable_thinking: false },
        extra_body: {
          chat_template_kwargs: { enable_thinking: false },
        },
      }),
      signal: timeout.signal,
    });
    if (!response.ok || !response.body) {
      const errDetail = await response.text().catch(() => '');
      throw new Error(`AI model is unavailable (${response.status}): ${errDetail || response.statusText}`);
    }

    let reply = '';
    const parser = new TaggedOutputParser((text) => {
      reply += text;
      handlers.delta(text);
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = done ? '' : lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        const content = event?.choices?.[0]?.delta?.content;
        if (typeof content === 'string' && content) parser.push(content);
      }
      if (done) break;
    }
    const result = parser.finish();
    return { raw: result.raw, reply: result.reply || reply };
  } finally {
    clearTimeout(timer);
    handlers.signal?.removeEventListener('abort', abort);
  }
};

const normalizeExtraction = (raw: TaskExtraction) => {
  const intent = raw.intent === 'QUESTION' ? 'QUESTION' : 'TASK';
  const title = typeof raw.title === 'string' ? raw.title.normalize('NFC').trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.normalize('NFC').trim() : '';
  const date = typeof raw.date === 'string' ? raw.date.trim() : '';
  const startTime = typeof raw.startTime === 'string' ? raw.startTime.trim() : '';
  const endTime = typeof raw.endTime === 'string' ? raw.endTime.trim() : '';
  const parsedDurationMinutes = Number(raw.durationMinutes);
  const durationMinutes = Number.isFinite(parsedDurationMinutes) && parsedDurationMinutes > 0
    ? parsedDurationMinutes
    : null;
  const point = raw.point === null || raw.point === undefined || raw.point === '' ? null : Number(raw.point);
  const assigneeUsername = typeof raw.assigneeUsername === 'string'
    ? raw.assigneeUsername.trim().toLowerCase().slice(0, 120)
    : '';
  const values = { title, date, startTime, endTime, point };
  const missingFields = REQUIRED_FIELDS.filter((field) => {
    const value = values[field];
    return value === '' || value === null || (field === 'point' && (!Number.isFinite(value) || Number(value) < 0));
  });

  let workStartAt: Date | null = null;
  let workEndAt: Date | null = null;
  if (!missingFields.includes('date') && !missingFields.includes('startTime') && !missingFields.includes('endTime')) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      missingFields.push('date', 'startTime', 'endTime');
    } else {
      workStartAt = new Date(`${date}T${startTime}:00+07:00`);
      workEndAt = new Date(`${date}T${endTime}:00+07:00`);
      if (Number.isNaN(workStartAt.getTime()) || Number.isNaN(workEndAt.getTime()) || workEndAt <= workStartAt) {
        workStartAt = null;
        workEndAt = null;
        missingFields.push('startTime', 'endTime');
      }
    }
  }

  return {
    intent,
    title,
    description,
    date,
    startTime,
    endTime,
    durationMinutes,
    point,
    assigneeUsername,
    missingFields: [...new Set(missingFields)],
    complete: intent === 'TASK' && missingFields.length === 0 && Boolean(workStartAt && workEndAt),
    workStartAt,
    workEndAt,
  };
};

const resolveAiTaskAssignee = async (actor: AuthUser, assigneeUsername: string) => {
  if (!assigneeUsername || assigneeUsername === actor.username?.toLowerCase()) {
    if (!actor.organization) {
      throw badRequest('Please specify an assignee from an organization before creating this task.');
    }
    return {
      id: actor.id,
      username: actor.username ?? '',
      fullName: actor.fullName,
      organization: actor.organization,
      department: actor.department,
    };
  }
  if (actor.role.level > 3) throw forbidden('Only leaders can assign work to another user.');

  const target = await UserModel.findOne({ username: assigneeUsername, status: 'ACTIVE' })
    .select('_id username fullName organization department role')
    .populate('role', 'level')
    .lean();
  if (!target) throw badRequest('AI could not find the requested active assignee.');
  if (!isAdmin(actor) && idOf((target as any).organization) !== actor.organization) {
    throw forbidden('The selected assignee is outside your organization.');
  }
  if (Number((target as any).role?.level) <= Number(actor.role.level)) {
    throw forbidden('Work can only be assigned to a user with a lower role level.');
  }
  if (isDepartmentLeader(actor) && idOf((target as any).department) !== actor.department) {
    throw forbidden('Department leaders can only assign work within their department.');
  }
  return {
    id: idOf((target as any)._id),
    username: (target as any).username,
    fullName: (target as any).fullName,
    organization: idOf((target as any).organization),
    department: idOf((target as any).department) || null,
  };
};

const createConfirmationDraft = async (actor: AuthUser, extraction: ReturnType<typeof normalizeExtraction>) => {
  if (!extraction.workStartAt || !extraction.workEndAt || extraction.point === null) {
    throw badRequest('AI task data is incomplete.');
  }
  const assignee = await resolveAiTaskAssignee(actor, extraction.assigneeUsername);
  if (!assignee.organization) throw badRequest('The selected assignee has no organization assigned.');
  await AiTaskDraftModel.updateMany(
    { user: actor.id, status: 'PENDING' },
    { $set: { status: 'EXPIRED' } },
  );
  return AiTaskDraftModel.create({
    token: randomUUID(),
    user: actor.id,
    organization: assignee.organization,
    department: assignee.department,
    payload: {
      title: extraction.title,
      description: extraction.description,
      workStartAt: extraction.workStartAt,
      workEndAt: extraction.workEndAt,
      declaredPoint: extraction.point,
      assigneeId: assignee.id,
      assigneeUsername: assignee.username,
      assigneeFullName: assignee.fullName,
    },
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
};

const confirmDraft = async (actor: AuthUser, token: unknown) => {
  const confirmationToken = String(token ?? '').trim();
  if (!confirmationToken) throw badRequest('No AI task is waiting for confirmation.');

  const draft = await AiTaskDraftModel.findOneAndUpdate(
    { token: confirmationToken, user: actor.id, status: 'PENDING', expiresAt: { $gt: new Date() } },
    { $set: { status: 'CONFIRMING' } },
    { returnDocument: 'after' },
  );
  if (!draft) {
    const existing = await AiTaskDraftModel.findOne({ token: confirmationToken, user: actor.id }).select('status confirmedDeclaration');
    if (!existing) throw notFound('AI confirmation is invalid or expired.');
    if ((existing as any).status === 'CONFIRMED') {
      return { alreadyConfirmed: true, declarationId: String((existing as any).confirmedDeclaration ?? '') };
    }
    throw conflict('AI task is already being confirmed or has expired.');
  }

  let declarationId = '';
  try {
    const created = await createWorkDeclarationService(actor, {
      title: (draft as any).payload.title,
      description: (draft as any).payload.description,
      workStartAt: (draft as any).payload.workStartAt,
      workEndAt: (draft as any).payload.workEndAt,
      declaredPoint: (draft as any).payload.declaredPoint,
      assigneeId: (draft as any).payload.assigneeId ?? actor.id,
    });
    const declarationData = (created as any).data;
    declarationId = String(declarationData?._id ?? '');
    const declarationRevision = Number(declarationData?.revision ?? 1);
    let result: any = created;
    let submissionError: string | null = null;
    if (actor.role.code === 'SPECIALIST') {
      try {
        result = await submitWorkDeclarationService(actor, declarationId, {
          revision: declarationRevision,
        });
      } catch (error: any) {
        submissionError = error?.message || 'Task was created but could not be submitted for approval.';
      }
    }
    await AiTaskDraftModel.updateOne(
      { _id: (draft as any)._id },
      { $set: { status: 'CONFIRMED', confirmedDeclaration: declarationId, confirmedAt: new Date() } },
    );
    return { alreadyConfirmed: false, declarationId, declaration: (result as any).data, submissionError };
  } catch (error) {
    if (!declarationId) {
      await AiTaskDraftModel.updateOne({ _id: (draft as any)._id }, { $set: { status: 'PENDING' } });
    }
    throw error;
  }
};

const cancelDraft = async (actor: AuthUser, token: unknown) => {
  const proposalToken = String(token ?? '').trim();
  const filter: Record<string, unknown> = { user: actor.id, status: 'PENDING' };
  if (proposalToken) filter.token = proposalToken;
  const result = await AiTaskDraftModel.updateMany(filter, { $set: { status: 'EXPIRED' } });
  return {
    proposalToken: proposalToken || null,
    cancelled: result.modifiedCount > 0,
  };
};

const confirmationReply = (result: Record<string, any>) => {
  if (result.alreadyConfirmed) return 'Công việc này đã được xác nhận trước đó.';
  if (result.submissionError) return `Đã tạo công việc, nhưng chưa thể gửi duyệt: ${result.submissionError}`;
  return 'Đã xác nhận công việc.';
};

const cancellationReply = (result: Record<string, unknown>) => (
  result.cancelled ? 'Đã hủy yêu cầu tạo công việc.' : 'Hiện không có công việc nào chờ xác nhận.'
);

export const streamAssignmentAiChat = async (
  actor: AuthUser,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
) => {
  if (!actor.organization && !isAdmin(actor)) throw forbidden('User has no organization assigned.');
  const message = String(body.message ?? '').normalize('NFC').trim();
  if (!message || message.length > 1500) throw badRequest('message is required and must not exceed 1500 characters.');
  const proposalToken = body.proposalToken ?? body.confirmationToken;
  const session = await getOrCreatePrimaryChatSession(actor.id);
  const sessionId = String((session as any)._id);
  await appendChatContent(sessionId, 'USER', message);

  if (isAiCancellation(message)) {
    const result = await cancelDraft(actor, proposalToken);
    await cancelPendingTaskProposals(sessionId, String(proposalToken ?? '') || undefined);
    await appendChatContent(sessionId, 'ASSISTANT', cancellationReply(result), {
      kind: 'CANCELLATION',
      proposalToken: result.proposalToken,
      cancelled: result.cancelled,
    });
    handlers.cancelled({ ...result, message: cancellationReply(result) });
    return;
  }

  if (isAiConfirmation(message) && proposalToken) {
    const result = await confirmDraft(actor, proposalToken);
    await updateTaskProposal(sessionId, String(proposalToken), 'CONFIRMED', {
      declarationId: result.declarationId ?? null,
    });
    await appendChatContent(sessionId, 'ASSISTANT', confirmationReply(result), {
      kind: 'CONFIRMATION',
      proposalToken: String(proposalToken),
      declarationId: result.declarationId ?? null,
      alreadyConfirmed: Boolean(result.alreadyConfirmed),
    });
    handlers.confirmed({ ...result, message: confirmationReply(result) });
    return;
  }

  const messages: ChatMessage[] = await getChatMemory(sessionId);
  const currentDraft = sanitizeCurrentDraft(await getLatestTaskDraft(sessionId));
  const workspaceContext = await buildWorkspaceContext(actor);
  const { raw, reply } = await readModelStream(messages, actor, currentDraft, workspaceContext, handlers);
  const extraction = normalizeExtraction(raw);
  if (handlers.signal?.aborted) return;

  // A factual question must not discard a pending create-work proposal. A new
  // task instruction does supersede it, even when it is still missing fields.
  if (extraction.intent === 'TASK') {
    await AiTaskDraftModel.updateMany(
      { user: actor.id, status: 'PENDING' },
      { $set: { status: 'EXPIRED' } },
    );
    await replacePendingTaskProposals(sessionId);
  }

  let confirmationToken: string | null = null;
  let confirmationDraft: any = null;
  if (extraction.complete) {
    confirmationDraft = await createConfirmationDraft(actor, extraction);
    confirmationToken = String(confirmationDraft.token);
  }
  const draftPayload = {
    intent: extraction.intent,
    title: extraction.title || null,
    description: extraction.description,
    date: extraction.date || null,
    startTime: extraction.startTime || null,
    endTime: extraction.endTime || null,
    durationMinutes: extraction.durationMinutes,
    point: extraction.point,
    assigneeUsername: extraction.assigneeUsername || null,
    assignee: confirmationDraft ? {
      username: confirmationDraft.payload.assigneeUsername,
      fullName: confirmationDraft.payload.assigneeFullName,
    } : null,
    missingFields: extraction.missingFields,
    complete: extraction.complete,
    confirmationToken,
  };
  await appendChatContent(sessionId, 'ASSISTANT', reply, {
    kind: extraction.complete ? 'TASK_PROPOSAL' : 'TEXT',
    intent: extraction.intent,
    draft: draftPayload,
    ...(extraction.complete ? {
      proposal: { ...draftPayload, status: 'PENDING' },
    } : {}),
  });
  handlers.draft(draftPayload);
};
