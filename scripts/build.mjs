#!/usr/bin/env node
// Builds every Slidev project under slides/ into dist/p/<slide-id>/,
// then writes a landing page (dist/index.html) and a deep-link fallback (dist/404.html).
//
// Env:
//   BASE_PATH   URL prefix the site is served under, e.g. "/" or "/my-repo/" (default "/")
//   SLIDES      optional comma-separated list of slide ids to build (default: all)

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SLIDES_DIR = join(ROOT, 'slides')
const DIST = join(ROOT, 'dist')
const SITE_TITLE = process.env.SITE_TITLE || 'Slides'

const BASE = normalizeBase(process.env.BASE_PATH || '/')
const ONLY = (process.env.SLIDES || '').split(',').map(s => s.trim()).filter(Boolean)

function normalizeBase(b) {
  b = b.trim()
  if (!b.startsWith('/')) b = '/' + b
  if (!b.endsWith('/')) b += '/'
  return b.replace(/\/{2,}/g, '/')
}

function log(...a) { console.log('[slides]', ...a) }

function run(cmd, args, cwd) {
  log(`$ ${cmd} ${args.join(' ')}   (in ${cwd.replace(ROOT + '/', '')})`)
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: process.env.CI || '1' } })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${r.status}`)
}

function hasBin(name) {
  return spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0
}

// Pick install command from the lockfile the slide repo ships with.
function install(dir) {
  const has = f => existsSync(join(dir, f))
  if (has('pnpm-lock.yaml')) {
    return hasBin('pnpm') ? run('pnpm', ['install', '--frozen-lockfile'], dir)
      : run('npx', ['-y', 'pnpm@latest', 'install', '--frozen-lockfile'], dir)
  }
  if (has('yarn.lock')) {
    return hasBin('yarn') ? run('yarn', ['install', '--frozen-lockfile'], dir)
      : run('npx', ['-y', 'yarn@1', 'install', '--frozen-lockfile'], dir)
  }
  if (has('bun.lockb') || has('bun.lock')) return run('bun', ['install', '--frozen-lockfile'], dir)
  if (has('package-lock.json')) return run('npm', ['ci', '--no-audit', '--no-fund'], dir)
  return run('npm', ['install', '--no-audit', '--no-fund'], dir)
}

// Entry file: taken from `"build": "slidev build <entry>"` if present, else slides.md.
function entryOf(dir, pkg) {
  const m = (pkg.scripts?.build || '').match(/slidev\s+build(?:\s+([^\s-][^\s]*))?/)
  return (m && m[1]) || 'slides.md'
}

function frontmatter(file) {
  if (!existsSync(file)) return {}
  const src = readFileSync(file, 'utf8')
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const out = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    let [, k, v] = kv
    if (v === '|' || v === '>' || v === '|-' || v === '>-') {
      const block = []
      while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1])) block.push(lines[++i].trim())
      v = block.filter(Boolean).join(v.startsWith('|') ? '\n' : ' ')
    }
    out[k] = v.replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

function lastUpdated(dir) {
  try { return execFileSync('git', ['-C', dir, 'log', '-1', '--format=%cs'], { encoding: 'utf8' }).trim() }
  catch { return '' }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Runs before Slidev's router: restores the deep link that 404.html stashed in ?__spa=.
function spaRestoreScript() {
  return `<script>(function(){var p=new URLSearchParams(location.search).get('__spa');if(p===null)return;var b=location.pathname.replace(/[^/]*$/,'');history.replaceState(null,'',b+p.replace(/^\\//,''))})()</script>`
}

function injectSpaRestore(slideOut) {
  for (const f of ['index.html', '404.html']) {
    const p = join(slideOut, f)
    if (!existsSync(p)) continue
    const html = readFileSync(p, 'utf8')
    if (html.includes('__spa')) continue
    writeFileSync(p, html.replace(/<head>/i, m => `${m}${spaRestoreScript()}`))
  }
}

function discover() {
  if (!existsSync(SLIDES_DIR)) return []
  return readdirSync(SLIDES_DIR)
    .filter(name => !name.startsWith('.') && statSync(join(SLIDES_DIR, name)).isDirectory())
    .filter(name => {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
        log(`skip "${name}": slide id must be URL-safe ([A-Za-z0-9._-])`)
        return false
      }
      if (!existsSync(join(SLIDES_DIR, name, 'package.json'))) {
        log(`skip "${name}": no package.json (submodule not checked out? run: git submodule update --init)`)
        return false
      }
      return ONLY.length === 0 || ONLY.includes(name)
    })
    .sort()
}

function buildSlide(id) {
  const dir = join(SLIDES_DIR, id)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const entry = entryOf(dir, pkg)
  const out = join(DIST, 'p', id)
  const base = `${BASE}p/${id}/`

  log(`── building "${id}"  entry=${entry}  base=${base}`)
  install(dir)
  const slidev = join(dir, 'node_modules', '.bin', 'slidev')
  if (!existsSync(slidev)) throw new Error(`"${id}": @slidev/cli not found in dependencies`)
  run(slidev, ['build', entry, '--base', base, '--out', out], dir)
  injectSpaRestore(out)

  const fm = frontmatter(join(dir, entry))
  return {
    id,
    title: fm.title || id,
    info: (fm.info || '').replace(/\s*\n\s*/g, ' '),
    updated: lastUpdated(dir),
    url: base,
  }
}

function indexHtml(slides) {
  const cards = slides.map(s => `
      <a class="card" href="${esc(s.url)}">
        <span class="id">${esc(s.id)}</span>
        <h2>${esc(s.title)}</h2>
        ${s.info ? `<p>${esc(s.info)}</p>` : ''}
        ${s.updated ? `<time datetime="${esc(s.updated)}">${esc(s.updated)}</time>` : ''}
      </a>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(SITE_TITLE)}</title>
<style>
  :root { --bg:#fafaf9; --fg:#1c1917; --muted:#78716c; --card:#fff; --line:#e7e5e4; --accent:#4f46e5; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0c0a09; --fg:#f5f5f4; --muted:#a8a29e; --card:#1c1917; --line:#292524; --accent:#a5b4fc; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:960px; margin:0 auto; padding:48px 16px; }
  header h1 { margin:0 0 4px; font-size:28px; }
  header p { margin:0 0 32px; color:var(--muted); }
  .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); }
  .card { display:flex; flex-direction:column; gap:6px; padding:20px; background:var(--card); border:1px solid var(--line); border-radius:12px; color:inherit; text-decoration:none; transition:border-color .15s, transform .15s; }
  .card:hover { border-color:var(--accent); transform:translateY(-2px); }
  .card h2 { margin:0; font-size:18px; line-height:1.35; }
  .card p { margin:0; color:var(--muted); font-size:14px; }
  .id { font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--accent); }
  time { margin-top:auto; padding-top:8px; font-size:12px; color:var(--muted); }
  .empty { color:var(--muted); }
</style>
</head>
<body>
<main>
  <header>
    <h1>${esc(SITE_TITLE)}</h1>
    <p>${slides.length} deck${slides.length === 1 ? '' : 's'}</p>
  </header>
  ${slides.length ? `<div class="grid">${cards}\n  </div>` : '<p class="empty">No slides yet.</p>'}
</main>
</body>
</html>
`
}

// GitHub Pages serves only the root 404.html. For /p/<id>/<anything>, bounce to the
// slide's index with the rest of the path in ?__spa=, which the slide restores on load.
function notFoundHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not found</title>
<script>
(function () {
  var base = ${JSON.stringify(BASE)};
  var path = location.pathname;
  if (path.indexOf(base) !== 0) return;
  var m = path.slice(base.length).match(/^p\\/([^/]+)\\/?(.*)$/);
  if (!m || !m[2]) return;
  var rest = m[2] + location.search + location.hash;
  location.replace(base + 'p/' + m[1] + '/?__spa=' + encodeURIComponent(rest));
})();
</script>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#fafaf9; color:#1c1917; font:16px/1.5 system-ui,sans-serif; }
  @media (prefers-color-scheme: dark) { body { background:#0c0a09; color:#f5f5f4; } }
  a { color:inherit; }
</style>
</head>
<body>
<p>Page not found. <a href="${esc(BASE)}">Back to all slides</a></p>
</body>
</html>
`
}

function main() {
  const ids = discover()
  if (ONLY.length) for (const id of ONLY) if (!ids.includes(id)) throw new Error(`slide "${id}" not found in slides/`)

  rmSync(DIST, { recursive: true, force: true })
  mkdirSync(join(DIST, 'p'), { recursive: true })

  log(`base=${BASE}  slides=${ids.join(', ') || '(none)'}`)
  const built = ids.map(buildSlide)

  writeFileSync(join(DIST, 'index.html'), indexHtml(built))
  writeFileSync(join(DIST, '404.html'), notFoundHtml())
  writeFileSync(join(DIST, '.nojekyll'), '')
  writeFileSync(join(DIST, 'slides.json'), JSON.stringify(built, null, 2))
  log(`done: ${built.length} slide(s) → dist/`)
  for (const s of built) log(`  ${s.url}  ${s.title}`)
}

try { main() }
catch (e) { console.error('[slides] ERROR:', e.message); process.exit(1) }
