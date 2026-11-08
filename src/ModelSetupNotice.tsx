import { useState } from "react";
import type { ReactNode } from "react";
import { WarningCircle, X } from "@phosphor-icons/react";
import "./model-setup-notice.css";

// 关闭状态分两种：这次先跳过（当前浏览器会话）和不再提醒（长期保存）。
const keyFor = (id: string, scope: "session" | "forever") => `shifen:model-notice:${id}:${scope}`;
function stored(scope: "session" | "forever", id: string) {
  try { return (scope === "session" ? sessionStorage : localStorage).getItem(keyFor(id, scope)) === "1"; }
  catch { return false; }
}
function remember(scope: "session" | "forever", id: string) {
  try { (scope === "session" ? sessionStorage : localStorage).setItem(keyFor(id, scope), "1"); }
  catch { /* 存储不可用时仍然可以关闭本次提醒。 */ }
}

type Props = {
  id: string;
  title: string;
  description: ReactNode;
  actionLabel: string;
  onConfigure: () => void;
  tone?: "warning" | "info";
};

export default function ModelSetupNotice({ id, title, description, actionLabel, onConfigure, tone = "warning" }: Props) {
  const [closed, setClosed] = useState(() => stored("forever", id) || stored("session", id));
  if (closed) return null;
  return <aside className={`model-setup-notice is-${tone}`} role="alert">
    <WarningCircle size={20} aria-hidden="true" />
    <div className="model-setup-notice-copy">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
    <div className="model-setup-notice-actions">
      <button type="button" className="model-setup-notice-primary" onClick={onConfigure}>{actionLabel}</button>
      <button type="button" onClick={() => { remember("session", id); setClosed(true); }}>这次先跳过</button>
      <button type="button" onClick={() => { remember("forever", id); setClosed(true); }}>不再提醒</button>
      <button type="button" className="model-setup-notice-close" aria-label="关闭这条提醒" onClick={() => { remember("session", id); setClosed(true); }}><X size={16} /></button>
    </div>
  </aside>;
}
