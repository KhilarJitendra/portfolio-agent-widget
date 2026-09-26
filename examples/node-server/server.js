import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRecruiterAgentHandler } from '../../src/server.js';
import exampleKnowledgeBase from '../knowledge-base.example.js';

const port = Number(process.env.PORT || 3000);
const key = process.env.GROQ_API_KEY;
const localKnowledgeBase = new URL('../knowledge-base.local.js', import.meta.url);
const knowledgeBase = existsSync(fileURLToPath(localKnowledgeBase))
  ? (await import(localKnowledgeBase.href)).default : exampleKnowledgeBase;
const profileName = process.env.RECRUITER_NAME || 'Alex Rivera';
const initials = profileName.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
const escapeHtml = (value) => String(value).replace(/[&"<>']/g, (char) => ({
  '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;',
}[char]));
const handler = key && !key.includes('your-key-here') ? createRecruiterAgentHandler({
  apiKey: key,
  model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  name: profileName,
  knowledgeBase,
  calendlyLink: process.env.CALENDLY_LINK || '',
}) : null;
const files = new Map([
  ['/', ['../plain-html/index.html', 'text/html; charset=utf-8']],
  ['/src/widget.js', ['../../src/widget.js', 'text/javascript; charset=utf-8']],
]);

http.createServer(async (req, res) => {
  if (req.url === '/api/recruiter-agent') {
    if (!handler) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Set GROQ_API_KEY in .env to enable chat.' }));
    }
    return handler(req, res);
  }
  const asset = files.get(req.url);
  if (req.method !== 'GET' || !asset) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    let contents = await readFile(fileURLToPath(new URL(asset[0], import.meta.url)));
    if (req.url === '/') {
      contents = Buffer.from(contents.toString()
        .replaceAll('Alex Rivera', escapeHtml(profileName))
        .replace('avatar="AR"', `avatar="${escapeHtml(initials)}"`));
    }
    if (req.url === '/' && process.env.CALENDLY_LINK && URL.canParse(process.env.CALENDLY_LINK)) {
      const link = new URL(process.env.CALENDLY_LINK);
      if (['https:', 'http:'].includes(link.protocol)) {
        const escaped = escapeHtml(link.href);
        contents = Buffer.from(contents.toString().replace('calendly-link=""', `calendly-link="${escaped}"`));
      }
    }
    res.writeHead(200, { 'Content-Type': asset[1] }).end(contents);
  } catch {
    res.writeHead(500).end('Unable to load demo asset');
  }
}).listen(port, () => {
  console.log(`Demo running at http://localhost:${port}`);
  if (!handler) console.warn('Chat needs GROQ_API_KEY in .env.');
});
