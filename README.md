# Slides

Hub to serve multiple [Slidev](https://sli.dev) decks on GitHub Pages.

```
slides/<slide-id>/      ← each deck is a git submodule (one Slidev project)
        │  scripts/build.mjs
        ▼
dist/index.html         ← list of all decks
dist/p/<slide-id>/      ← built deck, served at {domain}/p/<slide-id>/
dist/404.html           ← deep links (/p/<id>/5, /p/<id>/presenter) for every deck
```

`<slide-id>` is the name of the submodule folder under `slides/`.

## Add a new deck

```bash
git submodule add https://github.com/<owner>/<repo> slides/<slide-id>
```

```bash
git commit -m "Add <slide-id>" && git push
```

That's all. The workflow builds every deck in `slides/` and deploys them. The new deck appears at `{domain}/p/<slide-id>/` and on the index page.

To remove a deck: `git rm slides/<slide-id>`, then commit and push.

### Requirements for a deck repo

- `@slidev/cli` is in `dependencies` / `devDependencies`.
- The entry file is `slides.md`, or whatever `"build": "slidev build <entry>"` in its `package.json` names.
- The lockfile picks the install tool: `package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn.
- The `title` (and `info`) in the headmatter is what the index page shows.

## Update a deck after it changes

A submodule is pinned to a commit. Pick one of these:

- **Pin a new commit** (recommended):

  ```bash
  git submodule update --remote slides/<slide-id>
  ```

  ```bash
  git commit -am "Update <slide-id>" && git push
  ```

- **Build the latest without committing**: Actions → *Build & deploy slides* → *Run workflow*, tick *update_submodules*.
- **Auto-rebuild from the deck repo**: send a `repository_dispatch` event of type `slides-updated` to this repo. For example, add a step to the deck repo's workflow, with a PAT that can write to this repo:

  ```bash
  gh api repos/<owner>/<this-repo>/dispatches -f event_type=slides-updated
  ```

## One-time GitHub setup

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. (Optional) Custom domain: set it in Settings → Pages. The base path is detected automatically (`/` on a custom domain or `<user>.github.io`, `/<repo>/` on a project site).
3. (Optional) Repository variables (Settings → Secrets and variables → Actions → Variables):
   - `SITE_TITLE`: index page title (default `Slides`).
   - `BASE_PATH`: override the detected base path.
4. (Optional) Private deck repos: add a `SUBMODULES_TOKEN` secret (PAT with read access to those repos).

## Local

```bash
git clone --recurse-submodules <this-repo>
```

```bash
npm run build
```

```bash
npm run serve
```

Then open http://localhost:4173. `npm run serve` acts like GitHub Pages, including the 404 fallback. To build just some decks: `SLIDES=id1,id2 npm run build`.

## Deep links

GitHub Pages serves only one `404.html`, at the root. For `/p/<id>/<path>` the root `404.html` redirects to `/p/<id>/?__spa=<path>`. A small script that the build adds to each deck's `index.html` puts the original URL back before Slidev's router starts. So `/p/<id>/5?lang=en`, `/p/<id>/presenter/3`, and others open directly.
