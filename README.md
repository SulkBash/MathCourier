# WhatsApp LaTeX Render Bot

Render equations, plots, solver output, chemistry, and 3D math visuals directly inside WhatsApp.

<p align="center">
  <img src="assets/readme/gaussian-integral.png" alt="Gaussian integral rendered as a dark themed card" width="900">
</p>

A local-first WhatsApp bot built with `whatsapp-web.js`, `Puppeteer`, `KaTeX`, `mathjs`, and Python/SymPy backends. It works in group chats and DMs, turns math commands into polished PNG cards, and can export animated 3D scenes as MP4 clips when `ffmpeg` is available.

## Highlights

- Tiny public command surface: `!latex`, `!plot`, `!solve`, and `!help`
- Auto-render inline `$$ ... $$` blocks inside ordinary chat messages
- 2D plotting for explicit, implicit, parametric, polar, and vector-field expressions
- 3D plotting for surfaces, implicit volumes, curves, vector fields, and camera animations
- Symbolic and numeric solving for algebra, calculus, matrices, ODEs, PDEs, and variable isolation
- Chemistry, `chemfig`, TikZ, and `circuitikz` support through the unified `!latex` command
- Local Puppeteer rendering first, with fallback engines available for resiliency

## Preview

<table>
  <tr>
    <td align="center">
      <img src="assets/readme/plot-overlay.png" alt="2D plot with explicit and implicit curves" width="100%">
      <br>
      <sub><code>!plot y = x^2, x^2 + y^2 = 9</code></sub>
    </td>
    <td align="center">
      <img src="assets/readme/plot-vector-field.png" alt="2D vector field plot" width="100%">
      <br>
      <sub><code>!plot (-y, x) kind:vector x:[-5, 5] y:[-5, 5]</code></sub>
    </td>
    <td align="center">
      <img src="assets/readme/plot3d-torus.png" alt="3D parametric torus surface" width="100%">
      <br>
      <sub><code>!plot (...) view:3d kind:surface vars:{u, v}</code></sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="assets/readme/solve-system.png" alt="Solved linear system rendered as a card" width="100%">
      <br>
      <sub><code>!solve x + y = 5; x - y = 1</code></sub>
    </td>
    <td align="center">
      <img src="assets/readme/circuitikz-diagram.png" alt="Circuitikz diagram rendered as a card" width="100%">
      <br>
      <sub><code>!latex &lt;circuitikz diagram&gt;</code></sub>
    </td>
    <td align="center">
      <img src="assets/readme/chemfig-benzene.png" alt="Chemfig structure rendered as a card" width="100%">
      <br>
      <sub><code>!latex \chemfig{A-B*6(=-=-=-)}</code></sub>
    </td>
  </tr>
</table>

## Command Overview

| Command | Use it for | Example |
| --- | --- | --- |
| `!latex <content>` | Formulas, mixed text, chemistry, `chemfig`, TikZ, and `circuitikz` | `!latex \sum_{i=1}^{n} i = \frac{n(n+1)}{2}` |
| `!plot <expression> [options]` | 2D plots, 3D plots, vector fields, parametric curves, and animation | `!plot z = sin(x)*cos(y) view:3d x:[-3, 3] y:[-3, 3]` |
| `!solve <expression> [options]` | Equations, calculus, matrices, ODEs, PDEs, and variable isolation | `!solve integ[sin(x), x, 0, pi]` |
| `!help [topic]` | Syntax help, command help, helper docs, and option docs | `!help plot` |

## Syntax Tips

- Ranges use brackets: `x:[min, max]`, `y:[min, max]`, `z:[min, max]`
- Scalar options use `key:value`, such as `view:3d` or `kind:vector`
- Grouped options use braces: `vars:{x, y, z}`, `ic:{y(0)=1; y'(0)=0}`
- Semicolons separate systems of equations and matrix rows: `x + y = 5; x - y = 1`, `[1, 2; 3, 4]`
- Use `kind:parametric`, `kind:polar`, or `kind:vector` when a tuple would otherwise be ambiguous

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3 with `sympy`, `numpy`, and `scipy`
- Optional: `ffmpeg` for animated 3D MP4 output

### Install

```bash
npm install
pip install sympy numpy scipy
```

### Smoke-test the renderer

```bash
npm test
```

This writes sample output to `test_output/` so you can verify that Puppeteer, KaTeX, and plotting are working before connecting the bot to WhatsApp.

### Run the bot

```bash
npm start
```

1. Scan the QR code from WhatsApp -> Linked Devices.
2. The login session is stored in `.wwebjs_auth/`, so you normally only scan once.

## Example Commands

### `!latex`

```text
!latex \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
!latex \ce{CO2 + H2O <=> H2CO3}
!latex \chemfig{A-B*6(=-=-=-)}
!latex
\draw (0,0) to[R, l=$R$] (2,0)
      to[C, l=$C$] (2,2)
      to[L, l=$L$] (0,2)
      to[V, l=$V$] (0,0);
```

Another standalone formula example:

```text
!latex \int_0^\infty e^{-x^2} \, dx = \frac{\sqrt{\pi}}{2}
```

### `!plot`

```text
!plot sin(x) * cos(x/2)
!plot x^2 + y^2 = 1
!plot (cos(3*t), sin(2*t)) kind:parametric t:[0, 2*pi]
!plot (-y, x) kind:vector x:[-5, 5] y:[-5, 5]
!plot z = sin(x)*cos(y) view:3d x:[-3, 3] y:[-3, 3]
!plot z = sin(x - t)*cos(y) view:3d animate:t x:[-3, 3] y:[-3, 3] t:[0, 2*pi]
```

### `!solve`

```text
!solve x^2 - 5x + 6 = 0
!solve x + y = 5; x - y = 1
!solve E = m * c^2 vars:c
!solve deriv[x^2 * sin(x), x]
!solve curl[(-y, x, 0), vars:{x, y, z}]
!solve [1, 2; 3, 4] * [2, 0; 1, 2]
!solve dy/dx = -y ic:{y(0)=1}
```

## Configuration

Most runtime and visual tuning lives in [`config.js`](config.js):

- `style.*` controls card colors, typography, padding, graph sizing, and watermark styling
- `bot.*` controls command behavior, auto-rendering, fallbacks, 3D concurrency, and animation defaults
- `puppeteer.launchArgs.*` controls Chromium launch flags

If you want a clean output without branding, set `style.watermark.text` to `''`.

## Architecture At A Glance

```text
WhatsApp message
  -> bot.js
  -> src/commands/{latex,plot,solve}.js
  -> src/renderer/* or src/solver/*
  -> PNG / MP4 reply
```

- `src/renderer/` handles KaTeX cards, 2D plots, 3D Plotly renders, and fallback routing
- `src/solver/` combines fast JS-side math with Python subprocess backends
- `python/*.py` speak JSON over stdin/stdout for symbolic solving, calculus, ODEs, and PDEs

## Troubleshooting

- If QR login gets stuck, delete `.wwebjs_auth/` and start the bot again
- If symbolic solving fails, make sure `python` resolves to Python 3 and `sympy`, `numpy`, and `scipy` are installed
- If animated 3D output falls back to a static image, install `ffmpeg`
- If local rendering fails, check your Chromium/Puppeteer install first by running `npm test`

## License

Released under the [MIT License](LICENSE).
