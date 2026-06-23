const block = (lines) => lines.join('\n');

const generalHelp = block([
    '*LaTeX Render Bot Help*',
    '',
    'A math assistant bot for WhatsApp.',
    'Render LaTeX formulas, plot 2D and 3D functions, solve equations, and compute calculus from chat messages.',
    '',
    'Type `!command` followed by a space and the content you want to send.',
    '',
    '*Commands (use `!help <command>` for details)*',
    '- `!latex <formula>` or `!tex <formula>`',
    '- `$$ ... $$` anywhere in a normal message',
    '- `!chem <chemfig code>`',
    '- `!tikz <drawing code>` or `\\begin{tikzpicture}...\\end{tikzpicture}`',
    '- `!plot <expression> [options]`',
    '- `!solve <equation or system>`',
    '- `!matrix <expression>`',
    '- `!diff <expression> [options]`',
    '- `!int <expression> [options]`',
    '- `!ode <equations> ic:{...} [options]`',
    '- `!pde <pde> ic:{...} bc:{...} [options]`',
    '- `!grad <field>` · `!lap <field>` · `!div <field>` · `!curl <field>`',
    '- `!desp <equation> vars:<var>` or `for <var>`',
    '',
    '*Options* (use `!help <option>` for details)',
    '`view` · `kind` · `camera` · `animate` · `vars` · `mode` · `phase` · `ic` · `bc` · `param`',
    '',
    '*Quick Syntax Rules*',
    '- Ranges use brackets: `key:[min, max]` (e.g. `x:[-5, 5]`)',
    '- Scalar options use `key:value` (e.g. `mode:num`)',
    '- Grouped options use `key:{...}` (e.g. `vars:{x, y}`, `ic:{y(0)=1}`)',
    '- Semicolons separate equations: `!solve x + y = 5; x - y = 1`',
    '- Matrix rows also use semicolons: `[1, 2; 3, 4]`'
]);

const detailedHelp = {
    syntax: block([
        '*Syntax Basics*',
        '',
        'Commands take the form `!command body [options]`.',
        'Do not use parentheses after the command — `!plot y = sin(x)`, not `!plot(y = sin(x))`.',
        '',
        'Structured commands accept one main body followed by labeled options.',
        'Format: `!command <body> key:val key:[min, max] key:{...}`',
        '',
        '*Separators*',
        '- Use commas to separate list elements: `vars:{x, y}`',
        '- Use semicolons to separate complete equations or conditions: `ic:{x(0)=1; y(0)=0}`',
        '- Inside matrix literals, semicolons separate rows: `[1, 2; 3, 4]`',
        '',
        '*Options*',
        '- Range: `x:[-5, 5]`, `t:[0, 2*pi]` (can include math)',
        '- Grouped: `vars:{x, y}`, `ic:{y(0)=1}`',
        '- Scalar: `mode:num`, `view:3d`, `camera:z`, `animate:t`',
        '',
        '*Examples*',
        '- `!plot y = sin(x) x:[-10, 10] y:[-2, 2]`',
        '- `!plot (cos(3*t), sin(2*t)) kind:parametric t:[0, 2*pi]`',
        '- `!plot z = x^2 + y^2 view:3d x:[-3, 3] y:[-3, 3]`',
        '- `!solve x^2 - 5*x + 6 = 0`',
        '- `!matrix det([1, 2; 3, 4])`'
    ]),

    latex: block([
        '*LaTeX Rendering*',
        '',
        '*What to send:* `!latex <formula>` or `!tex <formula>`',
        '*Inline form:* put `$$ ... $$` anywhere in a normal message.',
        '',
        '*Best for*',
        '- Fractions, integrals, sums, matrices, aligned math, and standard KaTeX/LaTeX syntax.',
        '',
        '*Examples*',
        '- `!latex \\int_0^\\infty e^{-x^2} \\, dx = \\frac{\\sqrt{\\pi}}{2}`',
        '- `!tex \\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}`',
        '- `The roots are $$x = \\pm 2$$`'
    ]),

    diff: block([
        '*Differentiation*',
        '',
        '*What to send:* `!diff <expression> [options]`',
        '',
        '*Options*',
        '- `vars:x` — differentiate once with respect to `x`',
        '- `vars:{x:2}` — second derivative in `x`',
        '- `vars:{x:2, y}` — differentiate twice in `x`, then once in `y`',
        '- Omit `vars` to auto-detect when there is one variable; if several variables appear, `x` is used only when present, otherwise specify `vars`',
        '',
        '*Examples*',
        '- `!diff x^2 * sin(x)`',
        '- `!diff u^3 - u*y vars:u`',
        '- `!diff x^3 * y^2 vars:x`',
        '- `!diff x^3 * y^2 vars:{x:2}`',
        '- `!diff x^3 * y^2 vars:{x:2, y}`'
    ]),

    int: block([
        '*Integration*',
        '',
        '*What to send:* `!int <expression> [options]`',
        '',
        '*Options*',
        '- Omit `vars` to auto-detect when there is one variable; if several variables appear, `x` is used only when present, otherwise specify `vars`',
        '- `vars:x` or `vars:{x, y}` — variable(s) for indefinite integration',
        '- `x:[a, b]` — integrate over a definite range (stack for multiple variables)',
        '- `kind:line` — line integral; requires `param:{fx(t), fy(t)}` and `t:[a, b]`',
        '- `kind:surface` — surface integral; requires `param:{fx, fy, fz}` and two ranges',
        '- `kind:volume` — volume integral; provide a range for each integration variable',
        '',
        '*Examples*',
        '- Line and surface integrals accept either scalar fields or vector fields',
        '- `!int x^2` (indefinite)',
        '- `!int x^2 + y vars:x` (choose the integration variable explicitly)',
        '- `!int x^2 vars:{x, y}` (double indefinite)',
        '- `!int sin(x) x:[0, pi]` (definite)',
        '- `!int x^2 + y^2 x:[0, 1] y:[0, 2]` (double definite)',
        '- `!int (-y, x) kind:line param:{cos(t), sin(t)} t:[0, 2*pi]`',
        '- `!int x^2 + y^2 kind:line param:{cos(t), sin(t)} t:[0, 2*pi]`',
        '- `!int x*y*z kind:volume x:[0, 1] y:[0, 2] z:[0, 3]`'
    ]),

    chem: block([
        '*Chemfig Rendering*',
        '',
        '*What to send:* `!chem <chemfig code>` or `!chemfig <chemfig code>`',
        '',
        '*Important rule*',
        '- Send actual chemfig source. The safest form is to include `\\chemfig{...}` yourself.',
        '',
        '*Examples*',
        '- `!chem \\chemfig{H-O-H}`',
        '- `!chem \\chemfig{A-B*6(=-=-=-)}`',
        '- `!chem \\chemfig{[:30]-(=[4]O)-[:-30]OH}`'
    ]),

    tikz: block([
        '*TikZ Rendering*',
        '',
        '*What to send:* `!tikz <drawing code>`',
        '',
        '*Important rules*',
        '- You may send raw TikZ drawing commands after `!tikz`.',
        '- You may also send a full `\\begin{tikzpicture} ... \\end{tikzpicture}` block.',
        '- If a message already contains `\\begin{tikzpicture}`, the bot can render it even without `!tikz`.',
        '',
        '*Examples*',
        '- `!tikz \\draw[thick] (0,0) circle (1.5);`',
        '- `!tikz \\draw (0,0) to[R, l=$R$] (2,0);`',
        '- `\\begin{tikzpicture}\\draw (0,0) -- (2,1);\\end{tikzpicture}`'
    ]),

    plot: block([
        '*2D & 3D Plotting*',
        '',
        '*What to send:* `!plot <expression> [options]`',
        '',
        '*Options*',
        '- `view:2d|3d` — rendering mode; default is 2d, use `view:3d` for 3D',
        '- `<var>:[min, max]` — domain for any axis or parameter (e.g. `x:[-5, 5]`, `t:[0, 2*pi]`)',
        '- `camera:<axis>` or `camera:<axis><angle>` — animated camera rotation (3D only; axis: x/y/z, angle in degrees, e.g. `camera:z` or `camera:z360`)',
        '- `animate:<param>` — sweep a named parameter as a frame animation (3D only; `<param>` must have a matching range)',
        '- `kind:parametric` · `kind:polar` · `kind:vector` — 2D plot types',
        '- `kind:curve` · `kind:surface` · `kind:vector` — 3D plot types (requires `view:3d`)',
        '',
        '- In 3D vector plots, extra `x:[..] y:[..] z:[..]` ranges clip a shared Cartesian box; `radius:[a, b]` clips spherical radius and `rho:[a, b]` clips cylindrical radius',
        '',
        '*Examples*',
        '- `!plot y = sin(x) x:[-10, 10] y:[-2, 2]`',
        '- `!plot x^2 + y^2 = 9 x:[-4, 4] y:[-4, 4]`',
        '- `!plot (cos(3*t), sin(2*t)) kind:parametric t:[0, 2*pi]`',
        '- `!plot (-y, x) kind:vector x:[-5, 5] y:[-5, 5]`',
        '- `!plot z = sin(x)*cos(y) view:3d x:[-3, 3] y:[-3, 3]`',
        '- `!plot z = sin(x - t)*cos(y) view:3d animate:t x:[-3, 3] y:[-3, 3] t:[0, 2*pi]`',
        '- `!plot z = sin(x)*cos(y) view:3d camera:z360 x:[-3, 3] y:[-3, 3]`',
        '- `!plot F(x,y,z) = (...) view:3d kind:vector vars:{x, y, z} radius:[1, 3] x:[-2, 2] y:[-2, 2] z:[-2, 2]`'
    ]),


    solve: block([
        '*Equation Solving*',
        '',
        '*What to send:* `!solve <equation>` or `!solve <eq1>; <eq2>; ...`',
        '',
        '*Important rules*',
        '- Separate multiple equations with semicolons.',
        '- If you omit `=`, the expression is treated as `= 0`.',
        '- Single nonlinear equations are supported.',
        '- Multi-equation systems must be linear and square to get a unique solution.',
        '',
        '*Examples*',
        '- `!solve x^2 - 5*x + 6 = 0`',
        '- `!solve cos(x) - x = 0`',
        '- `!solve x + y = 5; x - y = 1`'
    ]),

    matrix: block([
        '*Matrix Algebra*',
        '',
        '*What to send:* `!matrix <expression>`',
        '',
        '*Matrix literal format*',
        '- Write matrices as `[a, b; c, d]`',
        '- Commas separate columns.',
        '- Semicolons separate rows.',
        '- Every row must have the same number of columns.',
        '',
        '*Useful operations*',
        '- `det(A)` for determinant',
        '- `inv(A)` for inverse',
        '- `eigen(A)` for eigenvalues and eigenvectors',
        '- `rref(A)` for row-reduced echelon form',
        '',
        '*Examples*',
        '- `!matrix [1, 2; 3, 4] * [2, 0; 1, 2]`',
        '- `!matrix det([1, 2, 3; 0, 4, 5; 1, 0, 6])`',
        '- `!matrix inv([1, 2; 3, 4])`',
        '- `!matrix eigen([1, 2; 2, 1])`',
        '- `!matrix rref([1, 2, 3; 2, 4, 6])`'
    ]),

    ode: block([
        '*ODE Solving*',
        '',
        '*What to send:* `!ode <equations> ic:{...} [options]`',
        '',
        '*Core structure*',
        '- Equation: `dy/dx = -y` or `y\'\' + y = 0`',
        '- Initial Conditions: `ic:{y(0)=1}` or `ic:{y(0)=1; y\'(0)=0}` (use semicolons)',
        '- Systems: separate equations with semicolons: `dx/dt = -y; dy/dt = x`',
        '',
        '*Options*',
        '- `mode:sym|num|hybrid` — solving strategy (default: hybrid)',
        '- `phase:{var1, var2}` — render a phase portrait for two dependent variables (forces numerical)',
        '- `<var>:[min, max]` — plot range for any variable or parameter in the equation',
        '',
        '*Examples*',
        '- `!ode dy/dx = -y ic:{y(0)=1} x:[-5, 5]`',
        '- `!ode y\'\' + y = 0 mode:sym ic:{y(0)=1; y\'(0)=0} x:[-10, 10]`',
        '- `!ode dx/dt = -y; dy/dt = x mode:num ic:{x(0)=1; y(0)=0} phase:{x, y} t:[0, 2*pi] x:[-2, 2]`'
    ]),

    pde: block([
        '*PDE Solving*',
        '',
        '*What to send:* `!pde <pde> ic:{...} bc:{...} [options]`',
        '',
        '*Core structure*',
        '- PDE: `du/dt = d2u/dx2`',
        '- Initial condition: `ic:{u(x,0) = sin(x)}`',
        '- Boundary conditions: `bc:{u(0,t)=0; u(pi,t)=0}` (use semicolons)',
        '',
        '*Options*',
        '- view: `view:2d` for 2D time slices/evolution, 3D surface is the default',
        '- `camera:<axis>` or `camera:<axis><angle>` — animated camera (axis: x/y/z, angle: degrees e.g. `camera:y` or `camera:y180`)',
        '- ranges: space and time domains e.g. `x:[0, pi] t:[0, 2]`',
        '',
        '*Examples*',
        '- `!pde du/dt = d2u/dx2 ic:{u(x,0) = sin(x)} bc:{u(0,t)=0; u(pi,t)=0} x:[0, pi] t:[0, 2]`',
        '- `!pde du/dt = d2u/dx2 ic:{u(x,0) = sin(x)} bc:{u(0,t)=0; u(pi,t)=0} camera:y x:[0, pi] t:[0, 2]`',
        '- `!pde du/dt = d2u/dx2 ic:{u(x,0) = sin(x)} bc:{u(0,t)=0; u(pi,t)=0} view:2d camera:z x:[0, pi] t:[0, 2]`'
    ]),

    vector: block([
        '*Vector Calculus*',
        '',
        '*Gradient and Laplacian*',
        '- `!grad <scalar field> [vars:{...}]`',
        '- `!lap <scalar field> [vars:{...}]`',
        '',
        '*Divergence and Curl*',
        '- `!div <vector field> [vars:{...}]`',
        '- `!curl <vector field> [vars:{...}]`',
        '',
        '*Note on variables*',
        '- Variables are optional and can be defined using `vars:{...}` (e.g. `vars:{x, y}`). If omitted, they are inferred.',
        '- Vector fields are written as coordinate tuples: `(-y, x)` or `(x^2, y^2, z^2)`.',
        '',
        '*Examples*',
        '- `!grad x^2 * y * z`',
        '- `!lap x^2 + y^2 vars:{x, y}`',
        '- `!div (x^2, y^2, z^2)`',
        '- `!curl (-y, x, 0) vars:{x, y, z}`'
    ]),

    desp: block([
        '*Rearrange / Isolate a Variable*',
        '',
        '*What to send:* `!desp <equation> vars:<variable>`',
        'Or readable form: `!desp <equation> for <variable>`',
        '',
        '*Examples*',
        '- `!desp E = m * c^2 vars:c`',
        '- `!desp PV = n*R*T for T`'
    ]),

    // ─── Option-specific help pages ────────────────────────────────────────────

    view: block([
        '*view — Rendering Dimension*',
        '',
        'Controls whether output is rendered in 2D or 3D.',
        'Format: `view:2d` or `view:3d`',
        '',
        '*Values*',
        '- `view:2d` — 2D rendering (default for `!plot`)',
        '- `view:3d` — 3D rendering; enables 3D plot types, `camera`, and `animate` options',
        '',
        '*Per-command defaults*',
        '- `!plot` — defaults to `view:2d`; use `view:3d` for surfaces and 3D plots',
        '- `!pde` — defaults to `view:3d` (space-time surface); use `view:2d` for time-slice plots',
        '',
        '*Used by*: `!plot`, `!pde`'
    ]),

    camera: block([
        '*camera — Animated Camera Rotation*',
        '',
        'Rotates the camera around the 3D scene and produces an animated output.',
        'Format: `camera:<axis>` or `camera:<axis><angle>`',
        '',
        '*Values*',
        '- `<axis>` — rotation axis: `x`, `y`, or `z`',
        '- `<angle>` — optional integer in degrees (e.g. `360` for a full orbit, `90` for a quarter turn)',
        '- Without `<angle>`: camera swings back and forth (pendulum-style)',
        '- With `<angle>`: camera orbits by exactly that many degrees',
        '',
        '*Used by*: `!plot view:3d`, `!pde`',
        '',
        '*Examples*',
        '- `camera:z` — pendulum swing around the z-axis',
        '- `camera:z360` — full 360° orbit around z-axis',
        '- `camera:y180` — half-orbit around y-axis'
    ]),

    kind: block([
        '*kind — Plot or Integral Type*',
        '',
        'Specifies the type of plot or integral. Many types are auto-detected without `kind`.',
        'Format: `kind:<type>`',
        '',
        '*For !plot — 2D kinds*',
        '- `kind:parametric` — parametric curve; body: `(fx(t), fy(t))`, supply a parameter range',
        '- `kind:polar` — polar curve; body: `r = f(theta)` or `f(theta)`, supply a `theta` range',
        '- `kind:vector` — 2D vector field; body: `(fx, fy)`, supply `x` and `y` ranges',
        '',
        '*For !plot view:3d — 3D kinds*',
        '- `kind:curve` — parametric 3D curve; body: `(fx(t), fy(t), fz(t))`, supply one parameter range',
        '- `kind:surface` — parametric 3D surface; body: `(fx, fy, fz)`, supply two parameter ranges',
        '- `kind:vector` — 3D vector field; body: `(fx, fy, fz)`, supply `x`, `y`, `z` ranges',
        '',
        '*For !int — integral kinds*',
        '- `kind:line` — line integral; supply `param:{fx(t), fy(t)}` and one parameter range',
        '- `kind:surface` — surface integral; supply `param:{fx, fy, fz}` and two parameter ranges',
        '- `kind:volume` — volume integral; supply a range for each integration variable',
        '',
        '*Used by*: `!plot`, `!int`'
    ]),

    animate: block([
        '*animate — Parameter Evolution Animation*',
        '',
        'Sweeps a named parameter across its range and produces a frame-by-frame animation.',
        'Format: `animate:<param>`',
        '',
        '*Rules*',
        '- `<param>` must be a variable name that appears in the expression',
        '- A matching range must be provided: `animate:t` requires `t:[min, max]`',
        '- Only valid for `!plot view:3d`',
        '',
        '*Used by*: `!plot view:3d`',
        '',
        '*Example*',
        '- `!plot z = sin(x - t)*cos(y) view:3d animate:t x:[-3, 3] y:[-3, 3] t:[0, 2*pi]`'
    ]),

    vars: block([
        '*vars — Variable Specification*',
        '',
        'Specifies which variable(s) to operate on. Syntax depends on the command.',
        '',
        '*Forms*',
        '- `vars:x` — single variable',
        '- `vars:{x, y}` — multiple variables (comma-separated)',
        '- `vars:{x:2}` — variable with order (for `!diff`: differentiate twice in x)',
        '- `vars:{x:2, y}` — mixed orders (for `!diff`: twice in x, then once in y)',
        '',
        '*Per-command usage*',
        '- For `!diff` and `!int`, auto-detect is safest when one variable is present; otherwise specify `vars` explicitly',
        '- `!diff` — variable(s) and order(s) to differentiate; omit to auto-detect',
        '- `!int` — variable(s) for indefinite integration; omit to auto-detect',
        '- `!grad`, `!lap`, `!div`, `!curl` — coordinate variables; omit to auto-detect',
        '- `!desp` — the single variable to isolate (required)',
        '',
        '*Used by*: `!diff`, `!int`, `!grad`, `!lap`, `!div`, `!curl`, `!desp`'
    ]),

    mode: block([
        '*mode — Solving Strategy*',
        '',
        'Controls how the equation is solved.',
        'Format: `mode:sym`, `mode:num`, or `mode:hybrid`',
        '',
        '*Values*',
        '- `mode:sym` — symbolic only; returns exact closed-form solutions via SymPy',
        '- `mode:num` — numerical only; always produces a result, returns decimal approximations',
        '- `mode:hybrid` — tries symbolic first, falls back to numerical if it fails (default)',
        '',
        '*Notes*',
        '- `phase:{...}` always forces numerical solving regardless of `mode`',
        '- High-order or nonlinear systems may not have symbolic solutions; prefer `mode:num` in those cases',
        '',
        '*Used by*: `!ode`'
    ]),

    phase: block([
        '*phase — Phase Portrait*',
        '',
        'Plots a phase portrait (state-space trajectory) instead of a time-domain solution.',
        'Format: `phase:{var1, var2}`',
        '',
        '*Rules*',
        '- Must contain exactly two distinct variable names',
        '- Forces numerical solving (`mode:num`)',
        '- Best used with ODE systems where both variables are part of the same autonomous system',
        '',
        '*Used by*: `!ode`',
        '',
        '*Example*',
        '- `!ode dx/dt = -y; dy/dt = x ic:{x(0)=1; y(0)=0} phase:{x, y} t:[0, 2*pi]`'
    ]),

    ic: block([
        '*ic — Initial Conditions*',
        '',
        'Specifies the initial conditions for a differential equation.',
        'Format: `ic:{condition}` or `ic:{cond1; cond2; ...}` for multiple (semicolon-separated)',
        '',
        '*For !ode*',
        '- First-order: `ic:{y(0)=1}`',
        '- Higher-order: `ic:{y(0)=1; y\'(0)=0}` (prime notation for derivatives)',
        '- System: `ic:{x(0)=1; y(0)=0}` (one condition per variable)',
        '',
        '*For !pde*',
        '- `ic:{u(x,0) = sin(x)}` — the initial state across the spatial domain at t=0',
        '',
        '*Used by*: `!ode`, `!pde`'
    ]),

    bc: block([
        '*bc — Boundary Conditions*',
        '',
        'Specifies spatial boundary conditions for a PDE (required by `!pde`).',
        'Format: `bc:{cond1; cond2}` — conditions separated by semicolons',
        '',
        '*Common forms*',
        '- Dirichlet (fixed value): `bc:{u(0,t)=0; u(L,t)=0}`',
        '- At least two boundary conditions are expected for most 1D PDEs',
        '',
        '*Used by*: `!pde`',
        '',
        '*Example*',
        '- `!pde du/dt = d2u/dx2 ic:{u(x,0)=sin(x)} bc:{u(0,t)=0; u(pi,t)=0} x:[0,pi] t:[0,2]`'
    ]),

    param: block([
        '*param — Parametric Curve or Surface*',
        '',
        'Defines the parametric path or surface for field integrals.',
        'Format: `param:{fx, fy}` (2D) or `param:{fx, fy, fz}` (3D)',
        '',
        '*For line integrals* (`kind:line`)',
        '- Body is the vector field `(Fx, Fy)`; `param` is the parametric path',
        '- `param:{fx(t), fy(t)}` — supply one parameter range (e.g. `t:[0, 2*pi]`)',
        '',
        '*For surface integrals* (`kind:surface`)',
        '- Body is the vector field `(Fx, Fy, Fz)`; `param` is the parametric surface',
        '- `param:{fx(u,v), fy(u,v), fz(u,v)}` — supply two parameter ranges',
        '',
        '*Used by*: `!int kind:line`, `!int kind:surface`',
        '',
        '*Examples*',
        '- `!int (-y, x) kind:line param:{cos(t), sin(t)} t:[0, 2*pi]`',
        '- `!int (0,0,z) kind:surface param:{sin(u)*cos(v), sin(u)*sin(v), cos(u)} u:[0,pi] v:[0,2*pi]`'
    ])
};

function isHelpText(body = '') {
    const trimmed = String(body || '').trim();
    if (!trimmed) {
        return false;
    }

    if (trimmed === generalHelp) {
        return true;
    }

    return Object.values(detailedHelp).includes(trimmed);
}

function getHelp(cmd = '') {
    const normalized = cmd.trim().toLowerCase().replace(/^!/, '');
    if (!normalized) {
        return generalHelp;
    }

    const aliases = {
        // command aliases
        tex: 'latex',
        '$$': 'latex',
        chemfig: 'chem',
        plot3d: 'plot',
        grad: 'vector',
        lap: 'vector',
        div: 'vector',
        curl: 'vector',
        basics: 'syntax',
        format: 'syntax',
        ranges: 'syntax',
        domains: 'syntax',
        // option aliases
        '2d': 'view',
        '3d': 'view',
        animation: 'animate',
        parameter: 'param',
        parameters: 'param',
        initial: 'ic',
        boundary: 'bc',
        variable: 'vars',
        variables: 'vars',
        options: 'syntax'
    };

    const key = aliases[normalized] || normalized;

    if (detailedHelp[key]) {
        return detailedHelp[key];
    }

    return `*LaTeX Render Bot* - Command not found: !${normalized}\n\nType \`!help\` to see all available commands.`;
}

getHelp.isHelpText = isHelpText;

module.exports = getHelp;
