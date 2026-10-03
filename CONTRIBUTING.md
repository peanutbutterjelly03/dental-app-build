# Contributing to FLORAL

FLORAL is a dental health record management system for Barangay Tanyag, Taguig City —
a capstone project, but one that holds **real student health records**. A few rules here
exist because of that, not because of style preferences. They're marked ⚠.

You do **not** need to install anything to help with frontend work. Everything below runs
in the browser.

---

## Getting set up

1. **Accept the collaborator invite** sent to your email. It expires after 7 days, and
   nothing works until you accept.
2. Open the repo → **Code** (green button) → **Codespaces** tab → **Create codespace on
   main**. First build takes ~2–3 minutes while it pulls the image and runs `npm install`.
3. In the Codespace terminal, move into the app folder and start it:

   ```bash
   cd dental-4-12-main/project
   npm run dev:host
   ```

   The `cd` is required — the terminal opens at the repo root, where there is no
   `package.json`. Without it you get `npm error code ENOENT`.

4. Click **Open in Browser** on the port-5173 toast. (Missed it? **Ports** tab at the
   bottom → 🌐 next to 5173.)

You should land on the FLORAL login screen.

> `dev:host` is `vite --host`. The `--host` matters: plain `npm run dev` binds to
> `127.0.0.1` *inside* the container, which the port forwarder can't reach, so the browser
> tab hangs with nothing served. Use `dev:host` in a Codespace, `dev` locally.

More detail, including troubleshooting, is in [`.devcontainer/README.md`](.devcontainer/README.md).

**Running the full stack locally instead** (backend + database + ML service) is documented
in the root [`README.md`](README.md) — see *Prerequisites*, *Environment variables*, and
*Run locally*. That path needs a `.env` with real credentials, so it's for maintainers, not
for frontend contributions. Ask first; you'd get a throwaway development database, never
production.

### What works, and what won't

**Works:** every screen, all components, styling, layout, routing, Tailwind, hot reload.
The frontend reads no environment variables, so there is nothing to configure.

**Won't work:** logging in, and any screen that loads data. The Codespace runs no backend —
`/api` calls have nothing to reach. **This is expected, not something you broke.** You can
see and style every screen; you just can't sign in or load real records.

### When you're done

Commit and push first, then delete the Codespace at `github.com/codespaces` (⋯ → Delete).
Stopping only pauses it and still uses your storage allowance. Deleting discards any
**uncommitted** work permanently, so push before you do.

---

## Making a change

`main` is protected — you can't push to it directly. Every change goes through a pull
request.

```bash
git checkout -b fix-patient-list-spacing   # name it after what you're doing
# ...make changes, check them in the browser...
git add -A
git commit -m "Tighten spacing in the patient list header"
git push -u origin fix-patient-list-spacing
```

Then on GitHub: **Compare & pull request** → describe what changed and why → Create.

Vercel posts a preview URL on the PR. **Check your change there before asking for review** —
it's the fastest way to catch something that looked fine locally.

### Keeping your branch current

Before starting each new branch, get the latest `main`:

```bash
git checkout main && git pull
```

Building on stale code is the most common cause of painful merge conflicts here.

---

## Conventions

**One change per PR.** Don't bundle unrelated edits — it makes review harder, and half a
PR can't be merged.

**Surgical changes.** Touch the minimum number of files. Resist the urge to reformat,
rename, or "clean up while I'm here" — it buries the actual change in noise.

**Follow the design system.** Colors, spacing, and typography come from tokens, not
literal values. Before adding any color, read [`DESIGN.md`](DESIGN.md). Two rules catch
people out:

- **The One Red Rule** — there is exactly one red (`#DC2626`). Never introduce a second.
- **The No-Dead-Tokens Rule** — a token you add must actually be used.

Chart colors come from `src/app/utils/chartColors.ts`, never inline hex values.

**Match the surrounding code.** Same naming, same comment density, same idioms as the file
you're editing.

---

## ⚠ Rules that aren't negotiable

**Never commit `.env`, `.env.local`, or any credential.** They're gitignored — keep it
that way. If you ever think you've committed a secret, say so immediately; rotating a key
is easy, and un-publishing one is not.

**Never ask for or use the production `FIELD_ENCRYPTION_SECRET`.** Changing or mismatching
it makes every existing patient record permanently undecryptable. There is no recovery.

**Never hard-delete a record.** The system uses soft deletes everywhere (`isArchived`).
This is a clinical and legal requirement, not a code style choice.

**Never commit real student data** — no exports, screenshots with real names, database
dumps, or Excel files from `data/`. These are real minors' health records. Use demo data
for screenshots.

**Don't put patient data in a Codespace.** If you ever need a working backend, ask — you'll
get a throwaway development database, never production.

---

## Questions

Ask before building if anything is unclear. A five-minute question beats a rewritten
pull request.
