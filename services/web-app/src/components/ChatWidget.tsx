"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageSquare, X, Send, Loader2 } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

function getOrCreateVisitorId(): string {
  if (typeof window === "undefined") return "ssr";
  const k = "f2_visitor_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(k, v);
  }
  return v;
}

export default function ChatWidget() {
  const t = useTranslations("chat");
  const locale = useLocale();
  const greeting: Msg = { role: "assistant", content: t("greeting") };

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([greeting]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Refresh greeting if locale changes mid-session.
  useEffect(() => {
    setMessages((m) => [{ role: "assistant", content: t("greeting") }, ...m.slice(1)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "/api";
      const res = await fetch(`${apiBase}/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor_id: getOrCreateVisitorId(),
          session_id: sessionId,
          message: text,
          locale,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { session_id: string; reply: string };
      setSessionId(data.session_id);
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: t("errorOffline") }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        aria-label={t("open")}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-accent-600 text-white shadow-card-hover hover:bg-accent-700"
      >
        {open ? <X className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-navy-100 bg-white shadow-card-hover">
          <div className="border-b border-navy-100 bg-navy-900 px-4 py-3 text-white">
            <p className="font-display text-base leading-tight">{t("title")}</p>
            <p className="text-xs text-navy-300">{t("tagline")}</p>
          </div>

          <div ref={scrollRef} className="max-h-96 min-h-72 overflow-y-auto bg-navy-50 px-3 py-3 text-sm">
            {messages.map((m, i) => (
              <div key={i} className={`mb-2 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                    m.role === "user" ? "bg-accent-600 text-white" : "bg-white text-navy-800 border border-navy-100"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-navy-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("thinking")}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="flex items-center gap-2 border-t border-navy-100 bg-white p-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("placeholder")}
              className="flex-1 rounded-lg border border-navy-200 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !input.trim()}
              className="grid h-9 w-9 place-items-center rounded-lg bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50"
              aria-label={t("send")}>
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
