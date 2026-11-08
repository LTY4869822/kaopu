import type { PointerEvent } from "react";

/** Pointer polish only: real controls and their layout never depend on a hover. */
export function surfaceMove(event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const element = event.currentTarget;
  const box = element.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
  const y = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
  element.style.setProperty("--tilt-x", `${(0.5 - y) * 6}deg`);
  element.style.setProperty("--tilt-y", `${(x - 0.5) * 6}deg`);
  element.style.setProperty("--pointer-x", `${x * 100}%`);
  element.style.setProperty("--pointer-y", `${y * 100}%`);
}

export function surfaceReset(event: PointerEvent<HTMLElement>) {
  const element = event.currentTarget;
  element.style.setProperty("--tilt-x", "0deg");
  element.style.setProperty("--tilt-y", "0deg");
  element.style.setProperty("--pointer-x", "50%");
  element.style.setProperty("--pointer-y", "50%");
}
