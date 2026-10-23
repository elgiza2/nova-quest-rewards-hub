import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useUserLang } from "@/lib/authI18n";
import ServiceIcon, { detectServiceKind } from "./ServiceIcon";

export interface ThinkingTraceProps {
  /** Live status line — always the real current operation, never a placeholder. */
  status?: string;
  /** Ordered narration steps (deep research, tools, slides, media…). */
  steps?: string[];
  /** Raw reasoning tokens from the model. */
  text?: string;
  /** True while the turn is still running. */
  active?: boolean;
  /** Kept for API compatibility. */
  running?: boolean;
  /** Real tool family currently executing — drives the service icon. */
  tool?: string | null;
  /** "tools" renders the used-tools timeline after the run ends. */
  variant?: "default" | "tools";
  /** Start expanded. */
  defaultOpen?: boolean;
  className?: string;
}

const RTL_LANGS = new Set(["ar", "ar-eg", "fa", "he"]);

// Raw stream lines can carry tool markers, routing tags or JSON — never show those.
export const cleanTraceLine = (raw: string): string => {
  let v = String(raw || "")
    .replace(/\[\[\s*MEGSY_ESCALATE[^\]]*\]\]/gi, " ")
    .replace(/<\/?[a-z_]+(?:\s[^>]*)?>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^[[{]/.test(v) || /"(tool_call|function_call|arguments|parameters)"/.test(v)) return "";
  if (/^(we need to|i need to|i will|i am currently|let me|the user)/i.test(v)) return "";
  if (v.length > 140) v = `${v.slice(0, 140)}…`;
  return v;
};

/**
 * Single quiet "thinking / tools" surface for every turn type.
 * - Collapsed: one line — icon, live headline (shimmer while running), elapsed time.
 * - Expanded: a tidy vertical timeline of real steps (max 3 reasoning lines).
 */
const ThinkingTrace = ({
  status,
  steps,
  text,
  active,
  tool,
  variant = "default",
  defaultOpen,
  className = "",
}: ThinkingTraceProps) => {
  const lang = useUserLang();
  const [open, setOpen] = useState(!!defaultOpen);
  const rtl = RTL_LANGS.has(lang);
  const isAr = lang.startsWith("ar");

  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    const incoming = [...(steps || []), status || ""].map(cleanTraceLine).filter(Boolean);
    if (!incoming.length) return;
    setHistory((prev) => {
      const next = [...prev];
      for (const l of incoming) if (!next.includes(l)) next.push(l);
      return next.length === prev.length ? prev : next.slice(-40);
    });
  }, [steps, status]);

  const startRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);

  const reasoningLines = useMemo(() => {
    if (!text?.trim()) return [] as string[];
    const out: string[] = [];
    for (const p of text.trim().split(/\n+/)) {
      const v = cleanTraceLine(p);
      if (v && !out.includes(v)) out.push(v);
      if (out.length >= 3) break;
    }
    return out;
  }, [text]);

  const lines = history.length ? history : reasoningLines;
  const live = cleanTraceLine(status || "") || history[history.length - 1] || "";
  const headerKind = tool ? detectServiceKind(tool) : detectServiceKind(live);

  if (!lines.length && !active) return null;

  const KIND_AR: Record<string, string> = { search: "بيدوّر على الإنترنت", browse: "بيقرا الصفحات", code: "بيكتب ويشغّل كود", agent: "بيكلّم وكيل متخصص", video: "بيجهز الفيديو", image: "بيرسم الصورة", slides: "بيعمل الشرائح", docs: "بيكتب المستند", memory: "بيفتكر كلامكم", computer: "بيشتغل على الكمبيوتر", integration: "بيفتح تطبيقاتك", tool: "بيستخدم أداة" };
  const KIND_EN: Record<string, string> = { search: "Searching the web", browse: "Reading pages", code: "Writing and running code", agent: "Asking a specialist agent", video: "Making the video", image: "Drawing the image", slides: "Building slides", docs: "Writing the document", memory: "Recalling", computer: "Using the computer", integration: "Opening your apps", tool: "Using a tool" };
  const IDLE_AR = ["بيفهم طلبك", "بيفكر", "بيرتّب الأفكار", "بيجهز الرد"];
  const IDLE_EN = ["Understanding your request", "Thinking", "Organizing ideas", "Preparing the answer"];
  const kindLine = headerKind !== "thinking" ? (isAr ? KIND_AR : KIND_EN)[headerKind] : "";
  const idle = (isAr ? IDLE_AR : IDLE_EN)[Math.min(3, Math.floor(elapsed / 4))];
  const liveLabel = live || kindLine || reasoningLines[reasoningLines.length - 1] || idle;
  const usedTools = variant === "tools" || history.length > 1;
  const label = active
    ? liveLabel
    : usedTools
      ? isAr
        ? `استخدم ${lines.length} ${lines.length === 1 ? "خطوة" : "خطوات"}`
        : `Used ${lines.length} ${lines.length === 1 ? "step" : "steps"}`
      : isAr
        ? elapsed > 0
          ? `فكّر لمدة ${elapsed} ث`
          : "عرض التفكير"
        : elapsed > 0
          ? `Thought for ${elapsed}s`
          : "Show thinking";

  return (
    <div
      className={`mb-3 min-w-0 ${className}`}
      dir={rtl ? "rtl" : undefined}
      data-tool-timeline={variant === "tools" ? true : undefined}
    >
      <button
        type="button"
        onClick={() => lines.length && setOpen((v) => !v)}
        aria-expanded={open}
        className="group inline-flex max-w-full items-center gap-2 rounded-full py-1 text-start text-muted-foreground transition-colors hover:text-foreground"
      >
        <ServiceIcon kind={headerKind} active={!!active} size={15} />
        <span
          key={active ? label : "done"}
          className={`min-w-0 truncate text-[13px] animate-in fade-in slide-in-from-bottom-1 duration-300 ${active ? "thinking-shimmer" : ""}`}
          aria-live="polite"
        >
          {label}
        </span>
        {lines.length > 0 && (
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        )}
      </button>

      {open && lines.length > 0 && (
        <ol className="relative mt-1.5 flex min-w-0 flex-col gap-2 ps-[7px]">
          <span aria-hidden className="absolute inset-y-1 start-[7px] w-px bg-border" />
          {lines.map((line, i) => (
            <li key={`${i}-${line.slice(0, 20)}`} className="relative flex min-w-0 items-start gap-2.5 ps-4">
              <span
                aria-hidden
                className={`absolute start-[-3px] top-[7px] h-[7px] w-[7px] rounded-full border border-border bg-background ${
                  active && i === lines.length - 1 ? "animate-pulse bg-primary" : ""
                }`}
              />
              <span className="min-w-0 flex-1 break-words text-[12.5px] leading-relaxed text-muted-foreground">
                {line}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default memo(ThinkingTrace);
