import type { DecisionAction, RequisitionStatus } from "@/lib/api/schemas";

// English is primary. Bengali and Hindi are secondary labels and need native-speaker review.
export type Trilingual = { en: string; bn: string; hi: string };

export const NAV_LABELS = {
  dashboard: { en: "Dashboard", bn: "ড্যাশবোর্ড", hi: "डैशबोर्ड" },
  requisitions: { en: "Requisitions", bn: "চাহিদাপত্র", hi: "माँग-पत्र" },
  inventory: { en: "Inventory", bn: "মজুত", hi: "स्टॉक" },
  vendors: { en: "Vendors", bn: "বিক্রেতা", hi: "विक्रेता" },
} as const satisfies Record<string, Trilingual>;

export const STATUS_LABELS: Record<RequisitionStatus, Trilingual> = {
  DRAFT: { en: "Draft", bn: "খসড়া", hi: "मसौदा" },
  PROCESSING: { en: "Processing", bn: "প্রক্রিয়াধীন", hi: "प्रक्रिया में" },
  PENDING_CONFIRMATION: { en: "Awaiting engineer", bn: "ইঞ্জিনিয়ারের অপেক্ষায়", hi: "इंजीनियर की प्रतीक्षा" },
  CONFIRMED: { en: "Confirmed", bn: "নিশ্চিত", hi: "पुष्ट" },
  SUBMITTED: { en: "Submitted", bn: "জমা দেওয়া", hi: "जमा" },
  PENDING_APPROVAL: { en: "Needs your decision", bn: "আপনার সিদ্ধান্ত প্রয়োজন", hi: "आपका निर्णय आवश्यक" },
  APPROVED: { en: "Approved", bn: "অনুমোদিত", hi: "स्वीकृत" },
  REJECTED: { en: "Rejected", bn: "বাতিল", hi: "अस्वीकृत" },
  CLARIFICATION_REQUIRED: { en: "Clarification asked", bn: "স্পষ্টীকরণ চাওয়া হয়েছে", hi: "स्पष्टीकरण माँगा" },
  RFQ_FLOATED: { en: "RFQ floated", bn: "আরএফকিউ পাঠানো", hi: "आरएफक्यू भेजा" },
  UNDER_EVALUATION: { en: "Under evaluation", bn: "মূল্যায়নাধীন", hi: "मूल्यांकन में" },
  VENDOR_SELECTED: { en: "Vendor selected", bn: "বিক্রেতা নির্বাচিত", hi: "विक्रेता चयनित" },
  WO_GENERATED: { en: "Work Order issued", bn: "ওয়ার্ক অর্ডার জারি", hi: "वर्क ऑर्डर जारी" },
  ORDER_PLACED: { en: "Order placed", bn: "অর্ডার দেওয়া", hi: "ऑर्डर दिया" },
  COMPLETED: { en: "Completed", bn: "সম্পন্ন", hi: "पूर्ण" },
  CANCELLED: { en: "Cancelled", bn: "বাতিলকৃত", hi: "रद्द" },
};

export const DECISION_LABELS: Record<DecisionAction, Trilingual> = {
  approve: { en: "Approve", bn: "অনুমোদন", hi: "स्वीकृत करें" },
  reject: { en: "Reject", bn: "বাতিল", hi: "अस्वीकार करें" },
  clarify: { en: "Ask to clarify", bn: "স্পষ্টীকরণ চান", hi: "स्पष्टीकरण माँगें" },
};

export const LANG_NAMES: Record<"bn" | "hi" | "en", string> = { bn: "Bengali", hi: "Hindi", en: "English" };
