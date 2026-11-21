import type {
  CodeMatch,
  InventoryRow,
  Project,
  ReqItem,
  Requisition,
  Revision,
  Vendor,
} from "./types";

// Invented demo data only. Nothing here comes from the client data pack.

export const RFQ_TEST_INBOX_LABEL = "rfq-test-inbox@example.invalid";

const uid = (group: number, index: number): string =>
  `00000000-0000-4000-8000-${String(group).padStart(6, "0")}${String(index).padStart(6, "0")}`;

export const MOCK_PROJECTS: Project[] = [
  { id: uid(1, 1), code: "DEMO1", name: "Demo Residency Phase 1" },
  { id: uid(1, 2), code: "DEMO2", name: "Demo Heights Phase 2" },
];

export const MOCK_PEOPLE: Record<string, string> = {
  [uid(2, 1)]: "Site Engineer One (demo)",
  [uid(2, 2)]: "Site Engineer Two (demo)",
};

const daysAgo = (days: number, hour = 10): string => {
  const date = new Date(Date.UTC(2026, 10, 21, hour, 0, 0));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};

const baseItem = {
  wo_code: null,
  item_code: null,
  category: null,
  spec: null,
  brand: null,
  original_qty: null,
  original_uom: null,
  extra_pct: null,
  location_breakdown: null,
  remarks: null,
  uncertain_fields: [],
  clarification_question: null,
  source_ref: null,
  new_code_suggestion: null,
  duplicate_of: [],
} satisfies Partial<ReqItem>;

const item = (fields: Partial<ReqItem> & Pick<ReqItem, "id" | "kind" | "description" | "uom" | "quantity" | "confidence">): ReqItem => ({
  ...baseItem,
  ...fields,
});

const roofItems: ReqItem[] = [
  item({
    id: uid(10, 1),
    kind: "work",
    wo_code: "WO-DM1-WP-01",
    description: "Brickbat coba waterproofing to main roof with IPS finish",
    category: "Waterproofing",
    spec: "Average 100 mm thick, slope 1:100 towards rainwater outlets",
    uom: "SQFT",
    quantity: 4200,
    original_qty: 390.2,
    original_uom: "SQM",
    remarks: "Tower A roof, after parapet plaster",
    confidence: 0.93,
    source_ref: "voice 00:12–00:31",
    item_code: "WP.01.1",
  }),
  item({
    id: uid(10, 2),
    kind: "work",
    wo_code: "WO-DM1-WP-02",
    description: "Polymer-modified cementitious coating to toilet sunken slabs",
    category: "Waterproofing",
    spec: "Two coats, 1.5 mm total, 150 mm upturn on walls",
    uom: "SQFT",
    quantity: null,
    confidence: 0.58,
    uncertain_fields: ["quantity"],
    clarification_question: "The toilet sunken area was not measured. What is the total area in SQFT?",
    source_ref: "voice 00:32–00:51",
    duplicate_of: [
      {
        code: "WP.02.3",
        description: "Cementitious waterproof coating, toilets",
        reason: "Same work, different code in ERP",
      },
    ],
  }),
  item({
    id: uid(10, 3),
    kind: "material",
    description: "Cement",
    category: "Cement",
    spec: "PPC, 50 kg bags",
    uom: "BAG",
    quantity: 320,
    confidence: 0.9,
    item_code: "CM.01.1",
    source_ref: "voice 00:52–01:02",
  }),
  item({
    id: uid(10, 4),
    kind: "material",
    description: "Sand",
    category: "Sand & Aggregates",
    spec: "Coarse river sand, Zone II",
    uom: "CFT",
    quantity: 900,
    confidence: 0.86,
    source_ref: "voice 01:03–01:10",
  }),
  item({
    id: uid(10, 5),
    kind: "material",
    description: "Integral waterproofing compound",
    category: "Waterproofing",
    brand: "BrandX Coat",
    uom: null,
    quantity: 150,
    original_qty: 150,
    original_uom: "packet",
    confidence: 0.52,
    uncertain_fields: ["uom"],
    clarification_question: "The engineer said \"150 packet\". Is that 150 kg, or 150 packets of a fixed size?",
    source_ref: "voice 01:11–01:20",
  }),
];

const roadItems: ReqItem[] = [
  item({
    id: uid(11, 1),
    kind: "material",
    wo_code: "WO-DM2-RD-04",
    description: "Paver Block 60mm",
    category: "Road / Civil",
    spec: "M-30 grey, zig-zag pattern",
    uom: "SQM",
    quantity: 650,
    extra_pct: 3,
    confidence: 0.88,
    item_code: "RD.04.2",
    source_ref: "photo, line 1",
  }),
  item({
    id: uid(11, 2),
    kind: "material",
    wo_code: "WO-DM2-RD-05",
    description: "Precast Kerb Stone",
    category: "Road / Civil",
    spec: "300 x 150 x 450 mm",
    uom: "NOS",
    quantity: 180,
    confidence: 0.81,
    source_ref: "photo, line 2",
  }),
  item({
    id: uid(11, 3),
    kind: "material",
    wo_code: "WO-DM2-RD-06",
    description: "Stone Dust",
    category: "Sand & Aggregates",
    uom: "CFT",
    quantity: 1200,
    confidence: 0.74,
    uncertain_fields: ["spec"],
    clarification_question: "Handwriting is unclear for the grade. Is it bedding-grade stone dust?",
    source_ref: "photo, line 3",
  }),
];

const plasterItems: ReqItem[] = [
  item({
    id: uid(12, 1),
    kind: "material",
    description: "Stucco Plaster",
    category: "Cement",
    uom: "BAG",
    quantity: 400,
    confidence: 0.95,
    item_code: "PL.01.1",
    source_ref: "page 1, row 4",
  }),
  item({
    id: uid(12, 2),
    kind: "work",
    wo_code: "WO-DM1-PL-02",
    description: "External sand-faced plaster, 20 mm, two coats",
    uom: "SQFT",
    quantity: 18500,
    confidence: 0.91,
    item_code: "PL.02.1",
    source_ref: "page 1, row 5",
  }),
];

export const MOCK_REQUISITIONS: Requisition[] = [
  {
    id: uid(20, 142),
    project_id: MOCK_PROJECTS[0].id,
    raised_by: uid(2, 1),
    input_type: "voice",
    original_lang: "bn",
    source_file_id: uid(30, 1),
    status: "PENDING_APPROVAL",
    items: roofItems,
    revision: 2,
    confirmed_at: daysAgo(0, 8),
    created_at: daysAgo(0, 7),
  },
  {
    id: uid(20, 139),
    project_id: MOCK_PROJECTS[1].id,
    raised_by: uid(2, 2),
    input_type: "image",
    original_lang: "hi",
    source_file_id: uid(30, 2),
    status: "PENDING_APPROVAL",
    items: roadItems,
    revision: 1,
    confirmed_at: daysAgo(1, 15),
    created_at: daysAgo(1, 14),
  },
  {
    id: uid(20, 137),
    project_id: MOCK_PROJECTS[0].id,
    raised_by: uid(2, 1),
    input_type: "pdf",
    original_lang: "en",
    source_file_id: uid(30, 3),
    status: "PENDING_APPROVAL",
    items: plasterItems,
    revision: 1,
    confirmed_at: daysAgo(3, 11),
    created_at: daysAgo(3, 10),
  },
  {
    id: uid(20, 131),
    project_id: MOCK_PROJECTS[1].id,
    raised_by: uid(2, 2),
    input_type: "csv",
    original_lang: "en",
    source_file_id: uid(30, 4),
    status: "APPROVED",
    items: [
      item({
        id: uid(13, 1),
        kind: "material",
        description: "Cement",
        uom: "BAG",
        quantity: 200,
        confidence: 0.97,
        item_code: "CM.01.1",
      }),
    ],
    revision: 1,
    confirmed_at: daysAgo(5),
    created_at: daysAgo(5, 9),
  },
  {
    id: uid(20, 128),
    project_id: MOCK_PROJECTS[0].id,
    raised_by: uid(2, 1),
    input_type: "text",
    original_lang: "bn",
    source_file_id: null,
    status: "CLARIFICATION_REQUIRED",
    items: [
      item({
        id: uid(14, 1),
        kind: "material",
        description: "Sand",
        uom: "CFT",
        quantity: 600,
        confidence: 0.84,
      }),
    ],
    revision: 1,
    confirmed_at: daysAgo(6),
    created_at: daysAgo(6, 9),
  },
  {
    id: uid(20, 144),
    project_id: MOCK_PROJECTS[1].id,
    raised_by: uid(2, 2),
    input_type: "voice",
    original_lang: "hi",
    source_file_id: uid(30, 5),
    status: "PENDING_CONFIRMATION",
    items: [
      item({
        id: uid(15, 1),
        kind: "material",
        description: "Precast Kerb Stone",
        uom: "NOS",
        quantity: 60,
        confidence: 0.79,
      }),
    ],
    revision: 1,
    confirmed_at: null,
    created_at: daysAgo(0, 9),
  },
  {
    id: uid(20, 120),
    project_id: MOCK_PROJECTS[0].id,
    raised_by: uid(2, 1),
    input_type: "docx",
    original_lang: "en",
    source_file_id: uid(30, 6),
    status: "REJECTED",
    items: [
      item({
        id: uid(16, 1),
        kind: "work",
        description: "Terrace garden membrane",
        uom: "SQM",
        quantity: 120,
        confidence: 0.9,
      }),
    ],
    revision: 1,
    confirmed_at: daysAgo(9),
    created_at: daysAgo(9, 9),
  },
];

export const MOCK_REVISIONS: Record<string, Revision[]> = {
  [uid(20, 142)]: [
    {
      version: 1,
      actor: "ai",
      change_note: "Original AI extraction from the Bengali voice note",
      items: roofItems.map((row) => (row.id === uid(10, 3) ? { ...row, quantity: 300 } : row)),
      created_at: daysAgo(0, 7),
    },
    {
      version: 2,
      actor: "user",
      change_note: "Engineer corrected cement from 300 to 320 bags by voice",
      items: roofItems,
      created_at: daysAgo(0, 8),
    },
  ],
};

export const MOCK_CODE_MATCHES: Record<string, CodeMatch[]> = {
  [uid(10, 2)]: [
    { code: "WP.02.1", description: "Polymer cementitious coating, sunken slab", score: 0.94 },
    { code: "WP.02.3", description: "Cementitious waterproof coating, toilets", score: 0.93 },
    { code: "WP.02.4", description: "Crystalline waterproofing, wet areas", score: 0.71 },
  ],
  [uid(10, 4)]: [
    { code: "SA.01.1", description: "Coarse sand, Zone II", score: 0.91 },
    { code: "SA.01.2", description: "Fine sand for plaster", score: 0.68 },
  ],
  [uid(10, 5)]: [{ code: "WP.05.1", description: "Integral waterproofing admixture, powder", score: 0.66 }],
  [uid(11, 2)]: [{ code: "RD.05.1", description: "Precast kerb, 300x150x450", score: 0.95 }],
  [uid(11, 3)]: [{ code: "SA.03.1", description: "Stone dust, bedding grade", score: 0.82 }],
};

export const MOCK_NEW_CODE_SUGGESTIONS: Record<string, string> = {
  [uid(10, 5)]: "WP.05.2",
};

const inventoryFor = (projectIndex: 0 | 1, start: number): InventoryRow[] => {
  const project = MOCK_PROJECTS[projectIndex].id;
  const rows: Array<[string, string, number, number]> = [
    ["Cement", "BAG", 5000, 1000],
    ["Sand", "CFT", 8000, 0],
    ["Stone Dust", "CFT", 0, 0],
    ["Paver Block 60mm", "SQM", 400, 100],
    ["Precast Kerb Stone", "NOS", 120, 20],
    ["Stucco Plaster", "BAG", 900, 150],
    ["Integral waterproofing compound", "KG", 40, 0],
  ];
  return rows.map(([material, uom, physical, reserved], index) => ({
    id: uid(40, start + index),
    project_id: project,
    material,
    uom,
    physical,
    reserved,
    available: physical - reserved,
    is_dummy: true,
  }));
};

export const MOCK_INVENTORY: InventoryRow[] = [...inventoryFor(0, 1), ...inventoryFor(1, 101)];

const vendorSeed: Array<[string, string[], string[], [number, number, number]]> = [
  ["Demo AquaSeal Works", ["Waterproofing"], ["BrandX Coat"], [4, 4, 1]],
  ["Demo DryGuard Contractors", ["Waterproofing"], ["BrandY Shield"], [3, 5, 2]],
  ["Demo Paving & Roads Co", ["Road / Civil"], [], [4, 3, 1]],
  ["Demo Roadline Infra", ["Road / Civil"], [], [5, 4, 1]],
  ["Demo Metro Civil Works", ["Road / Civil"], [], [3, 3, 3]],
  ["Demo Cement Traders", ["Cement"], ["Brand A", "Brand B"], [4, 5, 1]],
  ["Demo Bengal Cement Depot", ["Cement"], ["Brand B"], [5, 3, 2]],
  ["Demo Sand & Aggregates", ["Sand & Aggregates"], [], [3, 4, 1]],
  ["Demo Rod & Steel Supply", ["Iron Rods"], ["Brand S"], [4, 4, 2]],
  ["Demo Fasteners House", ["Fasteners"], [], [4, 5, 1]],
];

export const MOCK_VENDORS: Vendor[] = vendorSeed.map(([name, categories, brands, [quality, delivery, disputes]], index) => ({
  id: uid(50, index + 1),
  name,
  categories,
  category_source: "inferred",
  brands,
  status: "active",
  contact_email: RFQ_TEST_INBOX_LABEL,
  performance: { quality, delivery, disputes, n: 3, is_dummy: true },
}));

export const VENDOR_CATEGORIES = [
  "Waterproofing",
  "Road / Civil",
  "Cement",
  "Sand & Aggregates",
  "Iron Rods",
  "Fasteners",
  "Electrical",
  "Testing Lab",
] as const;

export const mockId = uid;
