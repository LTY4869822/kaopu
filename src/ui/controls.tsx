import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import "./galaxy-controls.css";

/** Adapted from Uiverse/galaxy; upstream sources and MIT license in public/licenses. */
export function LoadingMark({ size = 18 }: { size?: number }) {
  return <span className="sf-loading-mark" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function LoadingState({ title, description }: { title: string; description?: string }) {
  return <div className="sf-loading-state" role="status" aria-live="polite"><LoadingMark size={23} /><div><strong>{title}</strong>{description && <p>{description}</p>}</div></div>;
}

type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; arrow?: boolean; children: ReactNode };
export function ActionButton({ busy = false, arrow = true, className = "primary", children, disabled, type = "button", ...props }: ActionProps) {
  return <button {...props} type={type} className={`${className} sf-action`} disabled={disabled || busy} aria-busy={busy || undefined}>
    <span className="sf-button-label">{children}</span>{(busy || arrow) && <span className="sf-button-trailing">{busy ? <LoadingMark /> : <ArrowRight size={18} />}</span>}
  </button>;
}
