"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, MapPin } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import { fmtTime, istDateKey } from "@/lib/time";
import { Button, Notice, Spinner, cx } from "@/components/ui";

type V = { status: string; startsAt: string; projectId: string; projectName: string; address: string; mapUrl: string; rera: string; exec: string | null };
const LOCALE = { EN: "en-IN", HI: "hi-IN", GU: "gu-IN" } as const;
const LANG_ATTR = { EN: "en", HI: "hi", GU: "gu" } as const;

export default function ManageVisit({ token, lang, visit, optedOut, upcoming }: { token: string; lang: Lang; visit: V; optedOut: boolean; upcoming: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "pick" | "cancel">("view");
  const [slots, setSlots] = useState<{ id: string; startsAt: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const d = new Date(visit.startsAt);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: "Asia/Kolkata", ...o }).format(d);
  const live = visit.status === "BOOKED" && upcoming;

  const post = async (body: unknown) => {
    setError(null);
    const res = await fetch(`/api/visit/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t(lang, "error"));
    return data;
  };

  const loadSlots = async (exclude?: string[]) => {
    setMode("pick");
    setBusy("slots");
    try {
      const data = await post({ action: "slots", excludeDays: exclude });
      setSlots(data.slots);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const run = async (key: string, body: unknown, after: string) => {
    setBusy(key);
    try {
      await post(body);
      setNotice(after);
      setMode("view");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      if (key.startsWith("slot")) loadSlots();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div lang={LANG_ATTR[lang]} className="mx-auto min-h-dvh max-w-lg px-5 py-8">
      <Link href="/" className="text-[15px] font-semibold text-ink-2">
        Company A
      </Link>
      <h1 className="mt-10 text-sm text-ink-3">{t(lang, "manageTitle")}</h1>

      <article className={cx("mt-3 overflow-hidden rounded-[var(--radius-card)] border bg-surface", live ? "border-indigo/20" : "border-line")}>
        <div className={cx("px-5 pb-5 pt-4", live ? "bg-indigo text-white" : "bg-line-2 text-ink")}>
          <p className="wide text-[32px] font-semibold leading-none">{fmt({ day: "numeric", month: "short" })}</p>
          <p className="num mt-2 text-lg opacity-90">
            {fmt({ weekday: "long" })} · {fmtTime(d, lang)}
          </p>
        </div>
        <div className="space-y-1 px-5 py-4">
          <p className="font-medium">{visit.projectName}</p>
          <p className="text-[15px] text-ink-2">{visit.address}</p>
          {visit.exec && (
            <p className="pt-1 text-[15px] text-ink-2">
              {t(lang, "host")}: <span className="font-medium text-ink">{visit.exec}</span>
            </p>
          )}
        </div>
        {live && (
          <div className="grid grid-cols-2 border-t border-line-2 text-sm">
            <a href={visit.mapUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 py-3 font-medium text-indigo">
              <MapPin className="size-4" aria-hidden /> {t(lang, "openMap")}
            </a>
            <a href={`/api/visit/${token}/ics`} className="flex items-center justify-center gap-1.5 border-l border-line-2 py-3 font-medium text-indigo">
              <CalendarPlus className="size-4" aria-hidden /> {t(lang, "addCalendar")}
            </a>
          </div>
        )}
        <p className="border-t border-line-2 px-5 py-2.5 text-[13px] text-ink-3">RERA {visit.rera}</p>
      </article>

      <div className="mt-6 space-y-4">
        {notice && <Notice tone="sage">{notice}</Notice>}
        {error && (
          <p role="alert" className="text-sm text-rose">
            {error}
          </p>
        )}
        {visit.status === "CANCELLED" && <Notice>{t(lang, "cancelledNote")}</Notice>}
        {visit.status === "VISITED" && <Notice tone="sage">{t(lang, "visitedNote")}</Notice>}
        {!live && (
          <Link href={`/chat?project=${visit.projectId}`} className="inline-block font-medium text-indigo">
            {t(lang, "bookAgain")}
          </Link>
        )}

        {live && mode === "view" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="line" onClick={() => loadSlots()}>
              {t(lang, "changeTime")}
            </Button>
            <Button variant="quiet" onClick={() => setMode("cancel")}>
              {t(lang, "cancelVisit")}
            </Button>
          </div>
        )}

        {live && mode === "cancel" && (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p>{t(lang, "cancelSure")}</p>
            <div className="mt-4 flex gap-2">
              <Button variant="danger" busy={busy === "cancel"} onClick={() => run("cancel", { action: "cancel" }, t(lang, "cancelledNote"))}>
                {t(lang, "yesCancel")}
              </Button>
              <Button variant="quiet" onClick={() => setMode("view")}>
                {t(lang, "keepVisit")}
              </Button>
            </div>
          </div>
        )}

        {live && mode === "pick" && (
          <div>
            <p className="mb-3 text-sm text-ink-3">{t(lang, "pickTime")}</p>
            {busy === "slots" || !slots ? (
              <Spinner className="text-ink-3" />
            ) : slots.length === 0 ? (
              <p className="text-ink-2">{t(lang, "noSlots")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {slots.map((s) => {
                  const sd = new Date(s.startsAt);
                  return (
                    <button
                      key={s.id}
                      disabled={!!busy}
                      onClick={() => run(`slot-${s.id}`, { action: "reschedule", slotId: s.id }, t(lang, "rescheduled"))}
                      className="flex flex-col items-start rounded-[var(--radius-card)] border border-line bg-surface px-3 py-3 text-left hover:border-indigo disabled:opacity-60"
                    >
                      <span className="text-[13px] text-ink-3">{new Intl.DateTimeFormat(LOCALE[lang], { timeZone: "Asia/Kolkata", weekday: "short" }).format(sd)}</span>
                      <span className="wide font-semibold">{new Intl.DateTimeFormat(LOCALE[lang], { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(sd)}</span>
                      <span className="num text-indigo">{busy === `slot-${s.id}` ? "…" : fmtTime(sd, lang)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex gap-4">
              {slots && slots.length > 0 && (
                <button
                  className="text-sm font-medium text-indigo"
                  onClick={() => loadSlots([...new Set(slots.map((s) => istDateKey(new Date(s.startsAt)).split("-").map(Number).join("-")))])}
                >
                  {t(lang, "moreTimes")}
                </button>
              )}
              <button className="text-sm text-ink-3" onClick={() => setMode("view")}>
                {t(lang, "keepVisit")}
              </button>
            </div>
          </div>
        )}

        {!optedOut ? (
          <button className="pt-6 text-sm text-ink-3 underline-offset-4 hover:underline" onClick={() => run("optout", { action: "optout" }, t(lang, "stopped"))}>
            {t(lang, "stopMessages")}
          </button>
        ) : (
          <p className="pt-6 text-sm text-ink-3">{t(lang, "stopped")}</p>
        )}
      </div>
    </div>
  );
}
