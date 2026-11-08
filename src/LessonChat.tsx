import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, BookOpen, ChatCircleText, GearSix, PaperPlaneTilt, Stop, X } from "@phosphor-icons/react";
import LessonText, { splitLessonText } from "./LessonText";
import { readingExamplesFor, readingSectionsFor } from "./LectureDocument";
import type { Lesson, LessonChatCitation, LessonChatContext } from "./lesson-types";
import "./lesson-chat.css";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; citations?: LessonChatCitation[]; mode?: "model" | "retrieval"; complete?: boolean; stopped?: boolean };
type ContextInfo = { lessonId: string; fingerprint: string; modelConfigured: boolean };
type Props = {
  lesson: Lesson; open: boolean; context: LessonChatContext; returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void; onContextChange: (context: LessonChatContext) => void;
  onLocate: (citation: LessonChatCitation) => void; onSettings: () => void;
};
const tokenFor = (context: LessonChatContext) => context.sectionId ? `section:${context.sectionId}` : context.exampleId ? `example:${context.exampleId}` : context.cueId ? `cue:${context.cueId}` : context.frameId ? `frame:${context.frameId}` : "lesson";
const contextFor = (value: string): LessonChatContext => {
  const index = value.indexOf(":");
  if (index < 0) return {};
  const kind = value.slice(0, index), id = value.slice(index + 1);
  return kind === "section" ? { sectionId: id } : kind === "example" ? { exampleId: id } : kind === "cue" ? { cueId: id } : kind === "frame" ? { frameId: id } : {};
};
const clock = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
function historyFor(messages: ChatMessage[]) {
  const history: { role: "user" | "assistant"; content: string }[] = []; let characters = 0;
  for (const item of [...messages].reverse()) {
    if (!item.content.trim() || item.role === "assistant" && !item.complete) continue;
    const content = item.content.slice(0, 4000);
    if (history.length >= 20 || characters + content.length > 16000) break;
    history.unshift({ role: item.role, content }); characters += content.length;
  }
  return history;
}
export function parseLessonChatEvent(block: string): { event: string; data: Record<string, unknown> } | null {
  const lines = block.replace(/\r/g, "").split("\n");
  const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim() || "message";
  const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
  if (!data) return null;
  try { return { event, data: JSON.parse(data) as Record<string, unknown> }; }
  catch { throw new Error("回答数据格式异常，已收到的内容保留，请重新提问。"); }
}

/** A small text renderer: React escapes all prose; only LessonText handles formulas. */
export function LessonChatAnswer({ text, citations = [] }: { text: string; citations?: LessonChatCitation[] }) {
  const citationNumbers = new Map(citations.map((citation, index) => [citation.id, index + 1]));
  const math: string[] = [];
  let marker = "\uE000lesson-math-";
  while (text.includes(marker)) marker += "x";
  const masked = splitLessonText(text).map(part => {
    if (part.kind === "math") { const index = math.push(part.raw) - 1; return `${marker}${index}\uE001`; }
    return part.value.replace(/\[([A-Za-z][A-Za-z0-9_-]{0,100})\]/g, (original, id: string) => citationNumbers.has(id) ? `[${citationNumbers.get(id)}]` : original);
  }).join("");
  const restore = (value: string) => value.replace(new RegExp(`${marker}(\\d+)\uE001`, "g"), (_, index: string) => math[Number(index)] || "");
  const inline = (value: string) => {
    const nodes: ReactNode[] = []; let start = 0;
    for (const match of value.matchAll(/\*\*([^\n]+?)\*\*/g)) {
      if (match.index > start) nodes.push(<LessonText key={`text-${start}`} text={restore(value.slice(start, match.index))} inline />);
      nodes.push(<strong key={`bold-${match.index}`}><LessonText text={restore(match[1])} inline /></strong>);
      start = match.index + match[0].length;
    }
    if (start < value.length) nodes.push(<LessonText key={`text-${start}`} text={restore(value.slice(start))} inline />);
    return nodes;
  };
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [], items: string[] = [], ordered = false, listStart = 1, fence: string | null = null, code: string[] = [];
  const flushParagraph = () => { if (paragraph.length) { blocks.push(<p key={`p-${blocks.length}`}>{inline(paragraph.join("\n"))}</p>); paragraph = []; } };
  const flushList = () => {
    if (!items.length) return;
    const children = items.map((item, index) => <li key={index}>{inline(item)}</li>);
    blocks.push(ordered ? <ol key={`list-${blocks.length}`} start={listStart}>{children}</ol> : <ul key={`list-${blocks.length}`}>{children}</ul>); items = [];
  };
  for (const line of masked.replace(/\r\n?/g, "\n").split("\n")) {
    const codeFence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (codeFence?.[1][0] === fence[0] && codeFence[1].length >= fence.length) { blocks.push(<pre key={`code-${blocks.length}`}>{restore(code.join("\n"))}</pre>); fence = null; code = []; }
      else code.push(line);
      continue;
    }
    if (codeFence) { flushParagraph(); flushList(); fence = codeFence[1]; continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const item = line.match(/^\s{0,3}(?:(\d+)[.)、]|([-*+]))\s+(.+)$/);
    if (item) {
      flushParagraph(); const nextOrdered = !!item[1];
      if (items.length && nextOrdered !== ordered) flushList();
      if (!items.length) { ordered = nextOrdered; listStart = item[1] ? Number(item[1]) : 1; }
      items.push(item[3]); continue;
    }
    if (items.length && /^\s{2,}\S/.test(line)) { items[items.length - 1] += `\n${line.trimStart()}`; continue; }
    flushList();
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) { flushParagraph(); blocks.push(<h4 key={`h-${blocks.length}`}>{inline(heading[1])}</h4>); }
    else paragraph.push(line);
  }
  if (fence) blocks.push(<pre key={`code-${blocks.length}`}>{restore(code.join("\n"))}</pre>);
  flushParagraph(); flushList();
  return <div className="lesson-chat-answer">{blocks}</div>;
}

export default function LessonChat({ lesson, open, context, returnFocusRef, onClose, onContextChange, onLocate, onSettings }: Props) {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1179px)").matches);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [info, setInfo] = useState<ContextInfo | null>(null), [contextLoading, setContextLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const stream = useRef<AbortController | null>(null), infoRequest = useRef<AbortController | null>(null);
  const turn = useRef(0), mounted = useRef(true), fingerprint = useRef("");
  const scroll = useRef<HTMLDivElement | null>(null), stickToBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const sections = useMemo(() => readingSectionsFor(lesson), [lesson]);
  const examples = readingExamplesFor(lesson);
  const options = [{ value: "lesson", label: "整节课" }, ...sections.map(section => ({ value: `section:${section.id}`, label: section.title })), ...examples.map(example => ({ value: `example:${example.id}`, label: `例题 · ${example.title}` })), ...(lesson.visual?.frames || []).map(frame => ({ value: `frame:${frame.id}`, label: `画面 · ${clock(frame.time)}` }))];
  const contextToken = tokenFor(context);
  if (!options.some(option => option.value === contextToken)) {
    const cue = [...lesson.cues, ...(lesson.visualCues || [])].find(item => item.id === context.cueId);
    options.push({ value: contextToken, label: context.cueId ? `原文 · ${cue?.start != null ? clock(cue.start) : "当前段落"}` : "当前阅读位置" });
  }
  const contextTitle = options.find(option => option.value === contextToken)?.label || "整节课";

  useEffect(() => {
    mounted.current = true;
    const media = window.matchMedia("(max-width: 1179px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => { mounted.current = false; turn.current++; stream.current?.abort(); infoRequest.current?.abort(); media.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    turn.current++; stream.current?.abort(); infoRequest.current?.abort();
    setMessages([]); setQuestion(""); setError(""); setInfo(null); fingerprint.current = ""; setBusy(false);
  }, [lesson.id]);
  useEffect(() => { if (!open) stream.current?.abort(); }, [open]);
  useEffect(() => { stream.current?.abort(); }, [contextToken]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); infoRequest.current?.abort(); infoRequest.current = controller;
    setContextLoading(true);
    void fetch(`/api/lessons/${encodeURIComponent(lesson.id)}/chat/context`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) { if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired")); throw new Error(body.error || "暂时无法读取课程上下文，请重试。"); }
      if (controller.signal.aborted || !mounted.current) return;
      if (fingerprint.current && fingerprint.current !== body.fingerprint) {
        turn.current++; stream.current?.abort(); setBusy(false); setMessages([]);
        setError("课程内容已更新，已切换到最新来源。可以重新提问。");
        onContextChange({});
      }
      fingerprint.current = body.fingerprint; setInfo(body);
    }).catch(cause => { if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : "课程上下文暂时无法读取。"); }).finally(() => { if (!controller.signal.aborted && mounted.current) setContextLoading(false); });
    return () => controller.abort();
  }, [open, lesson.id, lesson.updatedAt, refresh]);
  useEffect(() => {
    if (open && stickToBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages, open]);

  async function send(value = question) {
    const text = value.trim();
    if (!text || text.length > 2000 || busy || !info || contextLoading) return;
    const version = ++turn.current, controller = new AbortController(); stream.current = controller;
    const answerId = crypto.randomUUID();
    const current = () => mounted.current && turn.current === version;
    setMessages(items => [...items, { id: crypto.randomUUID(), role: "user", content: text, complete: true }, { id: answerId, role: "assistant", content: "" }]);
    setQuestion(""); setBusy(true); setError(""); stickToBottom.current = true;
    const updateAnswer = (patch: Partial<ChatMessage>) => { if (current()) setMessages(items => items.map(item => item.id === answerId ? { ...item, ...patch } : item)); };
    let accumulated = "", complete = false;
    const citationsFor = (value: unknown) => Array.isArray(value) ? value.filter(item => item && item.lessonId === lesson.id && ["section", "example", "cue", "frame"].includes(item.kind)) as LessonChatCitation[] : [];
    try {
      const response = await fetch(`/api/lessons/${encodeURIComponent(lesson.id)}/chat`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, signal: controller.signal, body: JSON.stringify({ message: text, history: historyFor(messages), context, fingerprint: info.fingerprint }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired"));
        if (response.status === 409 && current()) { setInfo(null); setRefresh(count => count + 1); }
        throw new Error(body.error || "本次提问未完成，请稍后重试。");
      }
      if (!response.body) throw new Error("没有收到回答，请重新提问。");
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "";
      const receive = (block: string) => {
        const event = parseLessonChatEvent(block); if (!event || !current()) return;
        if (event.event === "error") throw new Error(typeof event.data.error === "string" ? event.data.error : "回答中断，请重试。");
        if (event.event === "delta" && typeof event.data.text === "string") {
          accumulated += event.data.text;
          if (accumulated.length > 100000) throw new Error("回答过长，已停止。请缩小问题范围后继续。");
          updateAnswer({ content: accumulated });
        }
        if (event.event === "done") {
          complete = true;
          accumulated = typeof event.data.answer === "string" ? event.data.answer : accumulated;
          updateAnswer({ content: accumulated, complete: true, mode: event.data.mode === "retrieval" ? "retrieval" : "model", citations: citationsFor(event.data.citations) });
        }
      };
      while (true) {
        const next = await reader.read();
        if (!current()) { await reader.cancel(); return; }
        buffer = (buffer + decoder.decode(next.value, { stream: !next.done })).replace(/\r\n/g, "\n");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) { const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); receive(block); }
        if (next.done) { if (buffer.trim()) receive(buffer); break; }
      }
      if (!complete) throw new Error("连接中断，已收到的内容保留。可以重新提问。");
    } catch (cause) {
      if (!current()) return;
      if (controller.signal.aborted) updateAnswer({ content: accumulated || "本次回答已停止。", stopped: true });
      else { setError(cause instanceof Error ? cause.message : "回答未完成，请重试。"); updateAnswer({ content: accumulated || "未收到完整回答，请重试。" }); }
    } finally { if (current()) { setBusy(false); stream.current = null; } }
  }
  function locate(citation: LessonChatCitation) { if (narrow) onClose(); onLocate(citation); }
  const panel = <>
    <header className="lesson-chat-heading"><div><ChatCircleText size={21} /><h3>AI 助教</h3></div><div><button type="button" aria-label="打开问答模型设置" onClick={onSettings}><GearSix size={19} /></button><button type="button" aria-label="收起AI 助教" onClick={onClose}><X size={20} /></button></div></header>
    <div className="lesson-chat-context"><label htmlFor={`lesson-chat-context-${lesson.id}`}>正在讨论</label><select id={`lesson-chat-context-${lesson.id}`} value={contextToken} onChange={event => onContextChange(contextFor(event.target.value))}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><p><BookOpen size={15} /><span>{lesson.title} · 当前课程来源</span></p>{contextToken !== "lesson" && <button type="button" onClick={() => { const [kind, id] = contextToken.split(":"); locate({ id, kind: kind as LessonChatCitation["kind"], title: contextTitle, lessonId: lesson.id }); }}>回到这个位置<ArrowRight size={14} /></button>}</div>
    <div className="lesson-chat-messages" ref={scroll} role="log" aria-label="讲义问答记录" aria-live="polite" aria-relevant="additions" onScroll={() => { if (scroll.current) stickToBottom.current = scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight < 100; }}>
      {!messages.length && <div className="lesson-chat-empty"><span><ChatCircleText size={25} /></span><h4>卡在哪一步，就从这里问。</h4><p>助手会结合当前讲义、原文和已识别的课堂画面回答。也可以切换上方的讨论位置。</p><div>{["请像老师一样讲清这个知识点", "我需要先掌握哪些基础？", "这一步为什么这样推导？"].map(item => <button type="button" key={item} disabled={busy || !info || contextLoading} onClick={() => void send(item)}>{item}<ArrowRight size={16} /></button>)}</div></div>}
      {messages.map(item => <article key={item.id} className={`lesson-chat-message is-${item.role}`}><div className="lesson-chat-message-label">{item.role === "user" ? "你" : "AI 助教"}{item.mode === "retrieval" && <span>课程摘录</span>}{item.stopped && <span>已停止</span>}</div>{item.content ? item.role === "assistant" ? <LessonChatAnswer text={item.content} citations={item.citations} /> : <LessonText text={item.content} /> : <p className="lesson-chat-thinking" role="status">正在结合课程内容思考…</p>}{!!item.citations?.length && <div className="lesson-chat-citations"><span>对照课程来源</span>{item.citations.map((citation, index) => <button type="button" key={`${citation.kind}-${citation.id}-${index}`} onClick={() => locate(citation)}>[{index + 1}] {citation.kind === "frame" ? "画面" : citation.kind === "example" ? "例题" : citation.kind === "cue" ? "原文" : "知识点"} · {citation.title}{citation.time != null ? ` ${clock(citation.time)}` : ""}<ArrowRight size={14} /></button>)}</div>}</article>)}
    </div>
    <div className="lesson-chat-bottom">{error && <div className="lesson-chat-error" role="alert"><p>{error}</p>{!info && <button type="button" onClick={() => { setError(""); setRefresh(count => count + 1); }}>重新读取课程</button>}<button type="button" aria-label="关闭问答提示" onClick={() => setError("")}><X size={17} /></button></div>}<form className="lesson-chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}><textarea ref={input} aria-label="向AI 助教提问" placeholder={`针对${contextTitle === "整节课" ? "这节课" : "当前位置"}提问…`} rows={3} maxLength={2000} value={question} disabled={busy} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} /><div><span>{contextLoading ? "正在读取课程内容…" : info?.modelConfigured ? "结合当前课程回答" : "课程摘录模式 · 连接模型可深入讲解"}</span>{busy ? <button type="button" className="lesson-chat-stop" onClick={() => stream.current?.abort()}><Stop size={16} />停止</button> : <button type="submit" aria-label="发送问题" className="lesson-chat-send" disabled={!question.trim() || !info || contextLoading}><PaperPlaneTilt size={19} /></button>}</div></form>{!info?.modelConfigured && !contextLoading && <button type="button" className="lesson-chat-connect" onClick={onSettings}><GearSix size={15} />连接文字模型</button>}</div>
  </>;
  if (narrow) return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal><Dialog.Overlay className="lesson-chat-overlay" /><Dialog.Content className="lesson-chat lesson-chat-drawer" onCloseAutoFocus={event => { event.preventDefault(); if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }); }}><Dialog.Title className="lesson-chat-sr-only">AI 助教</Dialog.Title><Dialog.Description className="lesson-chat-sr-only">结合当前讲次的知识点、例题与来源继续提问。</Dialog.Description>{panel}</Dialog.Content></Dialog.Portal></Dialog.Root>;
  return open ? <aside className="lesson-chat" aria-label="AI 助教">{panel}</aside> : null;
}
