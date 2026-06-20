# WhatsApp LaTeX Render Bot

WhatsApp bot that renders LaTeX equations into images. Works in group chats and DMs.

Uses a local headless browser (Puppeteer + KaTeX) for fast rendering, with a Codecogs API fallback if Puppeteer breaks.

## What it does

- `!latex <formula>` / `!tex <formula>` — renders a single equation
- `$$ ... $$` in any message — auto-renders the equation in context with surrounding text
- `!chem <chemfig code>` — draws molecular structures (via QuickLaTeX)
- `!tikz <code>` — renders TikZ diagrams (via QuickLaTeX)
- `!plot <expr>` — plots functions, vector fields, and implicit equations
- `!solve <equation(s)>` — solves algebraic equations or square systems
- `!diff` / `!int` — differentiates/integrates expressions symbolically
- `!ode` — solves differential equations symbolically/numerically and graphs trajectories
- `!desp <eq> for <var>` — isolates a target variable symbolically

Output is a dark-themed card with rounded corners, drop shadows, and a small watermark. Looks nice on both light and dark WhatsApp themes.

## Setup

**Prerequisites:** 
- Node.js v18+
- Python 3 with `sympy`, `numpy`, `scipy` (required for calculus, ODE, and rearrange solvers)

```bash
# Install Node dependencies
npm install

# Install Python packages
pip install sympy numpy scipy
```

Node dependencies include KaTeX, Puppeteer (with Chromium), mathjs, and whatsapp-web.js.

### Test rendering locally

```bash
npm test
```

Writes test images to `test_output/`. Good for checking that Puppeteer and KaTeX are working without connecting to WhatsApp.

### Run the bot

```bash
npm start
```

1. Scan the QR code in the terminal with WhatsApp → Linked Devices.
2. Session is saved in `.wwebjs_auth/`, so you only scan once.

## Configuration

Edit `config.js` to change:
- **Colors/fonts/shadows** — `style.*`
- **Watermark** — `style.watermark.text` (set to `''` to disable)
- **Auto-render `$$`** — `bot.autoRenderBlock` (default: `true`)
- **Fallback API** — `bot.useFallback`

## Usage examples

### Equations
```
!latex \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
```

### Mixed text + math
```
The Euler identity:
$$e^{i \pi} + 1 = 0$$
connects five fundamental constants.
```

### Chemistry (mhchem)
```
!latex \ce{CO2 + H2O <=> H2CO3}
```

### Molecular structures (chemfig)
```
!chem \chemfig{A-B*6(=-=-=-)}
```

### TikZ & Circuit diagrams
```
!tikz
\draw[thick, fill=blue!10] (0,0) circle (1.5);
\node at (0,0) {TikZ Works!};
```

You can also draw circuits using `circuitikz`:
```
!tikz
\draw (0,0) to[R, l=$R$] (2,0)
      to[C, l=$C$] (2,2)
      to[L, l=$L$] (0,2)
      to[V, l=$V$] (0,0);
```

Or just send a `\begin{tikzpicture}` block directly.

### Plotting
```
!plot sin(x) * cos(x/2)
!plot x^2 + y^2 = 1
!plot y = ln(x) [-1, 20] [-5, 5]
```

Brackets at the end set custom x/y domains.

### Equation Solving
```
!solve x^2 - 5x + 6 = 0
!solve cos(x) - x = 0
!solve x + y = 5; x - y = 1
```

### Calculus
```
!diff x^2 * sin(x)
!int sin(x) x 0 pi
```

### Differential Equations (ODEs)
```
!ode dy/dx = -y, y(0) = 1
!ode y'' + y = 0, y(0) = 1, y'(0) = 0 [-10, 10]
```

### Variable Isolation
```
!desp E = m * c^2 for c
```
