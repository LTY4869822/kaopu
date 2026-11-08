import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowUp, ArrowUpRight, Command, FileText, FolderOpen, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { Course, Doc } from "./types";

type Action = { id: string; title: string; hint: string; icon: Icon; onSelect: () => void };
type Result = Action & { kind: string };
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courses: Course[];
  documents: Doc[];
  actions: Action[];
  onOpenCourse: (id: string) => void;
  onOpenDocument: (document: Doc) => void;
};

export default function CommandPalette({ open, onOpenChange, courses, documents, actions, onOpenCourse, onOpenDocument }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const listId = useId();
  const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase().trim();
  const results = useMemo(() => {
    const term = normalize(query);
    const matches = (text: string) => !term || normalize(text).includes(term);
    const courseResults: Result[] = courses.filter(course => matches(course.name)).map(course => ({
      id: `course-${course.id}`, title: course.name, hint: `${documents.filter(doc => doc.courseId === course.id).length} 份资料 · 课程工作台`,
      kind: "课程", icon: FolderOpen, onSelect: () => onOpenCourse(course.id),
    }));
    const documentResults: Result[] = documents.filter(doc => matches(`${doc.name} ${courses.find(course => course.id === doc.courseId)?.name || ""}`)).map(doc => ({
      id: `document-${doc.id}`, title: doc.name, hint: courses.find(course => course.id === doc.courseId)?.name || "待分类资料",
      kind: "资料", icon: FileText, onSelect: () => onOpenDocument(doc),
    }));
    const shortcuts: Result[] = actions.filter(action => matches(`${action.title} ${action.hint}`)).map(action => ({ ...action, kind: "前往" }));
    return (term ? [...courseResults, ...documentResults, ...shortcuts] : [...shortcuts, ...courseResults]).slice(0, 30);
  }, [query, courses, documents, actions, onOpenCourse, onOpenDocument]);

  useEffect(() => { if (!open) { setQuery(""); setActive(0); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  const current = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [current, listId, open]);
  function choose(result: Result | undefined) {
    if (!result) return;
    onOpenChange(false);
    result.onSelect();
  }

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="sf-command-overlay" />
      <Dialog.Content className="sf-command-panel" aria-describedby={`${listId}-description`}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          const target = returnFocus.current;
          if (target?.isConnected && target !== document.body) target.focus();
          else document.querySelector<HTMLButtonElement>(".sf-command-shortcut")?.focus();
        }}>
        <Dialog.Title className="sf-visually-hidden">快速找到你的学习内容</Dialog.Title>
        <Dialog.Description id={`${listId}-description`} className="sf-visually-hidden">搜索课程、资料或页面。使用上下方向键选择，回车打开，Escape关闭。</Dialog.Description>
        <div className="sf-command-search">
          <MagnifyingGlass size={24} aria-hidden="true" />
          <input type="search" role="combobox" aria-label="搜索课程、资料或功能" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={results.length ? `${listId}-${current}` : undefined} placeholder="想从哪里开始？" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive(index => results.length ? (Math.min(index, results.length - 1) + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0);
            } else if (event.key === "Enter") { event.preventDefault(); choose(results[current]); }
          }} />
          <Dialog.Close className="sf-command-close" aria-label="关闭快捷搜索"><X size={20} /><kbd>Esc</kbd></Dialog.Close>
        </div>
        <div className="sf-command-caption"><span>{query ? "搜索结果" : "快捷入口与我的课程"}</span><span>{results.length ? `${results.length} 个结果` : "试试课程名或文件名"}</span></div>
        <div className="sf-command-results" id={listId} role="listbox" aria-label="快捷搜索结果">
          {results.map((result, index) => <button type="button" role="option" aria-selected={current === index} id={`${listId}-${index}`} key={result.id} tabIndex={-1} className={`sf-command-result ${current === index ? "is-selected" : ""}`} onPointerMove={() => setActive(index)} onClick={() => choose(result)}>
            <span className="sf-command-icon"><result.icon size={21} /></span>
            <span className="sf-command-result-copy"><strong>{result.title}</strong><small>{result.hint}</small></span>
            <span className="sf-command-kind">{result.kind}</span><ArrowUpRight size={18} aria-hidden="true" />
          </button>)}
          {!results.length && <div className="sf-command-empty"><MagnifyingGlass size={32} /><strong>还没有找到匹配的内容</strong><p>换个关键词，或先在首页导入资料。</p></div>}
        </div>
        <footer className="sf-command-footer"><span><kbd><ArrowUp size={12} /></kbd><kbd><ArrowDown size={12} /></kbd>选择 <kbd>↵</kbd> 打开</span><span><Command size={14} /> 考谱 · 学习空间</span></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
