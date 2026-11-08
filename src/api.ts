function signalRestartRequired(data: { restartRequired?: boolean; code?: string }) {
  if (data?.restartRequired || data?.code === "RESTART_REQUIRED") window.dispatchEvent(new Event("shifen:restart-required"));
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers:
      body instanceof FormData
        ? undefined
        : body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
    body:
      body instanceof FormData
        ? body
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
  });
  const data = await response.json();
  signalRestartRequired(data);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("shifen:session-expired"));
    throw new Error(data.error || "操作未完成，请重试");
  }
  return data;
}

export async function downloadFullBackup() {
  const response = await fetch("/api/backup");
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    signalRestartRequired(data);
    if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired"));
    throw new Error(data.error || "完整备份未能下载，请重试。");
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="([^"]+\.zip)"/i)?.[1] || "shifen-full-backup.zip";
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function daysLeft(value: string) {
  return Math.ceil(
    (new Date(value + "T00:00:00").getTime() -
      new Date(dayKey() + "T00:00:00").getTime()) /
      86400000,
  );
}
