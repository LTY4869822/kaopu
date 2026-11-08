import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle, Image, Plug, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import "./model-settings.css";
import { ActionButton } from "./ui/controls";

type Kind = "text" | "vision";
type Connection = { configured: boolean; verified: boolean; baseUrl: string; model: string; hasKey: boolean; maskedKey: string; useTextProvider: boolean; verifiedAt: string | null };
type Connections = Record<Kind, Connection>;
type Draft = { baseUrl: string; model: string; apiKey: string; useTextProvider: boolean };
type Props = { open: boolean; onOpenChange: (open: boolean) => void; onConnected: () => unknown | Promise<unknown>; embedded?: boolean; initialKind?: Kind };
const blank = (): Draft => ({ baseUrl: "https://api.deepseek.com", model: "deepseek-flash", apiKey: "", useTextProvider: false });
const draftsFor = (status: Connections): Record<Kind, Draft> => ({
  text: { ...blank(), baseUrl: status.text.baseUrl || blank().baseUrl, model: status.text.model || blank().model },
  vision: { ...blank(), baseUrl: status.vision.baseUrl || blank().baseUrl, model: status.vision.model || blank().model, useTextProvider: status.vision.useTextProvider || (!status.vision.configured && status.text.configured) },
});
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : "连接未完成，请稍后重试。";

async function request<T>(route: string, signal: AbortSignal, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/model-service${route}`, { method, signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let value;
  try { value = await response.json(); } catch { throw new Error("暂时无法读取模型连接，请稍后重试。"); }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired"));
    throw new Error(value.error || "模型连接未完成，请检查配置后重试。");
  }
  return value as T;
}

export default function ModelSettings({ open, onOpenChange, onConnected, embedded = false, initialKind = "text" }: Props) {
  const [kind, setKind] = useState<Kind>("text");
  const [connections, setConnections] = useState<Connections | null>(null);
  const [drafts, setDrafts] = useState<Record<Kind, Draft>>({ text: blank(), vision: blank() });
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState<"save" | "test" | "">("");
  const [error, setError] = useState(""), [feedback, setFeedback] = useState("");
  const alive = useRef(false), locked = useRef(false);
  const session = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const callbacks = useRef({ onConnected, onOpenChange });
  callbacks.current = { onConnected, onOpenChange };
  const draft = drafts[kind], saved = connections?.[kind];
  const shared = kind === "vision" && draft.useTextProvider;

  useEffect(() => {
    if (!open) { setDrafts({ text: blank(), vision: blank() }); setLoading(true); setError(""); setFeedback(""); return; }
    const version = ++session.current;
    alive.current = true; setKind(initialKind); setLoading(true); setError(""); setFeedback("");
    const controller = new AbortController(); controllers.current.add(controller);
    void request<Connections>("", controller.signal).then(status => {
      if (alive.current && session.current === version) { setConnections(status); setDrafts(draftsFor(status)); }
    }).catch(cause => { if (alive.current && session.current === version && !controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { controllers.current.delete(controller); if (alive.current && session.current === version) setLoading(false); });
    return () => { session.current++; alive.current = false; controllers.current.forEach(item => item.abort()); controllers.current.clear(); };
  }, [open, initialKind]);

  function changeOpen(next: boolean) {
    if (!next) {
      session.current++; alive.current = false; controllers.current.forEach(item => item.abort()); controllers.current.clear();
      setDrafts({ text: blank(), vision: blank() }); setBusy(""); setLoading(true); locked.current = false;
    }
    callbacks.current.onOpenChange(next);
  }
  function update(patch: Partial<Draft>) {
    setDrafts(current => ({ ...current, [kind]: { ...current[kind], ...patch } })); setError(""); setFeedback("");
  }
  function select(next: Kind) { setKind(next); setError(""); setFeedback(""); }
  async function connect(save: boolean) {
    if (locked.current || loading || !alive.current) return;
    locked.current = true; setBusy(save ? "save" : "test"); setError(""); setFeedback("");
    const controller = new AbortController(); controllers.current.add(controller);
    const target = kind, version = session.current;
    const current = () => alive.current && session.current === version && !controller.signal.aborted;
    try {
      if (save) {
        const status = await request<Connections>(`/${target}`, controller.signal, "PUT", draft);
        if (!current()) return;
        setConnections(status);
        setDrafts(current => ({ ...current, [target]: { ...current[target], apiKey: "" } }));
        try { await callbacks.current.onConnected(); }
        catch { if (current()) setFeedback("模型已连接。课程列表暂未刷新，可重新打开课程页面。"); return; }
        if (current()) setFeedback(target === "text" ? "文字模型已连接，可以生成讲义。" : "视觉模型已连接，可以识别板书。");
      } else {
        await request(`/${target}/test`, controller.signal, "POST", draft);
        if (current()) setFeedback(target === "text" ? "文字生成测试通过，保存后即可使用。" : "图片识别测试通过，保存后即可使用。");
      }
    } catch (cause) { if (current()) setError(errorText(cause)); }
    finally { controllers.current.delete(controller); if (session.current === version) { locked.current = false; if (alive.current) setBusy(""); } }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void connect(true); }
  const canSubmit = shared ? !!connections?.text.configured : !!draft.baseUrl.trim() && !!draft.model.trim();
  const dirty = !!saved?.configured && (shared ? !saved.useTextProvider : saved.useTextProvider || draft.baseUrl !== saved.baseUrl || draft.model !== saved.model || !!draft.apiKey);
  const statusText = dirty ? "配置已修改，待测试" : saved?.verified ? "已验证" : saved?.configured ? "已填写，待验证" : "未连接";

  const content = <>
      <div className="model-service-tabs" role="group" aria-label="选择模型用途">
        <button type="button" aria-pressed={kind === "text"} disabled={!!busy} onClick={() => select("text")}><Sparkle size={18} />文字模型</button>
        <button type="button" aria-pressed={kind === "vision"} disabled={!!busy} onClick={() => select("vision")}><Image size={18} />视觉模型</button>
      </div>
      <form className="model-settings-form" onSubmit={submit}>
        <div className={`model-service-status ${saved?.verified && !dirty ? "is-verified" : ""}`} role="status">{saved?.verified && !dirty ? <CheckCircle size={17} /> : <Plug size={17} />}<span>{loading ? "正在读取连接…" : statusText}</span>{!shared && <button type="button" disabled={loading || !!busy} onClick={() => update(blank())}>填入 DeepSeek</button>}</div>
        {kind === "vision" && <label className="model-reuse"><input type="checkbox" checked={draft.useTextProvider} disabled={loading || !!busy || !connections?.text.configured} onChange={event => update({ useTextProvider: event.target.checked })} /><span>复用文字模型</span>{!connections?.text.configured && <small>先连接文字模型</small>}</label>}
        {kind === "vision" && <p className="model-reuse-hint">板书截图和公式识别需要「视觉模型」。如果文字模型本身支持看图（多模态模型），勾选上面的「复用文字模型」即可，不用再填一遍密钥。</p>}
        {shared ? <div className="model-reuse-info"><strong>{connections?.text.model}</strong><span>{connections?.text.baseUrl}</span></div> : <>
          <label>接口地址<input type="url" aria-label="模型接口地址" value={draft.baseUrl} onChange={event => update({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" maxLength={2000} disabled={loading || !!busy} required autoComplete="off" spellCheck={false} /></label>
          <label>模型名称<input aria-label="模型名称" value={draft.model} onChange={event => update({ model: event.target.value })} placeholder="填写服务商提供的模型名称" maxLength={200} disabled={loading || !!busy} required autoComplete="off" spellCheck={false} /></label>
          <label>API 密钥<span className="model-key-help">{saved?.hasKey && saved.baseUrl === draft.baseUrl ? "已保存，留空保留" : "本机服务可留空"}</span><input type="password" aria-label="API 密钥" value={draft.apiKey} onChange={event => update({ apiKey: event.target.value })} placeholder={saved?.hasKey && saved.baseUrl === draft.baseUrl ? "留空使用当前接口的已存密钥" : "仅保存在本机服务端"} maxLength={8192} disabled={loading || !!busy} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" /></label>
        </>}
        {error && <p className="model-service-error" role="alert"><WarningCircle size={18} /><span>{error}</span></p>}
        {feedback && <p className="model-service-feedback" role="status"><CheckCircle size={18} /><span>{feedback}</span></p>}
        <div className="model-settings-actions"><ActionButton arrow={false} busy={busy === "test"} className="secondary" disabled={loading || !!busy || !canSubmit} onClick={() => void connect(false)}>{busy === "test" ? "正在测试…" : "仅测试"}</ActionButton><ActionButton type="submit" busy={busy === "save"} disabled={loading || !!busy || !canSubmit}>{busy === "save" ? "正在连接…" : "测试并保存"}</ActionButton></div>
      </form>
  </>;
  if (embedded) return <section className="model-settings-embedded" aria-label="API 连接配置">{content}</section>;
  return <Dialog.Root open={open} onOpenChange={changeOpen}><Dialog.Portal>
    <Dialog.Overlay className="modal-overlay model-settings-overlay" />
    <Dialog.Content className="modal model-settings-dialog sf-control-surface">
      <div className="modal-heading"><Dialog.Title>连接模型</Dialog.Title><Dialog.Close className="icon-button" aria-label="关闭模型设置"><X size={22} /></Dialog.Close></div>
      <Dialog.Description>原文和图片发送至你配置的服务。</Dialog.Description>
      {content}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
