import type { Tone } from "@/components/ui";

export const SOURCE: Record<string, string> = { PORTAL: "Portal", SOCIAL_AD: "Social ad", WEBSITE: "Website", HOARDING: "Hoarding call" };
export const LANGUAGE: Record<string, string> = { EN: "English", HI: "Hindi", GU: "Gujarati" };

export const LEAD_STATUS: Record<string, [string, Tone]> = {
  NEW: ["New", "amber"],
  ENGAGED: ["Engaged", "neutral"],
  VISIT_BOOKED: ["Visit booked", "indigo"],
  VISITED: ["Visited", "sage"],
  HANDED_OFF: ["Handed off", "indigo"],
  CLOSED: ["Closed", "neutral"],
};

export const VISIT_STATUS: Record<string, [string, Tone]> = {
  HELD: ["Held", "amber"],
  BOOKED: ["Booked", "indigo"],
  VISITED: ["Visited", "sage"],
  NO_SHOW: ["No-show", "rose"],
  CANCELLED: ["Cancelled", "neutral"],
  EXPIRED: ["Hold expired", "neutral"],
};

export const FLAG_REASON: Record<string, string> = {
  OUTPUT_BLOCKED: "Reply blocked by safety check",
  MISSING_FACT: "Not on fact sheet",
  DISCOUNT_REQUEST: "Asked for discount",
  INJECTION: "Tried to change the rules",
  DISTRESS: "Complaint or distress",
  AI_ERROR: "Assistant unavailable",
};

export const OUTBOX_KIND: Record<string, string> = {
  FIRST_TOUCH: "First message",
  CONFIRMATION: "Visit confirmation",
  REMINDER_24H: "Reminder, 1 day before",
  REMINDER_2H: "Reminder, 2 hours before",
  CANCELLATION: "Cancellation",
  HANDOFF_ALERT: "Handoff alert to staff",
};

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const pct = (n: number | null) => (n == null ? "—" : `${n < 10 ? n.toFixed(1) : Math.round(n)}%`);
