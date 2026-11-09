"use client";
import { useEffect, useState } from "react";
import { CalendarPlus, MapPin, PencilLine } from "lucide-react";
import type { Card, SlotOption } from "@/lib/cards";
import { t, type Lang } from "@/lib/i18n";
import { fmtTime, istDateKey } from "@/lib/time";
import { Button, Field, Input, cx } from "@/components/ui";

type Act = (action: string, body: unknown) => Promise<boolean>;
const LOCALE = { EN: "en-IN", HI: "hi-IN", GU: "gu-IN" } as const;
const dayName = (d: Date, l: Lang) => new Intl.DateTimeFormat(LOCALE[l], { timeZone: "Asia/Kolkata", weekday: "short" }).format(d);
const dayNum = (d: Date, l: Lang) => new Intl.DateTimeFormat(LOCALE[l], { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(d);
const longDay = (d: Date, l: Lang) => new Intl.DateTimeFormat(LOCALE[l], { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(d);

export function CardView({ card, lang, messageId, act, latest }: { card: Card; lang: Lang; messageId: string; act: Act; latest: boolean }) {
  switch (card.type) {
    case "slots":
      return <SlotsCard slots={card.slots} lang={lang} act={act} active={latest} />;
    case "noSlots":
      return null;
    case "hold":
      return <HoldCard card={card} lang={lang} act={act} messageId={messageId} />;
    case "confirmed":
      return <VisitPass card={card} lang={lang} />;
    case "handoff":
      return (
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-sage-soft px-4 py-3 text-[15px] text-sage">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sage text-sm font-semibold text-white" aria-hidden>
            {card.exec.slice(0, 1)}
          </span>
          <span>{t(lang, "handoffBody", { exec: card.exec })}</span>
        </div>
      );
    case "contact":
    case "fallback":
      return <ContactCard kind={card.type} done={!!card.done} lang={lang} act={act} messageId={messageId} />;
  }
}

/* ---------- slot picker: real free times as large calm tiles ---------- */
function SlotsCard({ slots, lang, act, active }: { slots: SlotOption[]; lang: Lang; act: Act; active: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (id: string) => {
    setBusy(id);
    await act("pick", { slotId: id });
    setBusy(null);
  };
  return (
    <div className="space-y-3">
      <div className={cx("grid gap-2", slots.length >= 3 ? "grid-cols-3" : slots.length === 2 ? "grid-cols-2" : "grid-cols-1 max-w-[180px]")}>
        {slots.map((s) => {
          const d = new Date(s.startsAt);
          return (
            <button
              key={s.id}
              onClick={() => pick(s.id)}
              disabled={!active || !!busy}
              className="group flex flex-col items-start rounded-[var(--radius-card)] border border-line bg-surface px-3 py-3 text-left transition-colors hover:border-indigo enabled:hover:bg-indigo-soft/50 disabled:opacity-60"
            >
              <span className="text-[13px] text-ink-3">{dayName(d, lang)}</span>
              <span className="wide text-lg font-semibold leading-tight">{dayNum(d, lang)}</span>
              <span className="num mt-1 text-[15px] text-indigo">{busy === s.id ? "…" : fmtTime(d, lang)}</span>
            </button>
          );
        })}
      </div>
      {active && (
        <button
          className="text-sm font-medium text-indigo underline-offset-4 hover:underline"
          onClick={() => act("slots", { excludeDays: slots.map((s) => istDateKey(new Date(s.startsAt)).split("-").map(Number).join("-")) })}
        >
          {t(lang, "moreTimes")}
        </button>
      )}
    </div>
  );
}

/* ---------- hold: buyer checks name + number, confirms ---------- */
function HoldCard({ card, lang, act, messageId }: { card: Extract<Card, { type: "hold" }>; lang: Lang; act: Act; messageId: string }) {
  const [name, setName] = useState(card.name ?? "");
  const [editPhone, setEditPhone] = useState(!card.phone);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const d = new Date(card.startsAt);

  useEffect(() => {
    if (!card.expiresAt || card.state !== "open") return;
    const end = new Date(card.expiresAt).getTime();
    const tick = () => setLeft(Math.max(0, end - Date.now()));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [card.expiresAt, card.state]);

  if (card.state !== "open") {
    return (
      <p className="text-sm text-ink-3">
        {longDay(d, lang)}, {fmtTime(d, lang)} · {t(lang, card.state === "done" ? "doneHold" : "expiredHold")}
      </p>
    );
  }
  const expired = left === 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act("confirm", { messageId, slotId: card.slotId, visitId: expired ? null : card.visitId, name, phone: editPhone ? phone : undefined });
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
      <p className="text-sm text-ink-3">{t(lang, "confirmTitle")}</p>
      <p className="wide mt-1 text-xl font-semibold leading-snug">{longDay(d, lang)}</p>
      <p className="num text-lg text-indigo">
        {fmtTime(d, lang)} · {card.projectName}
      </p>
      {left !== null && (
        <p className={cx("num mt-2 text-sm", expired ? "text-amber" : "text-ink-3")} aria-live="polite">
          {expired ? t(lang, "holdExpired") : `${t(lang, "heldFor")} · ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`}
        </p>
      )}
      <div className="mt-4 space-y-3">
        <Field label={t(lang, "yourName")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={80} />
        </Field>
        {editPhone ? (
          <Field label={t(lang, "yourPhone")}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98250 12345" required pattern="[\d\s+\-]{10,16}" />
          </Field>
        ) : (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-ink-2">{t(lang, "yourPhone")}</span>
            <div className="flex h-11 items-center justify-between rounded-[var(--radius-ctl)] border border-line-2 bg-paper px-3">
              <span className="num">{card.phone}</span>
              <button type="button" onClick={() => setEditPhone(true)} className="inline-flex items-center gap-1 text-sm font-medium text-indigo">
                <PencilLine className="size-3.5" aria-hidden /> {t(lang, "editNumber")}
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button type="submit" busy={busy} className="flex-1 sm:flex-none">
          {t(lang, "confirm")}
        </Button>
        <Button type="button" variant="quiet" onClick={() => act("slots", {})}>
          {t(lang, "change")}
        </Button>
      </div>
    </form>
  );
}

/* ---------- the visit pass: the one bold element ---------- */
function VisitPass({ card, lang }: { card: Extract<Card, { type: "confirmed" }>; lang: Lang }) {
  const d = new Date(card.startsAt);
  return (
    <article className="overflow-hidden rounded-[var(--radius-card)] border border-indigo/20 bg-surface">
      <div className="bg-indigo px-5 pb-5 pt-4 text-white">
        <p className="text-sm text-white/75">{t(lang, "confirmedTitle")}</p>
        <p className="wide mt-2 text-[28px] font-semibold leading-none sm:text-[32px]">{dayNum(d, lang)}</p>
        <p className="num mt-2 text-lg text-white/90">
          {dayName(d, lang)} · {fmtTime(d, lang)}
        </p>
      </div>
      <div className="space-y-1 px-5 py-4">
        <p className="font-medium">{card.projectName}</p>
        <p className="text-[15px] text-ink-2">{card.address}</p>
        <p className="pt-1 text-[15px] text-ink-2">
          {t(lang, "host")}: <span className="font-medium text-ink">{card.exec}</span>
        </p>
      </div>
      <div className="grid grid-cols-3 border-t border-line-2 text-sm">
        <a href={card.mapUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 px-2 py-3 font-medium text-indigo hover:bg-indigo-soft/50">
          <MapPin className="size-4" aria-hidden /> {t(lang, "openMap")}
        </a>
        <a href={`/api/visit/${card.manageToken}/ics`} className="flex items-center justify-center gap-1.5 border-x border-line-2 px-2 py-3 font-medium text-indigo hover:bg-indigo-soft/50">
          <CalendarPlus className="size-4" aria-hidden /> {t(lang, "addCalendar")}
        </a>
        <a href={`/visit/${card.manageToken}`} className="flex items-center justify-center px-2 py-3 text-center font-medium text-indigo hover:bg-indigo-soft/50">
          {t(lang, "manage")}
        </a>
      </div>
      <p className="border-t border-line-2 px-5 py-2.5 text-[13px] text-ink-3">
        {t(lang, "rera")} {card.rera}
      </p>
    </article>
  );
}

/* ---------- contact / fallback: so a person can call back ---------- */
function ContactCard({ kind, done, lang, act, messageId }: { kind: "contact" | "fallback"; done: boolean; lang: Lang; act: Act; messageId: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  if (done) return <p className="text-sm text-ink-3">{t(lang, "thanks")}</p>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act("contact", { messageId, name, phone, preferredTime: when || undefined });
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
      {kind === "fallback" && <p className="mb-3 font-medium">{t(lang, "fallbackTitle")}</p>}
      <div className="space-y-3">
        <Field label={t(lang, "yourName")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={80} />
        </Field>
        <Field label={t(lang, "yourPhone")}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98250 12345" required pattern="[\d\s+\-]{10,16}" />
        </Field>
        <Field label={t(lang, "preferredTime")}>
          <Input value={when} onChange={(e) => setWhen(e.target.value)} maxLength={60} placeholder={lang === "EN" ? "e.g. after 6 pm" : ""} />
        </Field>
      </div>
      <Button type="submit" busy={busy} className="mt-4 w-full sm:w-auto">
        {t(lang, "submit")}
      </Button>
    </form>
  );
}
