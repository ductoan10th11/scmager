import fs from 'node:fs'
import path from 'node:path'

// Public reading pages are rendered at build time so that clients which do not
// run JavaScript (store reviewers, crawlers) receive the full text.
const POLICY_FILE = path.resolve(__dirname, '../../../policy/PRIVACY_POLICY.md')
const SITE_URL = 'https://ework.expsolution.io'

const STYLE = `
:root { color-scheme: light dark; --bg: #f8fafc; --card: #fff; --text: #0f172a; --muted: #475569; --line: #e2e8f0; --accent: #2563eb; }
@media (prefers-color-scheme: dark) { :root { --bg: #09090b; --card: #18181b; --text: #f1f5f9; --muted: #cbd5e1; --line: #27272a; --accent: #60a5fa; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.65 Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 56rem; margin: 0 auto; padding: 2.5rem 1rem; }
article { background: var(--card); border: 1px solid var(--line); border-radius: 1rem; padding: 2rem; overflow-wrap: anywhere; }
h1 { margin: 0 0 1rem; font-size: 1.875rem; line-height: 1.25; }
h2 { margin: 2rem 0 .5rem; font-size: 1.125rem; }
p, li { color: var(--muted); }
code { font-size: .9em; }
a { color: var(--accent); }
footer { margin-top: 1.5rem; text-align: center; font-size: .75rem; color: var(--muted); }
.landing { min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; }
.landing nav { display: flex; flex-wrap: wrap; gap: .75rem; justify-content: center; margin-top: 1.5rem; }
.landing nav a { padding: .5rem 1.5rem; border: 1px solid var(--line); border-radius: 999px; font-weight: 500; text-decoration: none; }
`

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const inline = (text) =>
  escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')

// Covers the Markdown the policy file uses: headings, paragraphs and bullet lists.
export const renderMarkdown = (markdown) => {
  const html = []
  let inList = false
  const closeList = () => {
    if (inList) html.push('</ul>')
    inList = false
  }
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    const item = line.match(/^-\s+(.*)$/)
    if (item) {
      if (!inList) html.push('<ul>')
      inList = true
      html.push(`<li>${inline(item[1])}</li>`)
      continue
    }
    closeList()
    if (heading) html.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`)
    else if (line) html.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return html.join('\n')
}

const documentHtml = ({ lang, title, description, canonical, body }) => `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${SITE_URL}${canonical}">
<link rel="icon" type="image/png" href="/icon.png">
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`

const privacyPolicyHtml = () =>
  documentHtml({
    lang: 'en',
    title: 'eWork Assistant Privacy Policy',
    description: 'How the eWork Assistant Chrome Extension collects, uses and safeguards user data.',
    canonical: '/privacy-policy',
    body: `<main>
<article>
${renderMarkdown(fs.readFileSync(POLICY_FILE, 'utf8'))}
</article>
<footer><a href="/landing">eWork</a> · &copy; 2026 eWork Assistant</footer>
</main>`,
  })

const landingHtml = () =>
  documentHtml({
    lang: 'vi',
    title: 'eWork',
    description: 'Hệ thống Quản lý Lịch công tác và Theo dõi Nhiệm vụ Cơ quan.',
    canonical: '/landing',
    body: `<main class="landing">
<div>
<h1>eWork</h1>
<p>Hệ thống Quản lý Lịch công tác và Theo dõi Nhiệm vụ Cơ quan.</p>
<nav>
<a href="/dashboard">Vào Dashboard</a>
<a href="/privacy-policy">Chính sách quyền riêng tư</a>
</nav>
</div>
</main>`,
  })

const PAGES = {
  '/landing': landingHtml,
  '/privacy-policy': privacyPolicyHtml,
  '/privacy': privacyPolicyHtml,
}

export const staticPages = () => ({
  name: 'ework-static-pages',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const render = PAGES[req.url.split('?')[0].replace(/\/$/, '')]
      if (!render) return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(render())
    })
  },
  generateBundle() {
    for (const [route, render] of Object.entries(PAGES)) {
      const source = render()
      // Both forms, so the page is served with and without a trailing slash.
      for (const fileName of [`${route.slice(1)}.html`, `${route.slice(1)}/index.html`]) {
        this.emitFile({ type: 'asset', fileName, source })
      }
    }
  },
})
