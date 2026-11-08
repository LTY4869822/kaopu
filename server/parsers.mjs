import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

const MAX_TEXT = 1_000_000;
const MAX_EXPANDED = 60 * 1024 * 1024;
const xml = new XMLParser({ ignoreAttributes: true, processEntities: false, parseTagValue: false });
const xmlWithAttributes = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false });
const clean = (text) => String(text).replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

function fail(message) {
  const error = new Error(message);
  error.status = 422;
  throw error;
}

async function openOfficeZip(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files);
  if (files.length > 2500) fail('文件内容过多，请拆分为较小的文档后重试。');
  const expanded = files.reduce((sum, file) => sum + (file._data?.uncompressedSize || 0), 0);
  if (expanded > MAX_EXPANDED) fail('文档解压后超过 60 MB，请压缩图片或拆分文档后重试。');
  return zip;
}

function collectText(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'a:t') {
      const values = Array.isArray(value) ? value : [value];
      values.forEach((item) => result.push(typeof item === 'object' ? item['#text'] || '' : String(item)));
    } else if (Array.isArray(value)) value.forEach((item) => collectText(item, result));
    else if (typeof value === 'object') collectText(value, result);
  }
  return result;
}

async function presentationOrder(zip) {
  const manifestFile = zip.file('ppt/presentation.xml');
  const relationsFile = zip.file('ppt/_rels/presentation.xml.rels');
  if (!manifestFile || !relationsFile) fail('文件不是完整的 PPTX，请用 Office 或 WPS 重新另存后上传。');
  const [manifest, relations] = await Promise.all([manifestFile.async('string'), relationsFile.async('string')]);
  if (/<!DOCTYPE|<!ENTITY/i.test(manifest + relations)) fail('文档包含不支持的 XML 声明，请重新另存后上传。');
  const list = (value) => value ? (Array.isArray(value) ? value : [value]) : [];
  const slideIds = list(xmlWithAttributes.parse(manifest)?.['p:presentation']?.['p:sldIdLst']?.['p:sldId']);
  const rels = list(xmlWithAttributes.parse(relations)?.Relationships?.Relationship);
  const targets = new Map(rels.filter((rel) => rel['@_TargetMode'] !== 'External').map((rel) => [rel['@_Id'], rel['@_Target']]));
  return slideIds.map((slide) => {
    const target = targets.get(slide['@_r:id']);
    if (typeof target !== 'string') fail('幻灯片顺序信息损坏，请重新另存 PPTX 后上传。');
    const name = target.startsWith('/') ? path.posix.normalize(target.slice(1)) : path.posix.normalize(path.posix.join('ppt', target));
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name) || !zip.file(name)) fail('幻灯片内容缺失，请重新另存 PPTX 后上传。');
    return name;
  });
}

function splitChunks(pages) {
  const chunks = [];
  for (const { page, text } of pages) {
    const normalized = clean(text);
    if (!normalized) continue;
    // Preserve each source page/section. Overlap protects sentences at chunk boundaries.
    for (let start = 0; start < normalized.length; start += 1000) {
      chunks.push({ id: randomUUID(), page, text: normalized.slice(start, start + 1200) });
    }
  }
  return chunks;
}

// Shared preflight for the optional Python parser. Run before handing bytes to a
// model process so structured parsing keeps the same limits as native parsing.
export async function validateDocumentFile(file) {
  if (!Buffer.isBuffer(file?.buffer) || !file.buffer.length) fail('请选择包含内容的文件。');
  if (file.buffer.length > 20 * 1024 * 1024) fail('单个文件最多支持 20 MB，请拆分后上传。');
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!['.pdf', '.docx', '.pptx', '.txt', '.md'].includes(extension)) fail('请选择 PDF、DOCX、PPTX、TXT 或 Markdown 文件。');
  try {
    if (extension === '.pdf') {
      if (!file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) fail('文件内容不是有效 PDF，请检查文件格式后重试。');
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      try {
        const info = await parser.getInfo();
        if (!Number.isInteger(info.total) || info.total < 1) fail('PDF 没有可读取的页面。');
        if (info.total > 250) fail('单个 PDF 最多支持 250 页，请按章节拆分后上传。');
        return { extension, pageCount: info.total };
      } finally { await parser.destroy(); }
    }
    if (extension === '.docx' || extension === '.pptx') {
      const zip = await openOfficeZip(file.buffer);
      if (extension === '.docx') {
        if (!zip.file('word/document.xml')) fail('文件不是有效 DOCX，请用 Office 或 WPS 重新另存后上传。');
      } else {
        const slides = await presentationOrder(zip);
        if (!slides.length) fail('没有找到幻灯片，请检查 PPTX 文件。');
        if (slides.length > 250) fail('单个 PPTX 最多支持 250 张幻灯片，请拆分后上传。');
        return { extension, pageCount: slides.length };
      }
    }
    return { extension };
  } catch (error) {
    if (error.status) throw error;
    fail('无法读取此文件。请检查文件是否损坏或加密，再重新导出上传。');
  }
}

export async function parseDocument(file) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length > 20 * 1024 * 1024) fail('单个文件最多支持 20 MB，请拆分后上传。');
  const extension = path.extname(file.originalname).toLowerCase();
  if (['.doc', '.ppt'].includes(extension)) fail('暂不支持旧版 DOC / PPT。请在 Office 或 WPS 中另存为 DOCX / PPTX，或导出 PDF 后上传。');
  if (!['.pdf', '.docx', '.pptx', '.txt', '.md'].includes(extension)) fail('请选择 PDF、DOCX、PPTX、TXT 或 Markdown 文件。');
  let pages = [];
  let locationKind = 'page';
  let warning;
  try {
    if (extension === '.pdf') {
      if (!file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) fail('文件内容不是有效 PDF，请检查文件格式后重试。');
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      try {
        const info = await parser.getInfo();
        if (info.total > 250) fail('单个 PDF 最多支持 250 页，请按章节拆分后上传。');
        const result = await parser.getText();
        pages = result.pages.map(({ num, text }) => ({ page: num, text }));
        if (pages.reduce((sum, page) => sum + clean(page.text).length, 0) < 10) {
          fail('没有提取到可用文字。这可能是扫描版 PDF，请先使用 OCR 转为可搜索的 PDF，或上传含文字的 Word 文件。');
        }
      } finally { await parser.destroy(); }
    } else if (extension === '.docx') {
      const zip = await openOfficeZip(file.buffer);
      if (!zip.file('word/document.xml')) fail('文件不是有效 DOCX，请用 Office 或 WPS 重新另存后上传。');
      const { value } = await mammoth.extractRawText({ buffer: file.buffer });
      const paragraphs = value.split(/\n\s*\n/).map(clean).filter(Boolean);
      pages = paragraphs.map((text, index) => ({ page: index + 1, text }));
      locationKind = 'section';
      warning = 'Word 内容按段落分节；引用编号并非原文页码。图片、复杂公式与版式需对照原文件检查。';
    } else if (extension === '.pptx') {
      const zip = await openOfficeZip(file.buffer);
      const slides = await presentationOrder(zip);
      if (!slides.length) fail('没有找到幻灯片，请检查 PPTX 文件。');
      if (slides.length > 250) fail('单个 PPTX 最多支持 250 张幻灯片，请拆分后上传。');
      for (const [index, name] of slides.entries()) {
        const content = await zip.file(name).async('string');
        if (/<!DOCTYPE|<!ENTITY/i.test(content)) fail('文档包含不支持的 XML 声明，请重新另存后上传。');
        pages.push({ page: index + 1, text: collectText(xml.parse(content)).join('\n') });
      }
      warning = '已提取幻灯片中的文字；图片、公式图片和图表需对照原文件检查。';
    } else {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
      pages = content.split(/\n\s*\n/).map((text, index) => ({ page: index + 1, text }));
      locationKind = 'section';
      warning = '文本按段落分节；引用编号为段落编号。';
    }
  } catch (error) {
    if (error.status) throw error;
    fail('无法读取此文件。请检查文件是否损坏、加密或编码不是 UTF-8，再重新导出上传。');
  }
  if (pages.reduce((sum, page) => sum + page.text.length, 0) > MAX_TEXT) fail('提取的文字超过 100 万字符，请按章节拆分后重试。');
  const chunks = splitChunks(pages);
  if (!chunks.length) fail('没有提取到文字。图片或扫描内容需要先进行 OCR。');
  return { type: extension.slice(1).toUpperCase(), chunks, locationKind, ...(warning ? { warning } : {}) };
}
