# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Primary (this surface): Contracts & Planning HOD** at Vinayak Group, Kolkata. Reviews site requisitions raised by engineers, assigns ERP item codes, checks stock, approves or rejects, floats RFQs, compares vendor quotations and issues Work Orders. Works on a laptop in the office and in meetings, and approves from a tablet or phone on the move. Both are first-class.
- Other users, on the Expo app (not this surface): Site Engineer / QS, who raises requirements by voice, photo, document or text, and Vendor / Contractor, who answers RFQs and quotes.

## Product Purpose
AI procurement agent for Vinayak's SOP, from site requirement to vendor comparative to Work Order. AI extracts, normalises, matches and flags. A human always makes the final call.

Success means the HOD can see in seconds:
- what needs their decision
- what the AI is unsure about
- why a recommendation was made

Then they act with confidence.

## Positioning
Reads Vinayak's real, messy inputs and turns them into Vinayak's own formats, with uncertainty shown, never hidden or guessed:
- Bengali voice notes, handwritten scans
- BOQs with SQFT/SQM/RMT/CUM/CFT/NOS
- Duplicated ERP codes, four differently formatted vendor quotes

Those formats are WO codes, ERP item codes, the Comparative Statement and the Work Order.

## Operating Context
Vinayak's 12-step SOP:
- BOQ received and checked
- Tender docs
- Float to at least 3 vendors
- Comparative Statement
- Negotiation
- Management approval
- Vendor registration
- Work Order

Requisitions arrive in Bengali, Hindi or English. Live demo for Vinayak on 2026-11-21, on a laptop, a projector and a physical phone.

## Capabilities and Constraints
- Exactly two interfaces: the Expo app (engineer, vendor) and this HOD web. No vendor web portal.
- Human in the loop:
  - No RFQ is sent without HOD approval.
  - No alternative is accepted automatically.
  - No vendor is selected automatically, and never on price alone.
- Missing specs, quantities or units are null, flagged and given a clarification question. They are never guessed.
- No email is ever sent. RFQs, messages and work orders reach vendors as in-app notifications only.
- Vendor past performance, stock levels, vendor categories and two of five projects are dummy or inferred. They must be labelled in the UI.
- Simulated integrations (polling as real-time, WO print view) are labelled.
- Client data pack is confidential: never shown in committed code or mocks.
- Terminology: Requisition, BOQ line, WO code, ERP item code, Comparative Statement, Work Order (never "PO").

## Brand Commitments
- Vinayak Group identity, from the public site vinayakgroup.org (approved by the user for this client demo).
- Logo: red wordmark "VINAYAK" with tagline "SOCH APNEPAN KI", at `web/public/brand/vinayak-logo.webp`.
- Crimson red #CE181E as the brand colour, on white, with charcoal text.

## Evidence on Hand
- Logo file above.
- Dummy seed data in `api/seed/dummy/` (users, vendors, projects, inventory).
- No testimonials, metrics or customer claims exist. Never fabricate them.

## Product Principles
1. The human decides. The UI makes the decision point obvious and never pre-empts it.
2. Uncertainty is visible. Low confidence, nulls and flags outrank decoration.
3. Vinayak's language, not generic procurement jargon.
4. Honest about simulation. Dummy and simulated data is always labelled.
5. Works on the go. Every decision can be made from a phone.

## Accessibility & Inclusion
- WCAG AA.
- English primary UI with Bengali and Hindi secondary labels for navigation, statuses and key actions. Translations need native-speaker review.
- Original-language source text (bn/hi) is displayed as-is, with correct script fonts.
