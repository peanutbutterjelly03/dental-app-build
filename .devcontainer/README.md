# Frontend-only Codespace

For a collaborator doing UI work with **no local setup** — no Node, no MongoDB, no `.env`.

## Start

1. On the repo page: **Code → Codespaces → Create codespace on main**.
2. Wait for `npm install` to finish (first build ~2–3 min).
3. Run it from the repo root (where the terminal opens):

   ```bash
   npm run dev:host
   ```

4. Click the forwarded **5173** link when it pops up.

`dev:host` is just `vite --host`. The `--host` matters: plain `npm run dev` binds to
`127.0.0.1` *inside* the container, which the Codespaces port forwarder can't reach, so
the browser tab would hang with nothing served.

## What works and what doesn't

**Works:** every screen, all components, styling, layout, routing, Tailwind, hot reload.
The frontend reads no `import.meta.env` variables, so there is nothing to configure.

**Doesn't work:** anything hitting the API. `client/vite.config.ts` proxies `/api` to
`localhost:4000`, and no server runs there by default — those calls fail. Expect login
and any data-loading screen to error out.

To get real data you need `npm run dev:server`, which needs a `.env` with a Mongo URI and
secrets. `.env` is gitignored on purpose and is **not** in this container.

> Never share the production `FIELD_ENCRYPTION_SECRET`. Changing or mismatching it makes
> existing patient records permanently undecryptable. If a collaborator needs a working
> backend, give them a throwaway dev database and its own secret via
> **Settings → Secrets and variables → Codespaces**, never the production values.

## Scope note

The container opens at the repo root, so `client/`, `server/`, `docs/`, `HANDOFF.md` and
`ml-service/` are all in the default view.

## Contributing back

Work on a branch and open a PR rather than pushing to `main`. Vercel builds a preview URL
on the PR, which is the easiest way to review a UI change before it merges.
