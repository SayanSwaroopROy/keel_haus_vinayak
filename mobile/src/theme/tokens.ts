// Haal Khata (DESIGN.md) carried to the phone. Light only: engineers read this outdoors on site.
export const colors = {
  binding: '#C81E24',
  bindingDeep: '#7E1219',
  bindingForeground: '#FFFBFA',
  bindingMuted: '#F0CFCB',
  ink: '#22252A',
  paper: '#FFFFFF',
  ledger: '#FBFAF9',
  rule: '#E7E4E1',
  mutedInk: '#5E5752',
  unsure: '#B97A10',
  unsureSoft: '#FBF1D8',
  unsureInk: '#6E4410',
  settled: '#1F7A4D',
  settledSoft: '#E6F5EC',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  row: 12,
  gutter: 16,
  lg: 24,
  section: 40,
} as const;

export const radius = {
  sm: 4,
  md: 5,
  lg: 6,
  full: 9999,
} as const;

export const type = {
  wordmark: { fontSize: 20, fontWeight: '500', letterSpacing: 4.4 },
  pageTitle: { fontSize: 24, fontWeight: '500', lineHeight: 30 },
  sectionTitle: { fontSize: 18, fontWeight: '500', lineHeight: 25 },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 23 },
  meta: { fontSize: 14, fontWeight: '400', lineHeight: 19 },
  script: { fontSize: 13, fontWeight: '400', lineHeight: 17 },
  figure: { fontSize: 20, fontWeight: '500', lineHeight: 24, fontVariant: ['tabular-nums'] },
} as const;

export const TAP_TARGET = 48;
