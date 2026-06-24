# AGENTS.md - LaTeXRender WhatsApp Bot

This file explains the project layout, how the pieces connect, and the rules to follow when working on this codebase.

---

## Project overview

A WhatsApp bot that receives math-related commands and replies with rendered cards, plots, and solver output. It runs locally after the user scans a QR code once. Most replies are PNG images, and animated `!plot view:3d ...` requests can return MP4 output.

**Core capabilities:**
- Render LaTeX / KaTeX formulas as styled dark-theme cards
- Auto-render inline `$$ ... $$` blocks in ordinary chat messages
- Plot 2D explicit functions, implicit equations, parametric curves, polar curves, and vector fields
- Plot 3D explicit surfaces, implicit surfaces, parametric curves/surfaces, and vector fields with optional camera animation
- Solve equations, inequalities, and linear systems numerically or symbolically
- Isolate variables symbolically through `!solve ... vars:<var>`
- Differentiate and integrate expressions, including multivariable and field-integral workflows
- Compute gradient, Laplacian, divergence, and curl
- Compute matrix arithmetic, determinants, inverses, eigenvalues/eigenvectors, and RREF
- Solve ODEs symbolically or numerically
- Render chemfig structures and TikZ/circuit diagrams through QuickLaTeX

---

## File map

```text
config.js               - Visual style, graph settings, bot behavior, and 3D animation knobs
bot.js                  - WhatsApp client, message routing, middleware checks, command dispatch
package.json            - Node.js dependencies and npm scripts
roadmap.md              - Feature roadmap / milestone planning
src/
  math.js               - Shared mathjs instance, aliases, and inline helper functions
  middleware/
    rateLimit.js        - Per-sender sliding-window rate limiter
    validate.js         - Input length validation middleware
  commands/
    latex.js            - Unified !latex router for formulas, chemfig, and TikZ
    plot.js             - Unified !plot handler, including 3D via view:3d
    plot3d.js           - Legacy compatibility wrapper for deprecated !plot3d syntax
    solve.js            - Unified !solve router for algebra, calculus, matrices, ODEs, and PDEs
    ode.js              - Internal ODE sub-route used by !solve
    pde.js              - Internal PDE sub-route used by !solve
    help.js             - Help menu text
  renderer/
    index.js            - Renderer entrypoint, lock management, and fallback routing
    katex.js            - Shared Puppeteer page lifecycle and KaTeX card rendering
    plot.js             - 2D plotting, vector field rendering, and ODE plot rendering
    plot3d.js           - 3D Plotly rendering, sampling, and animation capture
    codecogs.js         - Codecogs fallback renderer for LaTeX images
    quicklatex.js       - QuickLaTeX rendering for chemfig and TikZ
    template.html       - Browser-side drawing and Plotly helper template
  solver/
    index.js            - Solver entrypoint re-exporting all solver functions
    subprocess.js       - Python subprocess bridge (JSON over stdin/stdout)
    equations.js        - Equation, inequality, isolation, and expression-mode solvers
    calculus.js         - Differentiation/integration parsing and dispatch
    ode.js              - ODE parsing and solver helpers
    pde.js              - PDE parsing and solver helpers
    vector.js           - Gradient, Laplacian, divergence, and curl solvers
    matrix.js           - Matrix parsing and linear algebra helpers
python/
  math_utils.py         - Shared SymPy parser local_dict and inline helper definitions
  equation_solver.py    - Unified SymPy backend for symbolic solving and expression modes
  calculus_solver.py    - SymPy calculus and field-integral backend
  ode_solver.py         - SymPy / SciPy ODE backend
  pde_solver.py         - SymPy / numerical PDE backend
tests/
  test-render.js        - Renderer and 2D plotting integration test suite
  test-plot3d.js        - 3D plotting tests
  test-solver.js        - Equation solver tests
  test-solve-router.js  - Unified !solve routing tests
  test-latex-router.js  - Unified !latex routing tests
  test-calculus.js      - Calculus solver tests
  test-ode.js           - ODE solver tests
  test-pde.js           - PDE solver tests
  test-vector.js        - Vector-operator solver tests
  test-matrix.js        - Matrix solver tests
  test-help.js          - Help command unit tests
  test-parser.js        - Command syntax parser tests
  test-labeled-domains.js - Labeled domain integration tests
  test-inline-calculus.js - Inline helper tests
test_output/            - Generated render output (gitignored)
.wwebjs_auth/           - WhatsApp session files (gitignored)
.wwebjs_cache/          - Puppeteer cache (gitignored)
Docs/
  step_by_step_guide.md - Architecture walkthrough and learning notes
```

---

## Architecture

```text
WhatsApp user
    |
    v
bot.js
    -> parses command prefix / auto-detects $$...$$
    -> applies rate limit + input validation
    -> dispatches to command handler

Commands
    !latex / !tex / !chem / !tikz / $$...$$
        -> commands/latex.js -> renderer.render() / renderChem() / renderTikz()
    !plot
        -> commands/plot.js -> renderer.renderPlot() / renderer.renderPlot3d()
    !solve / legacy math aliases
        -> commands/solve.js
        -> auto-detects equation vs matrix vs ODE vs PDE vs helper route
        -> solver.* and renderer.*

Solver backends
    Pure JS / mathjs:
      - equations, matrices, vector differential operators
      - many local inline helpers used by !plot
    Python bridge:
      - symbolic equation solving, inequalities, and isolation
      - symbolic calculus fallback
      - line/surface/volume integrals
      - ODE solving

Renderer backends
    Shared Puppeteer page + KaTeX:
      - LaTeX cards, mixed text, 2D plots, ODE cards, chem/tikz card composition
    Isolated Puppeteer pages + Plotly:
      - 3D surfaces, 3D curves, 3D vector fields, MP4 camera animations
    External fallbacks:
      - Codecogs for formula image fallback
      - QuickLaTeX for chemfig / TikZ source rendering
```

All Python subprocesses are called by `src/solver/subprocess.js` via `runSubprocess()`. Payloads are passed over stdin as JSON, and results must come back on stdout as JSON. The bridge enforces a 30-second timeout and a 512 KB stdout limit.

---

## Command reference

| Command | Aliases | Handler | Module |
|---|---|---|---|
| `!latex <content>` | `!tex`, `!chem`, `!chemfig`, `!tikz`, bare `\begin{tikzpicture}`, inline `$$...$$` auto-render | `handleLatexCommand()` / `renderMixed()` | `src/commands/latex.js`, `bot.js` |
| `!plot <expr> [options]` | `!plot3d` compatibility wrapper | `handlePlotCommand()` | `src/commands/plot.js` |
| `!solve <expression> [options]` | `!diff`, `!int`, `!grad`, `!lap`, `!div`, `!curl`, `!matrix`, `!ode`, `!pde` | `handleSolveCommand()` | `src/commands/solve.js` |
| `!help [topic]` | none | `getHelp()` | `src/commands/help.js` |

---

## Key design rules

### 1. Config is the source of truth for visual and runtime tuning
Keep styling, graph defaults, and 3D animation/concurrency settings in `config.js`. Do not hardcode colors, fonts, graph dimensions, or 3D animation constants inside command handlers.

### 2. Use the renderer entrypoint instead of calling internals directly
`src/renderer/index.js` owns lock management and fallback behavior.

- `render()` is for LaTeX card output and API fallback handling.
- `renderPlot()` and `renderOde()` run under the shared singleton-page lock.
- `renderPlot3d()` is intentionally outside that lock because 3D renders use isolated Puppeteer pages.

Do not bypass this layer from `bot.js`.

### 3. The project is JS-first, with Python for heavy symbolic work
Prefer pure Node.js / mathjs when the task is fast and local:
- equations
- matrices
- vector differential operators
- inline helpers used by plots

Use the Python bridge only where it adds real value:
- symbolic equation solving and exact expression modes
- symbolic calculus fallback
- field integrals
- ODE solving

### 3.5. The public command surface is intentionally tiny
User-facing commands are `!latex`, `!plot`, `!solve`, and `!help`.

- New rendering features should usually become a `!latex` mode or auto-detected branch.
- New math features should usually become a `!solve` sub-route, inline helper, or solver backend.
- Prefer extending the unified routers over adding new top-level command prefixes.

### 4. Python subprocesses must follow the JSON contract exactly
When adding a new Python solver:
- read input with `json.loads(sys.stdin.read())`
- write exactly one JSON payload to stdout
- include `"success": true/false`
- return `"error": "<message>"` on failure
- do not rely on interactive prompts or side channels

### 5. Keep JS and Python math registries aligned
Aliases and inline math helpers live in two places:
- `src/math.js`
- `python/math_utils.py`

If a helper should work in both local JS evaluation and symbolic Python evaluation, add it to both.

### 6. 2D plotting and 3D plotting live in different layers
For 2D plotting behavior:
- parsing/render prep lives in `src/renderer/plot.js`
- browser-side drawing behavior lives in `src/renderer/template.html`

For 3D plotting behavior:
- parsing, sampling, coordinate conversions, vector-field generation, and animation live in `src/renderer/plot3d.js`
- public command parsing and animation option handling live in `src/commands/plot.js`

Do not try to implement major 3D math changes inside the 2D template.

### 7. Matrix syntax is custom and semicolon-based
Matrix expressions use literals like `[1, 2; 3, 4]`.

- rows are separated by `;`
- columns are separated by `,`
- parsing and formatting live in `src/solver/matrix.js`

If you extend matrix or tensor-like syntax, keep it compatible with this parser or update the documentation and tests in the same change.

### 8. Middleware checks must stay in front of every command
All command entry points go through:
- rate limiting in `src/middleware/rateLimit.js`
- input length validation in `src/middleware/validate.js`

Do not add a new bot entry path that bypasses `handleCommandMessage()`.

### 8.5. Router precedence is part of the product surface
`src/commands/solve.js` is the unified router for algebra, matrices, ODEs, PDEs, and helper-based math.

- Relational solving takes precedence over matrix evaluation.
- Bare tuples should not be guessed as vector operations inside `!solve`; use a helper or explicit route.
- When updating routing behavior, keep `command_refactor.md`, help text, and router tests in sync.

### 9. QuickLaTeX SSRF protections are mandatory
`src/renderer/quicklatex.js` validates the returned image URL before fetching it. Do not weaken the protocol or hostname checks.

### 10. Help text is part of the product surface
If you add or change a command, update `src/commands/help.js` in the same change. The help file is the live user-facing API summary.

---

## Running and testing

```bash
# Install dependencies
npm install

# Main local renderer / 2D integration test
npm test

# Focused test scripts
npm run test:vector
npm run test:matrix
npm run test:help
npm run test:labeled
node tests/test-help.js
node tests/test-parser.js
node tests/test-labeled-domains.js
node tests/test-solver.js
node tests/test-solve-router.js
node tests/test-latex-router.js
node tests/test-calculus.js
node tests/test-ode.js
node tests/test-pde.js
node tests/test-inline-calculus.js
node tests/test-plot3d.js
node tests/test-render.js

# Run the bot
npm start
```

**Python requirements** (needed for symbolic solving, field integrals, ODEs, and PDEs):

```bash
pip install sympy numpy scipy
```

**Optional runtime dependency for animated 3D output:**
- `ffmpeg` is used by `src/renderer/plot3d.js` to assemble MP4 animations.
- If `ffmpeg` is unavailable, animated `!plot view:3d ...` requests gracefully fall back to a static image preview.

---

## Configuration reference (`config.js`)

| Key | Description |
|---|---|
| `style.backgroundColor` | Card background color |
| `style.textColor` | Card text / formula color |
| `style.fontSize` | KaTeX font size |
| `style.fontFamily` | Card font stack |
| `style.padding` | Card inner padding |
| `style.borderRadius` | Card corner radius |
| `style.border` | Card border CSS value |
| `style.boxShadow` | Card shadow CSS value |
| `style.watermark.*` | Watermark text styling |
| `style.graph.width/height` | 2D card graph canvas size |
| `style.graph.gridColor` | 2D graph grid color |
| `style.graph.axisColor` | 2D graph axis color |
| `style.graph.axisLabelColor` | 2D graph axis label color |
| `style.graph.curveColors` | 2D curve palette |
| `style.graph.glowColor` | 2D curve glow color |
| `style.graph.glowBlur` | 2D curve glow blur |
| `style.graph.lineWidth` | 2D curve line width |
| `style.graph.defaultXDomain` | Default 2D X range |
| `style.graph.defaultYDomain` | Default 2D Y range |
| `style.graph.streamlineConeColor` | 3D streamline arrowhead color |
| `bot.name` | Bot display name |
| `bot.autoRenderBlock` | Auto-render `$$...$$` in any message |
| `bot.errorPrefix` | Error reply prefix |
| `bot.useFallback` | Enable Codecogs fallback |
| `bot.fallbackEngine` | Fallback engine identifier |
| `bot.plot3dMaxConcurrency` | Max simultaneous 3D render jobs |
| `bot.plot3dAnimationFrames` | Default frame count for animated 3D renders |
| `bot.plot3dAnimationFps` | Default FPS for animated 3D renders |
| `bot.plot3dAnimationBaseAngleDegrees` | Base camera angle for 3D views |
| `bot.plot3dAnimationSwingDegrees` | Default swing amplitude for non-orbit animations |
| `bot.plot3dAnimationCameraRadius` | Default 3D camera radius |
| `bot.plot3dAnimationCameraHeight` | Default 3D camera height |
| `puppeteer.launchArgs.headless` | Chromium headless mode |
| `puppeteer.launchArgs.args` | Extra Chromium flags |

---

## Adding a new capability

Prefer extending the unified command surface instead of adding new top-level prefixes.

1. Decide whether the feature belongs under `!latex`, `!plot`, or `!solve`.
2. Extend the relevant router in `src/commands/latex.js`, `src/commands/plot.js`, or `src/commands/solve.js`.
3. If shared solver logic is needed, add it under `src/solver/` and export it from `src/solver/index.js`.
4. If Python is needed, add a script under `python/` that follows the JSON subprocess contract and call it through `runSubprocess()` in `src/solver/subprocess.js`.
5. Update `src/commands/help.js` in the same change.
6. Add focused tests under `tests/`, especially router coverage when auto-detection or mode overrides are involved.

Only add a brand-new top-level command if the product direction explicitly changes away from the unified `!latex` / `!plot` / `!solve` architecture.

---

## Common gotchas

- `await` is required for Puppeteer calls, subprocess calls, and `msg.reply()`.
- The bot listens to both `message` (incoming) and `message_create` (messages sent by the current account). Keep command parsing centralized in `handleCommandMessage()`.
- `src/renderer/index.js` uses a lock for shared-page rendering. Do not introduce parallel work that mutates the singleton KaTeX page outside that lock.
- 3D plots requested through `!plot view:3d` do not use the shared render lock; they use isolated pages plus a concurrency cap.
- Animated 3D renders depend on `ffmpeg`; if you are debugging animation output, check whether the environment has it installed.
- The KaTeX HTML file written into `node_modules/katex/dist/render_temp.html` is generated at startup. Do not edit it directly.
- Matrix literals use semicolon-separated rows: `[1, 2; 3, 4]`.
- Bare tuples under `!solve` are intentionally ambiguous; use helpers like `curl[...]` or force a route with `mode:...`.
- `src/solver/subprocess.js` calls `python`, not `python3`. Make sure `python` resolves to Python 3.
- `python/math_utils.py` pre-maps uppercase `A-Z` to `sympy.Symbol` so SymPy does not reinterpret letters like `E` and `I`.
- Delete `.wwebjs_auth/` to force a fresh QR scan.
