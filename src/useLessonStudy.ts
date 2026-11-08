import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Lesson, LessonStudy, LessonStudyAction } from "./lesson-types";

export default function useLessonStudy(lesson: Lesson | null) {
  const [value, setValue] = useState<{ id: string; data: LessonStudy } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const currentId = useRef(lesson?.id), serial = useRef(0), locked = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  currentId.current = lesson?.id;
  const id = lesson?.id;
  // Example enrichment changes content without replacing notes.createdAt.
  // Study marks alone must not trigger a reload or clear a just-saved mark.
  const revision = useMemo(() => JSON.stringify([lesson?.notes, lesson?.visual?.id, lesson?.visual?.updatedAt, lesson?.sourceDiagnostics]), [lesson?.notes, lesson?.visual, lesson?.sourceDiagnostics]);
  useEffect(() => {
    const controller = new AbortController(), sequence = ++serial.current;
    mutation.current?.abort(); locked.current = false; setSaving(false); setError(""); setValue(null);
    if (id) void fetch(`/api/lessons/${encodeURIComponent(id)}/study`, { signal: controller.signal, credentials: "include" }).then(async response => {
      const data = await response.json();
      if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired"));
      if (!response.ok) throw new Error(data.error || "学习记录暂时无法读取。");
      if (!controller.signal.aborted && sequence === serial.current) setValue({ id, data });
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "学习记录读取失败。"); });
    return () => { controller.abort(); mutation.current?.abort(); serial.current++; };
  }, [id, revision, reload]);
  const mark: LessonStudyAction = useCallback((kind, itemId, status) => {
    if (!id || !value || value.id !== id || locked.current) return;
    const controller = new AbortController(), sequence = ++serial.current;
    mutation.current = controller; locked.current = true; setSaving(true); setError("");
    void fetch(`/api/lessons/${encodeURIComponent(id)}/study`, { method: "PUT", credentials: "include", signal: controller.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: value.data.version, kind, id: itemId, status }) }).then(async response => {
      const data = await response.json();
      if (response.status === 401) window.dispatchEvent(new Event("shifen:session-expired"));
      if (!response.ok) throw new Error(data.error || "学习记录保存失败，请重试。");
      if (!controller.signal.aborted && currentId.current === id && sequence === serial.current) setValue({ id, data });
    }).catch(cause => { if (!controller.signal.aborted && currentId.current === id) setError(cause instanceof Error ? cause.message : "学习记录保存失败。"); })
      .finally(() => { if (sequence === serial.current) { locked.current = false; setSaving(false); } });
  }, [id, value]);
  return { study: value && value.id === id ? value.data : undefined, error, saving, mark, retry: () => setReload(value => value + 1) };
}
