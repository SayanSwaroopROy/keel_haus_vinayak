import type { ThreadStep } from '@/components/thread-steps';
import type { Requisition, RequisitionStatus } from '@/lib/api/schemas';
import { shortDate } from '@/lib/format';

// bn / hi second lines are cheap labels and need native-speaker review before release.
const STAGES = [
  { key: 'captured', label: 'Captured and read', script: 'গৃহীত · प्राप्त' },
  { key: 'confirmed', label: 'Confirmed by you', script: 'আপনার নিশ্চিতকরণ · आपकी पुष्टि' },
  { key: 'hod', label: 'HOD decision', script: 'এইচওডি সিদ্ধান্ত · HOD निर्णय' },
  { key: 'rfq', label: 'RFQ and quotations', script: 'কোটেশন · कोटेशन' },
  { key: 'vendor', label: 'Vendor selected', script: 'বিক্রেতা নির্বাচিত · विक्रेता चयनित' },
  { key: 'wo', label: 'Work Order', script: 'ওয়ার্ক অর্ডার · वर्क ऑर्डर' },
] as const;

type Position = { current: number; allDone?: boolean; stopped?: boolean; needsYou?: boolean };

const POSITION: Record<RequisitionStatus, Position> = {
  DRAFT: { current: 0 },
  PROCESSING: { current: 0 },
  PENDING_CONFIRMATION: { current: 1, needsYou: true },
  CLARIFICATION_REQUIRED: { current: 2, needsYou: true },
  CONFIRMED: { current: 2 },
  SUBMITTED: { current: 2 },
  PENDING_APPROVAL: { current: 2 },
  APPROVED: { current: 3 },
  RFQ_FLOATED: { current: 3 },
  UNDER_EVALUATION: { current: 3 },
  VENDOR_SELECTED: { current: 4 },
  WO_GENERATED: { current: 5 },
  ORDER_PLACED: { current: 5, allDone: true },
  COMPLETED: { current: 5, allDone: true },
  REJECTED: { current: 2, stopped: true },
  CANCELLED: { current: 2, stopped: true },
};

const CURRENT_DETAIL: Partial<Record<RequisitionStatus, string>> = {
  DRAFT: 'The AI is still reading your input.',
  PROCESSING: 'The AI is still reading your input.',
  PENDING_CONFIRMATION: 'Check each item, then confirm. Nothing goes to the HOD until you do.',
  CLARIFICATION_REQUIRED: 'The HOD asked a question. Answer it so this can move on.',
  CONFIRMED: 'Sent to the HOD.',
  SUBMITTED: 'Sent to the HOD.',
  PENDING_APPROVAL: 'Waiting for the HOD to approve, reject or ask a question.',
  APPROVED: 'Approved. The HOD decides when to float the RFQ.',
  RFQ_FLOATED: 'Vendors have been asked to quote.',
  UNDER_EVALUATION: 'The HOD is comparing quotations.',
  VENDOR_SELECTED: 'The HOD has chosen vendors. A Work Order comes next.',
  WO_GENERATED: 'Work Order drafted. Management approves before it reaches the vendor.',
  REJECTED: 'The HOD rejected this requisition.',
  CANCELLED: 'This requisition was cancelled.',
};

export function buildJourney(requisition: Requisition): ThreadStep[] {
  const position = POSITION[requisition.status];
  return STAGES.map((stage, index) => {
    const state: ThreadStep['state'] = position.allDone
      ? 'done'
      : index < position.current
        ? 'done'
        : index === position.current
          ? position.stopped
            ? 'stopped'
            : 'current'
          : 'todo';

    let detail: string | undefined;
    if (index === 0) detail = shortDate(requisition.created_at);
    else if (index === 1 && requisition.confirmed_at) detail = shortDate(requisition.confirmed_at);
    else if (index === position.current && !position.allDone) detail = CURRENT_DETAIL[requisition.status];

    return {
      key: stage.key,
      label: stage.label,
      script: stage.script,
      detail,
      state,
      needsYou: index === position.current && position.needsYou === true,
    };
  });
}
