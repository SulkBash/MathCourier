# Security Policy

## Supported versions

This project is still pre-`1.0` and the support posture is best-effort.

Security fixes are most likely to land on:

| Version / branch | Supported |
| --- | --- |
| Latest default branch | Yes |
| Latest published `0.x` release, once releases exist | Best effort |
| Older commits or forks | No |

## Reporting a vulnerability

Please do not open public GitHub issues for active vulnerabilities.

Preferred reporting path:

1. Use GitHub's private vulnerability reporting feature for this repository, if it is enabled.
2. If private reporting is not available yet, contact the maintainer privately through GitHub at <https://github.com/SulkBash>.
3. Include `[security] MathCourier` in the subject or opening line so the report can be triaged quickly.

Please include:

- A description of the issue
- Steps to reproduce
- Impact assessment
- Affected command or component
- Relevant environment details
- Any proof-of-concept material that does not expose secrets, QR codes, or private chat/session data

## Scope and special attention areas

Reports are especially helpful when they involve:

- WhatsApp auth/session handling or local runtime data exposure
- SSRF, unsafe fetch, or host-validation bypasses around QuickLaTeX and CodeCogs integrations
- Renderer sandbox or subprocess-boundary issues
- Dependency or CI supply-chain issues
- Unexpected network access, data exfiltration, or unsafe file writes

## External services

Some rendering paths may contact third-party services:

- QuickLaTeX for `chemfig`, TikZ, and `circuitikz` rendering
- CodeCogs as a formula fallback when fallback rendering is enabled

If your report depends on third-party behavior, please say which external service was involved and whether the issue reproduces with local rendering only.

## Response expectations

This repository does not currently offer a formal SLA.

Current targets are:

- Initial triage: within 7 business days when possible
- Status update after reproduction/assessment: as soon as practical

Because `whatsapp-web.js` is unofficial and upstream WhatsApp behavior can change without warning, some fixes may depend on upstream conditions and may take longer than normal application bugs.
