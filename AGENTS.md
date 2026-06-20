# AGENTS.md - LaTeXRender WhatsApp Bot

This file explains the project layout, how the pieces connect, and the rules to follow when working on this codebase.

---

## Project overview

A WhatsApp bot that receives math-related commands and replies with rendered cards, plots, and solver output. It runs locally after the user scans a QR code once. Most replies are PNG images, and animated `!plot3d` requests can return MP4 output.

**Core capabilities:**
- Render LaTeX / KaTeX formulas as styled dark-theme cards
- Auto-render inline `$$ ... $$` blocks in ordinary chat messages
- Plot 2D explicit functions, implicit equations, parametric curves, polar curves, and vector fields
- Plot 3D explicit surfaces, implicit surfaces, parametric curves/surfaces, and vector fields with optional camera animation
- Solve equations and linear systems numerically or symbolically
- Differentiate and integrate expressions, including multivariable and field-integral workflows
- Compute gradient, Laplacian, divergence, and curl
- Compute matrix arithmetic, determinants, inverses, eigenvalues/eigenvectors, and RREF
- Solve ODEs symbolically or numerically
- Rearrange equations to isolate a variable
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
    latex.js            - Command handler for !latex / !tex
    plot.js             - Command handler for !plot
    plot3d.js           - Command handler for !plot3d and animation flags
    solve.js            - Command handler for !solve
    matrix.js           - Command handler for !matrix
    diff.js             - Command handler for !diff
    int.js              - Command handler for !int
    ode.js              - Command handler for !ode
    desp.js             - Command handler for !desp
    grad.js             - Command handler for !grad
    lap.js              - Command handler for !lap
    div.js              - Command handler for !div
    curl.js             - Command handler for !curl
    chem.js             - Command handler for !chem / !chemfig
    tikz.js             - Command handler for !tikz
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
    equations.js        - Equation and linear-system solvers
    calculus.js         - Differentiation/integration parsing and dispatch
    ode.js              - ODE parsing and solver helpers
    rearrange.js        - Rearrangement / isolation helpers
    vector.js           - Gradient, Laplacian, divergence, and curl solvers
    matrix.js           - Matrix parsing and linear algebra helpers
python/
  math_utils.py         - Shared SymPy parser local_dict and inline helper definitions
  calculus_solver.py    - SymPy calculus and field-integral backend
  ode_solver.py         - SymPy / SciPy ODE backend
  rearrange_solver.py   - SymPy variable-isolation backend
tests/
  test-render.js        - Renderer and 2D plotting integration test suite
  test-plot3d.js        - 3D plotting tests
  test-solver.js        - Equation solver tests
  test-calculus.js      - Calculus solver tests
  test-ode.js           - ODE solver tests
  test-rearrange.js     - Rearrangement solver tests
  test-vector.js        - Vector-operator solver tests
  test-matrix.js        - Matrix solver tests
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
    !latex / !tex / $$...$$      -> commands/latex.js -> renderer.render()
    !chem / !chemfig             -> commands/chem.js  -> renderer.renderChem()
    !tikz / tikzpicture block    -> commands/tikz.js  -> renderer.renderTikz()
    !plot                        -> commands/plot.js  -> renderer.renderPlot()
    !plot3d                      -> commands/plot3d.js -> renderer.renderPlot3d()
    !solve                       -> commands/solve.js -> solver.solveEquation() -> renderer.render()
    !matrix                      -> commands/matrix.js -> solver.solveMatrixExpression() -> renderer.render()
    !diff                        -> commands/diff.js  -> solver.solveDerivative() -> renderer.render()
    !int                         -> commands/int.js   -> solver.solveIntegral() -> renderer.render()
    !ode                         -> commands/ode.js   -> solver.solveOde() -> renderer.renderOde()
    !grad / !lap / !div / !curl  -> commands/*        -> solver.vector helpers -> renderer.render()
    !desp                        -> commands/desp.js  -> solver.rearrangeEquation() -> renderer.render()

Solver backends
    Pure JS / mathjs:
      - equations, matrices, vector differential operators
      - many local inline helpers used by !plot and !plot3d
    Python bridge:
      - symbolic calculus fallback
      - line/surface/volume integrals
      - ODE solving
      - symbolic rearrangement

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
| `!latex <formula>` | `!tex` | `handleLatexCommand()` | `src/commands/latex.js` |
| `$$ .. $$` anywhere in a message | none | `renderMixed()` | `bot.js` |
| `!chem <chemfig code>` | `!chemfig` | `handleChemCommand()` | `src/commands/chem.js` |
| `!tikz <code>` | `\begin{tikzpicture}` | `handleTikzCommand()` | `src/commands/tikz.js` |
| `!plot <expr> [xRange] [yRange]` | none | `handlePlotCommand()` | `src/commands/plot.js` |
| `!plot3d [-a[angle]\|-ax[angle]\|-ay[angle]\|-az[angle]] <expr> [ranges]` | none | `handlePlot3dCommand()` | `src/commands/plot3d.js` |
| `!solve <equation(s)>` | none | `handleSolveCommand()` | `src/commands/solve.js` |
| `!matrix <expression>` | none | `handleMatrixCommand()` | `src/commands/matrix.js` |
| `!diff <expr> [variables/orders]` | none | `handleDiffCommand()` | `src/commands/diff.js` |
| `!int <expr> [variables/limits]` | none | `handleIntCommand()` | `src/commands/int.js` |
| `!ode [options] <equation(s)>, <IC(s)> [ranges]` | none | `handleOdeCommand()` | `src/commands/ode.js` |
| `!grad <scalar_field> [, vars]` | none | `handleGradCommand()` | `src/commands/grad.js` |
| `!lap <scalar_field> [, vars]` | none | `handleLapCommand()` | `src/commands/lap.js` |
| `!div <vector_field> [, vars]` | none | `handleDivCommand()` | `src/commands/div.js` |
| `!curl <vector_field> [, vars]` | none | `handleCurlCommand()` | `src/commands/curl.js` |
| `!desp <equation> for <var>` | none | `handleRearrangeCommand()` | `src/commands/desp.js` |
| `!help` | none | `helpText` | `src/commands/help.js` |

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
- symbolic calculus fallback
- field integrals
- ODE solving
- symbolic rearrangement

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
- flag parsing for animation options lives in `src/commands/plot3d.js`

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
node tests/test-solver.js
node tests/test-calculus.js
node tests/test-ode.js
node tests/test-rearrange.js
node tests/test-plot3d.js
node tests/test-render.js

# Run the bot
npm start
```

**Python requirements** (needed for symbolic calculus fallback, field integrals, ODEs, and rearrangement):

```bash
pip install sympy numpy scipy
```

**Optional runtime dependency for animated 3D output:**
- `ffmpeg` is used by `src/renderer/plot3d.js` to assemble MP4 animations.
- If `ffmpeg` is unavailable, animated `!plot3d` requests gracefully fall back to a static image preview.

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

## Adding a new command

1. Add a `parseCommand(body, '!newcmd')` call inside `handleCommandMessage()` in `bot.js`.
2. Add the corresponding `else if` branch that sets `mode` and `input`.
3. Create `src/commands/newcmd.js` and export a handler.
4. Import the handler in `bot.js` and wire it into the dispatch block.
5. If the command needs shared solver logic, add it under `src/solver/` and export it from `src/solver/index.js`.
6. If it needs Python, add a script under `python/` that follows the JSON subprocess contract and call it through `runSubprocess()` in `src/solver/subprocess.js`.
7. Update `src/commands/help.js`.
8. Add a focused test under `tests/`.

If the new command renders media, return renderer-style objects with `success`, `data`, and metadata fields instead of replying directly from the command layer.

---

## Common gotchas

- `await` is required for Puppeteer calls, subprocess calls, and `msg.reply()`.
- The bot listens to both `message` (incoming) and `message_create` (messages sent by the current account). Keep command parsing centralized in `handleCommandMessage()`.
- `src/renderer/index.js` uses a lock for shared-page rendering. Do not introduce parallel work that mutates the singleton KaTeX page outside that lock.
- `!plot3d` does not use the shared render lock; it uses isolated pages plus a concurrency cap.
- Animated 3D renders depend on `ffmpeg`; if you are debugging animation output, check whether the environment has it installed.
- The KaTeX HTML file written into `node_modules/katex/dist/render_temp.html` is generated at startup. Do not edit it directly.
- Matrix literals use semicolon-separated rows: `[1, 2; 3, 4]`.
- `src/solver/subprocess.js` calls `python`, not `python3`. Make sure `python` resolves to Python 3.
- `python/math_utils.py` pre-maps uppercase `A-Z` to `sympy.Symbol` so SymPy does not reinterpret letters like `E` and `I`.
- Delete `.wwebjs_auth/` to force a fresh QR scan.

