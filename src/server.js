/**
 * createRecruiterAgentHandler(config) — a plain (req, res) => Promise<void>
 * handler you can mount anywhere: raw Node http, Express, Next.js API
 * routes, Netlify/Vercel functions, etc. It holds your Groq API key
 * server-side and is the only thing the widget ever talks to.
 *
 * Example (plain Node):
 *   import http from 'node:http';
 *   import { createRecruiterAgentHandler } from 'portfolio-agent-widget';
 *   import knowledgeBase from './knowledge-base.js';
 *
 *   const handler = createRecruiterAgentHandler({
 *     apiKey: process.env.GROQ_API_KEY,
 *     name: 'Jitendra Khilar',
 *     knowledgeBase,
 *     calendlyLink: 'https://calendly.com/you/intro',
 *   });
 *
 *   http.createServer((req, res) => {
 *     if (req.url === '/api/recruiter-agent' && req.method === 'POST') return handler(req, res);
 *     res.writeHead(404).end();
 *   }).listen(3000);
 *
 * Express: app.post('/api/recruiter-agent', handler)
 * Next.js (pages/api/recruiter-agent.js): export default handler
 */

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

const SCHEDULING_KEYWORDS = [
  'time', 'talk', 'call', 'chat', 'meet', 'meeting', 'schedule',
  'available', 'availability', 'interview', 'connect', 'discuss',
];

function buildSystemPrompt({ name, knowledgeBase, calendlyLink, extraSystemPrompt }) {
  const kb = typeof knowledgeBase === 'string' ? knowledgeBase : JSON.stringify(knowledgeBase, null, 2);

  return `You are ${name}'s professional assistant, embedded as a chat widget on their portfolio site. Recruiters and hiring managers use you to learn about ${name}'s professional background and to find a good time to connect.

RULES:
- Only answer using the information in the KNOWLEDGE BASE below. Do not invent details.
- Keep general skills separate from named-project evidence. Do not claim a technology was used at a specific employer or project unless the knowledge base explicitly connects them. Do not overstate depth of experience beyond what is written.
- Only discuss professional topics: skills, experience, projects, education, and availability.
- Never discuss personal life, relationships, family, health, politics, religion, or any opinion unrelated to ${name}'s work.
- If asked something not covered in the knowledge base (e.g. exact salary figures, confidential employer info), give the pre-approved answer if one exists, or say you don't have that detail and suggest a direct conversation.
- Keep answers concise (2-4 sentences) unless the recruiter asks for more detail.
- Speak about ${name} in the third person; do not claim to be ${name}.
- If the recruiter asks about scheduling, availability, or wanting to talk, mention general working hours from the knowledge base. You cannot see a live calendar, so never confirm that a specific day or time is free (including "tomorrow afternoon"). ${calendlyLink ? 'Tell them to check the scheduling link that will be shown.' : 'No scheduling link is configured, so do not promise one; suggest contacting Jitendra directly.'}
- If a question is inappropriate or off-topic, politely redirect to what you can help with.
- Do not fulfill creative-writing requests (poems, jokes, stories, roleplay), even when they mention ${name}; redirect to factual professional information.
${extraSystemPrompt ? `\n${extraSystemPrompt}\n` : ''}
${calendlyLink ? `A scheduling link is available. Mention that it will be shown only when the recruiter explicitly asks to schedule, call, or meet. Otherwise, do not promise or offer a link unless they ask for one. Never paste the URL yourself.` : ''}

KNOWLEDGE BASE:
${kb}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      data += chunk;
      if (data.length > 32_000) {
        tooLarge = true;
      }
    });
    req.on('end', () => {
      if (tooLarge) return reject(new Error('Request body too large'));
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    // Express / Next.js style
    res.status(statusCode).json(payload);
  } else {
    // Raw Node http style
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }
}

function looksLikeSchedulingRequest(messages) {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) return false;
  const text = String(lastUserMsg.content).toLowerCase();
  return SCHEDULING_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(text));
}

export function createRecruiterAgentHandler(config) {
  const {
    apiKey,
    name,
    knowledgeBase,
    calendlyLink = '',
    extraSystemPrompt = '',
    model = DEFAULT_MODEL,
    maxTokens = 2048,
    allowedOrigin = null, // set to your site's origin string to enable CORS, or '*' for any
    rateLimit = { windowMs: 60_000, maxRequests: 10 },
  } = config;

  if (!apiKey) throw new Error('[recruiter-agent] "apiKey" is required.');
  if (!name) throw new Error('[recruiter-agent] "name" is required.');
  if (!knowledgeBase) throw new Error('[recruiter-agent] "knowledgeBase" is required.');

  const systemPrompt = buildSystemPrompt({ name, knowledgeBase, calendlyLink, extraSystemPrompt });
  const requests = new Map();

  return async function recruiterAgentHandler(req, res) {
    if (allowedOrigin) {
      res.setHeader?.('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type, Accept');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead ? res.writeHead(204).end() : res.status(204).end();
      return;
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

    const now = Date.now();
    const ip = req.socket?.remoteAddress || 'unknown';
    const previous = requests.get(ip);
    const bucket = previous && now - previous.start < rateLimit.windowMs
      ? previous : { start: now, count: 0 };
    bucket.count += 1;
    requests.set(ip, bucket);
    if (requests.size > 1000) {
      for (const [key, value] of requests) {
        if (now - value.start >= rateLimit.windowMs) requests.delete(key);
      }
    }
    if (bucket.count > rateLimit.maxRequests) {
      res.setHeader?.('Retry-After', String(Math.ceil((rateLimit.windowMs - (now - bucket.start)) / 1000)));
      return sendJson(res, 429, { error: 'Too many requests. Please try again shortly.' });
    }

    try {
      const body = req.body !== undefined
        ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body)
        : await readJsonBody(req);
      const messages = Array.isArray(body?.messages) ? body.messages : [];

      if (messages.length === 0 || messages.length > 20 ||
          messages.some((m) => !m || !['user', 'assistant'].includes(m.role) ||
            typeof m.content !== 'string' || m.content.length > 4000) ||
          messages.at(-1).role !== 'user') {
        return sendJson(res, 400, { error: 'Invalid messages array' });
      }

      const stream = req.headers?.accept?.includes('text/event-stream');
      const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: maxTokens,
          stream: Boolean(stream),
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      });

      if (!apiRes.ok) {
        const errText = await apiRes.text();
        if (apiRes.status === 429) {
          const retryAfter = apiRes.headers.get('retry-after') ||
            String(Math.ceil(Number(errText.match(/try again in ([\d.]+)s/i)?.[1] || 15)));
          res.setHeader?.('Retry-After', retryAfter);
          return sendJson(res, 429, { error: 'The assistant is busy. Please try again shortly.' });
        }
        console.error('[recruiter-agent] Groq API error:', apiRes.status, errText);
        return sendJson(res, 502, { error: 'Upstream API error' });
      }

      if (stream) {
        if (!apiRes.body) return sendJson(res, 502, { error: 'Upstream stream unavailable' });
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.statusCode = 200;
        res.flushHeaders?.();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;
        try {
          for await (const chunk of apiRes.body) {
            buffer += decoder.decode(chunk, { stream: true });
            const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
            buffer = frames.pop() || '';
            for (const frame of frames) {
              const line = frame.split('\n').find((part) => part.startsWith('data:'));
              if (!line) continue;
              const payload = line.slice(5).trim();
              if (payload === '[DONE]') { finished = true; break; }
              const token = JSON.parse(payload).choices?.[0]?.delta?.content;
              if (token) res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`);
            }
            if (finished) break;
          }
          res.write(`data: ${JSON.stringify(finished ? { type: 'done', suggestScheduling: Boolean(calendlyLink) && looksLikeSchedulingRequest(messages) } : { type: 'error' })}\n\n`);
        } catch (err) {
          console.error('[recruiter-agent] stream error:', err);
          res.write('data: {"type":"error"}\n\n');
        }
        res.end();
        return;
      }

      const data = await apiRes.json();
      const reply = data.choices?.[0]?.message?.content?.trim();

      return sendJson(res, 200, {
        reply: reply || "Sorry, I don't have an answer for that right now.",
        suggestScheduling: Boolean(calendlyLink) && looksLikeSchedulingRequest(messages),
      });
    } catch (err) {
      console.error('[recruiter-agent] handler error:', err);
      return sendJson(res, err instanceof SyntaxError || err.message === 'Request body too large' ? 400 : 500,
        { error: err instanceof SyntaxError || err.message === 'Request body too large' ? 'Invalid request body' : 'Internal server error' });
    }
  };
}
