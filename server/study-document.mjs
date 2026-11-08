import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import os from 'node:os';
import MarkdownIt from 'markdown-it';
import katex from 'katex';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { chromium } from 'playwright';
import { paginateWord } from './word-pagination.mjs';

const require = createRequire(import.meta.url);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const fail = (status, message) => Object.assign(new Error(message), { status });
const md = new MarkdownIt({ html: false, breaks: true, linkify: false, maxNesting: 40 });
md.disable('image'); // Model output never causes remote image requests.
md.inline.ruler.before('escape', 'study_math', (state, silent) => {
  const start = state.pos, raw = state.src.slice(start);
  const opener = raw.startsWith('\\(') ? '\\(' : raw.startsWith('\\[') ? '\\[' : raw.startsWith('$$') ? '$$' : raw.startsWith('$') ? '$' : null;
  if (!opener) return false;
  const closer = opener === '\\(' ? '\\)' : opener === '\\[' ? '\\]' : opener;
  let end = state.src.indexOf(closer, start + opener.length);
  while (end > 0 && state.src[end - 1] === '\\') end = state.src.indexOf(closer, end + closer.length);
  if (end < 0 || end - start > 12000 || !state.src.slice(start + opener.length, end).trim()) return false;
  if (!silent) { const token = state.push('study_math', '', 0); token.content = state.src.slice(start + opener.length, end); token.meta = { display: opener === '$$' || opener === '\\[' }; }
  state.pos = end + closer.length; return true;
});
md.block.ruler.before('fence', 'study_math_block', (state, startLine, endLine, silent) => {
  const first = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trim();
  const opener = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : null;
  if (!opener) return false;
  const closer = opener === '$$' ? '$$' : '\\]';
  let last = startLine, content = first.slice(opener.length), end = content.indexOf(closer);
  while (end < 0 && ++last < endLine) { content += '\n' + state.src.slice(state.bMarks[last] + state.tShift[last], state.eMarks[last]); end = content.indexOf(closer); }
  if (end < 0 || content.length > 12000) return false;
  if (silent) return true;
  const token = state.push('study_math_block', 'div', 0); token.content = content.slice(0, end); token.block = true; token.map = [startLine, last + 1]; state.line = last + 1; return true;
}, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
const mathHtml = (text, display) => {
  try { return katex.renderToString(text, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false, maxExpand: 1000 }); }
  catch { return `<span class="formula-error">公式待核对：<code>${esc(text)}</code></span>`; }
};
md.renderer.rules.study_math = (tokens, i) => mathHtml(tokens[i].content, tokens[i].meta.display);
md.renderer.rules.study_math_block = (tokens, i) => `<div class="equation">${mathHtml(tokens[i].content, true)}</div>`;
const textRenderer = md.renderer.rules.text;
md.renderer.rules.text = (tokens, i, options, env, renderer) => (textRenderer ? textRenderer(tokens, i, options, env, renderer) : esc(tokens[i].content)).replace(/\[来源\s*(s\d+(?:[、，,\s]+s\d+)*)\]/g, (all, ids) => ids.match(/s\d+/g).map(id => `<a class="citation" href="#source-${id}">[${id.slice(1)}]</a>`).join(''));

export function documentTokens(document) {
  if (!document || typeof document.title !== 'string' || !document.title.trim() || document.title.length > 500 || typeof document.body !== 'string' || document.body.length > 300000) throw fail(422, '讲义内容无效或过长，请分章节生成。');
  let body = document.body.replace(/\r/g, '');
  const first = body.match(/^\s*#\s+([^\n]+)\n/);
  if (first && first[1].trim() === document.title.trim()) body = body.slice(first[0].length);
  return md.parse(body, {});
}
let styles;
export async function embeddedMathStyles() {
  if (!styles) styles = (async () => {
    const root = path.dirname(require.resolve('katex/package.json'));
    const css = await fs.readFile(path.join(root, 'dist/katex.min.css'), 'utf8');
    const files = [...new Set([...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map(match => match[1]))];
    const fonts = new Map(await Promise.all(files.map(async file => [file, (await fs.readFile(path.join(root, 'dist', file))).toString('base64')])));
    return css.replace(/src:[^;]*;/g, source => { const file = source.match(/url\((fonts\/[^)]+\.woff2)\)/)?.[1]; return file ? `src:url(data:font/woff2;base64,${fonts.get(file)}) format('woff2');` : ''; });
  })();
  return styles;
}
const location = source => `第 ${source.page || 1} ${source.locationKind === 'section' ? '段' : source.locationKind === 'slide' ? '张' : '页'}`;
export async function studyDocumentHtml(document) {
  const tokens = documentTokens(document), toc = []; let index = 0, chapter = 0, subsection = 0;
  const base = Math.min(3, ...tokens.filter(t => t.type === 'heading_open').map(t => Number(t.tag.slice(1))));
  for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'heading_open') {
    const id = `heading-${++index}`, level = Number(tokens[i].tag.slice(1)) - base + 1;
    const number = level === 1 ? `${++chapter}` : level === 2 ? `${chapter}.${++subsection}` : '';
    if (level === 1) subsection = 0;
    tokens[i].attrSet('id', id); tokens[i].attrSet('class', `chapter-level-${level}`); tokens[i].attrSet('data-number', number);
    toc.push({ id, title: tokens[i + 1]?.content || '', level, number });
  }
  const body = md.renderer.render(tokens, md.options, {}).replace(/<p>\[原课截图:(frame-\d{4})\]<\/p>/g, (_match,id) => {
    const image = document.images?.find(item => item.id === id);
    if (!image || !Buffer.isBuffer(image.bytes) || image.bytes.length > 4*1024*1024 || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) return '<p class="boundary">原图暂不可用，请回到原课核对。</p>';
    return `<figure><img src="data:image/jpeg;base64,${image.bytes.toString('base64')}" alt="${esc(image.caption || '原课画面')}"><figcaption>${esc(image.caption || '原课画面')}</figcaption></figure>`;
  });
  const refs = (document.sources || []).map(source => `<li id="source-${esc(source.id)}"><b>${esc(source.id)}</b> ${esc(source.documentName)} · ${esc(location(source))}</li>`).join('');
  if (refs) toc.push({id:'sources-index',title:'来源索引',level:1,number:''});
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(document.title)}</title><style>
  ${await embeddedMathStyles()}
  @page{size:Letter;margin:22mm 22mm 21mm;@top-left{content:"考谱 / STUDY NOTES";font:8pt Arial;color:#566382;vertical-align:bottom;padding-bottom:6mm;border-bottom:.5pt solid #c2c9d7}@top-right{content:string(course);font:8pt "Microsoft YaHei";color:#566382;vertical-align:bottom;padding-bottom:6mm;border-bottom:.5pt solid #c2c9d7}@bottom-left{content:"理解 · 整理 · 检验";font:8pt "Microsoft YaHei";color:#7a8498}@bottom-right{content:counter(page) " / " counter(pages);font:9pt Arial;color:#3a4a70}}
  @page:first{@top-left{content:none;border:0}@top-right{content:none;border:0}}
  *{box-sizing:border-box}body{margin:0;background:white;color:#202838;font:11pt/1.75 "SimSun","Noto Serif CJK SC",serif}h1,h2,h3,h4,h5,h6,nav,.meta,.boundary,.kicker{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif}h1{font-size:27pt;line-height:1.5;margin:12pt 0 18pt;color:#1e315d;font-weight:600;letter-spacing:-.5pt}h2{font-size:17pt;line-height:1.55;margin:26pt 0 13pt;color:#253d71}h3{font-size:13pt;line-height:1.6;margin:20pt 0 10pt;color:#26395e}h4,h5,h6{font-size:11.5pt;margin:15pt 0 8pt}h1,h2,h3,h4,h5,h6{break-after:avoid}p{margin:8pt 0;orphans:3;widows:3;overflow-wrap:anywhere}li{margin:4pt 0;orphans:2;widows:2}ul,ol{padding-left:22pt}a{color:#3c548e;text-decoration:none}strong{font-weight:bold;color:#253c6b}.kicker{font:8pt/1.6 Arial;color:#536a9d;letter-spacing:2pt;text-transform:uppercase;border-top:3pt solid #243f83;padding-top:14pt}.course-name{string-set:course content(text)}.meta{color:#536381;font-size:10pt;line-height:1.8;margin-bottom:15pt}.boundary{color:#6b7280;font-size:9pt;line-height:1.8;border-top:.5pt solid #d2d6df;padding-top:12pt}.chapter-level-1{padding-bottom:8pt;border-bottom:.7pt solid #9ba9c7}.chapter-level-1::before{content:attr(data-number);font:21pt Georgia;color:#8392b3;margin-right:12pt}.chapter-level-2::before{content:attr(data-number);font:12pt Georgia;color:#6c7b9e;margin-right:9pt}nav{margin:28pt 0 20pt;break-after:page}nav h2{font-size:16pt;margin:0 0 18pt;color:#243b6b}nav ol{list-style:none;padding:0;margin:0}nav li{margin:10pt 0;break-inside:avoid}nav li.level-2{padding-left:22pt;font-size:9.5pt;color:#56647f}nav li.level-3{padding-left:35pt;font-size:9pt}nav a{display:flex;align-items:baseline;gap:6pt;color:inherit;line-height:1.8}nav[data-compact="true"] li{margin:4pt 0}nav[data-compact="true"] a{line-height:1.5}nav a::after{content:target-counter(attr(href),page);font:10pt Georgia;color:#25385d}.toc-leader{flex:1;border-bottom:1px dotted #abb3c3;min-width:10pt}.toc-number{min-width:20pt;font:10pt Georgia;color:#526a9b}nav .level-1 .toc-title{font-weight:600;color:#243a66}.toc-title{max-width:82%;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:16pt 0;font-size:10.5pt;line-height:1.7}th,td{border-bottom:.5pt solid #c7cfdf;padding:9pt 7pt;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}th{font-family:"Microsoft YaHei",sans-serif;font-weight:600;color:#30466e;border-top:1pt solid #586c95;border-bottom:.8pt solid #7c8db0}tr{break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:9pt/1.6 Consolas,monospace;margin:12pt 0}code{font:10pt Consolas,monospace}blockquote{margin:12pt 0;color:#5f6b80;font-size:10pt}.equation{margin:14pt 0;break-inside:avoid}.katex{font-size:1.04em}.katex-display{margin:12pt 0;white-space:normal}.katex-display>.katex{white-space:normal}.citation{font-size:8pt;vertical-align:super}.sources{font-size:9pt;line-height:1.7;margin-top:20pt;break-inside:avoid}.sources h2{font-size:15pt}figure{margin:16pt 0;break-inside:avoid}figure img{display:block;max-width:100%;width:auto;height:auto;max-height:110mm;object-fit:contain;margin:auto}figcaption{font:9pt/1.7 "Microsoft YaHei",sans-serif;color:#6b7893;margin-top:8pt;text-align:center}.formula-error{color:#9c4933}hr{border:0;border-top:.5pt solid #c7cfdf;margin:20pt 0}
  </style></head><body data-paginate="study"><header><div class="kicker">KAOPU / REVISION EDITION</div><h1>${esc(document.title)}</h1><p class="meta"><span class="course-name">${esc(document.courseName || '课程复习')}</span>${document.revision ? ` · 第 ${document.revision} 版` : ''}${document.sources?.length ? ` · ${new Set(document.sources.map(s => s.documentId || s.documentName)).size} 份来源` : ''}</p>${document.warning ? `<p class="boundary">${esc(document.warning)}</p>` : ''}</header>${toc.length > 2 ? `<nav aria-label="目录" data-compact="${toc.length > 12}"><h2>目录 <span style="font:9pt Georgia;color:#8490a8;margin-left:8pt">CONTENTS</span></h2><ol>${toc.filter(item => item.level <= 3).map(item => `<li class="level-${item.level}"><a href="#${item.id}"><span class="toc-number">${esc(item.number)}</span><span class="toc-title">${esc(item.title)}</span><span class="toc-leader"></span></a></li>`).join('')}</ol></nav>` : ''}<main>${body}</main>${refs ? `<section class="sources"><h2 id="sources-index">来源索引</h2><ol>${refs}</ol></section>` : ''}</body></html>`;
}

// Office Math preserves fractions, scripts, matrices and roots as editable math.
const mathParser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, parseTagValue: false });
const mathRun = (text, plain = true) => `<m:r><m:rPr><m:sty m:val="${plain ? 'p' : 'i'}"/></m:rPr><m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
function ommlNodes(nodes) {
  return (nodes || []).map(node => {
    const tag = Object.keys(node).find(key => key !== ':@'); if (!tag) return '';
    if (tag === '#text') return mathRun(node[tag]);
    if (tag === 'annotation' || tag === 'annotation-xml') return '';
    const children = node[tag], inner = () => ommlNodes(children), elements = children.filter(item => !('#text' in item)), part = i => ommlNodes(elements[i] ? [elements[i]] : []);
    if (tag === 'mrow' && elements.length >= 3 && elements[0].mo && elements.at(-1).mo) {
      const value = item => item.mo.map(child => child['#text'] || '').join('');
      const first = value(elements[0]), last = value(elements.at(-1));
      if ({ '(': ')', '[': ']', '{': '}', '|': '|', '‖': '‖' }[first] === last) return `<m:d><m:dPr><m:begChr m:val="${esc(first)}"/><m:endChr m:val="${esc(last)}"/><m:grow m:val="1"/></m:dPr><m:e>${ommlNodes(elements.slice(1, -1))}</m:e></m:d>`;
    }
    if (['mi', 'mn', 'mo', 'mtext', 'ms'].includes(tag)) return mathRun(children.map(child => child['#text'] || '').join(''),tag !== 'mi' || node[':@']?.['@_mathvariant'] === 'normal');
    if (tag === 'mspace') return mathRun(' ');
    if (tag === 'mfrac') return `<m:f><m:num>${part(0)}</m:num><m:den>${part(1)}</m:den></m:f>`;
    if (tag === 'msup') return `<m:sSup><m:e>${part(0)}</m:e><m:sup>${part(1)}</m:sup></m:sSup>`;
    if (tag === 'msub') return `<m:sSub><m:e>${part(0)}</m:e><m:sub>${part(1)}</m:sub></m:sSub>`;
    if (tag === 'msubsup') return `<m:sSubSup><m:e>${part(0)}</m:e><m:sub>${part(1)}</m:sub><m:sup>${part(2)}</m:sup></m:sSubSup>`;
    if (tag === 'msqrt') return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${inner()}</m:e></m:rad>`;
    if (tag === 'mroot') return `<m:rad><m:deg>${part(1)}</m:deg><m:e>${part(0)}</m:e></m:rad>`;
    if (tag === 'mtable') return `<m:m>${inner()}</m:m>`;
    if (tag === 'mtr') return `<m:mr>${inner()}</m:mr>`;
    if (tag === 'mtd') return `<m:e>${inner()}</m:e>`;
    if (tag === 'mover') return `<m:limUpp><m:e>${part(0)}</m:e><m:lim>${part(1)}</m:lim></m:limUpp>`;
    if (tag === 'munder') return `<m:limLow><m:e>${part(0)}</m:e><m:lim>${part(1)}</m:lim></m:limLow>`;
    if (tag === 'munderover') return `<m:limUpp><m:e><m:limLow><m:e>${part(0)}</m:e><m:lim>${part(1)}</m:lim></m:limLow></m:e><m:lim>${part(2)}</m:lim></m:limUpp>`;
    return inner();
  }).join('');
}
export function wordMath(latex, display = false) {
  try {
    const html = katex.renderToString(latex, { output: 'mathml', displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000 });
    return `<m:oMath>${ommlNodes(mathParser.parse(html))}</m:oMath>`;
  } catch { return `<w:r><w:t xml:space="preserve">${esc(`公式待核对：${latex}`)}</w:t></w:r>`; }
}
const run = (text, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
function inlineWord(tokens) {
  let bold = false, italic = false;
  return (tokens || []).map(token => {
    if (token.type === 'strong_open' || token.type === 'strong_close') { bold = token.type === 'strong_open'; return ''; }
    if (token.type === 'em_open' || token.type === 'em_close') { italic = token.type === 'em_open'; return ''; }
    if (token.type === 'study_math') return wordMath(token.content, token.meta.display);
    if (['softbreak', 'hardbreak'].includes(token.type)) return '<w:r><w:br/></w:r>';
    if (token.type === 'code_inline') return run(token.content, '<w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei"/>');
    if (token.type === 'text') return token.content.split(/(\[来源\s*[^\]]+\])/g).map(part => {
      if (!part.startsWith('[来源')) return run(part, `${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}`);
      return (part.match(/s\d+/g) || []).map(id => `<w:hyperlink w:anchor="source_${id}">${run(`[${id.slice(1)}]`, '<w:color w:val="49618E"/>')}</w:hyperlink>`).join('') || run(part);
    }).join('');
    return '';
  }).join('');
}
const paragraph = (content, style = '', extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${content}</w:p>`;
export async function studyDocumentWord(document, { paginate = true } = {}) {
  const tokens = documentTokens(document), paragraphs = [paragraph(run('KAOPU / REVISION EDITION'), 'Kicker'), paragraph(run(document.title), 'Title'), paragraph(run(`考谱学习讲义${document.courseName ? ` · ${document.courseName}` : ''}${document.revision ? ` · 第 ${document.revision} 版` : ''}`), 'Subtitle')];
  if (document.warning) paragraphs.push(paragraph(run(document.warning), 'Caption'));
  const headings = []; let headingIndex = 0, chapter = 0, subsection = 0;
  const base = Math.min(3,...tokens.filter(t => t.type === 'heading_open').map(t => Number(t.tag.slice(1))));
  for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'heading_open') {
    const level = Math.min(3,Number(tokens[i].tag.slice(1)) - base + 1);
    const label = level === 1 ? `${++chapter}` : level === 2 ? `${chapter}.${++subsection}` : '';
    if (level === 1) subsection = 0;
    tokens[i].meta = { bookmark: `heading_${++headingIndex}`, index: 2000 + headingIndex, level, label };
    headings.push({ id: tokens[i].meta.bookmark, text: `${label}  ${tokens[i + 1]?.content || ''}`, level });
  }
  if (headings.length > 2) {
    paragraphs.push(paragraph(run('目录  CONTENTS'), 'ContentsTitle'));
    paragraphs.push('<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>');
    for (const item of headings) paragraphs.push(paragraph(`<w:hyperlink w:anchor="${item.id}">${run(item.text)}<w:r><w:tab/></w:r><w:fldSimple w:instr="PAGEREF ${item.id} \\h">${run('—')}</w:fldSimple></w:hyperlink>`, `TOC${item.level}`, '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9972"/></w:tabs>'));
    paragraphs.push('<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
    paragraphs.push(paragraph('<w:r><w:br w:type="page"/></w:r>'));
  }
  const imageFiles = [], lists = []; let tableRows = null, row = null, cell = null, headerRow = false, drawingNumber = 0;
  const imageParagraph = id => {
    const image = document.images?.find(image => image.id === id);
    if (!image || !Buffer.isBuffer(image.bytes) || image.bytes.length > 4 * 1024 * 1024 || !Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) return paragraph(run('原图暂不可用，请回到原课核对。'), 'Caption');
    let number = imageFiles.findIndex(item => item.id === id) + 1;
    if (!number) { imageFiles.push(image); number = imageFiles.length; }
    const scale = Math.min(650 / image.width, 600 / image.height, 1), cx = Math.round(image.width * scale * 9525), cy = Math.round(image.height * scale * 9525);
    return paragraph(`<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${3000 + ++drawingNumber}" name="课程原图 ${number}" descr="${esc(image.caption || '课程原图')}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="课程原图"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage${number}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, '', '<w:jc w:val="center"/>') + paragraph(run(image.caption || '课程原图'), 'Caption');
  };
  const put = value => { if (cell !== null) cell.push(value); else paragraphs.push(value); };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (['bullet_list_open', 'ordered_list_open'].includes(token.type)) lists.push({ ordered: token.type === 'ordered_list_open', next: Number(token.attrGet('start')) || 1 });
    if (['bullet_list_close', 'ordered_list_close'].includes(token.type)) lists.pop();
    if (token.type === 'heading_open') { const next = tokens[++i]; put(paragraph(`<w:bookmarkStart w:id="${token.meta.index}" w:name="${token.meta.bookmark}"/>${run(token.meta.label ? token.meta.label + '  ' : '')}${inlineWord(next.children)}<w:bookmarkEnd w:id="${token.meta.index}"/>`, `Heading${token.meta.level}`)); }
    else if (token.type === 'paragraph_open') { const next = tokens[++i], image = next.content.match(/^\[原课截图:(frame-\d{4})\]$/); if (image) { put(imageParagraph(image[1])); continue; } const list = lists.at(-1); const prefix = list ? list.ordered ? `${list.next++}. ` : '• ' : ''; put(paragraph(run(prefix) + inlineWord(next.children), '', lists.length ? `<w:ind w:left="${Math.min(lists.length, 5) * 240}"/>` : '')); }
    else if (token.type === 'study_math_block') put(paragraph(wordMath(token.content, true), '', '<w:jc w:val="center"/>'));
    else if (['fence', 'code_block'].includes(token.type)) for (const line of token.content.replace(/\n$/, '').split('\n')) put(paragraph(run(line), 'Code'));
    else if (token.type === 'table_open') tableRows = [];
    else if (token.type === 'tr_open') { row = []; headerRow = false; }
    else if (['th_open', 'td_open'].includes(token.type)) { cell = []; if(token.type === 'th_open') headerRow = true; }
    else if (token.type === 'inline' && cell !== null) cell.push(paragraph(inlineWord(token.children), headerRow ? 'TableHeader' : 'TableText'));
    else if (['th_close', 'td_close'].includes(token.type)) { row.push(`<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${cell.join('') || paragraph('')}</w:tc>`); cell = null; }
    else if (token.type === 'tr_close') { tableRows.push(`<w:tr><w:trPr><w:cantSplit/>${headerRow ? '<w:tblHeader/>' : ''}</w:trPr>${row.join('')}</w:tr>`); row = null; }
    else if (token.type === 'table_close') { paragraphs.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="6D80AC"/><w:bottom w:val="single" w:sz="4" w:color="DDDDDD"/><w:insideH w:val="single" w:sz="4" w:color="DDDDDD"/></w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${tableRows.join('')}</w:tbl>`); tableRows = null; }
  }
  if (document.sources?.length) {
    paragraphs.push(paragraph(run('来源索引'), 'Heading1'));
    document.sources.forEach((source, i) => paragraphs.push(paragraph(`<w:bookmarkStart w:id="${i + 1}" w:name="source_${esc(source.id)}"/>${run(`${source.id}  ${source.documentName} · ${location(source)}`)}<w:bookmarkEnd w:id="${i + 1}"/>`, 'Caption')));
  }
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${imageFiles.map((image, i) => `<Relationship Id="rIdImage${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/evidence-${i + 1}.jpg"/>`).join('')}</Relationships>`);
  imageFiles.forEach((image, i) => zip.file(`word/media/evidence-${i + 1}.jpg`, image.bytes));
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paragraphs.join('')}<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId2"/><w:footerReference w:type="first" r:id="rId2"/><w:titlePg/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1247" w:bottom="1134" w:left="1134" w:right="1134" w:header="567" w:footer="567"/></w:sectPr></w:body></w:document>`);
  const style = (id, name, size, before, after, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="${after}"/>${id.startsWith('Heading') ? `<w:outlineLvl w:val="${Number(id.slice(-1)) - 1}"/>` : ''}</w:pPr><w:rPr><w:sz w:val="${size}"/><w:rFonts w:eastAsia="Microsoft YaHei"/><w:color w:val="253D71"/>${extra}</w:rPr></w:style>`;
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/><w:sz w:val="23"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="360" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('Kicker', 'Study Kicker', 17, 0, 280)}${style('Title', 'Title', 48, 0, 200)}${style('Subtitle', 'Subtitle', 20, 0, 240)}${style('ContentsTitle', 'Contents Title', 30, 450, 240)}${[1,2,3].map(level => `<w:style w:type="paragraph" w:styleId="TOC${level}"><w:name w:val="toc ${level}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="160"/><w:ind w:left="${(level-1)*320}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9972"/></w:tabs></w:pPr><w:rPr><w:rFonts w:eastAsia="Microsoft YaHei"/><w:sz w:val="${level===1?22:20}"/><w:color w:val="${level===1?'253D71':'5D6D89'}"/></w:rPr></w:style>`).join('')}${style('Heading1', 'heading 1', 34, 360, 180, '<w:b/>')}${style('Heading2', 'heading 2', 28, 280, 160, '<w:b/>')}${style('Heading3', 'heading 3', 25, 220, 120, '<w:b/>')}<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="19"/><w:color w:val="69758D"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="320" w:after="80"/></w:pPr><w:rPr><w:sz w:val="21"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="TableText"/><w:rPr><w:b/><w:color w:val="30466E"/><w:rFonts w:eastAsia="Microsoft YaHei"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas"/><w:sz w:val="19"/></w:rPr></w:style></w:styles>`);
  zip.file('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph(run('考谱  ·  ') + '<w:fldSimple w:instr="PAGE">' + run('1') + '</w:fldSimple>' + run(' / ') + '<w:fldSimple w:instr="NUMPAGES">' + run('1') + '</w:fldSimple>', 'Caption', '<w:jc w:val="center"/>')}</w:ftr>`);
  zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${paragraph(run('考谱 / STUDY NOTES    ·    ' + (document.courseName || '课程复习')), 'Caption', '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="8" w:color="A5B2CC"/></w:pBdr>')}</w:hdr>`);
  zip.file('word/settings.xml','<?xml version="1.0" encoding="UTF-8"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>');
  const result = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return paginate ? paginateWord(result) : result;
}

export async function browserExecutable() {
  const candidates = [process.env.DOCUMENT_CHROMIUM_PATH, chromium.executablePath()];
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Local/ms-playwright' : '.cache/ms-playwright');
  try { for (const name of (await fs.readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).reverse()) candidates.push(path.join(cache, name, process.platform === 'win32' ? 'chrome-win64/chrome.exe' : process.platform === 'darwin' ? 'chrome-mac/Chromium.app/Contents/MacOS/Chromium' : 'chrome-linux/chrome')); } catch { /* Explicit path or install command remains available. */ }
  for (const file of candidates.filter(Boolean)) { try { const stat = await fs.stat(file); if (stat.isFile()) return file; } catch { /* Try next installed browser. */ } }
  throw fail(503, 'PDF 阅读组件暂不可用，请先下载 Word，或联系平台管理员。');
}
export async function htmlPdf(html, { timeoutMs = 90000, launchBrowser } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw fail(500, 'PDF 排版超时配置无效。');
  let browser, expired = false, timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(fail(503, 'PDF 排版超时，请重试或先下载 Word。')); }, timeoutMs); });
  const work = async () => {
    browser = await (launchBrowser ? launchBrowser() : chromium.launch({ executablePath: await browserExecutable(), headless: true, timeout: 30000 }));
    if (expired) { await browser.close().catch(() => {}); throw fail(503, 'PDF 排版超时。'); }
    // Only server-authored, escaped templates reach this renderer; no remote code/assets.
    const context = await browser.newContext({ javaScriptEnabled: true, serviceWorkers: 'block' });
    await context.route('**/*', route => route.request().url().startsWith('data:') ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const lockedHtml = html.replace(/<head>/i, '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; font-src data:; img-src data:; connect-src \'none\'">');
    await page.setContent(lockedHtml, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(async () => { await document.fonts.ready; document.querySelectorAll('[data-print="omit"]').forEach(node => node.remove()); document.querySelectorAll('details').forEach(node => { node.open = true; }); });
    await page.emulateMedia({ media: 'print' });
    if (await page.locator('body[data-paginate="study"]').count()) {
      const entry = require.resolve('pagedjs'), bundle = path.resolve(path.dirname(entry), '../dist/paged.js');
      await page.evaluate(await fs.readFile(bundle, 'utf8'));
      await page.evaluate(async () => {
        const preview = new window.Paged.Previewer();
        const result = await preview.preview();
        if (!result.total || result.total > 400) throw new Error('Invalid document pagination');
        document.querySelectorAll('.pagedjs_page').forEach(node => { node.style.margin = '0'; node.style.boxShadow = 'none'; });
      });
      return await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true, outline: true, displayHeaderFooter: false, timeout:30000 });
    }
    return await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, tagged: true, outline: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font:9px Arial;color:#777"><span class="pageNumber"></span> / <span class="totalPages"></span></div>', margin: { top: '22mm', bottom: '20mm', left: '20mm', right: '20mm' }, timeout: 30000 });
  };
  try { return await Promise.race([work(), deadline]); }
  catch (cause) { if (cause.status) throw cause; const error = fail(503, 'PDF 暂未生成，请稍后重试，或先下载 Word。'); Object.defineProperty(error, 'cause', { value: cause }); throw error; }
  finally {
    clearTimeout(timer);
    if (browser) {
      let closeTimer;
      await Promise.race([browser.close().catch(() => {}), new Promise(resolve => { closeTimer = setTimeout(resolve, 3000); })]);
      clearTimeout(closeTimer);
    }
  }
}
export function createStudyDocumentExporter() {
  const cache = new Map(), pending = new Map(); let bytes = 0;
  async function render(document, format) {
    if (!['pdf', 'docx'].includes(format)) throw fail(400, '请选择 PDF 或 Word 格式。');
    const key = createHash('sha256').update(JSON.stringify([document, format])).digest('hex');
    if (cache.has(key)) return cache.get(key);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 2) throw fail(429, '正在准备其他讲义，请稍后重试。');
    const work = (async () => {
      // Keep downloads portable and immediate. Word updates native TOC/page fields
      // when opened; waiting for desktop Office automation can block the fallback.
      const result = format === 'pdf' ? await htmlPdf(await studyDocumentHtml(document)) : await studyDocumentWord(document, { paginate: false });
      if (result.length > 32 * 1024 * 1024) throw fail(413, '文件较大，请按章节生成讲义。');
      while (cache.size && (cache.size >= 6 || bytes + result.length > 32 * 1024 * 1024)) { const first = cache.keys().next().value; bytes -= cache.get(first).length; cache.delete(first); }
      cache.set(key, result); bytes += result.length; return result;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }
  return { render, clear() { cache.clear(); bytes = 0; } };
}
export function sendStudyDocument(res, bytes, title, format, inline = false) {
  const filename = `${title.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '').slice(0, 100) || '考谱学习讲义'}.${format}`;
  res.set({ 'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `${inline && format === 'pdf' ? 'inline' : 'attachment'}; filename="Shifen-Notes.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.send(bytes);
}
