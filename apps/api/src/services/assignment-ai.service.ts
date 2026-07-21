import { randomUUID } from 'crypto';
import AiTaskDraftModel from '../models/ai-task-draft.model';
import { DocumentModel, UserModel, WorkDeclarationModel } from '../models';
import { AuthUser } from '../types/auth';
import { badRequest, conflict, forbidden, notFound } from '../utils/http-error';
import {
  createWorkDeclarationService,
  submitWorkDeclarationService,
} from './work-declaration.service';
import { documentWorkflowFiltersFor } from './document-workflow.service';
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
  missingFields?: string[];
};

type StreamHandlers = {
  signal?: AbortSignal;
  delta: (text: string) => void;
  draft: (draft: Record<string, unknown>) => void;
  confirmed: (result: Record<string, unknown>) => void;
  cancelled: (result: Record<string, unknown>) => void;
};

const MODEL_URL = process.env.ASSIGNMENT_AI_URL || 'http://100.94.148.68:8000/v1/chat/completions';
const MODEL_NAME = process.env.ASSIGNMENT_AI_MODEL || 'qwen3.6-27b';
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
  const documentScope = await documentWorkflowFiltersFor(actor);
  const [employees, workDeclarations, documents] = await Promise.all([
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
    DocumentModel.find({
      deadline: { $ne: null },
      ...documentScope.participant,
    })
      .select('soKyHieu trichYeu deadline point ingest.completed processing')
      .sort({ deadline: 1, updatedAt: -1 })
      .limit(CONTEXT_DOCUMENT_LIMIT)
      .lean(),
  ]);

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
      completed: Boolean(document.ingest?.completed) || ['COMPLETED', 'MANUALLY_PROCESSED'].includes(document.processing?.status),
      processingStatus: document.processing?.status ?? 'UNASSIGNED',
      currentAssignee: document.processing?.currentAssignee
        ? { username: document.processing.currentAssignee.username, fullName: document.processing.currentAssignee.fullName }
        : null,
    })),
  };
};

const systemPrompt = (actor: AuthUser, currentDraft: unknown, workspaceContext: unknown) => `Bạn là trợ lý vận hành eWork. Bạn vừa có thể khai báo công việc, vừa trả lời câu hỏi về nhân sự, công việc và văn bản mà người dùng được phép xem.
Người dùng hiện tại: ${actor.fullName}.
Thời gian hiện tại tại Asia/Ho_Chi_Minh: ${vietnamNow()}.
Draft đã ghi nhận từ các lượt trước: ${JSON.stringify(currentDraft ?? {})}.
Dữ liệu hệ thống đã phân quyền, là nguồn sự thật duy nhất để trả lời tra cứu: ${JSON.stringify(workspaceContext)}.

Phân loại ý định:
- QUESTION: người dùng hỏi về nhân viên, ai đang làm gì, lịch, task, tiến độ, người duyệt, điểm hoặc văn bản. Chỉ trả lời bằng dữ liệu trong context. Nếu context không đủ hoặc không có dữ liệu, nói rõ không có dữ liệu trong phạm vi được phép xem; không suy đoán.
- TASK: người dùng muốn tạo, sửa hoặc tiếp tục khai báo một công việc. Chỉ intent này mới cần thu thập trường tạo việc và có thể đề nghị xác nhận.

Khi intent là TASK, mục tiêu là thu thập chính xác các trường bắt buộc: title, date, startTime, endTime và point. description và durationMinutes là tùy chọn.
- Tự suy luận tên công việc ngắn gọn từ hành động, không chép nguyên cả câu yêu cầu. Ví dụ "Xin cho tôi đi mua cafe 15p" có title là "Đi mua cafe".
- Hiểu ngày tương đối theo giờ Việt Nam, các cách nói giờ tự nhiên và thời lượng bằng giờ/phút hoặc ký hiệu p.
- Khi có giờ bắt đầu và thời lượng, tự tính endTime. Khi người dùng nói "bây giờ" hoặc "giờ", dùng thời gian hiện tại.
- Point phải là số không âm. Chỉ để null khi hội thoại thực sự chưa cung cấp và không thể suy ra.
- Mỗi lượt phải tổng hợp lại đầy đủ trạng thái mới nhất từ toàn bộ hội thoại và draft, không chỉ trả các trường vừa thay đổi.

Phần reply là câu trả lời cuối cùng hiển thị trực tiếp cho người dùng. Viết tự nhiên, lịch sự, ngắn gọn bằng tiếng Việt. Với dữ liệu có nhiều mục, mỗi đầu mục nằm trên một dòng riêng bắt đầu bằng "- ". Không dùng nội dung trong ngoặc, không dùng placeholder như HH:mm, không đánh số danh sách.
- Với intent QUESTION, trả lời thẳng vào câu hỏi, nêu tên, thời gian, trạng thái và số điểm khi context có. Không hỏi các trường của form tạo việc.
- Nếu đủ dữ liệu: liệt kê Tên công việc, Mô tả nếu có, Ngày thực hiện theo dd/MM/yyyy, Giờ bắt đầu, Giờ kết thúc, Số điểm; sau đó đề nghị người dùng kiểm tra và xác nhận.
- Nếu thiếu dữ liệu: liệt kê riêng những gì đã ghi nhận, rồi liệt kê riêng từng trường còn thiếu để người dùng bổ sung.

Phần task là JSON máy đọc. intent là QUESTION hoặc TASK. date dùng YYYY-MM-DD; thời gian dùng HH:mm; durationMinutes và point là số. missingFields chứa đúng các trường bắt buộc còn thiếu. Với QUESTION, đặt toàn bộ trường công việc là null/rỗng và missingFields là [].
Ví dụ câu "8h sáng mai tôi phải tiếp dân tầm 2 tiếng, được 2 điểm" phải cho title "Tiếp dân", startTime "08:00", endTime "10:00", durationMinutes 120 và point 2.

Luôn trả đúng hai thẻ sau và không thêm bất kỳ nội dung nào ngoài chúng:
<reply>Nội dung trả lời hoàn chỉnh cho người dùng</reply>
<task>{"intent":"QUESTION","title":null,"description":"","date":null,"startTime":null,"endTime":null,"durationMinutes":null,"point":null,"missingFields":[]}</task>`;

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
  };
};

class TaggedOutputParser {
  private buffer = '';
  private stage: 'prefix' | 'reply' | 'between' | 'task' | 'done' = 'prefix';
  private taskText = '';
  private readonly replyOpen = '<reply>';
  private readonly replyClose = '</reply>';
  private readonly taskOpen = '<task>';
  private readonly taskClose = '</task>';

  constructor(private readonly onReplyDelta: (text: string) => void) { }

  push(chunk: string) {
    this.buffer += chunk;
    this.consume(false);
  }

  finish() {
    this.consume(true);
    const match = this.taskText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response did not include task data.');
    return JSON.parse(match[0]) as TaskExtraction;
  }

  private consume(final: boolean) {
    while (this.buffer) {
      if (this.stage === 'prefix') {
        const index = this.buffer.indexOf(this.replyOpen);
        if (index < 0) {
          if (final) throw new Error('AI response did not include reply data.');
          this.buffer = this.buffer.slice(-this.replyOpen.length);
          return;
        }
        this.buffer = this.buffer.slice(index + this.replyOpen.length);
        this.stage = 'reply';
      } else if (this.stage === 'reply') {
        const index = this.buffer.indexOf(this.replyClose);
        if (index >= 0) {
          this.onReplyDelta(this.buffer.slice(0, index));
          this.buffer = this.buffer.slice(index + this.replyClose.length);
          this.stage = 'between';
        } else {
          const safeLength = final ? this.buffer.length : Math.max(0, this.buffer.length - this.replyClose.length);
          if (safeLength) this.onReplyDelta(this.buffer.slice(0, safeLength));
          this.buffer = this.buffer.slice(safeLength);
          return;
        }
      } else if (this.stage === 'between') {
        const index = this.buffer.indexOf(this.taskOpen);
        if (index < 0) {
          if (final) throw new Error('AI response did not include task data.');
          this.buffer = this.buffer.slice(-this.taskOpen.length);
          return;
        }
        this.buffer = this.buffer.slice(index + this.taskOpen.length);
        this.stage = 'task';
      } else if (this.stage === 'task') {
        const index = this.buffer.indexOf(this.taskClose);
        if (index >= 0) {
          this.taskText += this.buffer.slice(0, index);
          this.buffer = this.buffer.slice(index + this.taskClose.length);
          this.stage = 'done';
        } else {
          const safeLength = final ? this.buffer.length : Math.max(0, this.buffer.length - this.taskClose.length);
          this.taskText += this.buffer.slice(0, safeLength);
          this.buffer = this.buffer.slice(safeLength);
          return;
        }
      } else {
        this.buffer = '';
      }
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

  try {
    const response = await fetch(MODEL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: 'system', content: systemPrompt(actor, currentDraft, workspaceContext) },
          ...messages,
        ],
        temperature: 0,
        max_tokens: 1024,
        stream: true,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: timeout.signal,
    });
    if (!response.ok || !response.body) throw new Error('AI model is unavailable.');

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
    return { raw: parser.finish(), reply };
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
    missingFields: [...new Set(missingFields)],
    complete: intent === 'TASK' && missingFields.length === 0 && Boolean(workStartAt && workEndAt),
    workStartAt,
    workEndAt,
  };
};

const createConfirmationDraft = async (actor: AuthUser, extraction: ReturnType<typeof normalizeExtraction>) => {
  if (!actor.organization || !extraction.workStartAt || !extraction.workEndAt || extraction.point === null) {
    throw badRequest('AI task data is incomplete.');
  }
  await AiTaskDraftModel.updateMany(
    { user: actor.id, status: 'PENDING' },
    { $set: { status: 'EXPIRED' } },
  );
  return AiTaskDraftModel.create({
    token: randomUUID(),
    user: actor.id,
    organization: actor.organization,
    department: actor.department,
    payload: {
      title: extraction.title,
      description: extraction.description,
      workStartAt: extraction.workStartAt,
      workEndAt: extraction.workEndAt,
      declaredPoint: extraction.point,
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
      assigneeId: actor.id,
    });
    declarationId = String((created as any).data?._id ?? '');
    let result = created;
    let submissionError: string | null = null;
    if (actor.role.code === 'SPECIALIST') {
      try {
        result = await submitWorkDeclarationService(actor, declarationId, {});
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
  if (!actor.organization) throw forbidden('User has no organization assigned.');
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
  if (extraction.complete) {
    const draft = await createConfirmationDraft(actor, extraction);
    confirmationToken = String((draft as any).token);
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
