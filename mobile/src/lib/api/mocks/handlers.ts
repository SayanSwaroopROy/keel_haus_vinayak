import { getUserId } from '@/lib/identity';

import { ApiError } from '../errors';
import type {
  AppNotification,
  IngestJob,
  InputType,
  Project,
  Readback,
  ReqItem,
  Requisition,
  Revision,
  Uom,
  User,
} from '../schemas';
import { UomSchema } from '../schemas';
import { item, MOCK_PROJECTS, MOCK_USERS, seedNotifications, seedRequisitions, uid } from './fixtures';

// In-memory stand-in for the Phase 2 backend. It resets when the app reloads.
// It never pretends to understand language: text it cannot parse stays null and is flagged.

const LATENCY_MS = 350;
const STEP_MS = 1_100;

type JobRecord = {
  job: IngestJob;
  startedAt: number;
  projectId: string;
  inputType: InputType;
  text: string | null;
  ownerId: string;
};

const store = {
  requisitions: seedRequisitions(),
  revisions: new Map<string, Revision[]>(),
  notifications: seedNotifications(),
  jobs: new Map<string, JobRecord>(),
  counter: 0,
};

function nextId(group: number): string {
  store.counter += 1;
  return uid(group, 900_000 + store.counter);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function delay(ms = LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentUser(): User {
  const userId = getUserId();
  const user = MOCK_USERS.find((candidate) => candidate.id === userId);
  if (!user) throw new ApiError(401, 'unauthorized', 'Unknown X-User-Id.');
  return user;
}

function ownRequisition(id: string): Requisition {
  const user = currentUser();
  const requisition = store.requisitions.find((candidate) => candidate.id === id);
  if (!requisition) throw new ApiError(404, 'not_found', 'Requisition not found.');
  if (user.role === 'site_engineer' && requisition.raised_by !== user.id) {
    throw new ApiError(403, 'forbidden', "This is another engineer's requisition.");
  }
  return requisition;
}

function recordRevision(requisition: Requisition, actor: string, changeNote: string): void {
  const history = store.revisions.get(requisition.id) ?? [];
  history.push({
    version: requisition.revision,
    actor,
    change_note: changeNote,
    items: clone(requisition.items),
    created_at: new Date().toISOString(),
  });
  store.revisions.set(requisition.id, history);
}

function replaceRequisition(next: Requisition): Requisition {
  store.requisitions = store.requisitions.map((candidate) => (candidate.id === next.id ? next : candidate));
  return clone(next);
}

const QTY_UNIT = /(\d+(?:\.\d+)?)\s*(sqft|sq\.?\s?ft|sqm|sq\.?\s?m|rmt|cum|cft|nos|bags?|kg|mt|ltr|litres?)\b/i;

const UNIT_ALIASES: Record<string, Uom> = {
  sqft: 'SQFT',
  'sq ft': 'SQFT',
  'sq.ft': 'SQFT',
  sqm: 'SQM',
  'sq m': 'SQM',
  'sq.m': 'SQM',
  rmt: 'RMT',
  cum: 'CUM',
  cft: 'CFT',
  nos: 'NOS',
  bag: 'BAG',
  bags: 'BAG',
  kg: 'KG',
  mt: 'MT',
  ltr: 'LTR',
  litre: 'LTR',
  litres: 'LTR',
};

function toUom(raw: string): Uom | null {
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  const alias = UNIT_ALIASES[key];
  if (alias) return alias;
  const parsed = UomSchema.safeParse(key.toUpperCase());
  return parsed.success ? parsed.data : null;
}

function itemFromLine(line: string): ReqItem {
  const match = QTY_UNIT.exec(line);
  const quantity = match ? Number(match[1]) : null;
  const uom = match ? toUom(match[2]) : null;
  const description = line.replace(QTY_UNIT, '').replace(/[-–:,]+\s*$/, '').trim() || line.trim();
  const uncertain = [quantity === null ? 'quantity' : null, uom === null ? 'uom' : null].filter(
    (field): field is string => field !== null,
  );
  return item({
    id: nextId(62),
    description,
    quantity,
    uom,
    confidence: uncertain.length === 0 ? 0.8 : 0.4,
    uncertain_fields: uncertain,
    clarification_question: uncertain.length === 0 ? null : `What quantity and unit are needed for "${description}"?`,
    source_ref: line.trim(),
  });
}

function itemsFromText(text: string): ReqItem[] {
  return text
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter((line) => line.length > 2)
    .slice(0, 25)
    .map(itemFromLine);
}

function cannedItemsForFile(): ReqItem[] {
  return [
    item({
      id: nextId(62),
      kind: 'work',
      wo_code: 'WO-DM1-WP-02',
      description: 'Cementitious waterproof coating, toilets (mock extraction)',
      category: 'Waterproofing',
      uom: 'SQFT',
      quantity: 860,
      confidence: 0.84,
    }),
    item({
      id: nextId(62),
      description: 'Integral waterproofing admixture, powder (mock extraction)',
      category: 'Waterproofing',
      uom: 'KG',
      quantity: null,
      confidence: 0.38,
      uncertain_fields: ['quantity'],
      clarification_question: 'How many kg of admixture are needed?',
    }),
  ];
}

const STEPS: IngestJob['step'][] = ['validate', 'detect', 'extract', 'lang', 'llm', 'normalise', 'done'];

function advanceJob(record: JobRecord): IngestJob {
  if (record.job.status === 'DONE' || record.job.status === 'FAILED') return record.job;
  const stepIndex = Math.min(Math.floor((Date.now() - record.startedAt) / STEP_MS), STEPS.length - 1);
  const step = STEPS[stepIndex];
  if (step !== 'done') {
    record.job = { ...record.job, status: 'RUNNING', step, detected_lang: stepIndex >= 3 ? 'en' : null };
    return record.job;
  }

  const items = record.text ? itemsFromText(record.text) : cannedItemsForFile();
  if (items.length === 0) {
    record.job = { ...record.job, status: 'FAILED', step: 'llm', error: 'No requirement lines were found in the text.' };
    return record.job;
  }

  const requisition: Requisition = {
    id: nextId(60),
    project_id: record.projectId,
    raised_by: record.ownerId,
    input_type: record.inputType,
    original_lang: 'en',
    source_file_id: record.text ? null : nextId(61),
    status: 'PENDING_CONFIRMATION',
    revision: 1,
    confirmed_at: null,
    created_at: new Date().toISOString(),
    items,
  };
  store.requisitions = [requisition, ...store.requisitions];
  recordRevision(requisition, 'ai', 'Original AI extraction');
  record.job = { ...record.job, status: 'DONE', step: 'done', detected_lang: 'en', requisition_id: requisition.id };
  return record.job;
}

function startJob(projectId: string, inputType: InputType, text: string | null): IngestJob {
  const user = currentUser();
  if (user.role !== 'site_engineer' && user.role !== 'hod') throw new ApiError(403, 'forbidden', 'Only engineers raise requisitions.');
  if (!MOCK_PROJECTS.some((project) => project.id === projectId)) throw new ApiError(422, 'validation_error', 'Unknown project.');
  const job: IngestJob = { id: nextId(80), status: 'QUEUED', step: 'validate', detected_lang: null, error: null, requisition_id: null };
  store.jobs.set(job.id, { job, startedAt: Date.now(), projectId, inputType, text, ownerId: user.id });
  return job;
}

export const mockHandlers = {
  async listUsers(role?: User['role']): Promise<User[]> {
    await delay();
    return MOCK_USERS.filter((user) => role === undefined || user.role === role);
  },

  async me(): Promise<User> {
    await delay();
    return currentUser();
  },

  async listProjects(): Promise<Project[]> {
    await delay();
    currentUser();
    return MOCK_PROJECTS;
  },

  async listNotifications(): Promise<AppNotification[]> {
    await delay(200);
    const user = currentUser();
    return clone(store.notifications[user.id] ?? []);
  },

  async markNotificationRead(id: string): Promise<void> {
    await delay(150);
    const user = currentUser();
    const list = store.notifications[user.id] ?? [];
    store.notifications[user.id] = list.map((notification) =>
      notification.id === id && notification.read_at === null
        ? { ...notification, read_at: new Date().toISOString() }
        : notification,
    );
  },

  async ingestFile(projectId: string, inputType: InputType): Promise<IngestJob> {
    await delay(900);
    return startJob(projectId, inputType, null);
  },

  async createTextRequisition(projectId: string, text: string): Promise<IngestJob> {
    await delay();
    return startJob(projectId, 'text', text);
  },

  async getIngestJob(jobId: string): Promise<IngestJob> {
    await delay(150);
    const record = store.jobs.get(jobId);
    if (!record) throw new ApiError(404, 'not_found', 'Ingest job not found.');
    return clone(advanceJob(record));
  },

  async listRequisitions(): Promise<Requisition[]> {
    await delay();
    const user = currentUser();
    const visible = user.role === 'site_engineer'
      ? store.requisitions.filter((requisition) => requisition.raised_by === user.id)
      : store.requisitions;
    return clone(visible);
  },

  async getRequisition(id: string): Promise<Requisition> {
    await delay();
    return clone(ownRequisition(id));
  },

  async listRevisions(id: string): Promise<Revision[]> {
    await delay();
    ownRequisition(id);
    return clone(store.revisions.get(id) ?? []);
  },

  async readback(id: string): Promise<Readback> {
    await delay(700);
    const requisition = ownRequisition(id);
    const lines = requisition.items.map((line, index) => {
      const quantity = line.quantity === null ? 'quantity not known' : `${line.quantity} ${line.uom ?? 'unit not known'}`;
      return `${index + 1}. ${line.description}, ${quantity}.`;
    });
    return {
      text: `You asked for ${requisition.items.length} item${requisition.items.length === 1 ? '' : 's'}. ${lines.join(' ')} Is this correct?`,
      lang: requisition.original_lang,
      audio_url: null,
    };
  },

  async correct(id: string, text: string): Promise<Requisition> {
    await delay(900);
    const requisition = ownRequisition(id);
    if (requisition.status !== 'PENDING_CONFIRMATION' && requisition.status !== 'CLARIFICATION_REQUIRED') {
      throw new ApiError(409, 'invalid_transition', 'This requisition can no longer be corrected.');
    }
    const match = QTY_UNIT.exec(text);
    const uncertainItems = requisition.items.filter((line) => line.uncertain_fields.includes('quantity'));
    const items = requisition.items.map((line) => {
      if (!match || uncertainItems.length !== 1 || line.id !== uncertainItems[0].id) return line;
      const uom = toUom(match[2]) ?? line.uom;
      const remaining = line.uncertain_fields.filter((field) => field !== 'quantity' && !(field === 'uom' && uom !== null));
      return {
        ...line,
        quantity: Number(match[1]),
        uom,
        uncertain_fields: remaining,
        clarification_question: remaining.length === 0 ? null : line.clarification_question,
        confidence: remaining.length === 0 ? 0.8 : line.confidence,
      };
    });
    const next: Requisition = { ...requisition, items, revision: requisition.revision + 1, status: 'PENDING_CONFIRMATION' };
    recordRevision(next, 'user', `Correction: ${text}`);
    return replaceRequisition(next);
  },

  // The mock cannot hear. It records the correction and leaves items unchanged, so nothing is guessed.
  async correctByVoice(id: string): Promise<Requisition> {
    await delay(900);
    const requisition = ownRequisition(id);
    if (requisition.status !== 'PENDING_CONFIRMATION' && requisition.status !== 'CLARIFICATION_REQUIRED') {
      throw new ApiError(409, 'invalid_transition', 'This requisition can no longer be corrected.');
    }
    const next: Requisition = { ...requisition, revision: requisition.revision + 1, status: 'PENDING_CONFIRMATION' };
    recordRevision(next, 'user', 'Voice correction (simulated: the mock does not interpret speech)');
    return replaceRequisition(next);
  },

  async editItem(id: string, itemId: string, patch: Partial<ReqItem>): Promise<Requisition> {
    await delay();
    const requisition = ownRequisition(id);
    if (requisition.status !== 'PENDING_CONFIRMATION' && requisition.status !== 'CLARIFICATION_REQUIRED') {
      throw new ApiError(409, 'invalid_transition', 'This requisition can no longer be edited.');
    }
    const items = requisition.items.map((line) => {
      if (line.id !== itemId) return line;
      const merged: ReqItem = { ...line, ...patch, id: line.id };
      const remaining = merged.uncertain_fields.filter((field) => {
        const value = merged[field as keyof ReqItem];
        return value === null || value === undefined || value === '';
      });
      return {
        ...merged,
        uncertain_fields: remaining,
        clarification_question: remaining.length === 0 ? null : merged.clarification_question,
        confidence: remaining.length === 0 ? Math.max(merged.confidence, 0.9) : merged.confidence,
      };
    });
    if (!items.some((line) => line.id === itemId)) throw new ApiError(404, 'not_found', 'Item not found.');
    const next: Requisition = { ...requisition, items, revision: requisition.revision + 1 };
    recordRevision(next, 'user', 'Manual edit');
    return replaceRequisition(next);
  },

  async confirm(id: string): Promise<Requisition> {
    await delay(600);
    const requisition = ownRequisition(id);
    if (requisition.status !== 'PENDING_CONFIRMATION') {
      throw new ApiError(409, 'invalid_transition', 'Only a requisition waiting for your confirmation can be confirmed.');
    }
    const unsure = requisition.items.filter((line) => line.uncertain_fields.length > 0);
    if (unsure.length > 0) {
      throw new ApiError(409, 'conflict', `${unsure.length} item${unsure.length === 1 ? ' is' : 's are'} still uncertain.`, unsure.map((line) => line.id));
    }
    const next: Requisition = { ...requisition, status: 'PENDING_APPROVAL', confirmed_at: new Date().toISOString() };
    return replaceRequisition(next);
  },
};
