import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import katex from 'katex';
import { readLessonFrame } from './lesson-assets.mjs';
import { htmlPdf, studyDocumentHtml, studyDocumentWord, sendStudyDocument } from './study-document.mjs';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const list = value => Array.isArray(value) ? value : [];
const time = seconds => { const value = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(value / 3600) ? `${Math.floor(value / 3600)}:` : ''}${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; };

function rich(value) {
  const parts = String(value || '').split(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$(?!\$)[^\n$]{1,2000}\$)/g);
  return parts.map(part => {
    const block = part.startsWith('$$') || part.startsWith('\\['), inline = part.startsWith('\\(') || part.startsWith('$');
    if ((block || inline) && part.length > 2) {
      const expression = part.slice(block || part.startsWith('\\(') ? 2 : 1, block || part.startsWith('\\(') ? -2 : -1);
      try { return katex.renderToString(expression, { displayMode: block, throwOnError: false, trust: false, maxExpand: 1000, maxSize: 12, strict: 'ignore' }); } catch { return escape(part); }
    }
    return escape(part).replace(/\n/g, '<br>');
  }).join('');
}

let fontStyles;
async function mathStyles() {
  if (!fontStyles) fontStyles = (async () => {
    const directory = path.dirname(require.resolve('katex'));
    let css = await fs.readFile(path.join(directory, 'katex.min.css'), 'utf8');
    const rules = [...css.matchAll(/src:([^;}]+)/g)];
    for (const rule of rules) {
      const font = rule[1].match(/url\(fonts\/([^)]*\.woff2)\)\s*format\(["']woff2["']\)/);
      if (!font || !/^[a-zA-Z0-9_-]+\.woff2$/.test(font[1])) continue;
      const data = await fs.readFile(path.join(directory, 'fonts', font[1]));
      css = css.replace(rule[0], `src:url(data:font/woff2;base64,${data.toString('base64')}) format("woff2")`);
    }
    return css;
  })();
  return fontStyles;
}

const css = `:root{color-scheme:light}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f6f5f1;color:#292b27;font-family:"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;font-size:17px;line-height:1.9}main{max-width:900px;padding:48px 52px;margin:24px auto;background:#fffefa}h1{font-size:30px;line-height:1.4;margin:0 0 12px}h2{font-size:24px;line-height:1.5;margin:48px 0 16px;border-bottom:1px solid #e2e3da;padding-bottom:12px}h3{font-size:19px;line-height:1.6;margin:30px 0 12px}h4{font-size:17px;margin:22px 0 8px}p{margin:10px 0;overflow-wrap:anywhere}a{color:#a74425;text-underline-offset:4px}nav{margin:30px 0;padding:18px 22px;background:#f5f4ef}nav ol{margin:6px 0;padding-left:24px}ul,ol{padding-left:25px}li+li{margin-top:8px}.meta,.source,.caption,.boundary{color:#62675e;font-size:14px;line-height:1.8}.source{margin:14px 0}.tag{color:#9c4427;font-size:14px;font-weight:600}.supplement{padding:16px 20px;background:#f7f5ef;margin:20px 0}.example{margin:30px 0 45px;break-inside:avoid}figure{margin:24px 0;break-inside:avoid}img{width:100%;height:auto;max-height:520px;object-fit:contain;background:#f1f0ea;border-radius:6px}figcaption{font-size:14px;color:#62675e;line-height:1.7;margin-top:7px}.missing{padding:20px;background:#f5f3ec;color:#6c5d48;font-size:14px}summary{cursor:pointer;font-weight:600;padding:10px 0}details{margin:16px 0}.katex-display{overflow-x:auto;padding:4px 0}.transcript{font-size:15px;line-height:1.85}.transcript time{font-size:14px;color:#696f63}.page-note{padding-top:18px;margin-top:36px;border-top:1px solid #dddeda}.self-check{padding:16px 20px;background:#f7f5ef}.source-set{margin:10px 0;font-size:14px;color:#656b60}@media(max-width:760px){main{padding:26px 20px;margin:0}h1{font-size:26px}h2{font-size:22px}body{font-size:17px}}@media print{@page{size:A4;margin:18mm 16mm}html{scroll-behavior:auto}body{background:white;color:#111;font-size:11.5pt}main{margin:0;padding:0;max-width:none;background:white}h1{font-size:22pt}h2{font-size:17pt;break-after:avoid}h3,h4{break-after:avoid}p{orphans:3;widows:3}img{max-height:130mm}nav{background:transparent}a{color:#333}.boundary{font-size:9pt}.katex-display{overflow:visible}details[open]{break-inside:auto}.example{break-inside:auto}}`;

export async function renderLessonDocument(lesson, { dataDir, readImage = readLessonFrame } = {}) {
  if (!lesson?.notes) throw Object.assign(new Error('请先整理讲义，再下载图文文档。'), { status: 422 });
  if (lesson.notes.evidenceOutdated) throw Object.assign(new Error('画面已更新，请先更新讲义，再下载图文文档。'), { status: 422 });
  const notes = lesson.notes;
  const sections = list(notes.readingSections || notes.sections), examples = list(notes.readingExamples || notes.examples);
  const cues = new Map([...list(lesson.cues), ...list(lesson.visualCues)].map(cue => [cue.id, cue]));
  const frames = new Map(list(lesson.visual?.frames).map(frame => [frame.id, frame]));
  const canonical = lesson.url?.match(/\/video\/(BV[0-9A-Za-z]{10})/);
  const sourceUrl = canonical ? `https://www.bilibili.com/video/${canonical[1]}/?p=${lesson.part}` : null;
  const warning = new Set();
  const imageCache = new Map(); let imageBytes = 0;
  const image = async (frameId, caption = '') => {
    if (!frames.has(frameId)) return '';
    if (!imageCache.has(frameId)) imageCache.set(frameId, (async () => {
      try {
        const result = await readImage(dataDir, lesson, frameId);
        imageBytes += result.bytes.length;
        if (imageBytes > 48 * 1024 * 1024) throw new Error('budget');
        return `data:${result.mime};base64,${result.bytes.toString('base64')}`;
      } catch { warning.add(frameId); return null; }
    })());
    const value = await imageCache.get(frameId), frame = frames.get(frameId);
    return value ? `<figure><img src="${value}" alt="${escape(`原课 ${time(frame.time)} 的截图`)}"><figcaption>${escape(time(frame.time))} · ${escape(caption || '原课截图')}${sourceUrl ? ` · <a href="${escape(`${sourceUrl}&t=${Math.floor(frame.time)}`)}" rel="noreferrer">回看该时间</a>` : ''}</figcaption></figure>` : `<p class="missing">${escape(time(frame.time))} 的原图暂不可用，请回到原课核对。</p>`;
  };
  const images = async (ids, evidence) => (await Promise.all([...new Set(list(ids))].slice(0, 3).map(id => image(id, evidence?.selections?.find(item => item.frameId === id)?.caption)))).join('') || (evidence?.note ? `<p class="missing">${escape(evidence.note)}</p>` : '');
  const references = item => {
    const owned = list(item.cueIds).map(id => cues.get(id)).filter(Boolean);
    const start = owned.find(cue => Number.isFinite(cue.start))?.start;
    return `<p class="source">${sourceUrl ? `<a href="${escape(sourceUrl + (start != null ? `&t=${Math.floor(start)}` : ''))}" rel="noreferrer">原课 ${start != null ? escape(time(start)) : '来源'}</a> · ` : ''}${owned.length} 段原文${list(item.frameIds).length ? ` · ${list(item.frameIds).length} 张相关画面` : ''}</p>`;
  };
  const bullets = values => `<ul>${list(values).map(value => `<li>${rich(typeof value === 'string' ? value : value.text || '')}</li>`).join('')}</ul>`;
  const steps = values => `<ol>${list(values).map(value => `<li>${rich(typeof value === 'string' ? value : value.text || '')}</li>`).join('')}</ol>`;
  const teaching = item => [
    item.intuition ? `<h4>先这样理解</h4><p>${rich(item.intuition)}</p>` : '',
    list(item.prerequisites).length ? `<h4>需要先掌握</h4>${bullets(item.prerequisites)}` : '',
    item.teacherExplanation ? `<h4>把知识点讲透</h4><p>${rich(item.teacherExplanation)}</p>` : '',
    list(item.steps).length ? `<h4>推导与使用步骤</h4>${steps(item.steps)}` : '',
    list(item.pitfalls).length ? `<h4>容易弄错的地方</h4>${bullets(item.pitfalls)}` : '',
  ].join('');
  const renderSection = async (item, index) => `<section id="knowledge-${index}"><h2>${escape(item.title)}</h2>${references(item)}${item.takeaway ? `<p class="boundary">${rich(item.takeaway)}</p>` : ''}<p>${rich(item.text)}</p>${await images(item.frameIds, item.evidence)}${teaching(item) ? item.editorial ? `<details class="supplement"><summary>易错点与 AI 补充解释</summary>${teaching(item)}</details>` : `<div class="supplement"><span class="tag">AI 补充讲解</span>${teaching(item)}</div>` : ''}${list(item.subsections).length ? `<details data-print="omit"><summary>展开本节的课堂细节</summary>${list(item.subsections).map(sub => `<h3>${escape(sub.title)}</h3><p>${rich(sub.text)}</p>${references(sub)}`).join('')}</details>` : ''}${item.checkQuestion?.prompt ? `<div class="self-check"><h4>检查自己是否理解</h4><p>${rich(item.checkQuestion.prompt)}</p><details><summary>参考思路</summary><p>${rich(item.checkQuestion.answer || item.checkQuestion.explanation)}</p></details></div>` : ''}</section>`;
  const sectionHtml = [];
  for (let index = 0; index < sections.length; index++) sectionHtml.push(await renderSection(sections[index], index));
  const exampleHtml = [];
  for (let index = 0; index < examples.length; index++) {
    const item = examples[index];
    const gap = item.explanationStatus === 'needs-confirmation' ? `<p class="boundary">${rich(item.explanationGap || '题目条件不完整，请核对后再补充解法。')}</p>` : '';
    const supplementTitle = item.explanationStatus === 'conditional' ? 'AI 条件性补充解题' : 'AI 补充解题';
    exampleHtml.push(`<article class="example" id="exercise-${index}"><h3>例题 ${index + 1} · ${escape(item.title)}</h3>${references(item)}${item.needsReview ? '<p class="boundary">题干或条件存在待核对项，请先核对原图。</p>' : ''}${gap}${await images(item.frameIds, item.evidence)}<h4>题目</h4><p>${rich(item.prompt)}</p><h4>课堂解法</h4><p>${rich(item.solution || '原课没有完整可用的文字解法，请结合截图核对。')}</p>${item.detailedSolution || list(item.solutionSteps).length ? `<div class="supplement"><span class="tag">${supplementTitle}</span>${item.detailedSolution ? `<p>${rich(item.detailedSolution)}</p>` : ''}${steps(item.solutionSteps)}</div>` : ''}</article>`);
  }
  const archiveWarnings = [...new Set([...list(notes.readingWarnings), ...list(notes.warnings)])];
  if (warning.size) archiveWarnings.unshift(`${warning.size} 张引用图片未能打包，请回到原课核对。`);
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(lesson.title)} · 考谱图文讲义</title><style>${css}\n${await mathStyles()}</style></head><body><main><header><h1>${escape(lesson.title)}</h1><p class="meta">考谱图文精读 · 第 P${escape(lesson.part)} 讲次 · ${sections.length} 个知识单元 · ${examples.length} 个课堂例题</p><p class="boundary">本文件已内嵌可用截图和公式字体，可离线阅读或使用浏览器打印保存为 PDF。课堂整理与 AI 补充讲解分开标注；原始转写可能错词，请结合原课核对。</p>${sourceUrl ? `<p class="source"><a href="${escape(sourceUrl)}" rel="noreferrer">打开原课程</a></p>` : ''}</header><nav aria-label="文档目录"><strong>本课目录</strong><ol>${sections.map((item, index) => `<li><a href="#knowledge-${index}">${escape(item.title)}</a></li>`).join('')}${examples.length ? '<li><a href="#exercises">课堂例题与详细讲解</a></li>' : ''}</ol></nav><section><h2>本课先掌握什么</h2>${bullets(notes.readingOverview || notes.overview)}</section>${sectionHtml.join('')}${examples.length ? `<section id="exercises"><h2>课堂例题与详细讲解</h2>${exampleHtml.join('')}</section>` : ''}${list(notes.readingAppendix).length ? `<details><summary>补充内容与来源说明</summary>${list(notes.readingAppendix).map(item => `<h3>${escape(item.title)}</h3><p>${rich(item.text)}</p>`).join('')}</details>` : ''}<details data-print="omit"><summary>完整讲解原文 · ${cues.size} 段</summary><div class="transcript">${[...cues.values()].map(cue => `<p><time>${cue.start != null ? time(cue.start) : '文字段落'}</time><br>${rich(cue.text)}</p>`).join('')}</div></details>${archiveWarnings.length ? `<details class="page-note" data-print="omit"><summary>核对提示</summary>${bullets(archiveWarnings)}</details>` : ''}<p class="boundary page-note">图片为课程抽样画面，未覆盖每一次板书变化。原课时间链接需要联网，讲义内的图片、正文和公式字体可离线显示。</p></main></body></html>`;
  if (Buffer.byteLength(html) > 80 * 1024 * 1024) throw Object.assign(new Error('讲义图片较多，请分讲次下载。'), { status: 413 });
  return { html, imageCount: imageCache.size - warning.size, missingImageCount: warning.size };
}

export function mountLessonExport(app, { dataDir, lessonById, readableLesson = value => value }) {
  const cache = new Map(), pending = new Map();
  app.get('/api/lessons/:id/document', async (req, res) => {
    const lesson = readableLesson(lessonById(req.params.id));
    const format = req.query.format || 'html';
    if (!['html', 'pdf', 'docx'].includes(format)) throw Object.assign(new Error('请选择 PDF、Word 或图文网页。'), { status: 400 });
    if (!lesson.notes || lesson.notes.evidenceOutdated) throw Object.assign(new Error('请先完成或更新讲义，再打开文档。'), { status: 422 });
    if (format !== 'html') {
      const fingerprint = value => createHash('sha256').update(JSON.stringify([value.id, value.title, value.notes, value.visual?.id, value.visual?.frames])).digest('hex');
      const version = fingerprint(lesson), key = `${version}:${format}`;
      if (!cache.has(key) && !pending.has(key)) {
        if (pending.size >= 2) throw Object.assign(new Error('正在准备其他讲义，请稍后重试。'), { status: 429 });
        const work = (async () => { const document = await lessonWordContent(lesson,dataDir); return format === 'pdf' ? htmlPdf(await studyDocumentHtml(document)) : studyDocumentWord(document); })();
        pending.set(key, work);
        work.then(bytes => { if (bytes.length <= 32 * 1024 * 1024) { if (cache.size >= 2) cache.delete(cache.keys().next().value); cache.set(key, bytes); } }, () => {}).finally(() => pending.delete(key));
      }
      const bytes = cache.get(key) || await pending.get(key);
      if (fingerprint(readableLesson(lessonById(req.params.id))) !== version) throw Object.assign(new Error('讲义已更新，请重新打开文档。'), { status: 409 });
      return sendStudyDocument(res, bytes, lesson.title, format, req.query.inline === '1');
    }
    const result = await renderLessonDocument(lesson, { dataDir });
    const filename = `${lesson.title.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '').slice(0, 80) || '考谱'} · 图文讲义.html`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="Shifen-Lecture.html"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('html').send(result.html);
  });
}

async function lessonWordContent(lesson, dataDir) {
  const notes = lesson.notes, sections = list(notes.readingSections || notes.sections), examples = list(notes.readingExamples || notes.examples);
  const body = ['## 本课先掌握什么', ...list(notes.readingOverview || notes.overview).map(item => `- ${item}`)], provenance = [], images = [], used = new Set(); let imageBytes = 0;
  const bvid = lesson.url?.match(/\/video\/(BV[0-9A-Za-z]{10})/)?.[1];
  if (bvid) body.unshift(`原课链接 https://www.bilibili.com/video/${bvid}/?p=${lesson.part || 1}`);
  const addImages = async item => {
    for (const id of [...new Set(list(item.frameIds))].slice(0, 3)) {
      if (!used.has(id)) {
        try { const result = await readLessonFrame(dataDir, lesson, id); imageBytes += result.bytes.length; if (imageBytes > 48 * 1024 * 1024) throw new Error(); images.push({ id, bytes: result.bytes, width: result.frame.width, height: result.frame.height, caption: `${item.evidence?.selections?.find(selection => selection.frameId === id)?.caption || '原课画面'} · ${time(result.frame.time)}` }); used.add(id); }
        catch { body.push('该处原图暂不可用，请回到原课核对。'); continue; }
      }
      body.push(`[原课截图:${id}]`);
    }
    if (item.evidence?.note && !list(item.frameIds).length) body.push(item.evidence.note);
    const cue = [...list(lesson.cues), ...list(lesson.visualCues)].find(cue => list(item.cueIds).includes(cue.id));
    if (cue) body.push(`原课来源 ${cue.start == null ? '导入文字' : time(cue.start)}`);
  };
  for (const section of sections) {
    body.push(`## ${section.title}`, ...(section.takeaway ? [section.takeaway] : []), section.text);
    if (section.intuition) body.push('### 先这样理解', section.intuition);
    if (section.teacherExplanation) body.push('### AI 补充讲解', section.teacherExplanation);
    if (section.prerequisites?.length) body.push('### 需要先掌握', ...section.prerequisites.map(item => `- ${item}`));
    if (section.steps?.length) body.push('### 推导与应用', ...section.steps.map((item, i) => `${i + 1}. ${item}`));
    if (section.pitfalls?.length) body.push('### 容易弄错的地方', ...section.pitfalls.map(item => `- ${item}`));
    if(section.sourceNotes?.length)provenance.push(`### ${section.title}`, ...section.sourceNotes);
    if(section.contentAudit?.status==='not-checked')provenance.push(`### ${section.title} · 内容核对未完成`, '本节尚未通过逐项内容核对，当前讲义不能视为完整。');
    const issues=[...list(section.contentAudit?.checks).filter(c=>['partial','missing','unclear'].includes(c.status)).map(c=>c.reason),...list(section.contentAudit?.findings).map(c=>`${c.statement}：${c.reason}`)];
    if(issues.length)provenance.push(`### ${section.title} · 仍需核对`,...issues.map(item=>`- ${item}`));
    await addImages(section);
    if (!section.editorial) for (const child of list(section.subsections)) body.push(`### ${child.title}`, child.text);
    if (section.checkQuestion?.prompt) body.push('### 自测与参考思路', section.checkQuestion.prompt, section.checkQuestion.answer || section.checkQuestion.explanation || '请结合原课核对。');
  }
  for (const example of examples) {
    body.push(`## 例题 ${example.title}`, example.prompt, '### 原课解法', example.solution || '原课没有完整的文字解法，请结合截图核对。');
    if (example.detailedSolution) body.push('### AI 补充讲解', example.detailedSolution);
    if (example.solutionSteps?.length) body.push(...example.solutionSteps.map((item, i) => `${i + 1}. ${item}`));
    if (example.explanationGap) body.push(`待核对 ${example.explanationGap}`);
    await addImages(example);
  }
  for (const appendix of list(notes.readingAppendix)) body.push(`## ${appendix.title}`, appendix.text);
  if(provenance.length)body.push('## 来源疑问与内容核对',...provenance);
  return { title: lesson.title, body: body.filter(Boolean).join('\n\n'), images, warning: 'AI 辅助整理，课堂来源与补充讲解请核对。课程图片为抽样画面，未保证全课完整。' };
}
