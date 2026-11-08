import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowClockwise, ArrowRight, BookOpen, CalendarBlank, CaretDown,
  CaretLeft, CaretRight, Check, CheckCircle, Clock, Coffee,
  Info, ListChecks, Plus, SlidersHorizontal, Sparkle, Target, Trash, X,
} from "@phosphor-icons/react";
import { api, dayKey } from "./api";
import type { State, Task } from "./types";
import type { PlannerCourse, PlannerOverride, PlannerResult, PlannerSettings, PlannerState, PlannerWindow } from "./planner-types";
import "./study-planner.css";

type Props = {
  state: State;
  onRefresh: () => Promise<unknown>;
  onNotify: (message: string) => void;
  onOpenTask: (task: Task) => void;
  onAddCourse: () => void;
  focusTimer?: ReactNode;
};
type CourseDraft = {
  id: string; name: string; examDate: string; examTime: string; difficulty: number;
  target: number; mastery: number; remainingHours: string; prepStartDate: string;
};
const weekNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const taskNames = { learn: "理解与梳理", practice: "练习与检验", review: "主动回忆" };
const goals = [
  { value: "pass", label: "及格优先", detail: "先打牢基础，把有限时间用在最需要的课程。" },
  { value: "balanced", label: "兼顾提分", detail: "补齐薄弱点，同时保持练习和间隔回忆。" },
  { value: "high", label: "高绩点", detail: "增加独立练习、综合检验和考前回顾。" },
] as const;
const progressTicks = Array.from({ length: 40 }, (_, index) => {
  const angle = (index / 40 * 360 - 90) * Math.PI / 180;
  const inner = index % 5 === 0 ? 44 : 47;
  return { x1: 56 + Math.cos(angle) * inner, y1: 56 + Math.sin(angle) * inner, x2: 56 + Math.cos(angle) * 50, y2: 56 + Math.sin(angle) * 50 };
});
const amount = (minutes: number) => {
  const rounded = Math.max(0, Math.round(minutes || 0));
  return rounded >= 60 ? `${Math.floor(rounded / 60)} 小时${rounded % 60 ? ` ${rounded % 60} 分` : ""}` : `${rounded} 分钟`;
};
const addDays = (date: string, offset: number) => {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + offset);
  return dayKey(next);
};
const displayDate = (date: string) => {
  const value = new Date(`${date}T12:00:00`);
  return `${value.getMonth() + 1}月${value.getDate()}日`;
};
function defaultSettings(state: PlannerState): PlannerSettings {
  const value = state.settings.planner;
  return {
    startDate: value?.startDate || dayKey(),
    goal: ["pass", "high"].includes(state.settings.goal) ? state.settings.goal as "pass" | "high" : "balanced",
    mode: value?.mode || "timeline", blockMinutes: value?.blockMinutes || 40,
    breakMinutes: value?.breakMinutes || 10, reservePercent: value?.reservePercent ?? 10,
    windows: value?.windows?.map(window => ({ ...window })) || [{ start: "19:00", end: "23:00" }],
    weeklyMinutes: value?.weeklyMinutes?.slice() || Array(7).fill(state.settings.dailyMinutes),
    overrides: value?.overrides?.map(item => ({ ...item, windows: item.windows?.map(window => ({ ...window })) })) || [],
  };
}
const draftsFor = (courses: PlannerCourse[]): CourseDraft[] => courses.map(course => ({
  id: course.id, name: course.name, examDate: course.examDate || "", examTime: course.examTime || "",
  difficulty: course.difficulty || 3, target: course.target, mastery: Math.round(course.mastery),
  remainingHours: course.remainingHours == null ? "" : String(course.remainingHours), prepStartDate: course.prepStartDate || "",
}));
const weekdayIndex = (date: string) => (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
const overrideSignature = (minutes: number, windows: PlannerWindow[]) => `${minutes}|${windows.map(window => `${window.start}-${window.end}`).join(",")}`;
const mergeOverride = (list: PlannerOverride[], entry: PlannerOverride) => [...list.filter(item => item.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date));

export default function StudyPlanner({ state: baseState, onRefresh, onNotify, onOpenTask, onAddCourse, focusTimer }: Props) {
  const state = baseState as PlannerState;
  const [date, setDate] = useState(dayKey());
  const [result, setResult] = useState<PlannerResult | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [editing, setEditing] = useState(false), [configTab, setConfigTab] = useState("time");
  const [focusedCourseId, setFocusedCourseId] = useState<string | null>(null);
  const courseEditors = useRef(new Map<string, HTMLDetailsElement>());
  const [draft, setDraft] = useState<PlannerSettings>(() => defaultSettings(state));
  const [courseDrafts, setCourseDrafts] = useState(() => draftsFor(state.courses));
  const [mode, setMode] = useState<"day" | "timeline">(() => defaultSettings(state).mode);
  const [saving, setSaving] = useState(false), [pendingTask, setPendingTask] = useState("");
  const [formError, setFormError] = useState("");
  const [overrideDate, setOverrideDate] = useState(dayKey());
  const [overrideMinutes, setOverrideMinutes] = useState(state.settings.dailyMinutes);
  const [overrideWindows, setOverrideWindows] = useState<PlannerWindow[]>([{ start: "19:00", end: "23:00" }]);
  const overrideBaseline = useRef("");
  const configRef = useRef<HTMLElement>(null);
  const request = useRef(0), actionLock = useRef(false);
  const callbacks = useRef({ onRefresh, onNotify });
  callbacks.current = { onRefresh, onNotify };
  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    try {
      const next = await api<PlannerResult>(`/planner?date=${date}&days=14`);
      if (request.current === version) { setResult(next); setError(""); }
    } catch (cause) { if (request.current === version) setError((cause as Error).message); }
    finally { if (request.current === version) setLoading(false); }
  }, [date]);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => { void load(); return () => { request.current++; }; }, [load, baseState]);
  useEffect(() => {
    const handle = () => { if (!document.hidden && !actionLock.current) void load(); };
    const interval = window.setInterval(handle, 60000);
    window.addEventListener("focus", handle);
    return () => { clearInterval(interval); window.removeEventListener("focus", handle); };
  }, [load]);
  useEffect(() => { if (result?.settings.mode) setMode(result.settings.mode); }, [result?.settings.mode]);
  useEffect(() => {
    if (!editing || configTab !== "courses" || !focusedCourseId) return;
    const editor = courseEditors.current.get(focusedCourseId);
    if (!editor) return;
    editor.open = true;
    const frame = requestAnimationFrame(() => {
      editor.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      editor.querySelector("summary")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [editing, configTab, focusedCourseId]);
  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => configRef.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const settings = result?.settings || defaultSettings(state);
  const selected = result?.days.find(day => day.date === date);
  const courses = new Map(state.courses.map(course => [course.id, course]));
  const summaries = result?.courses || [];
  const shortageFor = (item: PlannerResult["courses"][number]) => mode === "timeline" ? item.timelineShortfallMinutes ?? item.shortfallMinutes : item.shortfallMinutes;
  const shortages = summaries.filter(item => shortageFor(item) > 0 && item.status === "ready");
  const missingDates = summaries.filter(item => item.status === "missing-date").length;
  const upcoming = state.courses.filter(course => course.examDate && course.examDate >= dayKey()).sort((a, b) => a.examDate.localeCompare(b.examDate));
  const completedCount = selected?.tasks.filter(task => task.completed).length || 0;
  const allTasks = selected?.tasks || [];
  const nextTask = allTasks.find(task => !task.completed);
  const completedIds = new Set(allTasks.filter(task => task.completed).map(task => task.id));
  const byTask = new Map(allTasks.map(task => [task.id, task]));
  const monday = addDays(date, -((new Date(`${date}T12:00:00`).getDay() + 6) % 7));
  const progress = selected?.allocated ? Math.min(100, Math.round(selected.completedMinutes / selected.allocated * 100)) : 0;
  const hasProgress = !!selected?.allocated && allTasks.length > 0;
  const phaseGoal = goals.find(goal => goal.value === settings.goal) || goals[1];

  function closeSettings() {
    setEditing(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".sp-adjust")?.focus());
  }
  function openSettings(tab = "time", courseId?: string) {
    const next: PlannerSettings = {
      ...settings,
      windows: settings.windows.map(window => ({ ...window })),
      weeklyMinutes: settings.weeklyMinutes.slice(),
      overrides: settings.overrides.map(item => ({ ...item, windows: item.windows?.map(window => ({ ...window })) })),
    };
    const existing = next.overrides.find(item => item.date === date);
    const minutes = existing?.minutes ?? next.weeklyMinutes[weekdayIndex(date)] ?? state.settings.dailyMinutes;
    const windows = (existing?.windows || next.windows).map(window => ({ ...window }));
    setDraft(next);
    setCourseDrafts(draftsFor(state.courses));
    setOverrideDate(date); setOverrideMinutes(minutes); setOverrideWindows(windows);
    overrideBaseline.current = overrideSignature(minutes, windows);
    setFocusedCourseId(courseId || null);
    setConfigTab(tab); setFormError(""); setEditing(true);
  }
  function changeOverrideDate(value: string) {
    if (!value) return;
    const existing = draft.overrides.find(item => item.date === value);
    const minutes = existing?.minutes ?? draft.weeklyMinutes[weekdayIndex(value)] ?? state.settings.dailyMinutes;
    const windows = (existing?.windows || draft.windows).map(window => ({ ...window }));
    setOverrideDate(value); setOverrideMinutes(minutes); setOverrideWindows(windows);
    overrideBaseline.current = overrideSignature(minutes, windows);
    setFormError("");
  }
  function stageOverride(minutes: number) {
    if (!overrideDate) { setFormError("请选择要调整的日期。"); return; }
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 720) { setFormError("单日可用时间应在 0–720 分钟之间。"); return; }
    const windowError = minutes > 0 ? checkWindows(overrideWindows) : "";
    if (windowError) { setFormError(windowError); return; }
    const windows = overrideWindows.map(window => ({ ...window }));
    setFormError("");
    setDraft(current => ({ ...current, overrides: mergeOverride(current.overrides, { date: overrideDate, minutes, windows }) }));
    setOverrideMinutes(minutes);
    overrideBaseline.current = overrideSignature(minutes, windows);
  }
  function removeOverride(value: string) {
    setDraft(current => ({ ...current, overrides: current.overrides.filter(item => item.date !== value) }));
    if (value !== overrideDate) return;
    const minutes = draft.weeklyMinutes[weekdayIndex(value)] ?? state.settings.dailyMinutes;
    const windows = draft.windows.map(window => ({ ...window }));
    setOverrideMinutes(minutes); setOverrideWindows(windows);
    overrideBaseline.current = overrideSignature(minutes, windows);
  }
  async function changeMode(next: "day" | "timeline") {
    if (next === mode || actionLock.current) return;
    actionLock.current = true; setSaving(true); const previous = mode; setMode(next);
    try {
      await api("/planner", "PATCH", { settings: { mode: next } });
      await callbacks.current.onRefresh();
    } catch (cause) { setMode(previous); callbacks.current.onNotify((cause as Error).message); }
    finally { actionLock.current = false; setSaving(false); }
  }
  async function toggleTask(task: Task) {
    if (actionLock.current) return;
    actionLock.current = true; setPendingTask(task.id);
    try {
      await api(`/planner/tasks/${encodeURIComponent(task.id)}/complete`, "POST", { completed: !task.completed });
      await callbacks.current.onRefresh();
      await latestLoad.current();
      callbacks.current.onNotify(task.completed ? "已恢复为待完成，计划已更新。" : "已记录完成，后续安排已更新。" );
    } catch (cause) { callbacks.current.onNotify((cause as Error).message); }
    finally { actionLock.current = false; setPendingTask(""); }
  }
  function updateCourse(id: string, patch: Partial<CourseDraft>) {
    setCourseDrafts(current => current.map(course => course.id === id ? { ...course, ...patch } : course));
  }
  function checkWindows(windows: PlannerWindow[]) {
    if (!windows.length || windows.some(window => !window.start || !window.end || window.start >= window.end)) return "请填写有效的空闲时段，结束时间需晚于开始时间。";
    const sorted = windows.slice().sort((a, b) => a.start.localeCompare(b.start));
    if (sorted.some((window, index) => index > 0 && window.start < sorted[index - 1].end)) return "空闲时段有重叠，请调整后保存。";
    return "";
  }
  async function saveConfiguration(event: FormEvent) {
    event.preventDefault(); if (actionLock.current) return;
    const windowError = checkWindows(draft.windows);
    if (windowError) { setFormError(windowError); setConfigTab("time"); return; }
    if (courseDrafts.some(course => course.remainingHours !== "" && (!Number.isFinite(Number(course.remainingHours)) || Number(course.remainingHours) < 0 || Number(course.remainingHours) > 300))) {
      setFormError("预计剩余复习时间应在 0–300 小时之间，留空则由系统估算。"); setConfigTab("courses"); return;
    }
    let overrides = draft.overrides;
    const overrideChanged = overrideDate && overrideSignature(overrideMinutes, overrideWindows) !== overrideBaseline.current;
    if (overrideChanged) {
      if (!Number.isFinite(overrideMinutes) || overrideMinutes < 0 || overrideMinutes > 720) { setFormError("单日可用时间应在 0–720 分钟之间。"); setConfigTab("override"); return; }
      const overrideError = overrideMinutes > 0 ? checkWindows(overrideWindows) : "";
      if (overrideError) { setFormError(overrideError); setConfigTab("override"); return; }
      overrides = mergeOverride(overrides, { date: overrideDate, minutes: overrideMinutes, windows: overrideWindows.map(window => ({ ...window })) });
    }
    actionLock.current = true; setSaving(true); setFormError("");
    try {
      await api("/planner", "PATCH", {
        settings: { ...draft, overrides, mode },
        courses: courseDrafts.map(({ name: _name, ...course }) => ({ ...course, remainingHours: course.remainingHours === "" ? null : Number(course.remainingHours) })),
      });
      await callbacks.current.onRefresh(); await latestLoad.current(); closeSettings();
      callbacks.current.onNotify("规划条件已保存，复习安排已重新计算。");
    } catch (cause) { setFormError((cause as Error).message); }
    finally { actionLock.current = false; setSaving(false); }
  }
  function taskCheck(task: Task, explicit = false) {
    return <button type="button" className={`task-check sp-task-check ${task.completed ? "is-checked" : ""}`} disabled={saving || !!pendingTask || date > dayKey()} aria-busy={pendingTask === task.id} aria-label={`${task.completed ? "恢复" : "完成"}${task.title}`} aria-pressed={task.completed} onClick={() => void toggleTask(task)} title={date > dayKey() ? "未来任务可提前查看，到当天再记录完成" : explicit ? "记录整项任务完成" : undefined}>{pendingTask === task.id ? <span className="sp-button-spinner" /> : task.completed ? <Check size={15} weight="bold" /> : null}</button>;
  }
  const colorIndex = (courseId: string) => Math.max(0, state.courses.findIndex(course => course.id === courseId)) % 4;

  return <div className="study-planner">
    <div className="sp-toolbar">
      <div className="sp-view-block">
        <div className={`sp-view-toggle ${saving ? "is-saving" : ""}`} data-mode={mode} role="group" aria-label="规划视图" aria-busy={saving}>
          <span className="sp-view-indicator" aria-hidden="true" />
          <button type="button" className={mode === "timeline" ? "is-active" : ""} aria-pressed={mode === "timeline"} disabled={saving} onClick={() => void changeMode("timeline")}><Clock size={18} />时间线</button>
          <button type="button" className={mode === "day" ? "is-active" : ""} aria-pressed={mode === "day"} disabled={saving} onClick={() => void changeMode("day")}><ListChecks size={18} />按天完成</button>
        </div>
        <span className="sp-view-hint">{mode === "timeline" ? "按空闲时段逐段安排，含休息与续段" : "不排具体时间，只列当天任务"}</span>
      </div>
      <span className="sp-sync" role="status"><span className={loading || saving ? "is-loading" : ""} />{saving ? "正在保存规划" : loading ? "正在更新安排" : "随学习进度更新"}</span>
      <button type="button" className="secondary sp-adjust" aria-label={editing ? "收起设置" : "调整规划"} aria-expanded={editing} aria-controls="planner-configuration" onClick={() => editing ? closeSettings() : openSettings()}><SlidersHorizontal size={18} /><span>{editing ? "收起设置" : "调整规划"}</span></button>
    </div>

    {editing && <section ref={configRef} className="sp-configuration" id="planner-configuration" aria-label="调整复习规划">
      <div className="sp-config-title"><div><h2>把计划调成你的节奏</h2><p>时间、目标和实际基础，都是安排的依据。</p></div><button type="button" className="icon-button" aria-label="关闭规划设置" onClick={closeSettings}><X size={20} /></button></div>
      <div className="sp-config-tabs" role="tablist" aria-label="规划设置分类">
        {[{ id: "time", label: "目标与时间", icon: Target }, { id: "courses", label: "科目设置", icon: BookOpen }, { id: "override", label: "单日调整", icon: CalendarBlank }].map(tab => <button key={tab.id} type="button" role="tab" id={`sp-tab-${tab.id}`} aria-selected={configTab === tab.id} aria-controls={`sp-panel-${tab.id}`} className={configTab === tab.id ? "is-active" : ""} tabIndex={configTab === tab.id ? 0 : -1} onKeyDown={event => {
          const tabs = ["time", "courses", "override"], index = tabs.indexOf(tab.id);
          const next = event.key === "ArrowRight" ? tabs[(index + 1) % 3] : event.key === "ArrowLeft" ? tabs[(index + 2) % 3] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : null;
          if (next) { event.preventDefault(); setConfigTab(next); setFormError(""); document.getElementById(`sp-tab-${next}`)?.focus(); }
        }} onClick={() => { setConfigTab(tab.id); setFormError(""); }}><tab.icon size={18} />{tab.label}</button>)}
      </div>
      <form onSubmit={saveConfiguration}>
        {configTab !== "override" && <div role="tabpanel" id={`sp-panel-${configTab}`} aria-labelledby={`sp-tab-${configTab}`}>
          {configTab === "time" ? <>
            <fieldset className="sp-goals"><legend>这次期末，你更想达到什么目标？</legend><div>{goals.map(goal => <label key={goal.value} className={draft.goal === goal.value ? "is-selected" : ""}><input type="radio" name="planner-goal" value={goal.value} checked={draft.goal === goal.value} onChange={() => setDraft(current => ({ ...current, goal: goal.value }))} /><span><strong>{goal.label}</strong><small>{goal.detail}</small></span><CheckCircle size={20} /></label>)}</div></fieldset>
            <div className="sp-form-section"><div className="sp-form-section-title"><h3>每周能投入多少时间？</h3><p>填的是每天总共可投入的分钟数，0 表示休息。</p></div><div className="sp-week-inputs">{weekNames.map((name, index) => <label key={name}><span>{name}</span><input aria-label={`${name}可用分钟`} type="number" min="0" max="720" step="5" required value={draft.weeklyMinutes[index]} onChange={event => setDraft(current => ({ ...current, weeklyMinutes: current.weeklyMinutes.map((value, day) => day === index ? Number(event.target.value) : value) }))} /><small>分钟</small></label>)}</div></div>
            <div className="sp-time-settings"><div><div className="sp-form-section-title"><h3>通常在哪些时段有空？</h3><p>时间线会在这些时段内安排，并留出休息。</p></div><WindowEditor windows={draft.windows} onChange={windows => setDraft(current => ({ ...current, windows }))} /></div><div className="sp-cadence"><label><span>从哪天开始准备</span><input aria-label="开始准备日期" type="date" required value={draft.startDate} onChange={event => setDraft(current => ({ ...current, startDate: event.target.value }))} /></label><div className="sp-cadence-pair"><label><span>单次专注</span><select aria-label="单次专注时长" value={draft.blockMinutes} onChange={event => setDraft(current => ({ ...current, blockMinutes: Number(event.target.value) as 25 | 40 | 50 }))}><option value="25">25 分钟</option><option value="40">40 分钟</option><option value="50">50 分钟</option></select></label><label><span>段间休息</span><select aria-label="段间休息时长" value={draft.breakMinutes} onChange={event => setDraft(current => ({ ...current, breakMinutes: Number(event.target.value) as 5 | 10 }))}><option value="5">5 分钟</option><option value="10">10 分钟</option></select></label></div><label><span>弹性缓冲 <b>{draft.reservePercent}%</b></span><input type="range" aria-label="弹性缓冲比例" min="0" max="25" step="5" value={draft.reservePercent} onChange={event => setDraft(current => ({ ...current, reservePercent: Number(event.target.value) }))} /><small>为拖延、临时事务和难题多留一点余地。</small></label></div></div>
          </> : <div className="sp-course-config"><p className="sp-help"><Info size={17} />预计还需复习多久最能帮助排期；留空会自动估算。考试时间用于展示，考试当天统一预留，不安排该科新任务。</p>{courseDrafts.map(course => <details key={course.id} id={`sp-course-${encodeURIComponent(course.id)}`} ref={element => { if (element) courseEditors.current.set(course.id, element); else courseEditors.current.delete(course.id); }} className="sp-course-editor" data-targeted={focusedCourseId === course.id || undefined}><summary><span className={`sp-course-dot sp-color-${colorIndex(course.id)}`} /><strong>{course.name}</strong><span>{course.examDate ? displayDate(course.examDate) : "待设置考试日期"}</span><CaretDown size={17} /></summary><div className="sp-course-fields"><label><span>考试日期</span><input aria-label={`${course.name}考试日期`} type="date" value={course.examDate} onChange={event => updateCourse(course.id, { examDate: event.target.value })} /></label><label><span>考试时间</span><input aria-label={`${course.name}考试时间`} type="time" value={course.examTime} onChange={event => updateCourse(course.id, { examTime: event.target.value })} /></label><label><span>对你而言的难度</span><select aria-label={`${course.name}难度`} value={course.difficulty} onChange={event => updateCourse(course.id, { difficulty: Number(event.target.value) })}><option value="1">1 · 轻松</option><option value="2">2 · 较容易</option><option value="3">3 · 适中</option><option value="4">4 · 较难</option><option value="5">5 · 很难</option></select></label><label><span>目标分数</span><input aria-label={`${course.name}目标分数`} type="number" min="1" max="100" required value={course.target} onChange={event => updateCourse(course.id, { target: Number(event.target.value) })} /></label><label><span>当前掌握估计 / 100</span><input aria-label={`${course.name}当前掌握估计`} type="number" min="0" max="100" required value={course.mastery} onChange={event => updateCourse(course.id, { mastery: Number(event.target.value) })} /></label><label><span>预计还需复习 / 小时</span><input aria-label={`${course.name}预计剩余复习小时`} type="number" min="0" max="300" step="0.5" placeholder="留空，由系统估算" value={course.remainingHours} onChange={event => updateCourse(course.id, { remainingHours: event.target.value })} /></label><label><span>这门课从哪天开始</span><input aria-label={`${course.name}准备起点`} type="date" value={course.prepStartDate} onChange={event => updateCourse(course.id, { prepStartDate: event.target.value })} /><small>留空则沿用整体开始日期。</small></label></div></details>)}{!courseDrafts.length && <div className="sp-inline-empty">还没有课程。<button type="button" className="text-button" onClick={onAddCourse}>添加考试科目 <Plus size={16} /></button></div>}</div>}
        </div>}
        {configTab === "override" && <div role="tabpanel" id="sp-panel-override" aria-labelledby="sp-tab-override">
          <p className="sp-help"><Info size={17} />有课、有事或今天状态不佳，只调整这一天。加入后会与其它改动一起保存，剩余工作会在后续可用时间内重新分配。</p>
          <div className="sp-override-fields"><label><span>调整日期</span><input type="date" aria-label="单日调整日期" value={overrideDate} onChange={event => changeOverrideDate(event.target.value)} /></label><label><span>这天可用 / 分钟</span><input type="number" min="0" max="720" step="5" aria-label="单日可用分钟" value={overrideMinutes} onChange={event => setOverrideMinutes(Number(event.target.value))} /></label></div>
          <div className="sp-form-section-title"><h3>这一天的空闲时段</h3></div>
          <WindowEditor windows={overrideWindows} onChange={setOverrideWindows} />
          <div className="sp-override-actions"><button type="button" className="secondary" disabled={saving || !overrideDate} onClick={() => stageOverride(0)}><Coffee size={18} />这天休息</button><button type="button" className="secondary" disabled={saving || !overrideDate} onClick={() => stageOverride(overrideMinutes)}><Plus size={18} />加入调整</button></div>
          {!!draft.overrides.length && <div className="sp-overrides"><h3>待保存的例外日期</h3>{draft.overrides.map(item => <div key={item.date}><span>{displayDate(item.date)}</span><span>{item.minutes ? amount(item.minutes) : "休息日"}</span><button type="button" className="text-button" disabled={saving} onClick={() => removeOverride(item.date)}>恢复常规 <ArrowClockwise size={15} /></button></div>)}</div>}
        </div>}
        {formError && <p className="sp-form-error" role="alert">{formError}</p>}
        <div className="sp-config-footer"><p>保存后重新排期，已完成的学习记录会保留。</p><button type="submit" className="primary" disabled={saving}>{saving ? "正在更新…" : "保存并重新规划"}<ArrowRight size={17} /></button></div>
      </form>
    </section>}

    {error && <div className="sp-error" role="alert"><Info size={20} /><p>{error}</p><button type="button" className="text-button" onClick={() => void load()}>重新加载 <ArrowClockwise size={16} /></button></div>}
    <div className="sp-layout">
      <section className="sp-agenda" aria-label="复习安排">
        <div className="sp-calendar-heading"><div><CalendarBlank size={20} /><strong>{new Date(`${date}T12:00:00`).getFullYear()} 年 {new Date(`${date}T12:00:00`).getMonth() + 1} 月</strong></div><div><button type="button" className="text-button" onClick={() => setDate(dayKey())}>今天</button><label className="sp-date-picker"><input type="date" aria-label="查看计划日期" value={date} onChange={event => event.target.value && setDate(event.target.value)} /></label><button type="button" className="icon-button" aria-label="上一周" onClick={() => setDate(addDays(date, -7))}><CaretLeft size={18} /></button><button type="button" className="icon-button" aria-label="下一周" onClick={() => setDate(addDays(date, 7))}><CaretRight size={18} /></button></div></div>
        <div className="sp-week" aria-label="选择安排日期">{weekNames.map((name, index) => { const value = addDays(monday, index); const day = result?.days.find(item => item.date === value); return <button type="button" key={name} aria-label={`${value}${value === dayKey() ? " 今天" : ""}${day?.allocated ? `，学习安排 ${amount(day.allocated)}` : ""}`} aria-pressed={date === value} className={`${date === value ? "is-selected" : ""} ${value === dayKey() ? "is-today" : ""}`} onClick={() => setDate(value)}><span>{name}</span><strong>{Number(value.slice(-2))}</strong><small>{value === dayKey() ? "今天" : day?.allocated ? <><span className="sp-date-workload">{day.allocated} 分</span><span className="sp-date-marker" aria-hidden="true" /></> : ""}</small></button>; })}</div>
        <div className="sp-day-heading"><div><h2>{date === dayKey() ? "今天，按自己的节奏来" : `${displayDate(date)}的复习安排`}{date > dayKey() && <span className="sp-preview-tag">预览</span>}</h2><p>{mode === "day" ? "完成当天的任务即可，先后顺序由你决定。" : "在你的空闲时间里专注，也为休息留出位置。"}</p></div></div>
        {nextTask && date <= dayKey() && <div className="sp-next-task"><div><span>下一项 · {courses.get(nextTask.courseId)?.name || "复习任务"}</span><strong>{nextTask.title}</strong></div><button type="button" className="sp-next-start" aria-label={`开始学习：${nextTask.title}`} disabled={loading || saving || !!pendingTask} onClick={() => onOpenTask(nextTask)}>开始<ArrowRight size={17} /></button></div>}
        {selected && <div className="sp-day-budget">
          <div className={`sp-budget-gauge ${hasProgress ? "has-progress" : "is-empty"}`} role={hasProgress ? "progressbar" : undefined} aria-label={hasProgress ? "当日任务完成进度" : undefined} aria-valuemin={hasProgress ? 0 : undefined} aria-valuemax={hasProgress ? 100 : undefined} aria-valuenow={hasProgress ? progress : undefined} aria-valuetext={hasProgress ? `完成 ${progress}%，${completedCount} / ${allTasks.length} 项` : undefined}>
            <svg viewBox="0 0 112 112" aria-hidden="true">
              <g className="sp-gauge-ticks">{progressTicks.map((tick, index) => <line key={index} {...tick} className={hasProgress && index < progress / 100 * progressTicks.length ? "is-lit" : ""} />)}</g>
              <circle className="sp-gauge-track" cx="56" cy="56" r="37" />
              <circle className="sp-gauge-value" cx="56" cy="56" r="37" pathLength="100" strokeDasharray={`${hasProgress ? progress : 0} 100`} transform="rotate(-90 56 56)" />
            </svg>
            <div className="sp-gauge-readout"><span>{hasProgress ? "完成" : allTasks.length ? "待安排" : "暂无任务"}</span><strong>{hasProgress ? `${progress}%` : "—"}</strong></div>
          </div>
          <div className="sp-budget-details">
            <div className="sp-budget-stats"><span>已完成<b>{amount(selected.completedMinutes)}</b></span><span>学习安排<b>{amount(selected.allocated)}</b></span><span>可用时间<b>{amount(selected.budget)}</b></span></div>
            <div className="sp-budget-footer"><span className="sp-budget-count">{completedCount} / {allTasks.length} 项完成</span><span>缓冲 {selected.reserveMinutes} 分钟{mode === "timeline" && selected.breakMinutes ? ` · 休息 ${selected.breakMinutes} 分钟` : ""}</span></div>
          </div>
        </div>}
        {selected?.warnings.length ? <div className="sp-day-notices">{selected.warnings.map((warning, index) => <p key={index}><Info size={16} />{warning}</p>)}</div> : null}
        {loading && (!result || !selected) ? <div className="sp-loading"><span className="sp-button-spinner" />正在根据你的时间计算复习安排…</div> : selected && allTasks.length ? <>
          {mode === "timeline" ? <div className="sp-timeline plan-list">{selected.slots.map(slot => {
            if (slot.kind === "break") return <div className="sp-timeline-row sp-break-row" key={slot.id}><time>{slot.start}</time><span className="sp-timeline-node" /><div><Coffee size={16} /><span>休息一下</span><small>{slot.minutes} 分钟</small></div></div>;
            const task = slot.taskId ? byTask.get(slot.taskId) : undefined; if (!task) return null;
            const pieces = selected.slots.filter(item => item.taskId === task.id && item.kind === "study");
            const firstPiece = pieces[0]?.id === slot.id;
            return <div className={`sp-timeline-row ${!firstPiece ? "is-continuation" : ""} ${completedIds.has(task.id) ? "is-done" : ""}`} key={slot.id}><div className="sp-time-label"><time>{slot.start}</time><small>{slot.end}</small></div><span className={`sp-timeline-node sp-color-${colorIndex(task.courseId)}`} /><article className={`sp-session sp-color-${colorIndex(task.courseId)}`}><div className="sp-session-meta"><span><i />{courses.get(task.courseId)?.name || "课程已移除"}</span><span>{slot.minutes} 分钟</span></div><h3>{task.title}</h3><p>{taskNames[task.kind]}{pieces.length > 1 ? ` · 第 ${pieces.findIndex(item => item.id === slot.id) + 1}/${pieces.length} 段` : ""}</p><div className="sp-session-bottom">{firstPiece ? <label className="sp-complete-label">{taskCheck(task, true)}<span>{task.completed ? "整项任务已完成" : pieces.length > 1 ? `完成整项任务 · ${task.minutes} 分` : "标记完成"}</span></label> : <span className="sp-followup">同一任务的后续专注段</span>}<button type="button" className="text-button" disabled={task.completed} onClick={() => onOpenTask(task)}>开始学习 <ArrowRight size={16} /></button></div><details className="sp-task-reason"><summary>为什么这样安排 <CaretDown size={14} /></summary><p>{task.reason}</p></details></article></div>;
          })}{!!selected.unscheduledMinutes && <div className="sp-unscheduled"><Info size={18} /><div><strong>还有 {amount(selected.unscheduledMinutes)} 尚未放入时间线</strong><p>空闲时段不足。可扩大时段、减少休息，或切换按天模式。</p><button type="button" className="text-button" onClick={() => openSettings("time")}>调整空闲时段 <ArrowRight size={15} /></button></div></div>}{!selected.slots.length && !selected.unscheduledMinutes && <div className="sp-inline-empty">这一天没有可用的时间线时段。<button type="button" className="text-button" onClick={() => openSettings("time")}>设置空闲时段</button></div>}</div> : <div className="sp-day-tasks plan-list">{allTasks.map(task => <article className={`sp-daily-task ${task.completed ? "is-done" : ""}`} key={task.id}><div className="sp-daily-top">{taskCheck(task)}<div><span className="sp-daily-course"><i className={`sp-course-dot sp-color-${colorIndex(task.courseId)}`} />{courses.get(task.courseId)?.name || "课程已移除"}</span><h3>{task.title}</h3></div><span className="sp-task-duration">{task.minutes}<small>分钟</small></span></div><p className="sp-daily-type">{taskNames[task.kind]}</p><div className="sp-daily-bottom"><details className="sp-task-reason"><summary>安排依据 <CaretDown size={14} /></summary><p>{task.reason}</p></details><button type="button" className="text-button" disabled={task.completed} onClick={() => onOpenTask(task)}>开始学习 <ArrowRight size={16} /></button></div></article>)}</div>}
          {completedCount === allTasks.length && <div className="sp-finished"><CheckCircle size={22} /><div><strong>这一天的安排，完成了。</strong><p>休息也是复习的一部分。明天再接着来。</p></div></div>}
        </> : !error && <div className="sp-empty"><Coffee size={38} /><h3>{!state.courses.length ? "先告诉我，你要考哪些科目" : selected?.budget === 0 ? "这一天，安心休息" : "这一天还没有需要安排的任务"}</h3><p>{!state.courses.length ? "加上考试日期、目标和每天的时间，一起做一份可执行的计划。" : selected?.budget === 0 ? "已设为休息日。复习会安排在其他可用的日子。" : "检查准备起点、考试日期和剩余复习时间，安排会随之更新。"}</p><button type="button" className="secondary" onClick={() => !state.courses.length ? onAddCourse() : openSettings("courses")}>{!state.courses.length ? "添加考试科目" : "检查规划条件"}<ArrowRight size={17} /></button></div>}
        {selected && <div className="sp-agenda-footer"><span><CheckCircle size={16} />已完成的任务会保留，未完成部分会重新安排。</span><button type="button" className="text-button" disabled={loading} onClick={() => void load()}><ArrowClockwise size={15} />重新计算</button></div>}
      </section>

      <aside className="sp-assistant" aria-label="规划助手">
      {!!(shortages.length || missingDates) && <div className="sp-mobile-alert" role="status"><Info size={18} /><p>{shortages.length ? `${shortages.length} 门课存在考前时间缺口。` : ""}{missingDates ? `${missingDates} 门课尚未设置考试日期。` : ""}</p><button type="button" className="text-button" onClick={() => openSettings(missingDates ? "courses" : "time")}>调整<ArrowRight size={15} /></button></div>}
        <section className="sp-assistant-note"><div className="sp-assistant-heading"><Sparkle size={22} weight="fill" /><h2>你的规划助手</h2></div><h3>{shortages.length ? "先把时间花在最需要的地方。" : upcoming.length ? "把大考拆成每天的小步。" : "准备好了，就从这里开始。"}</h3><p>{shortages.length ? `${shortages.length} 门课的预计复习量超过考前可用时间。先完成基础与临考任务，再根据实际进度调整。` : "安排会考虑考试先后、难度、掌握情况和剩余工作量。你调整时间，计划也会跟着变。"}</p><div className="sp-current-goal"><Target size={18} /><span>当前策略</span><strong>{phaseGoal.label}</strong></div><p className="sp-note-hint">需要改策略或某天的安排，用页面顶部的调整按钮。</p></section>
        {!!state.courses.length && <section className="sp-exam-list" aria-label="考试倒计时">
          <div className="sp-exam-list-head"><h2>考试倒计时</h2><span>考试日期与工作量，可在页面顶部的调整按钮里修改。</span></div>
          {[...state.courses].sort((a, b) => (a.examDate || "9999").localeCompare(b.examDate || "9999")).map(course => { const summary = summaries.find(item => item.courseId === course.id); return <div key={course.id} className="sp-exam-item"><span className={`sp-course-dot sp-color-${colorIndex(course.id)}`} /><div><span className="sp-exam-item-top"><strong>{course.name}</strong>{summary?.status === "ready" && <em className={shortageFor(summary) > 0 ? "sp-shortfall" : ""}>{shortageFor(summary) > 0 ? `缺口 ${amount(shortageFor(summary))}` : `${summary.estimated ? "估算" : "还需"} ${amount(summary.remainingMinutes)}`}</em>}{summary?.status === "finished" && <em>{summary.daysLeft === 0 ? "今天考试 · 已预留考试日" : "考试已结束"}</em>}{summary?.status === "not-started" && <em>尚未到准备起点</em>}</span><span className="sp-exam-item-meta">{course.examDate ? `${displayDate(course.examDate)}${course.examTime ? ` ${course.examTime}` : ""}${summary && summary.daysLeft >= 0 && summary.status !== "missing-date" && summary.status !== "finished" ? ` · ${summary.daysLeft === 0 ? "今天考试" : `剩 ${summary.daysLeft} 天`}` : ""}` : "尚未设置考试日期"}</span></div></div>; })}
        </section>}
        {!!result?.warnings.length && <div className="sp-global-notices">{result.warnings.map((warning, index) => <p key={index}><Info size={16} />{warning}</p>)}</div>}
        {focusTimer && <div className="sp-focus">{focusTimer}</div>}
        <details className="sp-method"><summary><Info size={17} />计划是怎样算出来的？<CaretDown size={16} /></summary><p>先守住每天可用时间、准备起点与考试截止，再根据剩余复习量、难度和目标分配任务。临近考试、时间紧张的科目优先，同时给练习与主动回忆留出位置。</p><p>时间线加入专注和休息；按天模式只约定当天任务。完成情况、时间调整与学习反馈都会影响后续安排。</p><p>这是可解释的滚动排期建议，工作量估计不代表成绩预测。到期卡片仍由 FSRS 单独调度。</p></details>
      </aside>
    </div>
  </div>;
}

function WindowEditor({ windows, onChange }: { windows: PlannerWindow[]; onChange: (windows: PlannerWindow[]) => void }) {
  return <div className="sp-window-editor">{windows.map((window, index) => <div key={index}><input aria-label={`空闲时段${index + 1}开始`} type="time" value={window.start} required onChange={event => onChange(windows.map((item, i) => i === index ? { ...item, start: event.target.value } : item))} /><span>至</span><input aria-label={`空闲时段${index + 1}结束`} type="time" value={window.end} required onChange={event => onChange(windows.map((item, i) => i === index ? { ...item, end: event.target.value } : item))} /><button type="button" className="icon-button" disabled={windows.length <= 1} aria-label={`移除空闲时段${index + 1}`} onClick={() => onChange(windows.filter((_, i) => i !== index))}><Trash size={17} /></button></div>)}<button type="button" className="text-button" disabled={windows.length >= 5} onClick={() => onChange([...windows, { start: "12:00", end: "13:00" }])}><Plus size={16} />添加空闲时段</button></div>;
}
