# AGENTS.md — LaTeXRender WhatsApp Bot

This file explains the project layout, how the pieces connect, and the rules to follow when working on this codebase.

---

## Project overview

A WhatsApp bot that receives math-related commands and replies with rendered PNG images. It runs entirely locally — no hosted server required. The user scans a QR code once, and the bot stays connected.

**Core capabilities:**
- Render LaTeX / KaTeX formulas as styled dark-theme cards
- Plot explicit functions, implicit equations, and vector fields on canvas
- Solve equations symbolically or numerically (Newton-Raphson)
- Differentiate and integrate expressions (mathjs → SymPy fallback)
- Solve ODEs symbolically (SymPy `dsolve`) or numerically (SciPy RK45)
- Rearrange equations to isolate a variable (SymPy)
- Render molecular structures (chemfig) and circuit/TikZ diagrams via QuickLaTeX API

---

## File map

```
config.js               — Visual style and bot behavior settings
bot.js                  — WhatsApp client, message routing, command dispatch
package.json            — Node.js dependencies and npm scripts
src/
  math.js               — Shared mathjs configuration and aliases
  middleware/
    rateLimit.js        — Rate-limiter (per sender, sliding window)
    validate.js         — Input length validation middleware
  commands/
    latex.js            — Command handler for !latex / !tex
    plot.js             — Command handler for !plot (parses range limits)
    solve.js            — Command handler for !solve (dispatch to equations solver)
    diff.js             — Command handler for !diff (dispatch to derivative solver)
    int.js              — Command handler for !int (dispatch to integral solver)
    ode.js              — Command handler for !ode (dispatch to ODE solver)
    desp.js             — Command handler for !desp (dispatch to rearrange solver)
    chem.js             — Command handler for !chem
    tikz.js             — Command handler for !tikz
    help.js             — Help menu menu documentation string
  renderer/
    index.js            — Renderer entrypoint and fallback logic
    katex.js            — Puppeteer browser lifecycle and KaTeX card renderer
    plot.js             — Plotting and ODE graph rendering coordinate math
    codecogs.js         — Web API fallback renderer
    quicklatex.js       — Chemfig and TikZ QuickLaTeX rendering
    template.html       — Canvas HTML template file
  solver/
    index.js            — Solver package entrypoint re-exporting functions
    subprocess.js       — Spawns Python subprocesses
    equations.js        — Numerical & symbolic equation solvers
    calculus.js         — Calculus parsing & solver helpers
    ode.js              — ODE parsing & solver helpers
    rearrange.js        — Rearrange solver helpers
python/
  math_utils.py         — Shared Python parser dictionary and transformations
  calculus_solver.py    — Symbolic differentiation and integration via SymPy
  ode_solver.py         — Symbolic and numerical ODE solvers
  rearrange_solver.py   — Symbolic variable isolation via SymPy
tests/
  test-render.js        — Renderer and plotting integration test suite
  test-solver.js        — Equation solver unit tests
  test-calculus.js      — Calculus solver tests
  test-ode.js           — ODE solver tests
  test-rearrange.js     — Rearrange solver tests
test_output/            — PNG output from test runs (gitignored)
.wwebjs_auth/           — WhatsApp session files (gitignored, generated on first run)
.wwebjs_cache/          — Puppeteer cache (gitignored)
Docs/
  step_by_step_guide.md — Architecture walkthrough and learning notes
```

---

## Architecture

```
WhatsApp user
    │  sends message
    ▼
bot.js  ─── parses command prefix ────────────────────────────────────────────────────────┐
    │                                                                                      │
    ├─► !latex / !tex / $$ ... $$                                                          │
    │       └─► handleLatexCommand() ──► renderer.render()                                 │
    │               ├─► Puppeteer + KaTeX (local, primary)                                 │
    │               └─► Codecogs API (fallback)                                            │
    │                                                                                      │
    ├─► !chem / !chemfig                                                                   │
    │       └─► handleChemCommand() ──► renderer.renderChem() ──► QuickLaTeX API           │
    │                                                                                      │
    ├─► !tikz / \begin{tikzpicture}                                                        │
    │       └─► handleTikzCommand() ──► renderer.renderTikz() ──► QuickLaTeX API           │
    │                                                                                      │
    ├─► !plot                                                                              │
    │       └─► handlePlotCommand() ──► renderer.renderPlot() ──► canvas drawing           │
    │                                                                                      │
    ├─► !solve                                                                             │
    │       └─► handleSolveCommand() ──► solver.solveEquation() ──► renderer.render()      │
    │                                                                                      │
    ├─► !diff                                                                              │
    │       └─► handleDiffCommand() ──► solver.solveDerivative()                           │
    │               ├─► mathjs.derivative (fast path)                                      │
    │               └─► python/calculus_solver.py via subprocess (SymPy fallback)          │
    │                                                                                      │
    ├─► !int                                                                               │
    │       └─► handleIntCommand() ──► solver.solveIntegral() ──► python/calculus_solver.py│
    │                                                                                      │
    ├─► !ode                                                                               │
    │       └─► handleOdeCommand() ──► solver.solveOde() ──► python/ode_solver.py          │
    │               └─► renderer.renderOde()                                               │
    │                                                                                      │
    └─► !desp                                                                              │
            └─► handleRearrangeCommand() ──► solver.rearrangeEquation() ──► python/...     │
```

All Python subprocesses are called by `src/solver/subprocess.js` via `runSubprocess()`. The payload is passed over **stdin as JSON**, and the result is returned on **stdout as JSON**. There is a 30-second timeout and a 512 KB output cap.

---

## Command reference (from bot.js)

| Command | Aliases | Handler | Module |
|---|---|---|---|
| `!latex <formula>` | `!tex` | `handleLatexCommand()` | [`src/commands/latex.js`](src/commands/latex.js) |
| `$$..$$` (anywhere in message) | — | `renderMixed()` | [`bot.js`](bot.js) |
| `!chem <chemfig code>` | `!chemfig` | `handleChemCommand()` | [`src/commands/chem.js`](src/commands/chem.js) |
| `!tikz <code>` | `\begin{tikzpicture}` | `handleTikzCommand()` | [`src/commands/tikz.js`](src/commands/tikz.js) |
| `!plot <expr> [xRange] [yRange]` | — | `handlePlotCommand()` | [`src/commands/plot.js`](src/commands/plot.js) |
| `!solve <equation(s)>` | — | `handleSolveCommand()` | [`src/commands/solve.js`](src/commands/solve.js) |
| `!diff <expr> [var]` | — | `handleDiffCommand()` | [`src/commands/diff.js`](src/commands/diff.js) |
| `!int <expr> [var] [lo] [hi]` | — | `handleIntCommand()` | [`src/commands/int.js`](src/commands/int.js) |
| `!ode [-s\|-n] <ode>, <IC> [range]` | — | `handleOdeCommand()` | [`src/commands/ode.js`](src/commands/ode.js) |
| `!desp <equation> for <var>` | — | `handleRearrangeCommand()` | [`src/commands/desp.js`](src/commands/desp.js) |
| `!help` | — | `helpText` | [`src/commands/help.js`](src/commands/help.js) |

---

## Key design rules

### 1. Config is the single source of truth for styling
All colors, fonts, padding, and graph options live in [`config.js`](config.js). Never hardcode visual values inside `src/renderer/katex.js` or command handlers. The renderer reads `config.style` and `config.style.graph` at `initialize()` time.

### 2. Rendering pipeline
- **Primary path:** Puppeteer + KaTeX (local, fast, styled card with watermark).
- **Fallback path:** Codecogs API (plain PNG, no card). Enabled/disabled via `config.bot.useFallback`. See [`src/renderer/codecogs.js`](src/renderer/codecogs.js).
- **External LaTeX path:** QuickLaTeX API for `!chem` and `!tikz` — these require a full LaTeX distribution that we don't bundle. The resulting PNG is embedded into the card if Puppeteer is available. See [`src/renderer/quicklatex.js`](src/renderer/quicklatex.js).

Never call `renderFallback()` directly from `bot.js`; go through `renderer.render()` in [`src/renderer/index.js`](src/renderer/index.js) which handles the fallback automatically.

### 3. Python subprocesses are isolated and sandboxed
Each call to `runSubprocess()` in [`src/solver/subprocess.js`](src/solver/subprocess.js) spawns a fresh Python process, writes JSON to stdin, reads JSON from stdout, and kills the process after 30 seconds. Variable names are validated before being passed to SymPy to prevent injection.

When adding new Python scripts:
- Accept input via `json.loads(sys.stdin.read())`
- Output exactly one line to stdout: `print(json.dumps({...}))`
- Always include `"success": true/false` in the response
- Return `"error": "<message>"` on failure — never let Python exceptions propagate silently

### 4. Rate limiting and input validation
Both are enforced as middleware before any rendering or calculation dispatch:
- **Rate limit:** 10 requests per 60-second window per sender (`isRateLimited(senderId)`). See [`src/middleware/rateLimit.js`](src/middleware/rateLimit.js).
- **Length cap:** 4000 characters (`validateInputLength(formula)`). See [`src/middleware/validate.js`](src/middleware/validate.js).

Do not add new entry points in `bot.js` that bypass these checks.

### 5. Math function aliases
Trigonometric/logarithmic aliases are imported globally from [`src/math.js`](src/math.js), which configures a single mathjs instance. If you add a new alias, add it there. The Python scripts import their base dictionary from [`python/math_utils.py`](python/math_utils.py) — update that too if the alias should work in symbolic mode.

### 6. Canvas drawing is done in-browser
The canvas drawing code (`drawGraphOnCanvas`) lives inside [`src/renderer/template.html`](src/renderer/template.html) and executes in the Puppeteer page context via `page.evaluate()`. To change plot rendering behavior, edit `template.html`.

### 7. QuickLaTeX SSRF guard
Before fetching the image URL returned by QuickLaTeX, the code validates that:
1. The URL parses successfully
2. The protocol is `https:`
3. The hostname is in `QUICKLATEX_ALLOWED_HOSTS` (`Set(['quicklatex.com', 'www.quicklatex.com'])`)

Do not remove or weaken this check in [`src/renderer/quicklatex.js`](src/renderer/quicklatex.js).

---

## Running and testing

```bash
# Install dependencies (pulls KaTeX, Puppeteer/Chromium, mathjs, whatsapp-web.js)
npm install

# Test the renderer locally — writes PNGs to test_output/, no WhatsApp connection needed
npm test
# or individual test scripts:
node tests/test-render.js
node tests/test-solver.js
node tests/test-calculus.js
node tests/test-ode.js
node tests/test-rearrange.js

# Run the bot (scan QR in terminal on first run)
npm start
```

**Python requirements** (for `!diff`, `!int`, `!ode`, `!desp`):
```
sympy
numpy
scipy
```
Install with `pip install sympy numpy scipy`.

---

## Configuration reference (`config.js`)

| Key | Description |
|---|---|
| `style.backgroundColor` | Card background color (hex) |
| `style.textColor` | Text/formula color (hex) |
| `style.fontSize` | KaTeX render font size |
| `style.fontFamily` | CSS font stack for the card |
| `style.padding` | Card inner padding |
| `style.borderRadius` | Card corner radius |
| `style.border` | Card border (CSS value) |
| `style.boxShadow` | Card shadow |
| `style.watermark.text` | Watermark string (set to `''` to disable) |
| `style.watermark.color` | Watermark text color |
| `style.graph.width/height` | Canvas dimensions in pixels |
| `style.graph.gridColor` | Grid line color |
| `style.graph.axisColor` | Axis line color |
| `style.graph.curveColors` | Array of curve colors (cycles through) |
| `style.graph.glowColor` | Glow/shadow color for curves |
| `style.graph.lineWidth` | Stroke width for curves |
| `style.graph.defaultXDomain` | Default x-axis range `[min, max]` |
| `style.graph.defaultYDomain` | Default y-axis range `[min, max]` |
| `bot.name` | Bot display name (logged at startup) |
| `bot.autoRenderBlock` | Auto-render `$$...$$` in any message (`true`/`false`) |
| `bot.errorPrefix` | Prefix for error reply messages |
| `bot.useFallback` | Enable Codecogs API fallback |
| `bot.fallbackEngine` | Fallback engine identifier (currently `'codecogs'`) |
| `puppeteer.launchArgs.headless` | `'new'` for headless, `false` to open a browser window |
| `puppeteer.launchArgs.args` | Extra Chromium flags (e.g. `['--no-sandbox']` on Linux) |

---

## Adding a new command

1. Add a `parseCommand(body, '!newcmd')` call in the `message_create` listener in [`bot.js`](bot.js).
2. Add the corresponding `else if` branch to set `mode` and `input`.
3. Create a command handler file `src/commands/newcmd.js` and implement the logic there, exporting the handler.
4. Import and wire the command handler in [`bot.js`](bot.js) to resolve when the message is triggered.
5. If it needs symbolic computation, add a Python script to the `python/` directory that reads JSON from stdin and writes JSON to stdout, then call it via `runSubprocess()` (imported from `src/solver/subprocess.js`).
6. Add the command to the `!help` text in [`src/commands/help.js`](src/commands/help.js).
7. Write a test script under `tests/` that exercises the function directly.

---

## Common gotchas

- **`await` is required** for all Puppeteer calls, subprocess calls, and `msg.reply()`. Forgetting it causes silent failures.
- **KaTeX template path:** The HTML template is written to `node_modules/katex/dist/render_temp.html` at startup by `src/renderer/katex.js` so that relative font paths resolve. This file is regenerated on every startup; do not edit it directly.
- **Session files:** `.wwebjs_auth/` stores the WhatsApp session. Delete this folder to force a new QR scan.
- **Puppeteer sandbox:** On some Linux servers you need `args: ['--no-sandbox', '--disable-setuid-sandbox']` in `config.puppeteer.launchArgs.args`.
- **Python path:** `src/solver/subprocess.js` calls `python` (not `python3`). Make sure `python` resolves to Python 3 in your environment.
- **SymPy uppercase symbols:** The shared Python local dictionary in `python/math_utils.py` pre-maps all uppercase letters A–Z to `sympy.Symbol` to prevent SymPy from interpreting `E` as Euler's number or `I` as the imaginary unit when they appear as variables in user input.
