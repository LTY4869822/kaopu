import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./lesson-text.css";

export type LessonTextPart =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; raw: string; display: boolean };

const DELIMITERS = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false },
] as const;
const MAX_FORMULA_LENGTH = 6000;
const MAX_FORMULAS = 250;
const ERROR_COLOR = "#b51e1e";

function escaped(text: string, index: number) {
  let slashes = 0;
  while (index > 0 && text[--index] === "\\") slashes++;
  return slashes % 2 === 1;
}

function dollarMath(value: string) {
  if (!value || /^\s|\s$/.test(value)) return false;
  // $5$, $12.50$ and ranges such as $10–$20 stay ordinary text.
  if (/^[+\-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)\s*(?:[%‰]|USD|CNY|RMB|元|美元)?$/i.test(value)) return false;
  return /[a-zA-Z\\_^=+*/<>()[\]{}|∑∫√α-ωΑ-Ω]/.test(value) || /\d\s*-\s*\d/.test(value);
}

/** Only delimiters are parsed; all prose remains escaped React text. */
export function splitLessonText(text: string): LessonTextPart[] {
  const parts: LessonTextPart[] = [];
  let plainStart = 0;
  let cursor = 0;
  let formulas = 0;
  while (cursor < text.length && formulas < MAX_FORMULAS) {
    // Leave inline code and fenced examples intact, including their dollars.
    if (text[cursor] === "`" && !escaped(text, cursor)) {
      let length = 1;
      while (text[cursor + length] === "`") length++;
      const end = text.indexOf("`".repeat(length), cursor + length);
      if (end >= 0 && (length >= 3 || !/[\r\n]/.test(text.slice(cursor, end)))) {
        cursor = end + length;
        continue;
      }
    }
    const delimiter = DELIMITERS.find(item => text.startsWith(item.open, cursor));
    if (!delimiter || escaped(text, cursor)) { cursor++; continue; }
    const contentStart = cursor + delimiter.open.length;
    const singleDollar = delimiter.open === "$";
    if (singleDollar && (text[cursor - 1] === "$" || /\s/.test(text[contentStart] || "") || !text[contentStart])) { cursor++; continue; }
    let end = text.indexOf(delimiter.close, contentStart);
    while (end >= 0 && end - contentStart <= MAX_FORMULA_LENGTH) {
      if (!delimiter.display && /[\r\n]/.test(text.slice(contentStart, end))) { end = -1; break; }
      if (escaped(text, end) || (singleDollar && (text[end - 1] === "$" || text[end + 1] === "$"))) {
        end = text.indexOf(delimiter.close, end + delimiter.close.length);
        continue;
      }
      break;
    }
    if (end < 0 || end - contentStart > MAX_FORMULA_LENGTH) { cursor += delimiter.open.length; continue; }
    const value = text.slice(contentStart, end);
    if (!value.trim() || (singleDollar && (!dollarMath(value) || /\d/.test(text[end + 1] || "")))) { cursor += delimiter.open.length; continue; }
    if (cursor > plainStart) parts.push({ kind: "text", value: text.slice(plainStart, cursor) });
    const next = end + delimiter.close.length;
    parts.push({ kind: "math", value, raw: text.slice(cursor, next), display: delimiter.display });
    formulas++;
    cursor = plainStart = next;
  }
  if (plainStart < text.length) parts.push({ kind: "text", value: text.slice(plainStart) });
  return parts;
}

function MathText({ part }: { part: Extract<LessonTextPart, { kind: "math" }> }) {
  const markup = useMemo(() => {
    try {
      // Official options: https://katex.org/docs/options and /docs/security.
      // Each expression gets fresh macros; no definitions persist between sources.
      const html = katex.renderToString(part.value, {
        displayMode: part.display,
        output: "htmlAndMathml",
        throwOnError: false,
        strict: false,
        trust: false,
        macros: {},
        globalGroup: false,
        maxExpand: 500,
        maxSize: 12,
        errorColor: ERROR_COLOR,
      });
      // Unsupported/untrusted commands use errorColor; keep their whole source.
      return html.includes('class="katex-error"') || html.includes(`mathcolor="${ERROR_COLOR}"`) ? null : html;
    } catch { return null; }
  }, [part.value, part.display]);
  if (!markup) return <span className="lesson-text-math-source">{part.raw}</span>;
  return <span
    className={`lesson-text-math ${part.display ? "lesson-text-math-display" : "lesson-text-math-inline"}`}
    // This string is exclusively produced by KaTeX with trust:false. Prose never
    // reaches this HTML sink; its markup and external images remain literal text.
    dangerouslySetInnerHTML={{ __html: markup }}
  />;
}

export default function LessonText({ text, className = "", inline = false }: { text: string; className?: string; inline?: boolean }) {
  const parts = useMemo(() => splitLessonText(text), [text]);
  const Tag = inline ? "span" : "div";
  return <Tag className={`lesson-text${className ? ` ${className}` : ""}`}>
    {parts.map((part, index) => part.kind === "text" ? part.value : <MathText key={index} part={part} />)}
  </Tag>;
}
