import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import AuthPage from "./AuthPage";
import LandingPage from "./LandingPage";
import type { AuthStatus } from "./AuthPage";
import { api } from "./api";
import { clearLessonImageCache } from "./lesson-assets";
const App = lazy(() => import("./App"));

export default function AuthGate() {
  const [showIntro, setShowIntro] = useState(() => new URLSearchParams(window.location.search).get("intro") === "1");
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");
  const authVersion = useRef(0);
  const updateStatus = useCallback((next: AuthStatus) => {
    clearLessonImageCache();
    authVersion.current++;
    setError("");
    setStatus(next);
  }, []);
  const check = useCallback(async () => {
    const version = ++authVersion.current;
    setError("");
    try {
      const result = await api<AuthStatus>("/auth/status");
      if (version === authVersion.current) { if (!result.authenticated) clearLessonImageCache(); setStatus(result); }
    } catch {
      if (version === authVersion.current) setError("暂时无法连接考谱服务，请检查服务后重试。");
    }
  }, []);
  useEffect(() => {
    void check();
    // Ignore requests from an earlier mount, including StrictMode's first effect.
    return () => { authVersion.current++; };
  }, [check]);
  useEffect(() => {
    const expire = () => { updateStatus({ authenticated: false, accountExists: true }); };
    window.addEventListener("shifen:session-expired", expire);
    return () => window.removeEventListener("shifen:session-expired", expire);
  }, [updateStatus]);
  async function logout() {
    const version = ++authVersion.current;
    const result = await api<AuthStatus>("/auth/logout", "POST", {});
    if (version === authVersion.current) updateStatus(result);
  }
  if (!status && !error) return <div className="auth-page" role="status" style={{display:"grid",placeItems:"center"}}>正在恢复你的学习空间…</div>;
  if (status?.authenticated && showIntro) {
    const enter = () => { const url = new URL(window.location.href); url.searchParams.delete("intro"); window.history.replaceState(null, "", url); setShowIntro(false); };
    return <LandingPage onLogin={enter} onRegister={enter} />;
  }
  if (status?.authenticated) return <Suspense fallback={<div className="auth-page" role="status" style={{display:"grid",placeItems:"center"}}>正在打开你的学习空间…</div>}><App onLogout={status.user ? logout : undefined} accountName={status.user?.name} /></Suspense>;
  return <AuthPage status={status} connectionError={error} onRetry={() => void check()} onAuthenticated={updateStatus} />;
}
