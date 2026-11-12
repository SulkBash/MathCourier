const math = require('../math');
const { splitTopLevel, buildLatex } = require('../utils');

function solveCurvilinear(operation, source, coordinates) {
    try {
        if (!['grad', 'lap', 'div', 'curl'].includes(operation) ||
            !['cylindrical', 'spherical'].includes(coordinates)) {
            throw new Error('Unsupported vector operator or coordinate system.');
        }
        const parts = splitTopLevel(String(source || ''), ',');
        if (parts.length < 1 || parts.length > 2) {
            throw new Error('Use an expression and optional vars:{...}.');
        }
        const defaults = coordinates === 'cylindrical' ? ['r', 'theta', 'z'] : ['r', 'theta', 'phi'];
        let vars = defaults;
        if (parts[1]) {
            const match = parts[1].match(/^vars\s*:\s*\{([^{}]+)\}$/i);
            if (!match) throw new Error('Use vars:{...} for coordinate names.');
            vars = splitTopLevel(match[1], ',');
        }
        if (vars.length !== 3 || new Set(vars).size !== 3 ||
            !vars.every((name) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name))) {
            throw new Error('Provide exactly three distinct coordinate names.');
        }
        const [r, theta, third] = vars;
        const simplify = (expression) => math.simplify(expression).toString();
        const derivative = (expression, variable) => simplify(math.derivative(math.parse(expression), variable));
        const tex = (expression) => math.parse(simplify(expression)).toTex();
        const basis = vars.map((name) => '\\hat{\\mathbf e}_{' + math.parse(name).toTex() + '}');
        const scalar = ['grad', 'lap'].includes(operation);
        let field;
        if (scalar) {
            field = parts[0];
            math.parse(field);
        } else {
            const tuple = parts[0].trim();
            if (!tuple.startsWith('(') || !tuple.endsWith(')')) {
                throw new Error(operation + ' expects three components in parentheses.');
            }
            field = splitTopLevel(tuple.slice(1, -1), ',');
            if (field.length !== 3) throw new Error(operation + ' expects exactly three components.');
            field.forEach((component) => math.parse(component));
        }

        let result;
        if (coordinates === 'cylindrical') {
            if (operation === 'grad') {
                result = [derivative(field, r), '(' + derivative(field, theta) + ')/' + r, derivative(field, third)];
            } else if (operation === 'lap') {
                result = '(' + derivative(r + '*(' + derivative(field, r) + ')', r) + ')/' + r +
                    '+(' + derivative(derivative(field, theta), theta) + ')/' + r + '^2+' +
                    derivative(derivative(field, third), third);
            } else if (operation === 'div') {
                result = '(' + derivative(r + '*(' + field[0] + ')', r) + ')/' + r +
                    '+(' + derivative(field[1], theta) + ')/' + r + '+' + derivative(field[2], third);
            } else {
                result = [
                    '(' + derivative(field[2], theta) + ')/' + r + '-(' + derivative(field[1], third) + ')',
                    '(' + derivative(field[0], third) + ')-(' + derivative(field[2], r) + ')',
                    '(' + derivative(r + '*(' + field[1] + ')', r) + '-(' + derivative(field[0], theta) + '))/' + r
                ];
            }
        } else {
            const sin = 'sin(' + theta + ')';
            if (operation === 'grad') {
                result = [derivative(field, r), '(' + derivative(field, theta) + ')/' + r,
                    '(' + derivative(field, third) + ')/(' + r + '*' + sin + ')'];
            } else if (operation === 'lap') {
                result = '(' + derivative(r + '^2*(' + derivative(field, r) + ')', r) + ')/' + r + '^2+' +
                    '(' + derivative(sin + '*(' + derivative(field, theta) + ')', theta) + ')/(' + r + '^2*' + sin + ')+' +
                    '(' + derivative(derivative(field, third), third) + ')/(' + r + '^2*' + sin + '^2)';
            } else if (operation === 'div') {
                result = '(' + derivative(r + '^2*(' + field[0] + ')', r) + ')/' + r + '^2+' +
                    '(' + derivative(sin + '*(' + field[1] + ')', theta) + ')/(' + r + '*' + sin + ')+' +
                    '(' + derivative(field[2], third) + ')/(' + r + '*' + sin + ')';
            } else {
                result = [
                    '(' + derivative(sin + '*(' + field[2] + ')', theta) + '-(' + derivative(field[1], third) + '))/(' + r + '*' + sin + ')',
                    '((' + derivative(field[0], third) + ')/' + sin + '-(' + derivative(r + '*(' + field[2] + ')', r) + '))/' + r,
                    '(' + derivative(r + '*(' + field[1] + ')', r) + '-(' + derivative(field[0], theta) + '))/' + r
                ];
            }
        }
        result = Array.isArray(result) ? result.map(simplify) : simplify(result);
        const resultTex = Array.isArray(result)
            ? result.map((item, index) => '(' + tex(item) + ')' + basis[index]).join(' + ')
            : tex(result);
        const symbol = { grad: '\\nabla f', lap: '\\nabla^2 f', div: '\\nabla\\cdot\\mathbf F', curl: '\\nabla\\times\\mathbf F' }[operation];
        const coordinateTex = vars.map((name) => math.parse(name).toTex()).join(', ');
        const thetaTex = math.parse(theta).toTex();
        const thirdTex = math.parse(third).toTex();
        const convention = coordinates === 'spherical'
            ? '\\text{Spherical: }(' + coordinateTex + '),\\quad ' + thetaTex + '\\text{ polar; }' + thirdTex + '\\text{ azimuth}'
            : '\\text{Cylindrical: }(' + coordinateTex + '),\\quad ' + thetaTex + '\\text{ azimuth}';
        const singular = coordinates === 'spherical'
            ? math.parse(r).toTex() + '>0,\\quad 0<' + thetaTex + '<\\pi'
            : math.parse(r).toTex() + '>0';
        const inputTex = scalar
            ? 'f &= ' + math.parse(field).toTex()
            : '\\mathbf F &= ' + field.map((item, index) => '(' + math.parse(item).toTex() + ')' + basis[index]).join(' + ');
        return {
            success: true,
            coordinates,
            variables: vars,
            result,
            latex: buildLatex([convention, inputTex, symbol + ' &= ' + resultTex, '\\text{Coordinate domain: }& ' + singular])
        };
    } catch (error) {
        return { success: false, error: 'Coordinate calculation error: ' + error.message };
    }
}

module.exports = { solveCurvilinear };
