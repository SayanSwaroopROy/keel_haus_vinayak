---
name: Vinayak Procurement · HOD
description: Haal Khata. Vinayak crimson binding on white ledger stock; every requisition is an account the HOD settles.
colors:
  binding: "oklch(0.55 0.21 26)"
  binding-deep: "oklch(0.38 0.15 24)"
  binding-foreground: "oklch(0.99 0.005 30)"
  binding-muted: "oklch(0.88 0.05 25)"
  ink: "oklch(0.25 0.008 260)"
  paper: "oklch(1 0 0)"
  ledger: "oklch(0.985 0.003 60)"
  rule: "oklch(0.92 0.008 60)"
  muted-ink: "oklch(0.47 0.012 50)"
  unsure: "oklch(0.62 0.15 70)"
  unsure-soft: "oklch(0.96 0.045 85)"
  unsure-ink: "oklch(0.42 0.1 60)"
  settled: "oklch(0.48 0.11 155)"
  settled-soft: "oklch(0.96 0.03 155)"
typography:
  page-title:
    fontFamily: "Roboto, Noto Sans Bengali, Noto Sans Devanagari, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1.25
  section-title:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.4
  body:
    fontFamily: "Roboto, Noto Sans Bengali, Noto Sans Devanagari, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  figure:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.2
  secondary-script:
    fontFamily: "Noto Sans Bengali, Noto Sans Devanagari, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 400
    lineHeight: 1.25
  wordmark:
    fontFamily: "Roboto, system-ui, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 500
    letterSpacing: "0.22em"
rounded:
  sm: "3.6px"
  md: "4.8px"
  lg: "6px"
  full: "9999px"
spacing:
  row: "12px"
  gutter-phone: "16px"
  gutter-laptop: "32px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.binding}"
    textColor: "{colors.binding-foreground}"
    rounded: "{rounded.lg}"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "36px"
  nav-rail:
    backgroundColor: "{colors.binding}"
    textColor: "{colors.binding-foreground}"
    width: "256px"
  nav-item-active:
    backgroundColor: "{colors.binding-deep}"
    textColor: "{colors.binding-foreground}"
    rounded: "{rounded.md}"
  badge-unsure:
    backgroundColor: "{colors.unsure-soft}"
    textColor: "{colors.unsure-ink}"
    rounded: "{rounded.sm}"
  badge-settled:
    backgroundColor: "{colors.settled-soft}"
    textColor: "{colors.settled}"
    rounded: "{rounded.sm}"
  badge-decision:
    backgroundColor: "{colors.binding}"
    textColor: "{colors.binding-foreground}"
    rounded: "{rounded.sm}"
---

# Design System: Vinayak Procurement · HOD

## Overview

**Creative North Star: "The Haal Khata"**

This is the red cloth-bound ledger a Bengali trader opens every Poila Baisakh, rendered as working software. Vinayak's crimson is the binding: it wraps the navigation and marks the accounts the HOD still has to settle. The page inside is plain white stock ruled with one-pixel hairlines, and every figure sits in tabular columns.

The world lends type, palette, density and one signature move. It never lends layout or controls. Navigation, tables, tabs, dialogs and toggles are standard web components that an HOD already knows. Uncertainty from the AI is always louder than decoration. Simulated data is always labelled, and always quieter than real signals.

**Key Characteristics:**
- Crimson binding rail as navigation, with the white text wordmark on it. The red-on-transparent logo appears only on white.
- Open accounts carry a crimson thread (a 1px cord with a knot) until the HOD signs them off.
- Decisions stamp a circular seal. Nothing disappears; it is approved, rejected or sent back.
- English first, with Bengali and Hindi as a quieter second line on navigation and statuses.
- Light only. The HOD works under office light and in daylight on a phone.

## Colors

The strategy is restrained: neutral stock and ink, one committed brand colour that does real jobs, and two state inks.

### Primary
- **Binding Crimson** (`binding`): Vinayak's brand red. Used for the nav rail, the primary action, the "Needs your decision" status and open-account threads. Nothing else.
- **Deep Binding** (`binding-deep`): the active nav item, and the confirm button inside a reject dialog.

### Neutral
- **Ledger Ink** (`ink`): all body text. A slightly cool charcoal, never pure black.
- **Paper** (`paper`) and **Ledger** (`ledger`): the page, and the hover/quiet-panel tint.
- **Rule** (`rule`): every hairline divider and table rule.
- **Muted Ink** (`muted-ink`): secondary text, at least 4.5:1 on paper.

### State inks
- **Turmeric** (`unsure`, `unsure-soft`, `unsure-ink`): AI is unsure, a value is not provided, or a question is open. It also tints the demo-data banner.
- **Leaf** (`settled`, `settled-soft`): approved, covered by stock, high confidence.

### Named Rules
**The Decision Rule.** Crimson means brand or "your decision now". A crimson element the HOD cannot act on, or that is not the brand, is a defect.

**The Honest Ink Rule.** Uncertainty is shown in turmeric and never hidden. Rejection reads as struck-through, never erased.

## Typography

Roboto is Vinayak's own web face. Noto Sans Bengali and Noto Sans Devanagari follow it in the stack, so original-language text and the secondary labels render in the correct script.

### Hierarchy
- **Page title** (500, 1.5rem): one per page, in the page header.
- **Section title** (500, 1.125rem): "Needs your decision", "Procurement ledger".
- **Body** (400, 0.875rem): rows, descriptions, dialogs.
- **Figure** (500, 1.25rem, tabular): ledger figures. Every quantity, rate and count uses tabular lining numerals, right-aligned, with the unit set smaller beside it.
- **Secondary script** (0.72rem, 75% opacity): the bn · hi line under English labels.
- **Wordmark** (500, 0.22em tracking): "VINAYAK" on crimson surfaces.

### Named Rules
**The Column Rule.** Numbers are figures, not decoration: tabular-nums, right-aligned, unit beside them. A null shows as "—" or "Not provided", never as 0.

## Layout

- Laptop: a 256px crimson rail plus the content column. The page header holds the title and the notification bell. Content gutters are 32px.
- Phone and tablet under 1024px: a crimson top bar (menu sheet, wordmark, bell). Gutters are 16px. Tap targets are at least 44px.
- Lists are ruled ledgers (`divide-y` hairlines between top and bottom rules), not card grids. Tables switch to stacked rows on phones.
- On the requisition page the decision bar sits inline under the header on laptop, and is fixed to the bottom on phone with the safe-area inset.
- Hierarchy on every working page: what needs a decision, then why it is waiting, then the evidence.

## Elevation & Depth

Flat by default. Depth comes only from component overlays (dialog, sheet, dropdown, toast) using their standard soft shadows. Sticky filter bars use a 95% paper background with a light backdrop blur, so rows scroll beneath them legibly.

## Shapes

The radius is small and consistent (`--radius` 0.375rem). Badges use `sm`. Buttons and inputs use `lg`. Full circles appear only on the thread knot, the unread dot and the decision seal.

## Components

### Buttons
- Primary is crimson, used for Approve and for the main action on a page.
- Outline is for secondary actions (Ask to clarify, Find ERP codes).
- Ghost is crimson text for Reject.
- Loading uses a Spinner icon plus `disabled`.

### Chips (Badges)
Status badges map to tones:
- decision: crimson
- settled: leaf
- waiting: turmeric
- void: outline, struck through

The `dummy` badge is dashed and muted. It labels simulated data without competing with real signals.

### Navigation
- Rail links show an icon, the English label, and a bn · hi line.
- The active link gets Deep Binding and `aria-current="page"`.
- The notification bell polls every 5 s and shows a count pip.

### Thread (signature)
A 16px gutter with a 1px vertical cord and an 8px knot. Crimson while the account is open (PENDING_APPROVAL), rule-grey once settled. It is never a thick coloured `border-left`.

### Decision Seal (signature)
A 112px double-ring circle, rotated −8°. It reads "VINAYAK · HOD", the decision word, the initials and the date. Tones: approved is leaf, rejected is crimson, clarify is turmeric. It stamps in once (scale 1.18 → 1 over 420ms, expo-out) and is static under reduced motion.

## Do's and Don'ts

### Do:
- **Do** lead every working page with what needs the HOD's decision.
- **Do** show AI uncertainty, null values and clarification questions in turmeric, next to the value they concern.
- **Do** label every simulated value (demo stock, demo vendor history, mocked endpoints) with the dashed `dummy` badge or the demo banner.
- **Do** set every number in tabular figures with its unit.
- **Do** require a note on every approve, reject or clarify decision.

### Don't:
- **Don't** use crimson for decoration, charts or emphasis that isn't a decision.
- **Don't** add kickers or eyebrows above headings.
- **Don't** add thick coloured side stripes. The thread is the only left-edge mark, and it is 1px.
- **Don't** auto-select, auto-approve or pre-tick any decision. The human decides.
- **Don't** render the red logo on a crimson surface. Use the white text wordmark there.
- **Don't** show a missing quantity as 0 or guess a unit.
