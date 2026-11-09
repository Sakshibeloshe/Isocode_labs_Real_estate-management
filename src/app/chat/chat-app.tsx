"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, UserRound } from "lucide-react";
import type { ChatMessageDTO } from "@/lib/cards";
import { LANGS, t, type Lang } from "@/lib/i18n";
import { Button, Spinner, cx } from "@/components/ui";
import { CardView } from "./cards";

type ProjectInfo = { id: string; name: string; locality: string; rera: string; bhk: string[] };
type Convo = { language: Lang; status: string; hasContact: boolean; project: { id: string; name: string; locality: string; rera: string } | null };

const LANG_ATTR: Record<Lang, string> = { EN: "en", HI: "hi", GU: "gu" };

async function fetchChat(resumeToken: string | null) {
  const res = await fetch(`/api/chat${resumeToken ? `?c=${encodeURIComponent(resumeToken)}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error("load failed");
  return res.json();
}

export default function ChatApp({ projects, initialProjectId, resumeToken }: { projects: ProjectInfo[]; initialProjectId: string | null; resumeToken: string | null }) {
  const [state, setState] = useState<"loading" | "welcome" | "chat" | "error">("loading");
  const [convo, setConvo] = useState<Convo | null>(null);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [lang, setLang] = useState<Lang>("EN");
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const apply = useCallback(
    (data: { conversation: Convo | null; messages: ChatMessageDTO[] }) => {
      if (data.conversation) {
        // an existing chat wins over the ?project link: it carries the history
        setConvo(data.conversation);
        setLang(data.conversation.language);
        setMessages(data.messages);
        setState("chat");
        if (resumeToken) window.history.replaceState(null, "", "/chat");
      } else setState("welcome");
    },
    [resumeToken],
  );

  const load = useCallback(() => {
    fetchChat(resumeToken)
      .then(apply)
      .catch(() => setState("error"));
  }, [resumeToken, apply]);

  useEffect(() => {
    let alive = true;
    fetchChat(resumeToken)
      .then((d) => alive && apply(d))
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [resumeToken, apply]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  const start = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, language: lang, consent: true }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConvo(data.conversation);
      setMessages(data.messages);
      setState("chat");
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (e) {
      setError((e as Error).message || t(lang, "error"));
    } finally {
      setPending(false);
    }
  };

  /** reload all messages: the server may have updated earlier cards (hold → done) */
  const refreshAll = async () => {
    const res = await fetch("/api/chat", { cache: "no-store" });
    const data = await res.json();
    if (data.conversation) setMessages(data.messages);
  };

  /** every chat action: optimistic for typed text, append server messages, keep the text on failure */
  const act = useCallback(
    async (action: string, body: unknown, optimistic?: string): Promise<boolean> => {
      setError(null);
      setPending(true);
      const tempId = `tmp-${Date.now()}`;
      if (optimistic) setMessages((m) => [...m, { id: tempId, role: "BUYER", content: optimistic, card: null, createdAt: new Date().toISOString() }]);
      try {
        const res = await fetch(`/api/chat/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setState("welcome");
          setConvo(null);
          setMessages([]);
          throw new Error(data.error);
        }
        if (!res.ok) throw new Error(data.error || t(lang, "error"));
        setConvo(data.conversation);
        if (data.conversation.language !== lang) setLang(data.conversation.language);
        setMessages((m) => {
          const base = optimistic ? m.filter((x) => x.id !== tempId) : m;
          // server may have updated earlier cards (hold → done); refresh those by id
          const incoming = data.messages as ChatMessageDTO[];
          return [...base, ...incoming];
        });
        if (action === "confirm" || action === "contact") void refreshAll();
        return true;
      } catch (e) {
        if (optimistic) {
          setMessages((m) => m.filter((x) => x.id !== tempId));
          setText(optimistic);
        }
        setError((e as Error).message || t(lang, "error"));
        return false;
      } finally {
        setPending(false);
      }
    },
    [lang],
  );

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v || pending) return;
    setText("");
    await act("message", { text: v }, v);
    inputRef.current?.focus();
  };

  const switchLang = async (l: Lang) => {
    setLang(l);
    if (state === "chat") await act("language", { language: l });
  };

  const project = convo?.project ?? projects.find((p) => p.id === projectId) ?? null;
  const lastId = messages.at(-1)?.id;
  const buyerCount = messages.filter((m) => m.role === "BUYER").length;

  return (
    <div lang={LANG_ATTR[lang]} className="mx-auto grid h-dvh max-w-6xl lg:grid-cols-[minmax(0,1fr)_minmax(0,620px)] lg:gap-12 lg:px-8">
      {/* left: what this is (desktop only) */}
      <aside className="hidden flex-col justify-between py-12 lg:flex">
        <div>
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-ink-2 hover:text-ink">
            Company A
          </Link>
          {project ? (
            <>
              <h1 className="wide mt-16 text-5xl font-semibold leading-[1.02]">{project.name}</h1>
              <p className="mt-3 text-lg text-ink-2">{project.locality}</p>
            </>
          ) : (
            <h1 className="wide mt-16 max-w-md text-4xl font-semibold leading-[1.08]">{t(lang, "welcomeTitle")}</h1>
          )}
          <p className="mt-8 max-w-sm text-[15px] leading-relaxed text-ink-2">{t(lang, "sourceNote")}</p>
        </div>
        {project && "rera" in project && <p className="text-sm text-ink-3">RERA {project.rera}</p>}
      </aside>

      {/* right: the chat */}
      <main className="flex h-dvh min-h-0 flex-col bg-surface lg:my-6 lg:h-[calc(100dvh-48px)] lg:rounded-[20px] lg:border lg:border-line">
        <header className="flex shrink-0 items-center gap-3 border-b border-line-2 bg-surface/95 px-4 py-3 backdrop-blur sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{project ? project.name : "Company A"}</p>
            <p className="truncate text-[13px] text-ink-3">{project ? `RERA ${project.rera}` : "Ahmedabad"}</p>
          </div>
          <LangSwitch lang={lang} onChange={switchLang} disabled={pending} />
        </header>

        {state === "loading" && (
          <div className="grid flex-1 place-items-center text-ink-3">
            <Spinner />
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p>{t(lang, "error")}</p>
            <Button
              variant="line"
              onClick={() => {
                setState("loading");
                load();
              }}
            >
              {t(lang, "retry")}
            </Button>
          </div>
        )}

        {state === "welcome" && (
          <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto p-5 sm:p-8">
            <div className="lg:hidden">
              <h1 className="wide text-[34px] font-semibold leading-[1.05]">{project ? project.name : t(lang, "welcomeTitle")}</h1>
              {project && <p className="mt-2 text-ink-2">{project.locality}</p>}
            </div>
            <p className="mt-6 text-lg text-ink-2 lg:mt-0">{t(lang, "startHint")}</p>
            {!initialProjectId && (
              <div className="mt-6 flex flex-wrap gap-2" role="radiogroup" aria-label={t(lang, "whichProject")}>
                {projects.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={projectId === p.id}
                    onClick={() => setProjectId(projectId === p.id ? null : p.id)}
                    className={cx(
                      "rounded-full border px-4 py-2 text-[15px] transition-colors",
                      projectId === p.id ? "border-indigo bg-indigo-soft text-indigo" : "border-line text-ink-2 hover:border-ink-3",
                    )}
                  >
                    {p.name} · {p.locality.split(",")[0]}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-8 border-t border-line-2 pt-4 text-sm leading-relaxed text-ink-3">{t(lang, "consent")}</p>
            {error && <p role="alert" className="mt-3 text-sm text-rose">{error}</p>}
            <Button className="mt-4 w-full" onClick={start} busy={pending}>
              {t(lang, "start")}
            </Button>
          </div>
        )}

        {state === "chat" && (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6" aria-live="polite">
              {messages.map((m) => (
                <MessageRow key={m.id} m={m} lang={lang} act={act} latest={m.id === lastId} />
              ))}
              {pending && (
                <div className="flex items-center gap-1.5 py-1 text-ink-3" aria-label={t(lang, "typing")}>
                  <span className="typing-dot size-1.5 rounded-full bg-current" />
                  <span className="typing-dot size-1.5 rounded-full bg-current [animation-delay:.15s]" />
                  <span className="typing-dot size-1.5 rounded-full bg-current [animation-delay:.3s]" />
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="shrink-0 border-t border-line-2 bg-surface px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 sm:px-5">
              {error && (
                <p role="alert" className="mb-2 px-1 text-sm text-rose">
                  {error}
                </p>
              )}
              {buyerCount < 2 && !pending && (
                <div className="mb-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {!project &&
                    projects.map((p) => (
                      <Chip key={p.id} onClick={() => act("project", { projectId: p.id }).then(() => setProjectId(p.id))}>
                        {p.name}
                      </Chip>
                    ))}
                  {project && <Chip onClick={() => act("slots", {})}>{t(lang, "chipVisit")}</Chip>}
                  <Chip onClick={() => act("message", { text: t(lang, "chipPrice") }, t(lang, "chipPrice"))}>{t(lang, "chipPrice")}</Chip>
                  <Chip onClick={() => act("message", { text: t(lang, "chipPossession") }, t(lang, "chipPossession"))}>{t(lang, "chipPossession")}</Chip>
                </div>
              )}
              <form onSubmit={send} className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  maxLength={1000}
                  placeholder={t(lang, "placeholder")}
                  aria-label={t(lang, "placeholder")}
                  className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] border border-line bg-paper px-4 py-2.5 text-[16px] focus:border-indigo focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!text.trim() || pending}
                  aria-label={t(lang, "send")}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-indigo text-white transition-opacity disabled:opacity-35"
                >
                  <ArrowUp className="size-5" />
                </button>
              </form>
              <div className="mt-2 flex items-center justify-between px-1">
                <button onClick={() => act("person", {})} disabled={pending} className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo disabled:opacity-50">
                  <UserRound className="size-4" aria-hidden /> {t(lang, "talkToPerson")}
                </button>
                <span className="text-[12px] text-ink-3">STOP = opt out</span>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function MessageRow({ m, lang, act, latest }: { m: ChatMessageDTO; lang: Lang; act: (a: string, b: unknown) => Promise<boolean>; latest: boolean }) {
  if (m.role === "BUYER") {
    return (
      <div className="settle flex justify-end">
        <p className="max-w-[82%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-indigo-soft px-4 py-2.5 text-[16px] text-ink">{m.content}</p>
      </div>
    );
  }
  return (
    <div className="settle max-w-[92%] space-y-3">
      {m.content && <p className="whitespace-pre-wrap text-[16px] leading-relaxed text-ink">{m.content}</p>}
      {m.card && <CardView card={m.card} lang={lang} messageId={m.id} act={act} latest={latest} />}
    </div>
  );
}

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-sm text-ink-2 transition-colors hover:border-indigo hover:text-indigo">
      {children}
    </button>
  );
}

function LangSwitch({ lang, onChange, disabled }: { lang: Lang; onChange: (l: Lang) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Language" className="flex rounded-full bg-paper p-0.5">
      {LANGS.map((l) => (
        <button
          key={l.id}
          role="radio"
          aria-checked={lang === l.id}
          disabled={disabled}
          onClick={() => onChange(l.id)}
          className={cx("rounded-full px-2.5 py-1 text-[13px] transition-colors", lang === l.id ? "bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-3 hover:text-ink")}
        >
          {l.id === "EN" ? "EN" : l.label}
        </button>
      ))}
    </div>
  );
}
