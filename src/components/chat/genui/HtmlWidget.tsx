/** @doc Renders a model-written ```widget HTML block inside a sandboxed iframe
 *  (scripts allowed, no same-origin — it cannot touch the app or the session).
 *  A built-in stylesheet gives every widget the same clean look; the widget
 *  calls megsy.send("text") to answer the agent and auto-sizes to its content. */
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { GenUIActionContext } from "./GenUIBlock";

const BASE_CSS = `
:root{--bg:#ffffff;--fg:#141414;--muted:#6b6b6b;--line:#e8e8e6;--soft:#f5f5f3;--accent:#141414;--accent-fg:#fff;--good:#1f9d55;--warn:#d97706;--bad:#dc2626;--info:#2563eb;--r:18px}
html.dark{--bg:#1b1b1b;--fg:#f2f2f0;--muted:#a3a3a0;--line:#2e2e2c;--soft:#242422;--accent:#f2f2f0;--accent-fg:#141414}
*{box-sizing:border-box;margin:0}
html,body{background:transparent;color:var(--fg);font:14px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","IBM Plex Sans Arabic",Tahoma,sans-serif;-webkit-font-smoothing:antialiased}
body{padding:2px}
h1,h2,h3{letter-spacing:-.01em;line-height:1.25}h1{font-size:22px}h2{font-size:18px}h3{font-size:15px}
p{color:var(--muted)}
ul,ol{padding-inline-start:20px;color:var(--fg)}li+li{margin-top:4px}li::marker{color:var(--muted)}
img{max-width:100%;background:var(--soft);display:block;border-radius:14px;object-fit:cover}
.card{background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:18px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 10px 30px -14px rgba(0,0,0,.18)}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}
.stack>*+*{margin-top:12px}
.stat{background:var(--soft);border-radius:14px;padding:14px}.stat b{display:block;font-size:22px;letter-spacing:-.02em}.stat span{font-size:12px;color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--soft)}
.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}.info{color:var(--info)}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;background:currentColor}
button,.btn{font:inherit;font-weight:600;border:1px solid var(--line);background:var(--bg);color:var(--fg);padding:9px 16px;border-radius:999px;cursor:pointer;transition:.15s}
button:hover{background:var(--soft)}button:active{transform:scale(.97)}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);width:100%;padding:12px}
.chip{border-radius:14px;padding:10px 14px;text-align:start}.chip[aria-pressed=true],.chip.on{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
input,select,textarea{font:inherit;width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:14px;background:var(--soft);color:var(--fg);outline:none}
input[type=range]{padding:0;accent-color:var(--accent);background:none;border:0}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:start;font-size:12px;color:var(--muted);font-weight:600;padding:8px 10px;background:var(--soft)}td{padding:9px 10px;border-top:1px solid var(--line)}
.bar{height:8px;border-radius:99px;background:var(--soft);overflow:hidden}.bar>i{display:block;height:100%;background:var(--accent);border-radius:99px}
.muted{color:var(--muted)}.small{font-size:12px}
`;

const BRIDGE = `<script>
window.megsy={send:function(t){parent.postMessage({__megsy:'send',id:window.name,text:String(t)},'*')}};
document.addEventListener('click',function(e){var el=e.target.closest('[data-send]');if(el){e.preventDefault();megsy.send(el.getAttribute('data-send')||el.textContent.trim())}});
function __h(){parent.postMessage({__megsy:'h',id:window.name,h:Math.ceil(document.body.getBoundingClientRect().height)+8},'*')}
document.querySelectorAll('img[data-q]').forEach(function(im){fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=800&gsrsearch='+encodeURIComponent(im.getAttribute('data-q'))).then(function(r){return r.json()}).then(function(j){var p=Object.values((j.query||{}).pages||{}).sort(function(a,b){return a.index-b.index}).find(function(x){return x.thumbnail});if(p){im.src=p.thumbnail.source}}).catch(function(){})});
new ResizeObserver(__h).observe(document.body);addEventListener('load',__h);document.addEventListener('load',__h,true);[50,300,1000,2500].forEach(function(t){setTimeout(__h,t)});
</script>`;

export function HtmlWidget({ html, done }: { html: string; done: boolean }) {
  const onSend = useContext(GenUIActionContext);
  const ref = useRef<HTMLIFrameElement>(null);
  const id = useMemo(() => `w${Math.random().toString(36).slice(2)}`, []);
  const [h, setH] = useState(120);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!e.data?.__megsy || e.data.id !== id) return;
      if (e.data.__megsy === "h") setH(Math.min(2400, Math.max(40, Number(e.data.h) || 0)));
      if (e.data.__megsy === "send" && onSend) onSend(String(e.data.text).slice(0, 2000));
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [onSend]);

  const dark = useMemo(() => {
    if (typeof window === "undefined") return false;
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    return m ? (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 < 110 : false;
  }, []);
  const doc = useMemo(
    () => `<!doctype html><html class="${dark ? "dark" : ""}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_CSS}</style></head><body dir="auto">${html}${BRIDGE}</body></html>`,
    [html, dark],
  );

  if (!done || !mounted) {
    return <div className="my-4 h-40 animate-pulse rounded-3xl border border-border/60 bg-muted/40" />;
  }
  return (
    <iframe
      ref={ref}
      name={id}
      title="Interactive answer"
      sandbox="allow-scripts"
      srcDoc={doc}
      style={{ height: h }}
      className="my-4 block w-full border-0 bg-transparent transition-[height] duration-200"
    />
  );
}
