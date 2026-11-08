import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDown,
  ArrowsClockwise,
  ArrowLeft,
  ArrowRight,
  BookBookmark,
  Books,
  CalendarBlank,
  CaretRight,
  Check,
  CheckCircle,
  DotsThree,
  DownloadSimple,
  FileText,
  FolderOpen,
  GearSix,
  GraduationCap,
  Lightbulb,
  MagnifyingGlass,
  Pause,
  Play,
  Plus,
  Sparkle,
  SignOut,
  Stack,
  Timer,
  TreeStructure,
  Exam,
  UploadSimple,
  VideoCamera,
  X,
} from "@phosphor-icons/react";
import BatchImport from "./BatchImport";
import CourseCatalog from "./CourseCatalog";
import StudyPlanner from "./StudyPlanner";
import "./practice-hub.css";
import "./mock-exam.css";
import "./course-studio-shell.css";
import type { AssessmentSource } from "./assessment-types";
import CommandPalette from "./CommandPalette";
import ModelSetupNotice from "./ModelSetupNotice";
import { api } from "./api";
import { LoadingState } from "./ui/controls";
import { readStudyRoute, studyRouteUrl } from "./study-route";
import type { StudyPage } from "./study-route";
import type {
  Answer,
  Card,
  Course,
  Doc,
  State,
  Task,
} from "./types";

type Page = StudyPage;
const LessonStudio = lazy(() => import("./LessonStudio"));
const PracticeStudio = lazy(() => import("./PracticeStudio"));
const ExamStudio = lazy(() => import("./ExamStudio"));
const CourseStudio = lazy(() => import("./CourseStudio"));
const ModelSettings = lazy(() => import("./ModelSettings"));
const AppSettings = lazy(() => import("./AppSettings"));
const LessonText = lazy(() => import("./LessonText"));
const KnowledgeBase = lazy(() => import("./KnowledgeBase"));
const navigation = [
  { id: "dashboard", label: "资料导入", mobileLabel: "导入", icon: UploadSimple },
  { id: "materials", label: "我的课程", mobileLabel: "课程", icon: FolderOpen },
  { id: "plan", label: "复习规划", mobileLabel: "规划", icon: CalendarBlank },
  { id: "lessons", label: "网课笔记", mobileLabel: "网课", icon: VideoCamera },
  { id: "knowledge", label: "知识库", mobileLabel: "知识库", icon: TreeStructure },
  { id: "practice", label: "练习答疑", mobileLabel: "练习", icon: BookBookmark },
  { id: "exams", label: "期末模考", mobileLabel: "模考", icon: Exam },
] as const;
function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Books size={36} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal sf-control-surface">
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="关闭">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function App({ onLogout, accountName }: { onLogout?: () => Promise<void>; accountName?: string }) {
  const [state, setState] = useState<State | null>(null),
    [page, setPage] = useState<Page>(() => readStudyRoute(window.location.href).page);
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [courseFilter, setCourseFilter] = useState(() => readStudyRoute(window.location.href).course);
  const [courseOpen, setCourseOpen] = useState(false),
    [editCourse, setEditCourse] = useState<Course | null>(null),
    [resetOpen, setResetOpen] = useState(false);
  const [search, setSearch] = useState(""),
    [selectedDoc, setSelectedDoc] = useState<Doc | null>(null),
    [uploadCourse, setUploadCourse] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const uploadMode = useRef<"auto" | "handwriting">("auto");
  const [pendingDocument, setPendingDocument] = useState<string | null>(null);
  const [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<Answer | null>(null),
    [askBusy, setAskBusy] = useState(false);
  const [sourceFocus, setSourceFocus] = useState<AssessmentSource | null>(null);
  const [lessonTarget, setLessonTarget] = useState<{ lessonId: string; kind: "section" | "example"; id: string; sequence: number }>();
  const [practiceTab, setPracticeTab] = useState<"quick" | "ask">("quick");
  const [practiceRefreshBusy, setPracticeRefreshBusy] = useState(false);
  const [practiceInitialDocumentIds, setPracticeInitialDocumentIds] = useState<string[]>([]);
  const [practiceInitialPaperId, setPracticeInitialPaperId] = useState<string | undefined>();
  const [practiceInitialAttemptId, setPracticeInitialAttemptId] = useState<string | undefined>();
  const [studioRefreshKey, setStudioRefreshKey] = useState(0);
  const [globalModelSettingsOpen, setGlobalModelSettingsOpen] = useState(false);
  const [modelSettingsKind, setModelSettingsKind] = useState<"text" | "vision">("text");
  const [flipped, setFlipped] = useState(false),
    [cardOpen, setCardOpen] = useState(false),
    [reviewCount, setReviewCount] = useState(0),
    [reviewed, setReviewed] = useState<string[]>([]);
  const [timer, setTimer] = useState(25 * 60),
    [running, setRunning] = useState(false),
    [timerStarted, setTimerStarted] = useState(false),
    [focusLength, setFocusLength] = useState(25);
  const fileRef = useRef<HTMLInputElement>(null);
  const askVersion = useRef(0), askSubmitting = useRef(false);
  const notify = (text: string) => setToast(text);
  const corpusVersion = state?.documents.map(doc => `${doc.id}:${doc.courseId}`).sort().join("|") || "";
  async function refresh() {
    const s = await api<State>("/state");
    setState(s);
    return s;
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const restore = () => {
      const next = readStudyRoute(window.location.href);
      setPage(next.page); setCourseFilter(next.course); setSearch(""); setSelectedDoc(null); setSourceFocus(null); setCommandOpen(false);
      setCourseOpen(false); setResetOpen(false); setGlobalModelSettingsOpen(false);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    const url = studyRouteUrl(window.location.href, page, courseFilter);
    if (url !== window.location.href) window.history.replaceState(null, "", url);
  }, [page, courseFilter]);
  useEffect(() => {
    if (state && courseFilter !== "all" && courseFilter !== "unassigned" && !state.courses.some(c => c.id === courseFilter)) {
      setCourseFilter("all"); setToast("这门课程已移除，已返回课程列表。");
    }
  }, [state, courseFilter]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen(open => !open);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!running) return;
    const deadline = Date.now() + timer * 1000;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimer(left);
      if (!left) {
        setRunning(false);
        setTimerStarted(false);
        api("/focus", "POST", { minutes: focusLength })
          .then(() => refresh())
          .then(() => notify(`完成一次 ${focusLength} 分钟专注，休息一下吧。`))
          .catch((e) => notify(e.message));
      }
    }, 500);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    setAnswer(null);
    setFlipped(false);
    if (courseFilter !== "all") setUploadCourse(courseFilter);
  }, [courseFilter]);
  useEffect(() => {
    setSelectedDoc(current => {
      if (!current || !state) return null;
      return state.documents.find(doc => doc.id === current.id &&
        (courseFilter === "all" || (courseFilter === "unassigned" ? !doc.courseId : doc.courseId === courseFilter))) || null;
    });
  }, [state?.documents, courseFilter]);
  useEffect(() => {
    askVersion.current++;
    askSubmitting.current = false;
    setAskBusy(false);
    setAnswer(null);
    return () => { askVersion.current++; };
  }, [courseFilter, page, corpusVersion]);
  useEffect(() => {
    if (!sourceFocus || page !== "materials" || selectedDoc?.id !== sourceFocus.documentId) return;
    let target: HTMLElement | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const articles = Array.from(document.querySelectorAll<HTMLElement>(".cw-source article"));
      target = articles.find(item => item.dataset.chunkId === sourceFocus.chunkId)
        || articles.find(item => item.dataset.sourcePage === String(sourceFocus.page));
      if (!target) return;
      target.classList.add("is-cited");
      target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      target.focus({ preventScroll: true });
      timer = setTimeout(() => target?.classList.remove("is-cited"), 8000);
    });
    return () => { cancelAnimationFrame(frame); if (timer) clearTimeout(timer); target?.classList.remove("is-cited"); };
  }, [sourceFocus, page, selectedDoc?.id]);
  function go(next: Page, course?: string) {
    setPage(next);
    if (course !== undefined) setCourseFilter(course);
    const route = studyRouteUrl(window.location.href, next, course ?? courseFilter);
    if (route !== window.location.href) window.history.pushState(null, "", route);
    setSearch("");
    setSelectedDoc(null);
    setSourceFocus(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function openMockExam() {
    setPracticeInitialDocumentIds([]); setPracticeInitialPaperId(undefined); setPracticeInitialAttemptId(undefined); go("exams");
  }
  function openModelSettings(kind: "text" | "vision" = "text") {
    setModelSettingsKind(kind);
    setGlobalModelSettingsOpen(true);
  }
  function openImport() {
    go("dashboard");
  }
  function openCourses() {
    go("materials", "all");
  }
  function openCourse(id: string) {
    go("materials", id);
  }
  function openPracticeSource(source: AssessmentSource) {
    const document = state?.documents.find(item => item.id === source.documentId);
    if (!document) { notify("来源资料已变化，请重新生成练习。"); return; }
    const lessonId = document.sourceLessonId || document.origin?.lessonId;
    if (lessonId) {
      const suffix = source.chunkId?.startsWith(`${document.id}-`) ? source.chunkId.slice(document.id.length + 1) : "";
      setLessonTarget({ lessonId, kind: suffix.startsWith("example-") ? "example" : "section", id: suffix || "section-1", sequence: Date.now() });
      go("lessons"); return;
    }
    go("materials", document.courseId || "unassigned");
    setSelectedDoc(document);
    setSourceFocus(source);
  }
  async function refreshPracticeMaterials() {
    if (practiceRefreshBusy) return;
    setPracticeRefreshBusy(true);
    try {
      await refresh();
      notify("资料已刷新，当前作答已保留。");
    } catch (e) {
      notify(`刷新失败：${(e as Error).message}`);
    } finally {
      setPracticeRefreshBusy(false);
    }
  }
  async function mutation(
    path: string,
    method: string,
    body: unknown,
    message?: string,
  ) {
    setBusy(true);
    try {
      const value = await api(path, method, body);
      await refresh();
      if (message) notify(message);
      return value;
    } catch (e) {
      notify((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  function openTask(task: Task) {
    setCourseFilter(task.courseId);
    if (task.action === "exams") { setPracticeInitialDocumentIds([]); setPracticeInitialPaperId(undefined); setPracticeInitialAttemptId(task.attemptId); go("exams"); return; }
    if (task.kind === "learn") go("materials");
    if (task.kind === "practice") go("practice");
    if (task.kind === "review") go("memory");
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const parseMode = uploadMode.current;
    const course = courseFilter !== "all" && courseFilter !== "unassigned" ? courseFilter : uploadCourse || state?.courses[0]?.id;
    if (!course) {
      notify("先添加一门课程，再导入资料。");
      setCourseOpen(true);
      return;
    }
    setBusy(true);
    let successful = 0;
    for (const file of Array.from(files)) {
      const data = new FormData();
      data.append("file", file);
      data.append("courseId", course);
      data.append("parseMode", parseMode);
      try {
        await api("/documents", "POST", data);
        successful++;
      } catch (e) {
        notify(`${file.name}：${(e as Error).message}`);
      }
    }
    await refresh();
    setBusy(false);
    if (successful)
      notify(`已导入 ${successful} 份资料，可以查看提炼和原文了。`);
    if (fileRef.current) fileRef.current.value = "";
  }
  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || askSubmitting.current) return;
    const version = ++askVersion.current;
    askSubmitting.current = true;
    setAskBusy(true);
    try {
      const result = await api<Answer>("/ask", "POST", {
          question,
          courseId: courseFilter === "all" ? undefined : courseFilter,
        });
      if (version === askVersion.current) setAnswer(result);
    } catch (e) {
      if (version === askVersion.current) notify((e as Error).message);
    } finally {
      if (version === askVersion.current) {
        askSubmitting.current = false;
        setAskBusy(false);
      }
    }
  }
  async function saveCourse(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const saved = await mutation(
        editCourse ? `/courses/${editCourse.id}` : "/courses",
        editCourse ? "PATCH" : "POST",
        {
          name: f.get("name"),
          examDate: f.get("examDate"),
          target: Number(f.get("target")),
          color: "#719083",
        },
        editCourse
          ? "课程信息已更新，计划已重排"
          : "课程已创建，可以开始整理资料。",
      );
      if (pendingDocument) {
        await mutation(
          `/documents/${pendingDocument}`,
          "PATCH",
          { courseId: (saved as Course).id },
          "资料已归入新学科",
        );
        setPendingDocument(null);
      }
      setCourseOpen(false);
      setEditCourse(null);
    } catch {}
  }
  if (!state)
    return (
      <div className="loading-screen">
        <div className="brand">
          <span className="brand-mark">
            <img className="brand-logo" src="/kaopu-logo.png" alt="" />
          </span>
          考谱
        </div>
        {error ? (
          <>
            <p>{error}</p>
            <button
              className="primary"
              onClick={() => {
                setError("");
                refresh().catch((e) => setError(e.message));
              }}
            >
              重新连接
            </button>
            <small>请确认本地服务已运行：npm run dev</small>
          </>
        ) : (
          <p>正在整理你的学习空间…</p>
        )}
      </div>
    );
  const courses = state.courses;
  const selectedCourse = courses.find((c) => c.id === courseFilter);
  const unassigned = state.documents.filter((d) => !d.courseId);
  const dueCards = state.cards.filter(
    (c) =>
      new Date(c.due) <= new Date() &&
      (courseFilter === "all" || c.courseId === courseFilter) &&
      !reviewed.includes(c.id),
  );
  const card = dueCards[0];
  const docs = state.documents.filter(
    (d) =>
      (courseFilter === "all" ||
        (courseFilter === "unassigned"
          ? !d.courseId
          : d.courseId === courseFilter)) &&
      (!search ||
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.summary.join(" ").includes(search) ||
        courses.find((c) => c.id === d.courseId)?.name.includes(search)),
  );
  const courseName = (id: string) =>
    courses.find((c) => c.id === id)?.name || "待分类";
  const isCatalog =
    page === "materials" && !selectedCourse && courseFilter !== "unassigned";
  const title =
    page === "settings" ? "设置" : page === "resources"
      ? "学习资源"
      : page === "materials" && selectedCourse
        ? `${selectedCourse.name} · 工作台`
        : page === "materials" && courseFilter === "unassigned"
          ? "待分类资料"
          : page === "memory" ? "复习回忆" : navigation.find((n) => n.id === page)?.label;
  const courseSelect = (
    <select
      aria-label="筛选课程"
      value={courseFilter}
      onChange={(e) => setCourseFilter(e.target.value)}
    >
      <option value="all">全部学科</option>
      {page === "materials" && (
        <option value="unassigned">待分类 ({unassigned.length})</option>
      )}
      {courses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
  return (
    <div className="app-shell sf-ui">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("dashboard");
          }}
        >
          <span className="brand-mark">
            <img className="brand-logo" src="/kaopu-logo.png" alt="" />
          </span>
          <span>
            考谱<small>KAOPU</small>
          </span>
        </a>
        <div className="workspace-label">学习空间 / WORKSPACE</div>
        <nav aria-label="主要导航">
          <span className="sf-nav-indicator" aria-hidden="true" style={{ transform: `translateY(${Math.max(0, navigation.findIndex(item => item.id === (page === "memory" ? "practice" : page))) * 58}px)`, opacity: page === "resources" || page === "settings" ? 0 : 1 }} />
          {navigation.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${(page === "memory" ? "practice" : page) === n.id ? "active" : ""}`}
              aria-current={(page === "memory" ? "practice" : page) === n.id ? "page" : undefined}
              onClick={() => (n.id === "materials" ? openCourses() : n.id === "exams" ? openMockExam() : go(n.id))}
            >
              <n.icon size={21} weight={(page === "memory" ? "practice" : page) === n.id ? "fill" : "regular"} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-separator" />
        <button
          className={`nav-item ${page === "resources" ? "active" : ""}`}
          onClick={() => go("resources")}
        >
          <GraduationCap size={22} />
          <span>学习资源</span>
        </button>
        <div className="sidebar-bottom">
          <button className={`nav-item ${page === "settings" ? "active" : ""}`} aria-current={page === "settings" ? "page" : undefined} onClick={() => go("settings")}>
            <GearSix size={21} />
            <span>设置</span>
          </button>
          <div className="profile">
            <div className="avatar">
              {(accountName || state.settings.name)?.slice(0, 1) || "同"}
            </div>
            <div>
              <strong>{accountName || state.settings.name || "同学"}</strong>
              <span>专属于你的学习空间</span>
            </div>
            <button
              className="icon-button"
              aria-label="打开设置"
              onClick={() => go("settings")}
            >
              <DotsThree size={23} />
            </button>
          </div>
        </div>
      </aside>
      <div className={`workspace workspace-${page}`}>
        <header className="topbar">
          <div className="breadcrumb">
            <span>我的空间</span>
            <CaretRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            {onLogout && <button className="icon-button" aria-label="退出登录" title="退出登录" onClick={() => { void onLogout().catch(e => notify(e.message)); }}><SignOut size={21} /></button>}
            <div className="searchbox">
              <MagnifyingGlass size={18} />
              <input
                aria-label="搜索课程或资料"
                placeholder="搜索课程、资料…"
                value={search}
                onChange={(e) => {
                  const value = e.target.value;
                  if (page !== "materials") go("materials", "all"); else setCourseFilter("all");
                  setSearch(value);
                }}
              />
              <button type="button" className="sf-command-shortcut" aria-label="打开快捷搜索" title="搜索课程、资料与页面（Ctrl / ⌘ K）" onClick={() => setCommandOpen(true)}><kbd>⌘ K</kbd><span>快捷搜索</span></button>
            </div>
            <button
              className="icon-button mobile-settings"
              aria-label="设置"
              aria-current={page === "settings" ? "page" : undefined}
              onClick={() => go("settings")}
            >
              <GearSix size={22} />
            </button>
            <span className="top-date">
              {new Intl.DateTimeFormat("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              }).format(new Date())}
            </span>
          </div>
        </header>
        {!state.providerConfigured && <ModelSetupNotice
          id="global-model"
          title="还没有连接 AI 模型"
          description="现在只能按字幕分段整理，不会生成重点笔记、例题答案或答疑。连接一次后，整个学习空间都能用上。"
          actionLabel="立即连接模型"
          onConfigure={() => openModelSettings("text")}
        />}
        <main className={`main page-${page} ${page === "materials" && selectedCourse ? "course-studio-page" : ""}`}>
          {page === "dashboard" ? (
            <section className="page-heading home-heading">
              <div>
                <span className="home-eyebrow">从一份资料，开始有序复习</span>
                <h1>把资料放进来，剩下的交给<span>考谱</span></h1>
                <p>先添加所有文件，点击「开始分析」，自动整理到对应课程。</p>
              </div>
            </section>
          ) : (
            <>
              {page === "materials" && selectedCourse ? <section className="studio-course-heading">
                <button className="text-button" onClick={openCourses}><ArrowLeft size={17} />我的课程</button>
                <span className="studio-heading-divider" aria-hidden="true" />
                <h1>{selectedCourse.name}</h1>
                <span className="studio-heading-count">{docs.length} 份资料</span>
                <div className="studio-heading-actions"><button className="text-button" onClick={openMockExam}><Exam size={17} />期末模考</button><button className="text-button" onClick={() => { setPendingDocument(null); setEditCourse(selectedCourse); setCourseOpen(true); }}><CalendarBlank size={17} />{selectedCourse.examDate ? "考试安排" : "设置考试"}</button><button className="icon-button" aria-label="模型设置" onClick={() => openModelSettings("text")}><GearSix size={19} /></button></div>
              </section> : <section className="page-heading">
                <div>
                  {page !== "plan" && page !== "lessons" && page !== "practice" && page !== "exams" && page !== "settings" && <span className="page-kicker">{page === "materials" ? (isCatalog ? "MY COURSES" : "COURSE WORKSPACE") : page === "memory" ? "SPACED REPETITION" : page === "knowledge" ? "KNOWLEDGE BASE" : "LEARNING RESOURCES"}</span>}
                  <h1>{title}</h1>
                  {page !== "lessons" && <p>
                    {
                      (
                        {
                          materials: selectedCourse
                            ? "资料、要点与讲解，专注于这一门课。"
                            : isCatalog
                              ? "每门课程，一个专属学习空间。"
                              : "为这些资料确认课程，归档后即可进入对应工作台。",
                          plan: "把考试和空闲时间交给考谱，让每一天都有清晰的下一步。",
                          practice: "针对一个知识点练习、提问，把卡住的地方弄明白。",
                          exams: "用一场完整模拟，检验复习效果，再带着错因补弱。",
                          memory:
                            "先试着回想，再看答案。记忆会在一次次提取中变牢。",
                          settings: "管理模型连接、复习偏好与本机学习数据。",
                          resources:
                            "少一点漫无目的地搜索，多一点有方向地学习。",
                          knowledge:
                            "把课程资料、网课和考点，自动整理成能互相跳转的笔记，还能看到知识点之间的关系图。",
                        } as Record<string, string>
                      )[page]
                    }
                  </p>}
                </div>
                {page === "materials" ? (
                  <button className="primary" onClick={openImport}>
                    <UploadSimple size={18} />
                    导入资料
                  </button>
                ) : page === "memory" ? (
                  <button
                    className="primary"
                    disabled={!courses.length}
                    onClick={() => setCardOpen(true)}
                  >
                    <Plus size={18} />
                    新建卡片
                  </button>
                ) : null}
              </section>}
              {isCatalog && (
                <>
                  <CourseCatalog
                    courses={courses}
                    documents={state.documents}
                    search={search}
                    onOpenCourse={openCourse}
                    onEditCourse={(course) => {
                      setPendingDocument(null);
                      setEditCourse(course);
                      setCourseOpen(true);
                    }}
                    onAddCourse={() => {
                      setPendingDocument(null);
                      setEditCourse(null);
                      setCourseOpen(true);
                    }}
                    onImport={openImport}
                    onReviewUnassigned={() => {
                      setCourseFilter("unassigned");
                      go("materials");
                    }}
                  />
                  {courses.some((c) => c.isDemo) && (
                    <div className="demo-note">
                      当前包含示例课程。
                      <button
                        className="text-button"
                        onClick={() => setResetOpen(true)}
                      >
                        清空示例，使用自己的资料
                      </button>
                    </div>
                  )}
                </>
              )}
              {page === "materials" && !isCatalog && (
                <>
                  {!selectedCourse && <div className="toolbar workbench-toolbar">
                    {courseSelect}
                    <span>{docs.length} 份资料</span>
                  </div>}
                  <input
                    type="file"
                    multiple
                    ref={fileRef}
                    className="sr-only"
                    aria-label="上传学习资料"
                    accept=".pdf,.docx,.pptx,.txt,.md,.doc,.ppt,.jpg,.jpeg,.png,.webp"
                    onChange={(e) => upload(e.target.files)}
                  />
                  <Suspense fallback={<LoadingState title="正在打开课程工作台…" description="资料、对话和笔记将在这里显示。" />}><CourseStudio
                    key={courseFilter}
                    course={selectedCourse}
                    courses={courses}
                    documents={docs}
                    selectedDoc={selectedDoc}
                    onSelectDocument={setSelectedDoc}
                    busy={busy}
                    providerConfigured={state.providerConfigured}
                    onAdd={() => { uploadMode.current = "auto"; if (selectedCourse) fileRef.current?.click(); else openImport(); }}
                    onAddHandwriting={() => { uploadMode.current = "handwriting"; fileRef.current?.click(); }}
                    onPractice={() => go("practice")}
                    onPracticeSources={documentIds => { setPracticeInitialDocumentIds(documentIds); setPracticeInitialPaperId(undefined); setPracticeInitialAttemptId(undefined); go("exams"); }}
                    onOpenPaper={paperId => { setPracticeInitialPaperId(paperId); setPracticeInitialDocumentIds([]); setPracticeInitialAttemptId(undefined); go("exams"); }}
                    onOpenModelSettings={() => openModelSettings("text")}
                    refreshKey={studioRefreshKey}
                    onNotify={notify}
                    onRefresh={refresh}
                    onAssign={async (doc, courseId) => {
                      if (courseId === "__new__") {
                        setPendingDocument(doc.id);
                        setEditCourse(null);
                        setCourseOpen(true);
                        return;
                      }
                      await mutation(`/documents/${doc.id}`, "PATCH", { courseId }, "课程归属已更新");
                    }}
                    onDelete={(doc) => {
                      if (window.confirm(`删除“${doc.name}”？此操作会移除其原文索引。`)) {
                        void mutation(`/documents/${doc.id}`, "DELETE", undefined, "资料已删除").catch(() => {});
                      }
                    }}
                  /></Suspense>
                </>
              )}
              {page === "plan" && (
                <StudyPlanner
                  state={state}
                  onRefresh={refresh}
                  onNotify={notify}
                  onOpenTask={openTask}
                  onAddCourse={() => { setPendingDocument(null); setEditCourse(null); setCourseOpen(true); }}
                  focusTimer={
                  <details className="focus-settings">
                    <summary>
                      <Timer size={19} />
                      专注计时
                      <span>
                        {running
                          ? "进行中"
                          : `${state.focusMinutes} 分钟累计专注`}
                      </span>
                    </summary>
                    <div className="focus-body">
                      <strong>{String(Math.floor(timer / 60)).padStart(2, "0")}:{String(timer % 60).padStart(2, "0")}</strong>
                      <label className="focus-length">
                        <span>专注时长</span>
                        <select aria-label="专注时长" value={focusLength} disabled={running || timerStarted} onChange={event => { const minutes = Number(event.target.value); setFocusLength(minutes); setTimer(minutes * 60); }}>
                          {[15, 20, 25, 30, 45, 60].map(minutes => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}
                        </select>
                      </label>
                      <div className="focus-actions">
                        <button
                          className="primary"
                          onClick={() => {
                            if (!timer) setTimer(focusLength * 60);
                            setRunning(!running);
                            setTimerStarted(true);
                          }}
                        >
                          {running ? <Pause size={18} /> : <Play size={18} />}
                          {running
                            ? "暂停专注"
                            : timerStarted
                              ? "继续专注"
                              : `开始${focusLength}分钟专注`}
                        </button>
                        <button
                          className="text-button"
                          onClick={() => {
                            setRunning(false);
                            setTimer(focusLength * 60);
                            setTimerStarted(false);
                          }}
                          hidden={!timerStarted && timer === focusLength * 60}
                        >
                          重新计时
                        </button>
                      </div>
                    </div>
                  </details>
                  }
                />
              )}
              {page === "practice" && (
                <Suspense fallback={<LoadingState title="正在打开练习工作台…" />}>
                <div className="practice-hub">
                  <div className="practice-hub-topbar">
                  <div className="practice-hub-tabs" role="tablist" aria-label="练习工作区">
                    {([
                      ["quick", "专项练习", BookBookmark],
                      ["ask", "资料答疑", Sparkle],
                    ] as const).map(([id, label, Icon]) => (
                      <button type="button" role="tab" key={id} id={`practice-tab-${id}`} aria-selected={practiceTab === id}
                        aria-controls={`practice-panel-${id}`} tabIndex={practiceTab === id ? 0 : -1}
                        onClick={() => setPracticeTab(id)} onKeyDown={event => {
                          const tabs = ["quick", "ask"] as const;
                          const index = tabs.indexOf(id);
                          const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[1] : null;
                          if (next) { event.preventDefault(); setPracticeTab(next); document.getElementById(`practice-tab-${next}`)?.focus(); }
                        }}><Icon size={19} /><span>{label}</span></button>
                    ))}
                  </div>
                  <div className="practice-utilities"><button type="button" className="text-button" title="重新读取课程和资料状态，不会清除当前作答" disabled={practiceRefreshBusy} onClick={() => void refreshPracticeMaterials()}><ArrowsClockwise size={16} />{practiceRefreshBusy ? "正在刷新…" : "刷新资料"}</button><button type="button" className="text-button" title="查看已加入记忆卡的内容，开始回忆复习" onClick={() => go("memory")}><Stack size={16} />前往回忆复习</button></div></div>
                  <div role="tabpanel" id="practice-panel-quick" aria-labelledby="practice-tab-quick" hidden={practiceTab !== "quick"} className="practice-hub-panel practice-hub-quick">
                    <PracticeStudio state={state} courseId={courseFilter} onCourseChange={setCourseFilter} onRefresh={refresh} onNotify={notify} onOpenSource={openPracticeSource} />
                  </div>
                  <div role="tabpanel" id="practice-panel-ask" aria-labelledby="practice-tab-ask" hidden={practiceTab !== "ask"} className="practice-hub-panel practice-hub-ask">
                    <section className="ask-panel">
                      <label className="practice-ask-course">答疑课程<select aria-label="答疑课程" value={courseFilter} onChange={event => setCourseFilter(event.target.value)}><option value="all">全部课程</option>{state.courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
                      <div className="assistant-label">
                        <Sparkle weight="fill" size={22} />
                        <div>
                          <h2>把不懂的地方问清楚</h2>
                          <span>
                            {state.providerConfigured
                              ? "基于资料的讲解"
                              : "从你的资料中找到相关段落"}
                          </span>
                        </div>
                      </div>
                      <form onSubmit={ask}>
                        <label className="sr-only" htmlFor="ask">
                          输入知识点问题
                        </label>
                        <textarea
                          id="ask"
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          placeholder="例如：导数和微分有什么区别？"
                          maxLength={2000}
                        />
                        <div className="ask-form-bottom">
                          <small>提交后，在下方查看讲解与资料出处</small>
                          <button
                            className="primary"
                            disabled={askBusy || !question.trim()}
                          >
                            {askBusy
                              ? "正在查找…"
                              : state.providerConfigured
                                ? "请帮我讲解"
                                : "查找相关资料"}
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      </form>
                      {!answer ? (
                        <div className="ask-intro">
                          <p>点示例只会填入问题，再点下方按钮提交；也可以直接输入。</p>
                          {[
                            "极限的定义是什么？",
                            "矩阵的秩如何计算？",
                            "牛顿第二定律有什么条件？",
                          ].map((q) => (
                            <button key={q} onClick={() => setQuestion(q)}>
                              {q}
                              <ArrowRight size={15} />
                            </button>
                          ))}
                          <div className="local-note">
                            <Books size={18} />
                            <p>
                              {state.providerConfigured
                                ? "讲解将参考选定课程的上传资料。请核对原文与推导。"
                                : "当前使用本地检索，返回原文依据。配置模型后可启用生成式解释，当前不会编造答案。"}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="retrieval-result">
                          <Badge tone="neutral">
                            {answer.mode === "ai"
                              ? "资料辅助讲解"
                              : "原文检索结果"}
                          </Badge>
                          <p className="answer-text"><LessonText text={answer.answer} inline /></p>
                          <p className="ask-continue">下一步：展开下方出处核对原文，或修改上方问题继续提问。</p>
                          {answer.sources.map((s, i) => (
                            <details key={i} open={i === 0}>
                              <summary>
                                <FileText size={16} />
                                {s.documentName} · 第 {s.page}{" "}
                                {s.locationKind === "section" ? "段" : "页"}
                              </summary>
                              <p>{s.text}</p>
                            </details>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </div>
                </Suspense>
              )}
              {page === "memory" && (
                <>
                  <div className="toolbar">
                    {courseSelect}
                    <span>
                      本轮已复习 {reviewCount} 张 · 当前到期 {dueCards.length}{" "}
                      张
                    </span>
                  </div>
                  {card ? (
                    <div className="memory-layout">
                      <div className="memory-main">
                        <div
                          className={`flashcard ${flipped ? "flipped" : ""}`}
                        >
                          <div className="flashcard-meta">
                            <Badge>{courseName(card.courseId)}</Badge>
                            <span>
                              {flipped ? "答案与解释" : "先回想，再翻面"}
                            </span>
                          </div>
                          <h2><Suspense fallback={card.front}><LessonText text={card.front} inline /></Suspense></h2>
                          {flipped ? (
                            <div className="card-back"><Suspense fallback={card.back}><LessonText text={card.back} /></Suspense></div>
                          ) : (
                            <div className="recall-hint">
                              <Lightbulb size={22} />
                              <p>试着不看资料，说出你记得的内容。</p>
                            </div>
                          )}
                          <p className="source-label">{card.source}</p>
                        </div>
                        {flipped ? (
                          <div className="rating-area">
                            <p>刚才的回想，感觉怎么样？</p>
                            <div className="rating-buttons">
                              {[
                                {
                                  label: "没想起来",
                                  rating: 1,
                                  class: "again",
                                },
                                { label: "有点吃力", rating: 2, class: "hard" },
                                { label: "记得清楚", rating: 3, class: "good" },
                                { label: "非常轻松", rating: 4, class: "easy" },
                              ].map((r) => (
                                <button
                                  className={r.class}
                                  key={r.rating}
                                  disabled={busy}
                                  onClick={async () => {
                                    try {
                                      const updated = (await mutation(
                                        `/cards/${card.id}/review`,
                                        "POST",
                                        { rating: r.rating },
                                      )) as Card;
                                      setFlipped(false);
                                      setReviewed([...reviewed, card.id]);
                                      setReviewCount(reviewCount + 1);
                                      notify(
                                        `已安排下次复习：${new Date(updated.due).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
                                      );
                                    } catch {}
                                  }}
                                >
                                  {r.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <button
                            className="primary flip-button"
                            onClick={() => setFlipped(true)}
                          >
                            看看答案 <ArrowDown size={17} />
                          </button>
                        )}
                      </div>
                      <aside className="memory-advice">
                        <Stack size={32} />
                        <h3>
                          把回想，交给自己。
                          <br />
                          把间隔，交给考谱。
                        </h3>
                        <p>
                          根据每次回想的难度，FSRS 记忆调度会更新下次复习时间。
                        </p>
                        <div>
                          <strong>诚实评价，比点“轻松”更有用</strong>
                          <p>
                            忘记是正常的。准确反馈，才能安排适合你的复习节奏。
                          </p>
                        </div>
                        <small>
                          本轮每张卡展示一次。较短间隔到期后，可重新进入本轮。
                        </small>
                      </aside>
                    </div>
                  ) : (
                    <Empty
                      title={
                        reviewCount
                          ? "这一轮，完成了！"
                          : "当前没有到期的记忆卡"
                      }
                      action={
                        <button
                          className="primary"
                          onClick={() => {
                            if (reviewCount) {
                              setReviewed([]);
                              setReviewCount(0);
                              refresh();
                            } else setCardOpen(true);
                          }}
                        >
                          {reviewCount
                            ? "检查下一轮到期卡片"
                            : "创建第一张记忆卡"}
                          <ArrowRight size={16} />
                        </button>
                      }
                    >
                      已保存 {state.cards.length}{" "}
                      张卡片。你可以稍后再来，或把今天的难点做成一张新卡片。
                    </Empty>
                  )}
                  <div className="saved-cards">
                    <h2>
                      卡片库{" "}
                      <span>
                        {
                          state.cards.filter(
                            (c) =>
                              courseFilter === "all" ||
                              c.courseId === courseFilter,
                          ).length
                        }
                      </span>
                    </h2>
                    {state.cards
                      .filter(
                        (c) =>
                          courseFilter === "all" || c.courseId === courseFilter,
                      )
                      .map((c) => (
                        <details key={c.id}>
                          <summary>
                            {c.front}
                            <span>
                              {new Date(c.due).toLocaleDateString("zh-CN")} 复习
                            </span>
                          </summary>
                          <p>{c.back}</p>
                        </details>
                      ))}
                  </div>
                </>
              )}
              {page === "exams" && <Suspense fallback={<div className="practice-hub-loading" role="status">正在打开期末模拟考…</div>}><ExamStudio state={state} courseId={courseFilter} onCourseChange={id => { setPracticeInitialDocumentIds([]); setPracticeInitialPaperId(undefined); setPracticeInitialAttemptId(undefined); setCourseFilter(id); }} onRefresh={refresh} onNotify={notify} onOpenSource={openPracticeSource} initialDocumentIds={practiceInitialDocumentIds} initialPaperId={practiceInitialPaperId} initialAttemptId={practiceInitialAttemptId} onOpenPlan={id => { setCourseFilter(id); go("plan"); }} /></Suspense>}
              {page === "lessons" && <Suspense fallback={<p role="status">正在打开网课精读…</p>}><LessonStudio initialTarget={lessonTarget} onPractice={(courseId, documentId) => { setCourseFilter(courseId); setPracticeInitialDocumentIds([documentId]); setPracticeInitialPaperId(undefined); setPracticeInitialAttemptId(undefined); go("exams"); }} courses={courses} savedCardKeys={state.cards.flatMap(card => card.sourceKey ? [card.sourceKey] : [])} providerConfigured={state.providerConfigured} onRefresh={refresh} onNotify={notify} onOpenCourse={openCourse} onAddCourse={() => { setEditCourse(null); setCourseOpen(true); }} /></Suspense>}
              {page === "knowledge" && <Suspense fallback={<LoadingState title="正在打开知识库…" description="正在整理你的课程笔记。" />}><KnowledgeBase onNotify={notify} /></Suspense>}
              {page === "resources" && (
                <>
                  <div className="resource-intro">
                    <GraduationCap size={45} />
                    <div>
                      <h2>资源不必多，适合眼前的问题就好。</h2>
                      <p>
                        以下为公开课程与教材入口。按当前薄弱知识点查找章节，不必从头刷完整门课。
                      </p>
                    </div>
                  </div>
                  <div className="resource-grid">
                    {[
                      {
                        name: "MIT OpenCourseWare",
                        category: "理工科 · 课程与习题",
                        desc: "高等数学、线性代数、物理等课程的讲义与练习，可按章节补足基础。",
                        url: "https://ocw.mit.edu/",
                        letter: "MIT",
                      },
                      {
                        name: "OpenStax",
                        category: "开放教材 · 基础知识",
                        desc: "数学、物理等大学基础教材，适合查定义、例题和章节习题。",
                        url: "https://openstax.org/",
                        letter: "OS",
                      },
                      {
                        name: "中国大学 MOOC",
                        category: "中文课程 · 按需补课",
                        desc: "用知识点定位课程章节；课程开放状态和学习条件以平台为准。",
                        url: "https://www.icourse163.org/",
                        letter: "慕课",
                      },
                      {
                        name: "3Blue1Brown",
                        category: "数学直觉 · 可视化",
                        desc: "通过图形理解线性代数、微积分等主题，适合先建立直觉，再动笔练习。",
                        url: "https://www.3blue1brown.com/",
                        letter: "3B1B",
                      },
                    ].map((r) => (
                      <a
                        className="resource-card"
                        key={r.name}
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="resource-mark">{r.letter}</span>
                        <Badge tone="neutral">{r.category}</Badge>
                        <h3>{r.name}</h3>
                        <p>{r.desc}</p>
                        <span className="resource-link">
                          打开资源
                          <ArrowRight size={17} />
                        </span>
                      </a>
                    ))}
                  </div>
                  <div className="notice">
                    <Lightbulb size={20} />
                    公开资源不一定对应你的任课老师与考试范围，请优先使用课程大纲、授课资料和合法取得的练习。
                  </div>
                </>
              )}
            </>
          )}
          {page === "settings" && <Suspense fallback={<LoadingState title="正在打开设置…" />}><AppSettings settings={state.settings} accountName={accountName} onRefresh={refresh} onNotify={notify} onOpenPlan={() => go("plan")} onReset={() => setResetOpen(true)} onLogout={onLogout} /></Suspense>}
          <section hidden={page !== "dashboard"} className="batch-surface">
            <BatchImport
              courses={courses}
              onRefresh={refresh}
              onOpenCourse={openCourse}
              onOpenCourses={openCourses}
            />
          </section>
          <footer className="main-footer">
            <span>考谱 · 让每一次复习，都有一点收获。</span>
            <span>
              本机保存 <span className="status-dot" />{" "}
              {state.providerConfigured ? "模型服务已配置" : "资料留在本机"}
            </span>
          </footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="移动导航">
        <span className="sf-mobile-indicator" aria-hidden="true" style={{ transform: `translateX(${Math.max(0, navigation.findIndex(item => item.id === (page === "memory" ? "practice" : page))) * 100}%)`, opacity: page === "resources" || page === "settings" ? 0 : 1 }} />
        {navigation.map((n) => (
          <button
            className={(page === "memory" ? "practice" : page) === n.id ? "active" : ""}
            key={n.id}
            aria-current={(page === "memory" ? "practice" : page) === n.id ? "page" : undefined}
            onClick={() => (n.id === "materials" ? openCourses() : n.id === "exams" ? openMockExam() : go(n.id))}
          >
            <n.icon size={22} weight={(page === "memory" ? "practice" : page) === n.id ? "fill" : "regular"} />
            <span>
              {n.mobileLabel}
            </span>
          </button>
        ))}
      </nav>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} courses={courses} documents={state.documents}
        actions={[
          ...navigation.map(item => ({ id: item.id, title: item.label, hint: item.id === "dashboard" ? "添加资料，分析归类" : item.id === "plan" ? "时间线、每日任务与考试安排" : item.id === "exams" ? "组卷、限时作答与考后复盘" : "打开学习页面", icon: item.icon, onSelect: () => item.id === "materials" ? openCourses() : item.id === "exams" ? openMockExam() : go(item.id) })),
          { id: "resources", title: "学习资源", hint: "查找课程与学习资源", icon: GraduationCap, onSelect: () => go("resources") },
          { id: "settings", title: "设置", hint: "API 配置、复习偏好与账户数据", icon: GearSix, onSelect: () => go("settings") },
        ]}
        onOpenCourse={openCourse}
        onOpenDocument={document => { go("materials", document.courseId || "unassigned"); setSelectedDoc(document); }} />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={19} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <Modal
        open={courseOpen}
        onOpenChange={(v) => {
          setCourseOpen(v);
          if (!v) {
            setEditCourse(null);
            setPendingDocument(null);
          }
        }}
        title={editCourse ? "编辑课程" : "添加一门课程"}
        description="先建好学科整理资料，考试日期可以稍后补充。"
      >
        <form className="form" onSubmit={saveCourse}>
          <label>
            课程名称
            <input
              name="name"
              placeholder="例如：高等数学（上）"
              required
              maxLength={80}
              defaultValue={editCourse?.name}
            />
          </label>
          <label>
            考试日期（可稍后设置）
            <input
              type="date"
              name="examDate"
              defaultValue={editCourse?.examDate || ""}
            />
          </label>
          <label>
            目标分数 <span>百分制</span>
            <input
              type="number"
              min={1}
              max={100}
              name="target"
              required
              defaultValue={editCourse?.target || 80}
            />
          </label>
          <p className="form-hint">
            掌握度会随练习反馈更新；目标分数用于调整学习优先级。
          </p>
          <button className="primary" disabled={busy}>
            {busy ? "正在保存…" : editCourse ? "保存并更新计划" : "创建课程"}
            <ArrowRight size={16} />
          </button>
          {editCourse && (
            <button
              type="button"
              className="danger-text"
              disabled={busy}
              onClick={async () => {
                if (
                  window.confirm(
                    "删除课程将同时移除该课程的资料、练习与卡片，确定继续？",
                  )
                ) {
                  try {
                    await mutation(
                      `/courses/${editCourse.id}`,
                      "DELETE",
                      undefined,
                      "课程已删除",
                    );
                    setCourseOpen(false);
                    setEditCourse(null);
                    setCourseFilter("all");
                    setUploadCourse("");
                  } catch {}
                }
              }}
            >
              删除课程及其资料
            </button>
          )}
        </form>
      </Modal>
      <Modal
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="开始自己的复习空间"
        description="这会删除当前课程、资料、卡片与学习记录。你可以先导出备份，再开始。"
      >
        <div className="form">
          <a
            className="secondary"
            href="/api/export"
            download="shifen-backup.json"
          >
            <DownloadSimple size={17} />
            先导出当前数据
          </a>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              try {
                await mutation(
                  "/reset",
                  "POST",
                  { mode: "empty" },
                  "空间已准备好，添加你的第一门课程吧。",
                );
                setResetOpen(false);
                setCourseFilter("all");
                setUploadCourse("");
                setSelectedDoc(null);
                setReviewed([]);
                setReviewCount(0);
                setCourseOpen(false);
                go("dashboard");
              } catch {}
            }}
          >
            确认清空，开始我的复习
          </button>
          <button className="text-button" onClick={() => setResetOpen(false)}>
            继续体验，暂不清空
          </button>
        </div>
      </Modal>
      <Modal
        open={cardOpen}
        onOpenChange={setCardOpen}
        title="把一个知识点收进记忆卡"
        description="每张卡只问一个具体问题，让回想更轻松。"
      >
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await mutation(
                "/cards",
                "POST",
                {
                  courseId: f.get("courseId"),
                  front: f.get("front"),
                  back: f.get("back"),
                  source: "我的学习笔记",
                },
                "卡片已保存",
              );
              setCardOpen(false);
              setReviewed([]);
            } catch {}
          }}
        >
          <label>
            所属课程
            <select
              name="courseId"
              defaultValue={
                courseFilter === "all" ? courses[0]?.id : courseFilter
              }
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            问题
            <textarea
              name="front"
              required
              maxLength={1000}
              placeholder="例如：什么时候可以使用洛必达法则？"
            />
          </label>
          <label>
            答案与解释
            <textarea
              name="back"
              required
              maxLength={5000}
              placeholder="写下条件、关键步骤或易错点…"
            />
          </label>
          <button className="primary" disabled={busy || !courses.length}>
            保存卡片
            <Check size={17} />
          </button>
        </form>
      </Modal>
      {globalModelSettingsOpen && <Suspense fallback={null}><ModelSettings initialKind={modelSettingsKind} open={globalModelSettingsOpen} onOpenChange={setGlobalModelSettingsOpen} onConnected={() => { setStudioRefreshKey(value => value + 1); return refresh(); }} /></Suspense>}
    </div>
  );
}
