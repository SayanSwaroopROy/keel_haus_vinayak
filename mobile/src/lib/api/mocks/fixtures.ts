import type { AppNotification, Project, ReqItem, Requisition, User } from '../schemas';

// Invented demo data only. Nothing here comes from the client data pack.
// IDs follow the same scheme as web/src/lib/api/mocks/fixtures.ts so both apps show the same people.

export const uid = (group: number, index: number): string =>
  `00000000-0000-4000-8000-${String(group).padStart(6, '0')}${String(index).padStart(6, '0')}`;

export const MOCK_PROJECTS: Project[] = [
  { id: uid(1, 1), code: 'DEMO1', name: 'Demo Residency Phase 1' },
  { id: uid(1, 2), code: 'DEMO2', name: 'Demo Heights Phase 2' },
];

const ENGINEER_ONE = uid(2, 1);
const ENGINEER_TWO = uid(2, 2);

export const MOCK_USERS: User[] = [
  { id: ENGINEER_ONE, name: 'Site Engineer One (demo)', role: 'site_engineer', vendor_id: null, project_ids: [MOCK_PROJECTS[0].id] },
  { id: ENGINEER_TWO, name: 'Site Engineer Two (demo)', role: 'site_engineer', vendor_id: null, project_ids: [MOCK_PROJECTS[1].id] },
  { id: uid(3, 1), name: 'HOD Contracts (demo)', role: 'hod', vendor_id: null, project_ids: [MOCK_PROJECTS[0].id, MOCK_PROJECTS[1].id] },
  { id: uid(3, 2), name: 'Management Approver (demo)', role: 'management', vendor_id: null, project_ids: [MOCK_PROJECTS[0].id, MOCK_PROJECTS[1].id] },
  { id: uid(4, 3), name: 'Paving & Roads Co (demo)', role: 'vendor', vendor_id: uid(50, 3), project_ids: [] },
  { id: uid(4, 4), name: 'Roadline Infra (demo)', role: 'vendor', vendor_id: uid(50, 4), project_ids: [] },
  { id: uid(4, 5), name: 'Metro Civil Works (demo)', role: 'vendor', vendor_id: uid(50, 5), project_ids: [] },
];

export function item(overrides: Partial<ReqItem> & Pick<ReqItem, 'id' | 'description'>): ReqItem {
  return {
    kind: 'material',
    wo_code: null,
    item_code: null,
    category: null,
    spec: null,
    brand: null,
    uom: null,
    quantity: null,
    original_qty: null,
    original_uom: null,
    extra_pct: null,
    location_breakdown: null,
    remarks: null,
    confidence: 0.9,
    uncertain_fields: [],
    clarification_question: null,
    source_ref: null,
    new_code_suggestion: null,
    duplicate_of: [],
    ...overrides,
  };
}

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

export function seedRequisitions(): Requisition[] {
  return [
    {
      id: uid(60, 1),
      project_id: MOCK_PROJECTS[0].id,
      raised_by: ENGINEER_ONE,
      input_type: 'voice',
      original_lang: 'bn',
      source_file_id: uid(61, 1),
      status: 'PENDING_CONFIRMATION',
      revision: 1,
      confirmed_at: null,
      created_at: hoursAgo(0.4),
      items: [
        item({
          id: uid(62, 1),
          kind: 'work',
          wo_code: 'WO-DM1-WP-01',
          description: 'Waterproofing of toilet sunken slab, cementitious coating',
          category: 'Waterproofing',
          uom: 'SQFT',
          quantity: 1240,
          confidence: 0.86,
          source_ref: '00:04–00:19',
        }),
        item({
          id: uid(62, 2),
          description: 'Coarse sand, Zone II',
          category: 'Sand & Aggregates',
          uom: 'CFT',
          quantity: 300,
          original_qty: 8.5,
          original_uom: 'CUM',
          confidence: 0.81,
          remarks: 'Spoken as 8.5 cubic metre; converted to CFT (×35.31).',
          source_ref: '00:20–00:31',
        }),
        item({
          id: uid(62, 3),
          description: 'PPC cement',
          category: 'Cement',
          uom: 'BAG',
          quantity: null,
          brand: null,
          confidence: 0.42,
          uncertain_fields: ['quantity', 'brand'],
          clarification_question: 'How many bags of PPC cement, and which brand?',
          source_ref: '00:32–00:40',
        }),
      ],
    },
    {
      id: uid(60, 2),
      project_id: MOCK_PROJECTS[0].id,
      raised_by: ENGINEER_ONE,
      input_type: 'text',
      original_lang: 'en',
      source_file_id: null,
      status: 'PENDING_APPROVAL',
      revision: 2,
      confirmed_at: hoursAgo(5),
      created_at: hoursAgo(6),
      items: [
        item({ id: uid(62, 4), description: 'TMT bar Fe500D, 12 mm', category: 'Iron Rods', uom: 'MT', quantity: 4.5, confidence: 0.95 }),
        item({ id: uid(62, 5), description: 'Binding wire, 18 gauge', category: 'Iron Rods', uom: 'KG', quantity: 60, confidence: 0.93 }),
      ],
    },
    {
      id: uid(60, 3),
      project_id: MOCK_PROJECTS[0].id,
      raised_by: ENGINEER_ONE,
      input_type: 'image',
      original_lang: 'en',
      source_file_id: uid(61, 3),
      status: 'APPROVED',
      revision: 1,
      confirmed_at: hoursAgo(28),
      created_at: hoursAgo(30),
      items: [
        item({ id: uid(62, 6), kind: 'work', wo_code: 'WO-DM1-PL-02', description: 'Internal wall plaster, 12 mm, 1:6', category: 'Plaster', uom: 'SQFT', quantity: 5600, confidence: 0.9 }),
      ],
    },
    {
      id: uid(60, 4),
      project_id: MOCK_PROJECTS[0].id,
      raised_by: ENGINEER_ONE,
      input_type: 'pdf',
      original_lang: 'en',
      source_file_id: uid(61, 4),
      status: 'CLARIFICATION_REQUIRED',
      revision: 1,
      confirmed_at: hoursAgo(50),
      created_at: hoursAgo(52),
      items: [
        item({ id: uid(62, 7), kind: 'work', wo_code: 'WO-DM1-RD-04', description: 'Paver block laying, 80 mm, M30', category: 'Road / Civil', uom: 'SQM', quantity: 420, confidence: 0.88 }),
      ],
    },
    {
      id: uid(60, 5),
      project_id: MOCK_PROJECTS[1].id,
      raised_by: ENGINEER_TWO,
      input_type: 'xlsx',
      original_lang: 'en',
      source_file_id: uid(61, 5),
      status: 'PENDING_APPROVAL',
      revision: 1,
      confirmed_at: hoursAgo(3),
      created_at: hoursAgo(4),
      items: [
        item({ id: uid(62, 8), kind: 'work', wo_code: 'WO-DM2-RD-05', description: 'Precast kerb, 300×150×450', category: 'Road / Civil', uom: 'RMT', quantity: 180, confidence: 0.92 }),
      ],
    },
  ];
}

export function seedNotifications(): Record<string, AppNotification[]> {
  return {
    [ENGINEER_ONE]: [
      {
        id: uid(70, 1),
        type: 'requisition_decided',
        ref_type: 'requisition',
        ref_id: uid(60, 4),
        title: 'HOD asked for clarification on the paver block requisition',
        created_at: hoursAgo(26),
        read_at: null,
      },
      {
        id: uid(70, 2),
        type: 'requisition_decided',
        ref_type: 'requisition',
        ref_id: uid(60, 3),
        title: 'Wall plaster requisition approved',
        created_at: hoursAgo(27),
        read_at: hoursAgo(20),
      },
    ],
  };
}
