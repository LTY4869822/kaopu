import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiliNoteFetcher } from '../server/bilinote-adapter.mjs';

const lesson = { url: 'https://www.bilibili.com/video/BV1B7411m7LV/?p=3&tracking=discard', part: 3 };
const config = { baseUrl: 'http://127.0.0.1:8483/api', providerId: 'configured-provider', modelName: 'configured-model', pollMs: 1, timeoutMs: 1000 };
const result = data => new Response(JSON.stringify({ code: 0, data }), { headers: { 'Content-Type': 'application/json' } });

test('BiliNote adapter uses the selected part, actual transcript, and strips tracking', async () => {
  const calls = []; let polls = 0;
  const fetcher = createBiliNoteFetcher({ ...config, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/generate_note')) return result({ task_id: 'test-task' });
    if (!polls++) return result({ status: 'TRANSCRIBING' });
    return result({ status: 'SUCCESS', result: { markdown: 'AI summary is not the transcript', transcript: { segments: [{ start: 12, end: 18, text: '原课讲解与公式' }] } } });
  } });
  const source = await fetcher(lesson);
  assert.deepEqual(JSON.parse(source.text).body, [{ from: 12, to: 18, content: '原课讲解与公式' }]);
  assert.equal(source.format, 'json');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(new URL(sent.video_url).search, '?p=3');
  assert.equal(sent.provider_id, config.providerId);
  assert.equal(sent.screenshot, false);
  assert.equal(calls[0].init.redirect, 'error');
});

test('missing service configuration stays disabled and arbitrary source hosts never reach the service', async () => {
  assert.equal(createBiliNoteFetcher({ baseUrl: '', providerId: '', modelName: '' }), undefined);
  let called = false;
  const fetcher = createBiliNoteFetcher({ ...config, fetchImpl: async () => { called = true; return result({}); } });
  await assert.rejects(fetcher({ ...lesson, url: 'https://evil.test/video/BV1B7411m7LV/' }), /有效/);
  assert.equal(called, false);
});

test('an upstream summary without timed source is rejected, not passed off as lecture content', async () => {
  const fetcher = createBiliNoteFetcher({ ...config, fetchImpl: async url => result(url.endsWith('/generate_note') ? { task_id: 'summary-only' } : { status: 'SUCCESS', result: { markdown: '只有摘要' } }) });
  await assert.rejects(fetcher(lesson), /没有返回逐段原文/);
});

test('upstream failures and timeouts expose no upstream credentials or raw error payload', async () => {
  const fetcher = createBiliNoteFetcher({ ...config, token: 'not-for-browser', fetchImpl: async () => new Response(JSON.stringify({ code: 500, msg: 'secret not-for-browser' })) });
  await assert.rejects(fetcher(lesson), error => error.message.includes('BiliNote') && !error.message.includes('not-for-browser'));
  const timed = createBiliNoteFetcher({ ...config, timeoutMs: 20, fetchImpl: async url => result(url.endsWith('/generate_note') ? { task_id: 'slow' } : { status: 'PENDING' }) });
  await assert.rejects(timed(lesson), /超时/);
});
