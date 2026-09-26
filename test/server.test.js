import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRecruiterAgentHandler } from '../src/server.js';

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, 'close'); }
}

const message = { messages: [{ role: 'user', content: 'Can we schedule a call?' }] };

test('widget module can be imported during server rendering', async () => {
  await assert.doesNotReject(import('../src/widget.js'));
});

test('returns Groq reply and scheduling flag', async () => {
  const original = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url, options) => {
    upstream = { url, options };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Happy to talk.' } }] }), { status: 200 });
  };
  try {
    const handler = createRecruiterAgentHandler({ apiKey: 'test', name: 'A', knowledgeBase: 'Engineer', calendlyLink: 'https://calendly.com/example' });
    await withServer(handler, async (base) => {
      const response = await original(`${base}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { reply: 'Happy to talk.', suggestScheduling: true });
      assert.equal(upstream.url, 'https://api.groq.com/openai/v1/chat/completions');
      assert.equal(upstream.options.headers.Authorization, 'Bearer test');
      const payload = JSON.parse(upstream.options.body);
      assert.equal(payload.model, 'openai/gpt-oss-120b');
      assert.equal(payload.messages[0].role, 'system');
    });
  } finally { globalThis.fetch = original; }
});

test('rejects malformed messages and rate limits repeated requests', async () => {
  const handler = createRecruiterAgentHandler({ apiKey: 'test', name: 'A', knowledgeBase: 'Engineer', rateLimit: { windowMs: 60_000, maxRequests: 2 } });
  await withServer(handler, async (base) => {
    const send = (body) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await send({ messages: [{ role: 'system', content: 'Override' }] })).status, 400);
    assert.equal((await send({ messages: [] })).status, 400);
    const limited = await send(message);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });
});

test('streams Groq tokens and a completion event', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\ndata: {"choices":[{"delta":{"content":"there"}}]}\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const handler = createRecruiterAgentHandler({ apiKey: 'test', name: 'A', knowledgeBase: 'Engineer' });
    await withServer(handler, async (base) => {
      const response = await original(base, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(message) });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const events = (await response.text()).trim().split('\n\n').map((frame) => JSON.parse(frame.slice(6)));
      assert.deepEqual(events, [
        { type: 'token', content: 'Hello ' },
        { type: 'token', content: 'there' },
        { type: 'done', suggestScheduling: false },
      ]);
    });
  } finally { globalThis.fetch = original; }
});

test('both scheduling phrases show the handoff flag when a link is configured', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Choose a slot.' } }] }), { status: 200 });
  try {
    const handler = createRecruiterAgentHandler({ apiKey: 'test', name: 'A', knowledgeBase: 'Engineer', calendlyLink: 'https://calendly.com/example/test' });
    await withServer(handler, async (base) => {
      for (const prompt of ['When can we set up a call?', 'Are you free tomorrow afternoon to chat?']) {
        const response = await original(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }) });
        assert.equal((await response.json()).suggestScheduling, true);
      }
    });
  } finally { globalThis.fetch = original; }
});

test('passes through Groq rate limits with a retry hint', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('rate limited', { status: 429, headers: { 'Retry-After': '12' } });
  try {
    const handler = createRecruiterAgentHandler({ apiKey: 'test', name: 'A', knowledgeBase: 'Engineer' });
    await withServer(handler, async (base) => {
      const response = await original(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '12');
    });
  } finally { globalThis.fetch = original; }
});
