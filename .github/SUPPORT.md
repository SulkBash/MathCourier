# Support

## Where to ask for what

- Bug reports: use the bug report issue template
- Feature requests: use the feature request issue template
- Security issues: follow `.github/SECURITY.md` and do not open a public issue
- Usage and setup questions: use the support question issue template if no better forum is available yet

## Before opening an issue

Please check the current docs first:

- `README.md` for install, runtime, and command examples
- `.github/CONTRIBUTING.md` for contributor workflow and test commands
- `.github/SECURITY.md` for anything security-sensitive

If you are reporting a runtime problem, include the output or result of:

```bash
npm run doctor
```

If you are contributing a fix, also include the most relevant test command you ran, ideally `npm run test:ci` when the change is broad enough.

## Support posture

Support is best-effort.

Current priority order:

1. Security and privacy issues
2. Install and startup blockers
3. Regressions in the documented public command surface: `!latex`, `!plot`, `!solve`, `!help`
4. Documentation inaccuracies that block onboarding
5. Nice-to-have features and broader roadmap ideas

## Platform expectations

- Windows local workstation flow is the primary manual validation path
- Linux and macOS are part of the automated CI release gate
- Containerized hosting is not part of the initial public support promise

## Upstream and external-service realities

- `whatsapp-web.js` is unofficial, so upstream WhatsApp changes can break behavior outside this repository's control
- QuickLaTeX and CodeCogs are external services and may introduce outages or behavior differences when fallback paths are used
- Issues caused by those upstream dependencies are still welcome, but fixes may take longer or require upstream changes

## What helps maintainers respond faster

- The exact command you sent
- Expected behavior versus actual behavior
- Whether the problem happens with local rendering, fallback rendering, or both
- Node, Python, browser, and `ffmpeg` details when relevant
- Screenshots or logs with secrets, QR codes, and private chat data removed
