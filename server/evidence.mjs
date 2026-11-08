// Shared, verbatim citation candidates for model-assisted learning.
export function citationPool(sources, terms = []) {
  const perSource = Math.min(600, Math.floor(12000 / Math.max(1, sources.length)));
  return sources.map(source => {
    const limit = Math.min(200, perSource), pieces = [];
    for (const match of source.text.matchAll(/[^。！？\n]+(?:[。！？]+|\n+|$)/gu)) {
      const raw = match[0];
      if (/^\s*(?:#{1,6}\s|\[来源\s|(?:目录|来源索引)\s*$)/u.test(raw)) continue;
      for (let offset = 0; offset < raw.length; offset += limit) {
        const value = raw.slice(offset, offset + limit).trim();
        if (value.length >= 8) pieces.push({ text: value, offset: match.index + offset,
          score: terms.reduce((n, term) => n + Number(value.toLowerCase().includes(term)), 0) });
      }
    }
    pieces.sort((a, b) => b.score - a.score || a.offset - b.offset);
    const selected = []; let chars = 0;
    for (const piece of pieces) {
      if (selected.length === 4 || chars + piece.text.length > perSource) continue;
      if (selected.some(p => p.text === piece.text)) continue;
      // Every candidate is tested against the actual transmitted source,
      // including its original punctuation, case and mathematical characters.
      if (source.text.includes(piece.text)) { selected.push(piece); chars += piece.text.length; }
    }
    if (!selected.length && source.text.trim().length >= 8 && !/^\s*(?:#{1,6}\s|\[来源\s|(?:目录|来源索引)\s*$)/u.test(source.text)) selected.push({ text: source.text.slice(0, limit).trim(), offset: 0 });
    selected.sort((a, b) => a.offset - b.offset);
    return { ...source, citations: selected.map((piece, index) => ({ id: `${source.sourceId}-c${index + 1}`, text: piece.text })) };
  });
}

/** Match only whitespace changes; return the actual original span, never model-rewritten maths. */
export function originalQuote(source, quote) {
  if (typeof source !== 'string' || typeof quote !== 'string' || !quote.trim()) return null;
  if (source.includes(quote)) return quote;
  const needle = quote.replace(/\s/gu, '');
  if (!needle) return null;
  let compact = ''; const positions = [];
  for (let i = 0; i < source.length; i++) if (!/\s/u.test(source[i])) { compact += source[i]; positions.push(i); }
  const start = compact.indexOf(needle);
  return start < 0 ? null : source.slice(positions[start], positions[start + needle.length - 1] + 1);
}
