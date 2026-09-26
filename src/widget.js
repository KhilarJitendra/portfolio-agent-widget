/**
 * <portfolio-agent> — a self-contained chat widget for portfolio sites.
 *
 * Usage:
 *   <script type="module" src="portfolio-agent-widget/src/widget.js"></script>
 *   <portfolio-agent
 *     name="Ask Jitendra's Assistant"
 *     api-endpoint="/api/recruiter-agent"
 *     calendly-link="https://calendly.com/you/intro"
 *     primary-color="#2743B8"
 *     avatar="JK"
 *     greeting="Hi! I can answer questions about Jitendra's experience and help find a time to talk."
 *   ></portfolio-agent>
 *
 * The widget never talks to the Groq API directly — it only POSTs the
 * conversation to `api-endpoint`, which you run on your own server using
 * src/server.js. This keeps your API key off the client entirely.
 */

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function appendReplyText(element, text, streaming = false) {
  const parts = String(text).split(/\*\*(.+?)\*\*/gs);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const strong = document.createElement('strong');
      strong.textContent = part;
      element.appendChild(strong);
    } else {
      element.appendChild(document.createTextNode(streaming ? part.replaceAll('**', '') : part));
    }
  });
}

const TEMPLATE = (opts) => `
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Manrope:wght@500;600;700&display=swap');
    :host {
      all: initial;
      position: fixed;
      inset: auto ${opts.position === 'bottom-left' ? 'auto' : '20px'} 20px ${opts.position === 'bottom-left' ? '20px' : 'auto'};
      z-index: 999999;
      font-family: 'Hanken Grotesk', Arial, sans-serif;
      color: #0b1c30;
      color-scheme: light;
    }
    * { box-sizing: border-box; }
    button, input { font: inherit; }
    button { -webkit-tap-highlight-color: transparent; }
    button:focus-visible, a:focus-visible { outline: 2px solid #b9c3ff; outline-offset: 2px; }
    .launcher {
      width: 56px; height: 56px; margin-left: auto; border: 0; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      background: var(--ra-primary); color: #fff;
      box-shadow: 0 20px 25px -5px rgba(39,67,184,.18), 0 8px 10px -6px rgba(15,23,42,.16);
      transition: transform .2s ease, box-shadow .2s ease;
    }
    .launcher:hover { transform: translateY(-2px); box-shadow: 0 22px 30px -6px rgba(39,67,184,.25); }
    .launcher svg { width: 26px; height: 26px; }
    .panel {
      position: absolute; bottom: 76px; ${opts.position === 'bottom-left' ? 'left' : 'right'}: 0;
      width: min(390px, calc(100vw - 24px)); height: min(510px, calc(100dvh - 108px));
      display: flex; flex-direction: column; overflow: hidden;
      background: #fff; border: 1px solid rgba(226,232,240,.85); border-radius: 24px;
      box-shadow: 0 20px 35px -5px rgba(11,28,48,.18), 0 10px 16px -6px rgba(11,28,48,.12);
      opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(12px) scale(.97);
      transition: opacity .2s ease, transform .2s ease, visibility .2s;
    }
    .panel.open { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0) scale(1); }
    .header {
      flex: none; min-height: 68px; padding: 12px; display: flex; align-items: center; justify-content: space-between;
      background: var(--ra-primary); color: #fff;
    }
    .identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .avatar {
      width: 36px; height: 36px; flex: none; display: grid; place-items: center;
      border-radius: 50%; background: #dee1ff; color: #001257;
      font: 700 14px/1 'Manrope', Arial, sans-serif;
    }
    .identity-copy { min-width: 0; }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 14px/20px 'Manrope', Arial, sans-serif; letter-spacing: -.01em; }
    .subtitle { display: flex; align-items: center; gap: 6px; margin-top: 2px; color: #dce4ff; font-size: 11px; font-weight: 600; }
    .status-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #89f5e7; }
    .close { width: 32px; height: 32px; flex: none; display: grid; place-items: center; margin-left: 6px; border: 0; border-radius: 50%; background: transparent; color: #fff; cursor: pointer; font-size: 23px; line-height: 1; }
    .close:hover { background: rgba(255,255,255,.14); }
    .messages {
      flex: 1; min-height: 0; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 12px;
      background: #eff4ff; scrollbar-color: #cbd5e1 transparent; scrollbar-width: thin;
    }
    .day-pill { align-self: center; padding: 4px 10px; border-radius: 999px; background: #e5eeff; color: #475569; font-size: 11px; font-weight: 600; }
    .message-row { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 90%; }
    .message-row.user { align-self: flex-end; align-items: flex-end; }
    .msg { padding: 12px 14px; border-radius: 18px; font-size: 13px; line-height: 1.52; white-space: pre-wrap; overflow-wrap: anywhere; }
    .msg.bot { background: #fff; color: #0b1c30; border: 1px solid #e2e8f0; border-bottom-left-radius: 4px; box-shadow: 0 1px 3px rgba(15,23,42,.06); }
    .msg.user { background: var(--ra-primary); color: #fff; border-bottom-right-radius: 4px; box-shadow: 0 1px 3px rgba(39,67,184,.12); }
    .msg.typing { color: #64748b; font-style: italic; animation: ra-pulse 1.2s ease-in-out infinite; }
    .message-time { padding: 0 4px; color: #64748b; font-size: 10px; font-weight: 600; }
    @keyframes ra-pulse { 50% { opacity: .55; } }
    .cal-link { display: inline-flex; align-items: center; margin-top: 8px; padding: 8px 14px; border-radius: 12px; background: var(--ra-primary); color: #fff !important; text-decoration: none; font-size: 12px; font-weight: 600; }
    .cal-link:hover { filter: brightness(.92); }
    .quick-prompts { flex: none; display: flex; gap: 6px; padding: 7px 12px; overflow-x: auto; background: #eff4ff; scrollbar-width: none; }
    .quick-prompts::-webkit-scrollbar { display: none; }
    .quick-prompts button { flex: none; padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 999px; background: #fff; color: #475569; cursor: pointer; font-size: 11px; font-weight: 600; }
    .quick-prompts button:hover { border-color: var(--ra-primary); color: var(--ra-primary); }
    .quick-prompts button:disabled { opacity: .55; cursor: default; }
    .composer { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #fff; border-top: 1px solid #e2e8f0; }
    .composer input { flex: 1; min-width: 0; height: 36px; padding: 0 14px; border: 1px solid transparent; border-radius: 999px; outline: none; background: #eff4ff; color: #0b1c30; font-size: 13px; }
    .composer input::placeholder { color: #64748b; }
    .composer input:focus { border-color: #b9c3ff; box-shadow: 0 0 0 3px rgba(39,67,184,.14); background: #fff; }
    .composer button { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--ra-primary); color: #fff; cursor: pointer; transition: transform .15s ease, opacity .15s ease; }
    .composer button:hover { transform: scale(1.05); }
    .composer button:disabled { opacity: .5; cursor: default; transform: none; }
    @media (max-width: 480px) {
      :host { inset: auto ${opts.position === 'bottom-left' ? 'auto' : '12px'} 12px ${opts.position === 'bottom-left' ? '12px' : 'auto'}; }
      .panel { bottom: 72px; height: min(510px, calc(100dvh - 96px)); border-radius: 22px; }
    }
    @media (prefers-reduced-motion: reduce) { .launcher, .panel, .composer button { transition: none; } .msg.typing { animation: none; } }
  </style>

  <button class="launcher" part="launcher" aria-label="Open chat">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
  </button>

  <div class="panel">
    <div class="header">
      <div class="identity">
        <div class="avatar" aria-hidden="true">${escapeHtml(opts.avatar)}</div>
        <div class="identity-copy">
          <div class="title">${escapeHtml(opts.name)}</div>
          <div class="subtitle"><span class="status-dot"></span>Usually replies in a few seconds</div>
        </div>
      </div>
      <button class="close" aria-label="Minimize chat">&times;</button>
    </div>
    <div class="messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
    <div class="quick-prompts" aria-label="Suggested questions">
      <button type="button" data-question="What professional experience can you share?">Experience</button>
      <button type="button" data-question="What is your tech stack?">Tech Stack</button>
      <button type="button" data-question="What is your availability?">Availability</button>
    </div>
    <div class="composer">
      <input type="text" placeholder="Ask about experience, skills, availability…" />
      <button class="send" aria-label="Send question">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  </div>
`;

const HTMLElementBase = globalThis.HTMLElement || class {};

class PortfolioAgent extends HTMLElementBase {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.history = [];
  }

  connectedCallback() {
    const name = this.getAttribute('name') || "Ask my assistant";
    const position = this.getAttribute('position') || 'bottom-right';
    const primary = this.getAttribute('primary-color') || '#2743B8';
    const avatar = this.getAttribute('avatar') || 'AI';
    this.apiEndpoint = this.getAttribute('api-endpoint');
    this.calendlyLink = this.getAttribute('calendly-link') || '';
    this.greeting = this.getAttribute('greeting') ||
      "Hi! I can answer questions about my experience, skills, and availability. What would you like to know?";

    if (!this.apiEndpoint) {
      console.error('[recruiter-agent] Missing required "api-endpoint" attribute.');
    }

    this.shadowRoot.innerHTML = TEMPLATE({ name, position, avatar });
    this.shadowRoot.host.style.setProperty('--ra-primary', primary);

    this.$launcher = this.shadowRoot.querySelector('.launcher');
    this.$panel = this.shadowRoot.querySelector('.panel');
    this.$close = this.shadowRoot.querySelector('.close');
    this.$messages = this.shadowRoot.querySelector('.messages');
    this.$input = this.shadowRoot.querySelector('.composer input');
    this.$send = this.shadowRoot.querySelector('.composer .send');
    this.$prompts = [...this.shadowRoot.querySelectorAll('.quick-prompts button')];

    this.$launcher.addEventListener('click', () => this.toggle());
    this.$close.addEventListener('click', () => this.toggle(false));
    this.$send.addEventListener('click', () => this.sendMessage());
    this.$input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });
    this.$prompts.forEach((button) => button.addEventListener('click', () => {
      if (this.$send.disabled) return;
      this.$input.value = button.dataset.question;
      this.sendMessage();
    }));
  }

  toggle(force) {
    const open = force ?? !this.$panel.classList.contains('open');
    this.$panel.classList.toggle('open', open);
    if (open && !this.$messages.querySelector('.msg')) {
      const day = document.createElement('div');
      day.className = 'day-pill';
      day.textContent = 'Today • Online';
      this.$messages.appendChild(day);
      this.appendMessage('bot', this.greeting);
    }
  }

  appendMessage(role, text, opts = {}) {
    const row = document.createElement('div');
    row.className = `message-row ${role}`;
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    if (role === 'bot') appendReplyText(div, text);
    else div.textContent = text;
    if (opts.calendlyLink) {
      this.appendSchedulingLink(div, opts.calendlyLink);
    }
    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());
    row.append(div, time);
    this.$messages.appendChild(row);
    this.$messages.scrollTop = this.$messages.scrollHeight;
    return div;
  }

  appendSchedulingLink(message, link) {
    const a = document.createElement('a');
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'cal-link';
    a.textContent = 'Pick a time →';
    message.appendChild(document.createElement('br'));
    message.appendChild(a);
  }

  async sendMessage() {
    const text = this.$input.value.trim();
    if (!text || !this.apiEndpoint || this.$send.disabled) return;
    this.$input.value = '';
    this.appendMessage('user', text);
    this.history.push({ role: 'user', content: text });

    const typing = this.appendMessage('bot', 'Thinking…');
    typing.classList.add('typing');
    this.$send.disabled = true;
    this.$prompts.forEach((button) => { button.disabled = true; });
    let received = '';
    let visible = 0;
    const paint = window.setInterval(() => {
      if (visible >= received.length) return;
      const nearBottom = this.$messages.scrollHeight - this.$messages.scrollTop - this.$messages.clientHeight < 100;
      visible = Math.min(received.length, visible + 4);
      typing.classList.remove('typing');
      typing.replaceChildren();
      appendReplyText(typing, received.slice(0, visible), true);
      if (nearBottom) this.$messages.scrollTop = this.$messages.scrollHeight;
    }, 30);

    try {
      const res = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ messages: this.history, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      if (!res.ok) throw Object.assign(new Error(`Request failed (${res.status})`), { status: res.status });
      if (!res.body) throw new Error('Response stream unavailable');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      let suggestScheduling = false;
      while (true) {
        const { done: ended, value } = await reader.read();
        if (ended) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.replace(/\r\n/g, '\n').split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((part) => part.startsWith('data:'));
          if (!line) continue;
          const event = JSON.parse(line.slice(5).trim());
          if (event.type === 'token') received += event.content;
          if (event.type === 'done') { done = true; suggestScheduling = event.suggestScheduling; }
          if (event.type === 'error') throw new Error('Response stream failed');
        }
      }
      if (!done || !received.trim()) throw new Error('Response stream ended early');
      while (visible < received.length) await new Promise((resolve) => window.setTimeout(resolve, 30));
      typing.replaceChildren();
      appendReplyText(typing, received);
      this.history.push({ role: 'assistant', content: received });
      if (suggestScheduling && this.calendlyLink) this.appendSchedulingLink(typing, this.calendlyLink);
    } catch (err) {
      if (!received) typing.parentElement.remove();
      this.appendMessage('bot', err.status === 429
        ? "I'm getting a lot of questions right now. Please try again shortly."
        : "Something went wrong reaching the server. Please try again in a moment.");
      console.error('[recruiter-agent]', err);
    } finally {
      window.clearInterval(paint);
      this.$send.disabled = false;
      this.$prompts.forEach((button) => { button.disabled = false; });
    }
  }
}

if (globalThis.customElements && !customElements.get('portfolio-agent')) {
  customElements.define('portfolio-agent', PortfolioAgent);
}
