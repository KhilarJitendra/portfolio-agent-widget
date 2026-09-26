import { createRecruiterAgentHandler } from '../src/server.js';

let handler;
export default function recruiterAgent(req, res) {
  if (!process.env.GROQ_API_KEY || !process.env.RECRUITER_NAME || !process.env.KNOWLEDGE_BASE) {
    return res.status(503).json({ error: 'Configure GROQ_API_KEY, RECRUITER_NAME, and KNOWLEDGE_BASE' });
  }
  handler ||= createRecruiterAgentHandler({
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    name: process.env.RECRUITER_NAME,
    knowledgeBase: process.env.KNOWLEDGE_BASE,
    calendlyLink: process.env.CALENDLY_LINK || '',
    allowedOrigin: process.env.ALLOWED_ORIGIN || null,
  });
  return handler(req, res);
}
