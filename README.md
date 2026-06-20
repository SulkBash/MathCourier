# WhatsApp LaTeX Render Bot

WhatsApp bot that renders LaTeX equations into images. Works in group chats and DMs.

Uses a local headless browser (Puppeteer + KaTeX) for fast rendering, with a Codecogs API fallback if Puppeteer breaks.

## What it does

- `!latex <formula>` / `!tex <formula>` renders a single equation
- `$$ ... $$` in any message auto-renders the equation in context with surrounding text
- `!chem <chemfig code>` draws molecular structures via QuickLaTeX
- `!tikz <code>` renders TikZ diagrams via QuickLaTeX
- `!plot <expr>` plots functions, vector fields, and implicit equations
- `!solve <equation(s)>` solves algebraic equations or square systems
- `!diff` / `!int` differentiate and integrate expressions symbolically, including line, surface, and volume integrals
- `!grad` / `!lap` / `!div` / `!curl` compute vector differential operators in 2D or 3D
- `!ode` solves differential equations symbolically or numerically and graphs trajectories
- `!desp <eq> for <var>` isolates a target variable symbolically

Output is a dark-themed card with rounded corners, drop shadows, and a small watermark. It looks good on both light and dark WhatsApp themes.

## Setup

**Prerequisites:**
- Node.js v18+
- Python 3 with `sympy`, `numpy`, `scipy` for the calculus, ODE, and rearrange solvers

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

1. Scan the QR code in the terminal with WhatsApp -> Linked Devices.
2. The session is saved in `.wwebjs_auth/`, so you only scan once.

## Configuration

Edit `config.js` to change:
- Colors, fonts, and shadows via `style.*`
- Watermark via `style.watermark.text` (set to `''` to disable)
- Auto-rendering of `$$` blocks via `bot.autoRenderBlock`
- The fallback API via `bot.useFallback`

## Usage examples

### Equations

```text
!latex \sum_{i=1}^{n} i = \frac{n(n+1)}{2}
```

### Mixed text + math

```text
The Euler identity:
$$e^{i \pi} + 1 = 0$$
connects five fundamental constants.
```

### Chemistry (mhchem)

```text
!latex \ce{CO2 + H2O <=> H2CO3}
```

### Molecular structures (chemfig)

```text
!chem \chemfig{A-B*6(=-=-=-)}
```

### TikZ and circuit diagrams

```text
!tikz
\draw[thick, fill=blue!10] (0,0) circle (1.5);
\node at (0,0) {TikZ Works!};
```

You can also draw circuits using `circuitikz`:

```text
!tikz
\draw (0,0) to[R, l=$R$] (2,0)
      to[C, l=$C$] (2,2)
      to[L, l=$L$] (0,2)
      to[V, l=$V$] (0,0);
```

Or just send a `\begin{tikzpicture}` block directly.

### Plotting

```text
!plot sin(x) * cos(x/2)
!plot x^2 + y^2 = 1
!plot y = ln(x) [-1, 20] [-5, 5]
!plot y = lap("x^3", x) [-3, 3] [-20, 20]
!plot v(x,y) = (gradx("x^2 + y^2", x, y), grady("x^2 + y^2", x, y)) [-3, 3] [-3, 3]
!plot (-y, x) [-5, 5] [-5, 5]
```

Brackets at the end set custom x/y domains.

### Equation Solving

```text
!solve x^2 - 5x + 6 = 0
!solve cos(x) - x = 0
!solve x + y = 5; x - y = 1
```

### Calculus

```text
!diff x^2 * sin(x)
!int sin(x) x 0 pi
!int line (-y, x) path (cos(t), sin(t)) [0, 2*pi]
!int surface (0, 0, z) surface (sin(u)*cos(v), sin(u)*sin(v), cos(u)) [0, pi] [0, 2*pi]
!int volume x*y*z [0, 1] [0, 2] [0, 3]
```

### Vector Differential Operators

```text
!grad x^2 * y * z
!grad x^2 + y^2, x, y
!lap x^2 + y^2, x, y
!div (x^2, y^2, z^2)
!curl (-y, x, 0)
!plot3d z = lap("x^2 + y^2", x, y) [-3, 3] [-3, 3] [0, 8]
!plot3d F(x,y,z) = (-y, x, z/2) [-4, 4] [-4, 4] [-4, 4]
!plot3d (-y, x, z/2) [-4, 4] [-4, 4] [-4, 4]
```

### Differential Equations (ODEs)

```text
!ode dy/dx = -y, y(0) = 1
!ode y'' + y = 0, y(0) = 1, y'(0) = 0 [-10, 10]
```

### Variable Isolation

```text
!desp E = m * c^2 for c
```
