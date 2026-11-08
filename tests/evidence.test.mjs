import test from 'node:test';
import assert from 'node:assert/strict';
import { citationPool, originalQuote } from '../server/evidence.mjs';

test('citations point to explanatory text instead of markdown headings and source-index markers', () => {
  const result = citationPool([{ sourceId:'s1', text:'## 连续与可导\n可导必连续，连续不一定可导。\n[来源 s2]' }, {sourceId:'s2',text:'## 链式法则与典型例题'}]);
  assert.equal(result[0].citations.length, 1); assert.equal(result[0].citations[0].text, '可导必连续，连续不一定可导。');
  assert.equal(result[1].citations.length, 0);
});

test('whitespace tolerance returns the actual original span without altering mathematical signs', () => {
  assert.equal(originalQuote('导数：y′ = 2x\n cos(x²)。', 'y′=2x cos(x²)'), 'y′ = 2x\n cos(x²)');
  for (const quote of ['y′=-2x cos(x²)', 'y′=2x sin(x²)', 'y′=2x cos(x^2)']) assert.equal(originalQuote('导数：y′ = 2x cos(x²)。', quote), null);
});
