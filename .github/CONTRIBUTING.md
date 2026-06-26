# Contributing

Thanks for taking a look at LaTeXRender.

This project is still in an early public stage. The goal of this guide is to make contributions predictable, reviewable, and aligned with the repo's current support boundaries.

## Project shape

- The public command surface is intentionally small: `!latex`, `!plot`, `!solve`, and `!help`.
- Most feature work should extend one of those routers rather than add a new top-level command.
- The repository is terminal-first. `npm run doctor` is the supported setup/status check.
- Windows, Linux, and macOS are all part of the release gate; the cross-platform startup/render checks live in CI and `npm run test:startup`.

## Local setup

Install dependencies and verify the environment before changing code:

```bash
npm install
pip install sympy numpy scipy
npm run doctor
```

If `npm run doctor` fails, fix that first. It is the same entry point used by CI before the release-gated test command.

## Development workflow

Use the smallest change that matches the user-facing behavior you want.

- If you change public command behavior, update both `README.md` and `src/commands/help.js` in the same change.
- If you add or change math helpers that should work in both runtimes, keep `src/math.js` and `python/math_utils.py` aligned.
- If you touch rendering behavior, go through `src/renderer/index.js` rather than bypassing the renderer entrypoint.
- Do not weaken the QuickLaTeX URL validation and SSRF guards in `src/renderer/quicklatex.js`.
- Keep changes phase-scoped when possible. This repository uses `publis_github.md` as an explicit release-hardening backlog.

## Tests

Run the narrowest useful test locally while iterating, then finish with the release gate that matches the scope of your change.

```bash
npm test
npm run test:startup
npm run test:core
npm run test:renderers
npm run test:ci
```

Useful notes:

- `npm test` is the local renderer smoke test.
- `npm run test:startup` checks bot bootstrap and renderer startup without requiring a live WhatsApp login.
- `npm run test:core` covers parser, help, router, solver, calculus, vector, matrix, and ODE checks.
- `npm run test:renderers` covers the smoke test plus renderer-focused suites, including the release-gated 3D and PDE integration checks.
- `npm run test:ci` is the canonical CI and pre-release verification command.

## Pull request expectations

Please keep pull requests focused and easy to review.

- Describe the behavior change, not just the files touched.
- List the test commands you ran.
- Call out any README or help text changes.
- Mention external-service implications if your change affects QuickLaTeX or CodeCogs behavior.
- Note runtime-impacting changes if they affect Chromium, Python, `ffmpeg`, or WhatsApp session handling.

The PR template in this repository mirrors those expectations.

## Issue triage

- Bug reports should use the bug report template.
- Feature ideas should use the feature request template.
- Setup and usage questions should use the support question template.
- Security reports should follow `.github/SECURITY.md` and should not be opened as public issues.
- General usage or setup questions should follow `.github/SUPPORT.md`.

## Style and scope

- Preserve the unified command surface unless the product direction explicitly changes.
- Prefer truthfulness over broad claims in docs and help text.
- If a change affects a documented example, either fix the example or downgrade the claim in the same change.
