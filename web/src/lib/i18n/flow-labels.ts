import type { RfqVendorStatus, WorkOrderStatus } from "@/lib/api/schemas-flow";
import type { Trilingual } from "./labels";

// English is primary. Bengali and Hindi are secondary and need native-speaker review.

export const RFQ_STATUS_LABELS: Record<string, Trilingual> = {
  DRAFT: { en: "Ready to send", bn: "পাঠানোর জন্য প্রস্তুত", hi: "भेजने को तैयार" },
  SENT: { en: "Out for quotation", bn: "দর চাওয়া হয়েছে", hi: "कोटेशन के लिए भेजा" },
  AWARDED: { en: "Vendors selected", bn: "বিক্রেতা নির্বাচিত", hi: "विक्रेता चयनित" },
  CLOSED: { en: "Closed", bn: "বন্ধ", hi: "बंद" },
};

export const WO_STATUS_LABELS: Record<WorkOrderStatus, Trilingual> = {
  GENERATED: { en: "Draft Work Order", bn: "খসড়া ওয়ার্ক অর্ডার", hi: "मसौदा वर्क ऑर्डर" },
  PENDING_APPROVAL: { en: "Awaiting management", bn: "ম্যানেজমেন্টের অপেক্ষায়", hi: "प्रबंधन की प्रतीक्षा" },
  SENT: { en: "Sent to vendor", bn: "বিক্রেতাকে পাঠানো", hi: "विक्रेता को भेजा" },
  ACKNOWLEDGED: { en: "Acknowledged", bn: "স্বীকৃত", hi: "स्वीकार किया" },
  COMPLETED: { en: "Completed", bn: "সম্পন্ন", hi: "पूर्ण" },
  CANCELLED: { en: "Cancelled", bn: "বাতিলকৃত", hi: "रद्द" },
};

export const RFQ_VENDOR_STATUS: Record<RfqVendorStatus, { label: string; tone: "waiting" | "settled" | "decision" | "plain" | "void" }> = {
  DRAFT: { label: "Not sent yet", tone: "plain" },
  RFQ_SENT: { label: "Not opened yet", tone: "plain" },
  RFQ_VIEWED: { label: "Opened", tone: "plain" },
  VENDOR_RESPONDED: { label: "Replied", tone: "plain" },
  ALTERNATIVE_PROPOSED: { label: "Alternative proposed", tone: "decision" },
  ALTERNATIVE_APPROVED: { label: "Alternative accepted", tone: "settled" },
  ALTERNATIVE_REJECTED: { label: "Alternative rejected", tone: "plain" },
  QUOTATION_SUBMITTED: { label: "Quoted", tone: "settled" },
  REVISION_REQUESTED: { label: "Revision requested", tone: "waiting" },
  AWARDED: { label: "Selected", tone: "settled" },
  NOT_AWARDED: { label: "Not selected", tone: "void" },
  CLOSED: { label: "Closed", tone: "void" },
  CANCELLED: { label: "Cancelled", tone: "void" },
};

/** Plain-language reading of each quotation flag, for the HOD. */
export const FLAG_COPY: Record<string, { label: string; hint: string }> = {
  expired_offer: { label: "Offer expired", hint: "The validity period has already passed. Ask for a fresh quote." },
  unit_mismatch: { label: "Different unit", hint: "Quoted in a unit other than the RFQ. The rate shown is converted, check it." },
  qty_differs_from_rfq: { label: "Quantity differs", hint: "The vendor priced a different quantity than the RFQ asked for." },
  missing_terms: { label: "Warranty missing", hint: "No warranty or standard terms were given." },
  brand_substitution: { label: "Brand substituted", hint: "The vendor quoted a brand other than the one specified." },
  escalation_clause: { label: "Escalation clause", hint: "The rate may rise during the contract. Compare with care." },
  undated: { label: "No quote date", hint: "The quotation carries no date, so validity cannot be checked." },
  payment_terms_open: { label: "Payment terms open", hint: "Payment terms were left blank or open-ended." },
};

export const BADGE_COPY = {
  lowest_price: "Lowest landed price",
  best_performance: "Best past performance",
  fastest_start: "Earliest start",
  best_overall: "Highest score",
} as const;
