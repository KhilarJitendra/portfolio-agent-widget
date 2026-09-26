# Portfolio Agent Widget

A small, framework-independent chat widget for professional portfolio sites. Visitors can ask about your experience and projects, and the widget can offer your scheduling link when they ask to connect.

The UI is a `<portfolio-agent>` Web Component. A separate Node.js handler calls Groq so your API key never appears in browser code. Responses are streamed to the widget.

> **Project status:** Pre-1.0. The [source repository](https://github.com/KhilarJitendra/portfolio-agent-widget) is public; the npm package has not been published yet.

## Try the local demo

Requires Node.js 20.6 or newer.

```bash
npm ci
cp .env.example .env
# Add your GROQ_API_KEY to .env
npm run demo
```

Open <http://localhost:3000>. The demo uses the fictional profile in `examples/knowledge-base.example.js`. To try your own details locally, copy that file to `examples/knowledge-base.local.js` and edit it. The local file and `.env` are ignored by Git and excluded from the npm package. Set `RECRUITER_NAME` and, optionally, `CALENDLY_LINK` in `.env`.

## Add it to a site

The package exposes two entry points:

| Import | Purpose |
|---|---|
| `portfolio-agent-widget/widget` | Registers the `<portfolio-agent>` browser element |
| `portfolio-agent-widget` | Exports `createRecruiterAgentHandler` for your server |

Once the npm package is published, install it with `npm install portfolio-agent-widget`. Until then, clone this repository or install it directly with `npm install github:KhilarJitendra/portfolio-agent-widget`.

### Frontend

With a JavaScript bundler, import the widget once:

```js
import 'portfolio-agent-widget/widget';
```

Then place the element on your page:

```html
<portfolio-agent
  name="Ask Alex's Assistant"
  avatar="AR"
  api-endpoint="https://your-api.example.com/api/recruiter-agent"
  calendly-link="https://calendly.com/your-handle/intro"
  primary-color="#2743B8"
></portfolio-agent>
```

In Next.js, put the import and element in a client component (`'use client'`). For a plain HTML site without a bundler, copy `src/widget.js` to a public asset path and load it with `<script type="module" src="/assets/widget.js"></script>`.

| Attribute | Default | Purpose |
|---|---|---|
| `api-endpoint` | Required | URL of your backend handler |
| `name` | `Ask my assistant` | Header title |
| `avatar` | `AI` | Header initials |
| `calendly-link` | None | Scheduling button target |
| `primary-color` | `#2743B8` | Accent color |
| `position` | `bottom-right` | `bottom-right` or `bottom-left` |
| `greeting` | Generic introduction | First chat message |
| `storage-key` | Derived from page path, API URL, and name | Optional key for this widget's session history |

The panel stays closed until clicked. After 2.5 seconds, an unread dot appears on the launcher and the widget attempts a soft notification tone. Browsers may block sound before a visitor interacts with the page; the dot still appears. Opening the chat clears the dot. Messages are kept in `sessionStorage` for the current tab session so a reload restores the conversation; no chat history is written to `localStorage`.

### Backend

Keep your Groq key and knowledge base on the server. For example:

```js
import { createRecruiterAgentHandler } from 'portfolio-agent-widget';

export default createRecruiterAgentHandler({
  apiKey: process.env.GROQ_API_KEY,
  name: 'Alex Rivera',
  knowledgeBase: {
    summary: 'Frontend engineer focused on accessible web applications.',
    skills: ['TypeScript', 'React', 'accessibility'],
    availability: { workingHours: 'Weekdays, 9am–5pm local time' },
  },
  calendlyLink: 'https://calendly.com/your-handle/intro',
  allowedOrigin: 'https://your-portfolio.example',
});
```

Mount this `(req, res)` handler at the URL used by `api-endpoint`. It works with raw Node.js HTTP, Express, and compatible Node.js serverless functions. See `examples/node-server/server.js` for a complete local server.

| Option | Required | Default | Purpose |
|---|---|---|---|
| `apiKey` | Yes | — | Groq API key, read from a server environment variable |
| `name` | Yes | — | Person whose profile the assistant represents |
| `knowledgeBase` | Yes | — | Verified professional facts, as an object or string |
| `calendlyLink` | No | Empty | Enables the scheduling suggestion flag |
| `model` | No | `openai/gpt-oss-120b` | Groq model ID |
| `maxTokens` | No | `2048` | Maximum completion tokens |
| `allowedOrigin` | No | None | Browser origin allowed by CORS; use a specific production origin |
| `rateLimit` | No | 10 requests/minute/IP | In-memory, per-process limiter |
| `extraSystemPrompt` | No | Empty | Additional assistant instructions |

### Vercel example

The root `api/recruiter-agent.js` is a deployable example. Configure these environment variables before deployment:

- `GROQ_API_KEY`: your server-side key
- `RECRUITER_NAME`: the name to use in replies
- `KNOWLEDGE_BASE`: verified professional facts as text
- `GROQ_MODEL`: optional model override
- `CALENDLY_LINK`: optional real scheduling URL
- `ALLOWED_ORIGIN`: your portfolio's exact origin if hosted separately

The function returns a configuration error until the key, name, and knowledge base are supplied. Set the widget's `api-endpoint` to the deployed function URL and its `calendly-link` to the same scheduling URL.

## Privacy and production notes

- Never put `GROQ_API_KEY` in frontend code, HTML, or Git. `.env` is ignored.
- Treat the knowledge base as public: answers may reveal facts placed in it. Confirm every claim and omit confidential information.
- The model is instructed to stay within the knowledge base, but model output still needs review before a public deployment.
- The built-in rate limiter is local to one process. For multi-instance serverless traffic, use a shared rate-limit store at your edge or hosting layer.
- The assistant does not see your calendar. It gives general working hours and directs visitors to your scheduling link for an actual slot.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and pull request guidance. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 Jitendra Khilar.
