import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowRight, Database, DownloadSimple, GearSix, Plug, SignOut, UserCircle, WarningCircle } from "@phosphor-icons/react";
import ModelSettings from "./ModelSettings";
import { api } from "./api";
import type { State } from "./types";
import "./app-settings.css";
import { ActionButton } from "./ui/controls";

type Props = { settings: State["settings"]; accountName?: string; onRefresh: () => Promise<unknown>; onNotify: (message: string) => void; onOpenPlan: () => void; onReset: () => void; onLogout?: () => Promise<unknown> };
const tabs = [{ id: "api", label: "API 与模型", icon: Plug }, { id: "study", label: "复习偏好", icon: GearSix }, { id: "account", label: "账户与数据", icon: UserCircle }] as const;
type Tab = typeof tabs[number]["id"];
export default function AppSettings({ settings, accountName, onRefresh, onNotify, onOpenPlan, onReset, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("api"), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [name, setName] = useState(settings.name), [minutes, setMinutes] = useState(String(settings.dailyMinutes)), [goal, setGoal] = useState(settings.goal);
  const locked = useRef(false), tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  function navigateTabs(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault(); setTab(tabs[next].id); tabButtons.current[next]?.focus();
  }
  async function save() {
    if (locked.current) return;
    locked.current = true; setSaving(true); setError("");
    try {
      await api("/settings", "PATCH", { name: name.trim(), dailyMinutes: Number(minutes), goal });
      onNotify("复习偏好已保存。"); await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : "保存未完成，请重试。"); }
    finally { locked.current = false; setSaving(false); }
  }
  return <section className="app-settings" aria-label="应用设置">
    <div className="st-tabs" role="tablist" aria-label="设置分类">{tabs.map((item, i) => <button key={item.id} type="button" id={`settings-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`settings-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} ref={el => { tabButtons.current[i] = el; }} onClick={() => setTab(item.id)} onKeyDown={e => navigateTabs(e, i)}><item.icon size={19} />{item.label}</button>)}</div>
    <div className="st-panel" role="tabpanel" id="settings-panel-api" aria-labelledby="settings-tab-api" hidden={tab !== "api"}>
      <div className="st-section-heading"><h2>连接你的 AI 服务</h2><p>用于整理笔记、课程答疑、练习讲评，以及笔记和板书识别。</p></div>
      <ModelSettings embedded open onOpenChange={() => {}} onConnected={onRefresh} />
      <p className="st-hint">原文与图片会发送至你配置的服务。API 密钥仅保存在本机服务端，已保存的密钥不会回显。</p>
    </div>
    <div className="st-panel" role="tabpanel" id="settings-panel-study" aria-labelledby="settings-tab-study" hidden={tab !== "study"}>
      <div className="st-section-heading"><h2>按你的节奏复习</h2><p>设置默认投入时间与目标，让复习安排贴近你的实际情况。</p></div>
      <form className="st-form" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>怎么称呼你<input aria-label="怎么称呼你" value={name} maxLength={30} required disabled={saving} onChange={e => setName(e.target.value)} /></label>
        <label>默认每天复习时间<div className="st-input-unit"><input aria-label="默认每天复习时间" type="number" min={15} max={720} step={1} required value={minutes} disabled={saving} onChange={e => setMinutes(e.target.value)} /><span>分钟</span></div><small>可设置 15–720 分钟；每周安排和单日调整优先于此默认值。</small></label>
        <fieldset className="st-goals"><legend>复习目标</legend>{[{ id: "balanced", name: "兼顾保过与提分", detail: "先稳住基础，再补薄弱点。" }, { id: "pass", name: "优先基础保过", detail: "优先复习高收益的基础内容。" }, { id: "high", name: "面向高分冲刺", detail: "加强综合应用与进阶练习。" }].map(item => <label key={item.id} className={goal === item.id ? "is-selected" : ""}><input type="radio" name="settings-goal" value={item.id} checked={goal === item.id} disabled={saving} onChange={() => setGoal(item.id)} /><span><strong>{item.name}</strong><small>{item.detail}</small></span></label>)}</fieldset>
        {error && <p className="st-error" role="alert"><WarningCircle size={18} />{error}</p>}
        <div className="st-actions"><ActionButton type="submit" arrow={false} busy={saving} disabled={saving}>{saving ? "正在保存…" : "保存复习偏好"}</ActionButton><button type="button" className="text-button" onClick={onOpenPlan}>打开复习规划<ArrowRight size={16} /></button></div>
      </form>
    </div>
    <div className="st-panel" role="tabpanel" id="settings-panel-account" aria-labelledby="settings-tab-account" hidden={tab !== "account"}>
      <div className="st-section-heading"><h2>账户与学习数据</h2><p>管理当前账户，保管好你的课程资料与学习记录。</p></div>
      <div className="st-account-row"><UserCircle size={32} /><div><strong>{accountName || settings.name || "同学"}</strong><span>{onLogout ? "当前已登录" : "本机学习空间"}</span></div>{onLogout && <button type="button" className="secondary" onClick={() => { void onLogout().catch(e => onNotify(e.message || "退出未完成，请重试。")); }}><SignOut size={17} />退出登录</button>}</div>
      <div className="st-data-row"><div><h3><Database size={19} />数据备份</h3><p>导出课程、笔记与复习记录，保存一份本机备份。</p></div><a href="/api/export" download="kaopu-backup.json" className="secondary"><DownloadSimple size={17} />导出学习数据</a></div>
      <p className="st-hint">资料和进度保存在当前电脑，手机页面适配不代表已开启云端同步。</p>
      <details className="st-advanced"><summary>清空学习空间</summary><p>将移除当前课程、资料与学习记录。请先导出备份，下一步仍需确认。</p><button type="button" className="st-danger" onClick={onReset}>打开清空确认</button></details>
    </div>
  </section>;
}
