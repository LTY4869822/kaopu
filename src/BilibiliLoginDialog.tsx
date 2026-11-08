import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowClockwise, CheckCircle, QrCode, WarningCircle, X } from "@phosphor-icons/react";
import { api } from "./api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (uname: string) => void;
};
type Phase = "loading" | "pending" | "scanned" | "expired" | "error";

/**
 * Bilibili scan-code login. The QR comes from Bilibili's official passport API;
 * the session cookie stays on the local server and never reaches page scripts.
 */
export default function BilibiliLoginDialog({ open, onOpenChange, onSuccess }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const key = useRef("");
  const alive = useRef(false);
  const success = useRef(onSuccess);
  success.current = onSuccess;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) { alive.current = false; return; }
    alive.current = true;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await api<{ status: string; uname?: string }>("/bilibili/auth/poll", "POST", { key: key.current });
        if (!alive.current) return;
        if (result.status === "success") {
          alive.current = false;
          success.current(result.uname || "");
          return;
        }
        if (result.status === "expired") { setPhase("expired"); return; }
        if (result.status === "scanned") setPhase("scanned");
        timer = window.setTimeout(poll, 2000);
      } catch (cause) {
        if (!alive.current) return;
        setPhase("error"); setError(cause instanceof Error ? cause.message : "登录状态读取失败，请重试。");
      }
    };
    const start = async () => {
      setPhase("loading"); setError(""); setImage("");
      try {
        const result = await api<{ key: string; image: string }>("/bilibili/auth/qrcode", "POST", {});
        if (!alive.current) return;
        key.current = result.key; setImage(result.image); setPhase("pending");
        timer = window.setTimeout(poll, 2000);
      } catch (cause) {
        if (!alive.current) return;
        setPhase("error"); setError(cause instanceof Error ? cause.message : "二维码获取失败，请重试。");
      }
    };
    void start();
    return () => { alive.current = false; window.clearTimeout(timer); };
  }, [open, attempt]);

  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="modal-overlay lesson-modal-overlay" />
    <Dialog.Content className="modal lesson-source-dialog bilibili-login-dialog">
      <div className="modal-heading"><Dialog.Title>扫码登录 B 站</Dialog.Title>
        <Dialog.Close className="icon-button" aria-label="关闭登录窗口"><X size={21} /></Dialog.Close></div>
      <Dialog.Description>登录只用于读取这个账号可见的字幕，完成后自动继续整理讲义。</Dialog.Description>
      <div className="bilibili-login-body">
        {phase === "loading" && <p className="bilibili-login-status">正在获取二维码…</p>}
        {phase === "error" && <div className="lesson-alert" role="alert"><WarningCircle size={18} /><span>{error}</span></div>}
        {image && phase !== "error" && <img className="bilibili-login-qr" src={image} alt="B 站登录二维码，用手机哔哩哔哩扫码" width={264} height={264} />}
        {(phase === "pending" || phase === "scanned") && <p className="bilibili-login-status">
          {phase === "scanned" ? "已扫码，请在手机上确认登录。" : "打开手机哔哩哔哩 App，扫一扫并确认登录。"}</p>}
        {phase === "scanned" && <p className="bilibili-login-hint"><CheckCircle size={15} />确认后会自动回到讲义，无需再点按钮。</p>}
        {phase === "expired" && <p className="bilibili-login-status">二维码已过期，请刷新后重新扫码。</p>}
        {(phase === "expired" || phase === "error") && <button type="button" className="primary" onClick={() => setAttempt(value => value + 1)}><ArrowClockwise size={16} />重新获取二维码</button>}
        <p className="bilibili-login-hint"><QrCode size={15} />登录态只保存在本机，不会读取你浏览器的 Cookie，也不会发往 B 站以外的服务。</p>
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
