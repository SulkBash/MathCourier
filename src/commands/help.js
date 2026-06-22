const block = (lines) => lines.join('\n');

const generalHelp = block([
    '*LaTeX Render Bot Help*',
    '',
    'A math assistant bot for WhatsApp.',
    'Render LaTeX formulas, plot 2D and 3D functions, solve equations, and compute calculus — all from a chat message.',
    '',
    'Type `!command` followed by a space and the content you want to send.',
    '',
    '*Commands*',
    '- `!latex <latex>` or `!tex <latex>`',
    '- `$$ ... $$` anywhere in a normal message',
    '- `!chem <chemfig code>`',
    '- `!tikz <drawing code>` or a full `\\begin{tikzpicture} ... \\end{tikzpicture}` block',
    '- `!plot <expression> [options]` (supports 2D and 3D via view:3d)',
    '- `!solve <equation or system>`',
    '- `!matrix <matrix expression>`',
    '- `!diff <expression> [options]`',
    '- `!int <expression> [options]`',
    '- `!ode <equations> ic:{...} [options]`',
    '- `!pde <pde> ic:{...} bc:{...} [options]`',
    '- `!grad <field> [options]`',
    '- `!lap <field> [options]`',
    '- `!div <field> [options]`',
    '- `!curl <field> [options]`',
    '- `!desp <equation> vars:<var>` or `!desp <equation> for <var>`',
    '',
    '*Quick Syntax Rules*',
    '- Ranges use brackets: `key:[min, max]` (e.g. `x:[-5, 5]`)',
    '- Scalar options use `key:value` (e.g. `mode:num`)',
    '- Grouped options use `key:{...}` (e.g. `vars:{x, y}`, `ic:{y(0)=1}`)',
    '- Semicolons separate equations: `!solve x + y = 5; x - y = 1`',
    '- Matrix rows also use semicolons: `[1, 2; 3, 4]`',
    '',
    '*Detailed help topics*',
    '`!help syntax` · `!help latex` · `!help plot` · `!help solve` · `!help matrix`',
    '`!help diff` · `!help int` · `!help ode` · `!help pde` · `!help vector` · `!help desp`',
    '`!help chem` · `!help tikz`'
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
        '- Scalar: `mode:num`, `view:3d`, `camera:z360`, `animate:t`',
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
        '*How options work*',
        '- Omitted vars: differentiate once with respect to the detected variable, or `x` if unclear.',
        '- `vars:x` means differentiate once in `x`.',
        '- `vars:{x:2}` means second derivative in `x`.',
        '- `vars:{x:2, y}` means differentiate twice in `x`, then once in `y`.',
        '',
        '*Examples*',
        '- `!diff x^2 * sin(x)`',
        '- `!diff x^3 * y^2 vars:x`',
        '- `!diff x^3 * y^2 vars:{x:2}`',
        '- `!diff x^3 * y^2 vars:{x:2, y}`'
    ]),

    int: block([
        '*Integration*',
        '',
        '*What to send:* `!int <expression> [options]`',
        '',
        '*Standard Integrals*',
        '- Indefinite: `!int x^2` or `!int x^2 vars:x`',
        '- Definite: `!int sin(x) x:[0, pi]`',
        '- Multiple indefinite: `!int x * y vars:{x, y}`',
        '- Multiple definite: `!int x^2 + y^2 x:[0, 1] y:[0, 2]`',
        '',
        '*Field-integral forms*',
        '- Line integral: `!int (-y, x) kind:line param:{cos(t), sin(t)} t:[0, 2*pi]`',
        '- Surface integral: `!int (0, 0, z) kind:surface param:{sin(u)*cos(v), sin(u)*sin(v), cos(u)} u:[0, pi] v:[0, 2*pi]`',
        '- Volume integral: `!int x*y*z kind:volume x:[0, 1] y:[0, 2] z:[0, 3]`',
        '',
        '*Examples*',
        '- `!int x^2`',
        '- `!int sin(x) x:[0, pi]`',
        '- `!int x^2 + y^2 x:[0, 1] y:[0, 2]`',
        '- `!int (-y, x) kind:line param:{cos(t), sin(t)} t:[0, 2*pi]`',
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
        '*Modes/Kinds (2D)*',
        '- Explicit function: `y = sin(x)` or `sin(x) x:[-5, 5]`',
        '- Implicit equation: `x^2 + y^2 = 9 x:[-4, 4] y:[-4, 4]`',
        '- Parametric curve: `(cos(3*t), sin(2*t)) kind:parametric t:[0, 2*pi]`',
        '- Polar curve: `r = 2*(1-cos(theta)) kind:polar theta:[0, 2*pi]`',
        '- Vector field: `(-y, x) kind:vector x:[-5, 5] y:[-5, 5]`',
        '',
        '*3D Plotting* (add `view:3d`)',
        '- Explicit surface: `z = sin(x)*cos(y) view:3d x:[-3, 3] y:[-3, 3]`',
        '- Implicit surface: `x^2 + y^2 + z^2 = 9 view:3d x:[-3, 3] y:[-3, 3] z:[-3, 3]`',
        '- Parametric curve: `(sin(t), cos(t), t/3) view:3d kind:curve t:[0, 6*pi]`',
        '- Parametric surface: `(cos(u)*(2+cos(v)), sin(u)*(2+cos(v)), sin(v)) view:3d kind:surface u:[0, 2*pi] v:[0, 2*pi]`',
        '- Vector field: `(-y, x, z/2) view:3d kind:vector x:[-4, 4] y:[-4, 4] z:[-4, 4]`',
        '',
        '*Animations & Camera (Only view:3d)*',
        '- Camera rotation: `camera:z360`, `camera:x180`, `camera:y`',
        '- Evolution sweep: `animate:t` (with `t:[min, max]`)',
        '',
        '*Examples*',
        '- `!plot y = sin(x) x:[-10, 10] y:[-2, 2]`',
        '- `!plot (cos(3*t), sin(2*t)) kind:parametric t:[0, 2*pi]`',
        '- `!plot z = sin(x)*cos(y) view:3d camera:z360 x:[-3, 3] y:[-3, 3]`',
        '- `!plot z = sin(x - t)*cos(y) view:3d animate:t x:[-3, 3] y:[-3, 3] t:[0, 2*pi]`'
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
        '- mode: `mode:sym` (symbolic), `mode:num` (numerical), `mode:hybrid` (default)',
        '- phase portrait: `phase:{x, y}` (forces numerical)',
        '- ranges: `x:[-5, 5]`, `t:[0, 2*pi]`',
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
        '- camera (3D or 2D anim): `camera:y`, `camera:z`',
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
        domains: 'syntax'
    };

    const key = aliases[normalized] || normalized;

    if (detailedHelp[key]) {
        return detailedHelp[key];
    }

    return `*LaTeX Render Bot* - Command not found: !${normalized}\n\nType \`!help\` to see all available commands.`;
}

getHelp.isHelpText = isHelpText;

module.exports = getHelp;
