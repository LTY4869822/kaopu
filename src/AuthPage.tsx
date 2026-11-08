import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, ArrowUpRight, ArrowLeft, Plus, List, Eye, EyeSlash, Fingerprint, Pause, Play, ArrowClockwise, X, BookOpen, CalendarBlank, Stack, WarningCircle } from "@phosphor-icons/react";
import ConfuciusPortrait from "./ConfuciusPortrait";
import LandingPage from "./LandingPage";
import { api } from "./api";
import "./auth.css";

export type AuthStatus = { authenticated: boolean; accountExists: boolean; user?: { name: string; email: string } };
type Info = "about" | "privacy" | "recovery" | null;
const initialAuthMode = () => {
  const requested = new URLSearchParams(window.location.search).get("auth");
  return requested === "login" || requested === "register" ? requested : "intro";
};

export default function AuthPage({ status, onAuthenticated, connectionError, onRetry }: {
  status: AuthStatus | null;
  onAuthenticated: (status: AuthStatus) => void;
  connectionError: string;
  onRetry: () => void;
}) {
  const [mode, setMode] = useState<"intro" | "login" | "register">(initialAuthMode);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<Info>(null);
  const [paused, setPaused] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [email, setEmail] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false);
  const register = mode === "register";

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    const back = () => { if (!submitting.current) { setMode(initialAuthMode()); setError(""); setVisible(false); setInfo(null); } };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); if (mode !== "intro") formHeading.current?.focus({ preventScroll: true }); }, [mode]);
  function changeMode(next: "intro" | "login" | "register") {
    if (busy) return;
    const url = new URL(window.location.href);
    if (next === "intro") url.searchParams.delete("auth"); else url.searchParams.set("auth", next);
    window.history.pushState(null, "", url);
    setMode(next); setError(""); setVisible(false); setInfo(null);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true; setBusy(true); setError("");
    try {
      const result = await api<AuthStatus>(`/auth/${mode}`, "POST", {
        email: String(form.get("email") || "").trim(), password: form.get("password"),
        ...(register ? { name: String(form.get("name") || "").trim() } : {}),
      });
      const url = new URL(window.location.href); url.searchParams.delete("auth"); window.history.replaceState(null, "", url);
      onAuthenticated(result);
    } catch (e) {
      setMode(initialAuthMode());
      setError(e instanceof Error ? e.message : "暂时无法连接，请稍后重试。");
    } finally { submitting.current = false; setBusy(false); }
  }

  if (mode === "intro") return <LandingPage onLogin={() => changeMode("login")} onRegister={() => changeMode("register")} />;

  return (
    <main className="auth-page auth-is-form">
      <header className="auth-nav">
        <a className="auth-brand" href="#" aria-label="考谱首页" onClick={e => { e.preventDefault(); changeMode("intro"); }}>考谱<span>KAOPU</span></a>
        <button className="auth-menu" type="button" onClick={() => setInfo("about")}>了解考谱 <List size={18} /></button>
        <button className="auth-nav-action" type="button" onClick={() => changeMode(register ? "login" : "register")} disabled={busy}><span>{register ? "登录账户" : "创建账户"}</span><Plus size={20} /></button>
      </header>
      <div className="auth-portrait-stage"><ConfuciusPortrait paused={paused} pulse={pulse} /></div>
      <section className="auth-entry" aria-label="账户入口">
        <div className="auth-form-wrap">
          <button type="button" className="auth-back" onClick={() => changeMode("intro")} disabled={busy}><ArrowLeft size={16} /> 返回</button>
          <div className="auth-form-intro">
            <h2 ref={formHeading} tabIndex={-1}>{register ? "开始，拾回知识。" : "继续你的复习。"}</h2>
            <p>{register ? "从一份资料开始，慢慢把知识变成底气。" : "接着上次的进度，把学过的变成学会的。"}</p>
          </div>
          <div className="auth-tabs" role="group" aria-label="选择登录或注册">
            <button type="button" className={!register ? "is-active" : ""} aria-pressed={!register} onClick={() => changeMode("login")} disabled={busy}>登录</button>
            <button type="button" className={register ? "is-active" : ""} aria-pressed={register} onClick={() => changeMode("register")} disabled={busy}>创建账户</button>
          </div>
          <form key={mode} className="auth-form" onSubmit={submit} aria-busy={busy}>
            {register && <div className="auth-field"><label htmlFor="auth-name">怎么称呼你</label><input id="auth-name" name="name" autoComplete="nickname" placeholder="你的名字或昵称" required maxLength={40} disabled={busy} /></div>}
            <div className="auth-field"><label htmlFor="auth-email">邮箱</label><input id="auth-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} disabled={busy} spellCheck={false} /></div>
            <div className="auth-field">
              <div className="auth-label-line"><label htmlFor="auth-password">密码</label>{!register && <button type="button" className="auth-text-button" onClick={() => setInfo("recovery")}>忘记密码？</button>}</div>
              <div className="auth-password"><input id="auth-password" name="password" type={visible ? "text" : "password"} autoComplete={register ? "new-password" : "current-password"} placeholder={register ? "设置至少 8 位的密码" : "输入你的密码"} required minLength={register ? 8 : 1} maxLength={128} disabled={busy} aria-describedby={register ? "password-hint" : undefined} /><button type="button" aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeSlash size={21} /> : <Eye size={21} />}</button></div>
              {register && <p id="password-hint" className="auth-field-hint">8–128 位，建议组合使用字母、数字和符号。</p>}
            </div>
            {error && <p className="auth-error" ref={errorRef} tabIndex={-1} role="alert"><WarningCircle size={19} />{error}</p>}
            {connectionError && <div className="auth-error" role="alert"><span>{connectionError}</span><button type="button" onClick={onRetry}>重试</button></div>}
            <button className="auth-submit" type="submit" disabled={busy || !status || !!connectionError}><span>{busy ? (register ? "正在创建账户…" : "正在进入学习空间…") : (register ? "创建账户，开始考谱" : "登录，继续考谱")}</span><ArrowRight size={21} /></button>
          </form>
          <p className="auth-local-note"><Fingerprint size={18} /><span>专属于你的本机学习空间</span></p>
          {register && <p className="auth-register-note">每个账户都有独立的本机学习空间，课程、笔记和知识库互不可见。</p>}
        </div>
      </section>
      <footer className="auth-footer"><div className="auth-footer-topics"><span>资料归档</span><span>复习计划</span><span>练习与记忆</span></div><div className="auth-art-controls"><span>移动探索 · 点击切换</span><button type="button" title="切换肖像色彩" aria-label="切换肖像色彩" onClick={() => setPulse(v => v + 1)} disabled={paused}><ArrowClockwise size={17} /></button><button type="button" title={paused ? "开启动效" : "暂停动效"} aria-label={paused ? "开启动效" : "暂停动效"} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={15} /> : <Pause size={15} />}</button><button className="auth-privacy" type="button" onClick={() => setInfo("privacy")}>隐私 <ArrowUpRight size={13} /></button></div></footer>

      <Dialog.Root open={info !== null} onOpenChange={open => { if (!open) setInfo(null); }}>
        <Dialog.Portal><Dialog.Overlay className="modal-overlay auth-dialog-overlay" /><Dialog.Content className="modal auth-dialog">
          <div className="modal-heading"><Dialog.Title>{info === "about" ? "让每一次复习，都有一点收获。" : info === "privacy" ? "你的学习，留在你的空间。" : "关于账户与密码"}</Dialog.Title><Dialog.Close className="icon-button" aria-label="关闭"><X size={22} /></Dialog.Close></div>
          <Dialog.Description>{info === "about" ? "考谱，把杂乱资料变成有出处的知识、可执行的计划和真正学会的每一步。" : info === "privacy" ? "每个账户都有独立的本机学习空间，登录后只能访问自己的资料。" : "使用本机的一次性恢复链接重设密码，学习资料会保留。"}</Dialog.Description>
          {info === "about" ? <div className="auth-about-list"><div><BookOpen size={24} /><p><strong>先把资料整理好</strong><span>上传 PDF、Word、PPT，按学科收拢知识。</span></p></div><div><CalendarBlank size={24} /><p><strong>再把时间安排好</strong><span>结合考试日期与可用时间，安排每天的复习。</span></p></div><div><Stack size={24} /><p><strong>让知识真正留下来</strong><span>练习、讲解与间隔复习，一点点补上薄弱处。</span></p></div></div> : info === "privacy" ? <div className="auth-info-copy"><p>账户与学习资料保存在运行考谱服务的设备中。密码以加盐哈希存储，登录会话使用 HttpOnly Cookie；浏览器不会保存明文密码。</p><p>本版本不提供跨设备云同步；不同账户的课程、资料、网课和知识库按目录隔离。若配置了模型服务，提问时会将问题和相关资料片段发送给你配置的服务。</p></div> : <div className="auth-info-copy"><p>请先确认使用的是首次创建账户时填写的邮箱与密码，也可以查看浏览器密码管理器中保存的记录。</p><p>如仍无法登录，请联系这台考谱服务的管理者协助恢复。学习资料不会因登录失败而被清除。</p></div>}
          {info === "recovery" && <div className="auth-info-copy"><p>在运行考谱的电脑、项目目录中执行 <code>npm run recover</code>，打开生成的15分钟一次性链接，自行设置新密码。</p><a className="auth-dialog-done" href="/auth/recovery">打开恢复入口 <ArrowRight size={18} /></a></div>}
          <Dialog.Close className="auth-dialog-done">知道了 <ArrowRight size={18} /></Dialog.Close>
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
