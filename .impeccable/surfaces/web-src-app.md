---
version: 1
slug: "web-src-app"
primary_target: "web/src/app"
related_targets: []
---

# HOD web (web/src/app)

Scope: Vinayak Procurement HOD dashboard, Phase 4: dashboard, requisitions list and detail, inventory, vendors. Visitor mode: **Operate**.

Audience and job: the Contracts & Planning HOD settles requisitions. Primary actions:
- see what awaits a decision
- understand AI uncertainty
- match ERP codes
- check stock
- approve, reject or clarify with a note

Used on laptop and on phone/tablet, both first-class.

Constraints:
- Human decides.
- Nulls are never guessed.
- Dummy data is labelled.
- en + bn/hi labels.
- Mocked endpoints are flagged by a banner.

## Direction contract
THESIS: Each requisition is a ledger account the HOD settles. Open accounts carry a crimson thread until signed off. Refuses the category default of a grey sidebar, a KPI card grid first and status chips everywhere.

OWN-WORLD: Haal Khata, the red cloth-bound Bengali trader's ledger.
- Shell: a deep crimson binding rail (Vinayak #CE181E → #8E0F14) on a white page with charcoal #212529 ink.
- Faint warm-grey rule tint, 1px hairlines, small consistent radius.
- Every number is in tabular figures, right-aligned, with its unit beside it.
- State inks: turmeric amber for "AI unsure", leaf green for settled, crimson only for brand and "your decision now".

STORY: The HOD opens to the accounts awaiting their signature, sees why each one is waiting (unsure fields, stock short, duplicate code, age) and opens one. They resolve the flags, then sign. The seal lands on the record and the thread is cut.

FIRST VIEWPORT:
- Laptop: crimson rail at left with logo, nav and bn/hi sublabels. Header with the page title and the notification bell. "Needs your decision" leads at full width: rows with a crimson thread on the left edge, requisition id, project, item count, reason chips and age, one "Review" action per row. The KPI strip sits below in a single row of tabular figures.
- Phone: crimson top bar with the logo and a menu sheet. The decision list comes first, KPIs after. On the detail page the decision bar is sticky at the bottom.

FORM: Haal Khata, position 5 of 7 on the grounded list. Seed key 704a9631. Raises:
- tabular-figure discipline (Datamatics)
- crimson reserved for decision (Orienteering)
- stamped states where nothing disappears (Ticket Wallet)
- 1px hairlines (Centre Rail)

Signature move: the **decision seal**. Approve, reject and clarify stamp a circular seal (label, HOD initials, date) onto the requisition header, replacing the crimson thread. Stamping animates once (scale 1.15 → 1, opacity) and is disabled under reduced motion.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
