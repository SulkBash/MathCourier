# WhatsApp LaTeX Render Bot

WhatsApp bot that renders LaTeX equations into images. Works in group chats and DMs.

Uses a local headless browser (Puppeteer + KaTeX) for fast rendering, with a Codecogs API fallback if Puppeteer breaks.

## What it does

- `!latex <content>` renders formulas, chemistry, and diagrams
- `$$ ... $$` in any message auto-renders the equation in context with surrounding text
- `!plot <expr>` plots functions, vector fields, and implicit equations
- `!plot view:3d ...` renders surfaces, implicit volumes, curves, vector fields, and animations
- `!solve <expression>` handles equations, calculus, vector calculus, matrices, ODEs, PDEs, and variable isolation

Output is a dark-themed card with rounded corners, drop shadows, and a small watermark. It looks good on both light and dark WhatsApp themes.

## Setup

**Prerequisites:**
- Node.js v18+
- Python 3 with `sympy`, `numpy`, `scipy` for symbolic solving, calculus, ODEs, and PDEs

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
!latex \chemfig{A-B*6(=-=-=-)}
```

### TikZ and circuit diagrams

```text
!latex
\draw[thick, fill=blue!10] (0,0) circle (1.5);
\node at (0,0) {TikZ Works!};
```

You can also draw circuits using `circuitikz`:

```text
!latex
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
!plot y = ln(x) x:[-1, 20] y:[-5, 5]
!plot y = lap("x^3") x:[-3, 3] y:[-20, 20]
!plot (-y, x) kind:vector x:[-5, 5] y:[-5, 5]
!plot z = sin(x)*cos(y) view:3d x:[-3, 3] y:[-3, 3]
```

Use labeled ranges such as `x:[min, max]`, `y:[min, max]`, and `z:[min, max]`.

### Equation Solving

```text
!solve x^2 - 5x + 6 = 0
!solve cos(x) - x = 0
!solve x + y = 5; x - y = 1
```

### Calculus

```text
!solve deriv[x^2 * sin(x), x]
!solve integ[sin(x), x, 0, pi]
!solve integ[(-y, x), kind:line, param:{cos(t), sin(t)}, t:[0, 2*pi]]
!solve integ[(0, 0, z), kind:surface, param:{sin(u)*cos(v), sin(u)*sin(v), cos(u)}, u:[0, pi], v:[0, 2*pi]]
!solve integ[x*y*z, kind:volume, x:[0, 1], y:[0, 2], z:[0, 3]]
```

### Vector Differential Operators

```text
!solve grad[x^2 * y * z, vars:{x, y, z}]
!solve lap[x^2 + y^2, vars:{x, y}]
!solve div[(x^2, y^2, z^2), vars:{x, y, z}]
!solve curl[(-y, x, 0), vars:{x, y, z}]
!plot z = lap("x^2 + y^2") view:3d x:[-3, 3] y:[-3, 3] z:[0, 8]
!plot F(x,y,z) = (-y, x, z/2) view:3d kind:vector vars:{x, y, z} x:[-4, 4] y:[-4, 4] z:[-4, 4]
```

### Differential Equations (ODEs)

```text
!solve dy/dx = -y ic:{y(0)=1}
!solve y'' + y = 0 ic:{y(0)=1; y'(0)=0} x:[-10, 10]
```

### Variable Isolation

```text
!solve E = m * c^2 vars:c
```
