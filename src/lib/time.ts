// IST helpers. India has no DST so a fixed +05:30 offset is exact.
export const IST_OFFSET_MIN = 330;
export const TZ = "Asia/Kolkata";

const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** IST wall-clock parts of a UTC instant */
export function istParts(d: Date) {
  const s = new Date(d.getTime() + IST_OFFSET_MIN * MIN);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    weekday: s.getUTCDay(),
    minutes: s.getUTCHours() * 60 + s.getUTCMinutes(),
  };
}

/** UTC instant for an IST wall-clock date + minutes after midnight */
export function fromIst(year: number, month: number, day: number, minutes = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, minutes) - IST_OFFSET_MIN * MIN);
}

/** start of the IST day containing d */
export function istStartOfDay(d: Date): Date {
  const p = istParts(d);
  return fromIst(p.year, p.month, p.day);
}

export function istDateKey(d: Date): string {
  const p = istParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function monthKey(d: Date): string {
  return istDateKey(d).slice(0, 7);
}

const LOCALE = { EN: "en-IN", HI: "hi-IN", GU: "gu-IN" } as const;
export type Lang = keyof typeof LOCALE;

export function fmtDate(d: Date, lang: Lang = "EN") {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(d);
}
export function fmtTime(d: Date, lang: Lang = "EN") {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}
export function fmtDateTime(d: Date, lang: Lang = "EN") {
  return `${fmtDate(d, lang)}, ${fmtTime(d, lang)}`;
}
export function fmtDateLong(d: Date, lang: Lang = "EN") {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d);
}

/** "14 min", "3 h 20 min", "2 d 4 h" */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < MIN) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

export function relativeTime(d: Date, now = new Date()): string {
  const diff = now.getTime() - d.getTime();
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.round(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)} d ago`;
  return fmtDate(d);
}
