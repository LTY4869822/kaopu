import { useEffect, useRef, useState } from 'react';
import { CheckCircle, FileText, UploadSimple, WarningCircle, X } from '@phosphor-icons/react';

type Transcript = { filename: string; text: string; needsReview: boolean; warnings: string[] };
type Props = { attemptId: string; questionId: string; disabled: boolean; hasAnswer: boolean; onUse: (text: string, append: boolean) => boolean };

export default function ExamSubmission({ attemptId, questionId, disabled, hasAnswer, onUse }: Props) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [draft, setDraft] = useState<Transcript | null>(null);
  const [pdfMode, setPdfMode] = useState<'handwriting' | 'auto'>('handwriting');
  const input = useRef<HTMLInputElement>(null), active = useRef<AbortController | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
  async function read(file?: File) {
    if (!file || busy || disabled) return;
    setError('');
    if (file.size > 20 * 1024 * 1024) { setError('每份作答文件最多20MB，请只上传本题内容。'); return; }
    const controller = new AbortController(); active.current = controller; setBusy(true);
    try {
      const form = new FormData(); form.append('file', file); form.append('questionId', questionId); form.append('parseMode', pdfMode);
      const response = await fetch(`/api/exams/attempts/${encodeURIComponent(attemptId)}/submission`, { method: 'POST', body: form, signal: controller.signal });
      let value; try { value = await response.json(); } catch { throw new Error('文件暂未读取成功，请稍后重试。'); }
      if (response.status === 401) window.dispatchEvent(new Event('shifen:session-expired'));
      if (!response.ok) throw new Error(value.error || '文件暂未读取成功，请稍后重试。');
      if (mounted.current && active.current === controller) setDraft(value as Transcript);
    } catch (cause) { if (mounted.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : '文件暂未读取成功，请重试。'); }
    finally { if (mounted.current && active.current === controller) { setBusy(false); active.current = null; if (input.current) input.current.value = ''; } }
  }
  function use(append: boolean) {
    if (!draft || disabled || busy || !draft.text.trim()) return;
    if (onUse(draft.text, append)) { setDraft(null); setError(''); }
    else setError('合并后超过10000字，或本轮已结束。请保留识别稿，缩短内容后再试。');
  }
  return <div className="es-submission">
    <input ref={input} className="es-hidden-input" hidden tabIndex={-1} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.pptx,.txt,.md" aria-label="上传本题作答文件" disabled={disabled || busy} onChange={event => void read(event.target.files?.[0])} />
    <div className="es-submission-upload"><button type="button" className="secondary" disabled={disabled || busy} onClick={() => input.current?.click()}><UploadSimple size={18} />{busy ? '正在读取作答…' : '上传纸上作答 / 文档'}</button>{busy ? <button type="button" className="text-button" onClick={() => active.current?.abort()}>取消读取</button> : <span>照片、PDF或Word · 20MB以内</span>}<label className="es-submission-pdf-mode"><span>PDF读取</span><select aria-label="PDF作答读取方式" disabled={disabled || busy} value={pdfMode} onChange={event => setPdfMode(event.target.value as 'handwriting' | 'auto')}><option value="handwriting">手写 / 扫描 · 8页内</option><option value="auto">文字文档</option></select></label></div>
    {error && <p className="es-submission-error" role="alert"><WarningCircle size={16} />{error}</p>}
    {draft && <div className="es-submission-preview"><div><FileText size={18} /><strong>{draft.filename}</strong><button type="button" className="icon-button" aria-label="关闭识别稿" onClick={() => setDraft(null)}><X size={17} /></button></div><label>核对识别稿<textarea aria-label="核对本题作答识别稿" value={draft.text} maxLength={10000} rows={6} disabled={disabled} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label><p>对照自己的原件核对公式、正负号和上下标，再放入答卷。照片会交给已配置的视觉模型。</p>{draft.warnings.length > 1 && <details><summary>读取提示</summary>{draft.warnings.slice(1).map((warning, i) => <p key={i}>{warning}</p>)}</details>}<div className="es-submission-use">{hasAnswer && <button type="button" className="text-button" disabled={disabled || !draft.text.trim()} onClick={() => use(false)}>替换当前文字</button>}<button type="button" className="primary" disabled={disabled || !draft.text.trim()} onClick={() => use(hasAnswer)}><CheckCircle size={17} />{hasAnswer ? '追加到本题答案' : '采用为本题答案'}</button></div></div>}
  </div>;
}
