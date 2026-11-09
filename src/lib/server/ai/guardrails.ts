// Deterministic safety nets around the model. We don't rely on the AI to behave (PRD §6).
import type { Lang } from "../../i18n";

/* ---------------- language ---------------- */

const DEVANAGARI = /[ऀ-ॿ]/g;
const GUJARATI = /[઀-૿]/g;

/** script-based detection; Latin text returns null (keep the buyer's chosen language, Hinglish stays as is) */
export function detectLanguage(text: string): Lang | null {
  const hi = text.match(DEVANAGARI)?.length ?? 0;
  const gu = text.match(GUJARATI)?.length ?? 0;
  if (gu > 2 && gu >= hi) return "GU";
  if (hi > 2) return "HI";
  return null;
}

/** Hindi/Gujarati digits → ASCII so money checks work in every script */
export function asciiDigits(s: string): string {
  return s
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[૦-૯]/g, (d) => String(d.charCodeAt(0) - 0x0ae6));
}

/* ---------------- buyer intent (checked before the model) ---------------- */

export type Intent = "OPT_OUT" | "HUMAN" | "DISTRESS" | "DISCOUNT" | "INJECTION";

const PATTERNS: Record<Intent, RegExp[]> = {
  OPT_OUT: [
    /^\s*(stop|unsubscribe|opt[\s-]?out)\s*[.!]*\s*$/i,
    /\b(don'?t|do not|stop)\s+(message|messaging|contact|contacting|call|calling|texting|sms)(ing)?\s+me\b/i,
    /\b(band karo|message mat bhejo|mat bhejo)\b/i,
    /(संदेश|मैसेज)\s*(मत|न)\s*भेज|^\s*बंद\s*करो/,
    /(સંદેશા|મેસેજ)\s*(ન|નહીં)\s*મોકલ|^\s*બંધ\s*કરો/,
  ],
  HUMAN: [
    /\b(talk|speak|connect|chat)\s+(to|with)\s+(a\s+|an\s+|your\s+|some\s+)?(human|person|someone|somebody|agent|executive|sales\s*(person|team|man)?|manager|representative|real\s+person)\b/i,
    /\b(call\s*me|call\s*back|callback|give\s+me\s+a\s+call|phone\s+me)\b/i,
    /\b(real|actual)\s+(person|human)\b/i,
    /\bare you (a )?(bot|robot|ai)\b/i,
    /\b(baat\s+kar(ni|na|wao|vao|ao)|call\s+kar(o|na|iye)|insaan)\b/i,
    /(किसी\s*(व्यक्ति|इंसान|आदमी)|इंसान|व्यक्ति)\s*से\s*बात|बात\s*करा|कॉल\s*कर|फ़?फोन\s*कर/,
    /(કોઈ\s*(વ્યક્તિ|માણસ)|વ્યક્તિ|માણસ)\s*(સાથે|જોડે)?\s*વાત|વાત\s*કરા|ફોન\s*કર|કૉલ\s*કર|કોલ\s*કર/,
  ],
  DISTRESS: [
    /\b(complain(t)?|fraud|cheat(ed|ing)?|scam|legal action|consumer court|police|harass(ed|ment)?|worst|disgusting|refund)\b/i,
    /(शिकायत|धोखा|ठगी|ठग|पुलिस|कोर्ट)/,
    /(ફરિયાદ|છેતરપિંડી|છેતર્યા|પોલીસ|કોર્ટ)/,
  ],
  DISCOUNT: [
    /\b(discount|cash\s*back|best\s+price|lowest\s+price|final\s+price|negotiat\w*|bargain|reduce\s+(the\s+)?price|price\s+(cut|reduction|drop)|any\s+offers?|festive\s+offer|special\s+offer|deal\s+price)\b/i,
    /\b(kam\s+kar(o|do|iye)|kuch\s+kam|best\s+rate)\b/i,
    /(छूट|डिस्काउंट|ऑफ़र|ऑफर|कम\s*कर|सबसे\s*कम\s*(दाम|कीमत)|आखिरी\s*(दाम|कीमत))/,
    /(છૂટ|ડિસ્કાઉન્ટ|ઓફર|ઑફર|ઓછું\s*કર|ઓછી\s*કર|છેલ્લો\s*ભાવ|ફાઇનલ\s*ભાવ)/,
  ],
  INJECTION: [
    /\b(ignore|disregard|forget)\s+(all\s+|any\s+|your\s+|the\s+|previous\s+|prior\s+|above\s+)*(instructions?|rules|prompts?|guidelines)\b/i,
    /\b(system\s+prompt|developer\s+mode|jailbreak|you\s+are\s+now|pretend\s+(to\s+be|you\s+are)|act\s+as\s+(a|an|my)|reveal\s+(your\s+)?(prompt|instructions))\b/i,
    /<\/?(system|assistant|tool)>/i,
  ],
};

export function detectIntents(text: string): Set<Intent> {
  const out = new Set<Intent>();
  for (const [intent, res] of Object.entries(PATTERNS) as [Intent, RegExp[]][]) {
    if (res.some((r) => r.test(text))) out.add(intent);
  }
  return out;
}

/* ---------------- money ---------------- */

const UNIT: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  l: 1e5,
  lac: 1e5,
  lacs: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  "लाख": 1e5,
  "લાખ": 1e5,
  cr: 1e7,
  crore: 1e7,
  crores: 1e7,
  "करोड़": 1e7,
  "करोड": 1e7,
  "કરોડ": 1e7,
};
const UNIT_RE = "(k|thousand|lakhs?|lacs?|l|crores?|cr|लाख|करोड़|करोड|લાખ|કરોડ)";
const CUR_RE = "(₹|rs\\.?|inr|rupees?|रुपये|रुपए|रु\\.?|રૂપિયા|રૂ\\.?)";
// "₹65 lakh", "Rs. 1.2 cr", "65L", "1,20,00,000 rupees", "65 लाख"
const MONEY = new RegExp(
  `${CUR_RE}\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*${UNIT_RE}?(?![\\p{L}])|(\\d[\\d,]*(?:\\.\\d+)?)\\s*${UNIT_RE}(?![\\p{L}])\\s*${CUR_RE}?`,
  "giu",
);

/** every money amount in the text, in rupees */
export function moneyMentions(text: string): number[] {
  const s = asciiDigits(text);
  const out: number[] = [];
  for (const m of s.matchAll(MONEY)) {
    const num = m[2] ?? m[4];
    const unit = (m[3] ?? m[5] ?? "").toLowerCase();
    if (!num) continue;
    const n = Number(num.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    // a bare number with no currency + "l" unit is too ambiguous ("2 l" water tank) → only count with currency or a clear unit
    if (!m[1] && !m[6] && unit === "l") continue;
    out.push(Math.round(n * (UNIT[unit] ?? 1)));
  }
  return out;
}

/* ---------------- output check (after the model) ---------------- */

const BANNED: RegExp[] = [
  /\b(discount(s|ed)?|cash\s*back|best\s+price|lowest\s+price|special\s+(offer|price)|offer\s+price|limited[\s-]period|festive\s+offer|freebies?|free\s+gift)\b/i,
  /\b(guarantee(d|s)?|assured\s+(returns?|appreciation)|returns?\s+on\s+investment|\bROI\b|appreciat(e|ion)|double\s+your|high\s+returns?|rental\s+yield|best\s+in\s+(the\s+)?city|number\s*1|no\.?\s*1\s+(project|developer)|100\s*%\s*(safe|guaranteed))\b/i,
  /(गारंटी|गारंटीड|छूट|डिस्काउंट|ऑफ़र|ऑफर|रिटर्न|मुनाफ़ा|मुनाफा)/,
  /(ગેરંટી|છૂટ|ડિસ્કાઉન્ટ|ઓફર|ઑફર|વળતર|નફો)/,
  /\b(system prompt|my instructions)\b/i,
];

export type OutputCheck = { ok: true } | { ok: false; reason: string };

/**
 * Block a reply if it states any money amount that isn't word-for-word backed by the published fact sheet,
 * or uses banned sales/RERA-risk words. A blocked reply is replaced with "a person will confirm" + handoff.
 */
export function checkOutput(reply: string, factCorpus: string): OutputCheck {
  for (const re of BANNED) {
    const m = reply.match(re);
    if (m) return { ok: false, reason: `Banned phrase: "${m[0]}"` };
  }
  const allowed = new Set(moneyMentions(factCorpus));
  for (const amount of moneyMentions(reply)) {
    if (!allowed.has(amount)) return { ok: false, reason: `Amount not in fact sheet: ₹${amount.toLocaleString("en-IN")}` };
  }
  return { ok: true };
}

/** remove reasoning blocks some models emit, collapse whitespace, cap length */
export function cleanModelText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 900);
}
