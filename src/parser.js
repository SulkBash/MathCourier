const math = require('./math');
const { splitTopLevel } = require('./utils');

// Predefined command keywords that are not range variables
const KEYWORDS = new Set(['vars', 'kind', 'animate', 'camera', 'mode', 'view', 'ic', 'bc', 'param', 'phase', 'xlim', 'ylim', 'zlim', 'dep']);

/**
 * Parses an input string according to the Command Syntax V2 spec.
 * Extracts a single unlabeled main body and top-level labeled modifiers/options:
 * - scalar: key:value
 * - range: key:[min, max]
 * - grouped: key:{...}
 *
 * @param {string} input - The raw command input text.
 * @param {Object} [parseOpts] - Parsing options.
 * @param {boolean} [parseOpts.requireBody=true] - Whether to report an error if no body is found.
 * @returns {Object} { success, body, options, rawOptions, errors }
 */
function parseCommandSyntax(input, parseOpts = {}) {
    const requireBody = parseOpts.requireBody !== false;
    const errors = [];
    const options = {};
    const rawOptions = {};

    const text = input || '';
    const cleanTextChunks = [];
    let lastIndex = 0;
    
    let i = 0;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let inQuotes = false;
    let quoteChar = null;

    while (i < text.length) {
        const char = text[i];

        // Track quotes
        if (inQuotes) {
            if (char === '\\' && i + 1 < text.length) {
                i += 2;
                continue;
            }
            if (char === quoteChar) {
                inQuotes = false;
                quoteChar = null;
            }
            i++;
            continue;
        }

        if (char === '"' || char === '\'') {
            inQuotes = true;
            quoteChar = char;
            i++;
            continue;
        }

        // Track nesting
        if (char === '(') { parenDepth++; i++; continue; }
        if (char === ')') { parenDepth = Math.max(0, parenDepth - 1); i++; continue; }
        if (char === '[') { bracketDepth++; i++; continue; }
        if (char === ']') { bracketDepth = Math.max(0, bracketDepth - 1); i++; continue; }
        if (char === '{') { braceDepth++; i++; continue; }
        if (char === '}') { braceDepth = Math.max(0, braceDepth - 1); i++; continue; }

        // Look for key-colon at the top level
        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
            // Check if this position starts a key (word boundary check)
            const isWordBoundary = (i === 0 || !/[a-zA-Z0-9_]/.test(text[i - 1]));
            if (isWordBoundary) {
                const remaining = text.slice(i);
                const keyColonMatch = remaining.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:/);
                if (keyColonMatch) {
                    const key = keyColonMatch[1].toLowerCase();
                    const keyLength = keyColonMatch[0].length;
                    
                    // Add preceding text to clean chunks
                    if (i > lastIndex) {
                        cleanTextChunks.push(text.slice(lastIndex, i));
                    }

                    // Find where the value starts after key and colon
                    let valIndex = i + keyLength;
                    while (valIndex < text.length && /\s/.test(text[valIndex])) {
                        valIndex++;
                    }

                    if (valIndex >= text.length) {
                        errors.push(`Option "${key}" is missing a value.`);
                        lastIndex = text.length;
                        i = text.length;
                        continue;
                    }

                    const firstValChar = text[valIndex];
                    let optionValue = null;
                    let optionType = null;
                    let optionEnd = valIndex;

                    if (firstValChar === '[') {
                        // Range option
                        optionType = 'range';
                        let subBracketDepth = 0;
                        let subParenDepth = 0;
                        let subBraceDepth = 0;
                        let subInQuotes = false;
                        let subQuoteChar = null;
                        let foundEnd = false;

                        for (let j = valIndex; j < text.length; j++) {
                            const c = text[j];
                            if (subInQuotes) {
                                if (c === '\\' && j + 1 < text.length) { j++; continue; }
                                if (c === subQuoteChar) { subInQuotes = false; subQuoteChar = null; }
                                continue;
                            }
                            if (c === '"' || c === '\'') { subInQuotes = true; subQuoteChar = c; continue; }
                            if (c === '(') { subParenDepth++; continue; }
                            if (c === ')') { subParenDepth = Math.max(0, subParenDepth - 1); continue; }
                            if (c === '{') { subBraceDepth++; continue; }
                            if (c === '}') { subBraceDepth = Math.max(0, subBraceDepth - 1); continue; }
                            if (c === '[') { subBracketDepth++; continue; }
                            if (c === ']') {
                                subBracketDepth = Math.max(0, subBracketDepth - 1);
                                if (subBracketDepth === 0 && subParenDepth === 0 && subBraceDepth === 0) {
                                    optionEnd = j + 1;
                                    optionValue = text.slice(valIndex + 1, j);
                                    foundEnd = true;
                                    break;
                                }
                                continue;
                            }
                        }
                        if (!foundEnd) {
                            errors.push(`Option "${key}" has an unclosed range bracket '['.`);
                            optionEnd = text.length;
                            optionValue = text.slice(valIndex + 1);
                        }
                    } else if (firstValChar === '{') {
                        // Grouped option
                        optionType = 'grouped';
                        let subBracketDepth = 0;
                        let subParenDepth = 0;
                        let subBraceDepth = 0;
                        let subInQuotes = false;
                        let subQuoteChar = null;
                        let foundEnd = false;

                        for (let j = valIndex; j < text.length; j++) {
                            const c = text[j];
                            if (subInQuotes) {
                                if (c === '\\' && j + 1 < text.length) { j++; continue; }
                                if (c === subQuoteChar) { subInQuotes = false; subQuoteChar = null; }
                                continue;
                            }
                            if (c === '"' || c === '\'') { subInQuotes = true; subQuoteChar = c; continue; }
                            if (c === '(') { subParenDepth++; continue; }
                            if (c === ')') { subParenDepth = Math.max(0, subParenDepth - 1); continue; }
                            if (c === '[') { subBracketDepth++; continue; }
                            if (c === ']') { subBracketDepth = Math.max(0, subBracketDepth - 1); continue; }
                            if (c === '{') { subBraceDepth++; continue; }
                            if (c === '}') {
                                subBraceDepth = Math.max(0, subBraceDepth - 1);
                                if (subBraceDepth === 0 && subParenDepth === 0 && subBracketDepth === 0) {
                                    optionEnd = j + 1;
                                    optionValue = text.slice(valIndex + 1, j);
                                    foundEnd = true;
                                    break;
                                }
                                continue;
                            }
                        }
                        if (!foundEnd) {
                            errors.push(`Option "${key}" has an unclosed grouped brace '{'.`);
                            optionEnd = text.length;
                            optionValue = text.slice(valIndex + 1);
                        }
                    } else {
                        // Scalar option
                        optionType = 'scalar';
                        let subBracketDepth = 0;
                        let subParenDepth = 0;
                        let subBraceDepth = 0;
                        let subInQuotes = false;
                        let subQuoteChar = null;
                        let foundEnd = false;

                        for (let j = valIndex; j < text.length; j++) {
                            const c = text[j];
                            if (subInQuotes) {
                                if (c === '\\' && j + 1 < text.length) { j++; continue; }
                                if (c === subQuoteChar) { subInQuotes = false; subQuoteChar = null; }
                                continue;
                            }
                            if (c === '"' || c === '\'') { subInQuotes = true; subQuoteChar = c; continue; }
                            if (c === '(') { subParenDepth++; continue; }
                            if (c === ')') { subParenDepth = Math.max(0, subParenDepth - 1); continue; }
                            if (c === '[') { subBracketDepth++; continue; }
                            if (c === ']') { subBracketDepth = Math.max(0, subBracketDepth - 1); continue; }
                            if (c === '{') { subBraceDepth++; continue; }
                            if (c === '}') { subBraceDepth = Math.max(0, subBraceDepth - 1); continue; }

                            if (subParenDepth === 0 && subBracketDepth === 0 && subBraceDepth === 0) {
                                if (/\s/.test(c)) {
                                    optionEnd = j;
                                    optionValue = text.slice(valIndex, j);
                                    foundEnd = true;
                                    break;
                                }
                            }
                        }
                        if (!foundEnd) {
                            optionEnd = text.length;
                            optionValue = text.slice(valIndex);
                        }
                    }

                    // Save the raw original token string (for debugging or exact reconstruction)
                    const rawToken = text.slice(i, optionEnd);

                    if (options.hasOwnProperty(key)) {
                        errors.push(`Duplicate option: "${key}"`);
                    } else {
                        rawOptions[key] = rawToken;

                        if (optionType === 'range') {
                            const parts = splitTopLevel(optionValue, ',');
                            if (parts.length !== 2) {
                                errors.push(`Range option "${key}" must contain exactly two values (min, max). Got: "${optionValue}"`);
                            }
                            options[key] = parts.map(p => p.trim());
                        } else if (optionType === 'grouped') {
                            options[key] = optionValue.trim();
                        } else {
                            options[key] = optionValue.trim();
                        }
                    }

                    lastIndex = optionEnd;
                    i = optionEnd;
                    continue;
                }
            }
        }

        i++;
    }

    if (lastIndex < text.length) {
        cleanTextChunks.push(text.slice(lastIndex));
    }

    const nonSpaceChunks = cleanTextChunks
        .map(chunk => chunk.trim())
        .filter(chunk => chunk.length > 0);

    let body = null;
    if (nonSpaceChunks.length > 1) {
        errors.push(`Multiple candidate bodies detected: ${nonSpaceChunks.map(c => `"${c}"`).join(', ')}`);
        body = nonSpaceChunks.join(' ');
    } else if (nonSpaceChunks.length === 1) {
        body = nonSpaceChunks[0];
    } else {
        if (requireBody) {
            errors.push('Missing command body.');
        }
    }

    return {
        success: errors.length === 0,
        body,
        options,
        rawOptions,
        errors
    };
}

/**
 * Normalizes raw options and performs validation against schema rules.
 *
 * @param {Object} parsed - The result from parseCommandSyntax.
 * @param {string} commandName - The name of the command (e.g. 'plot', 'ode', 'diff').
 * @returns {Object} Normalized and validated output.
 */
function normalizeAndValidate(parsed, commandName) {
    const errors = [...parsed.errors];
    const normalizedOptions = {};
    const variables = [];
    const ranges = [];

    const normCmd = String(commandName || '').toLowerCase().trim();

    // 1. Process variables (`vars`) if present
    if (parsed.options.hasOwnProperty('vars')) {
        const rawVars = parsed.options.vars;
        const varParts = splitTopLevel(rawVars, ',');
        
        for (const part of varParts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            const orderMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(\d+)$/);
            let name = trimmed;
            let order = 1;

            if (orderMatch) {
                name = orderMatch[1];
                order = parseInt(orderMatch[2], 10);
                if (!Number.isInteger(order) || order < 1) {
                    errors.push(`Invalid derivative order for "${name}": expected a positive integer.`);
                    continue;
                }
            }

            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
                errors.push(`Invalid variable name "${name}" in vars option.`);
            } else {
                variables.push({ name, order });
            }
        }
        normalizedOptions.vars = variables;
    }

    // 1.5. Process dependent variables (`dep`) if present
    if (parsed.options.hasOwnProperty('dep')) {
        const rawDep = parsed.options.dep;
        const depParts = splitTopLevel(rawDep, ',');
        const depVars = [];
        for (const part of depParts) {
            const name = part.trim();
            if (!name) continue;
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
                errors.push(`Invalid dependent variable name "${name}" in dep option.`);
            } else {
                depVars.push(name);
            }
        }
        normalizedOptions.dep = depVars;
    }

    // 2. Process ranges (any key not in KEYWORDS)
    for (const key of Object.keys(parsed.options)) {
        if (!KEYWORDS.has(key)) {
            const val = parsed.options[key];
            if (!Array.isArray(val)) {
                errors.push(`Option "${key}" is expected to be a range option of the form ${key}:[min, max].`);
                continue;
            }

            const isIntCmd = (normCmd === 'int');
            const [minExpr, maxExpr] = val;
            let min, max;
            const evalScope = { inf: Infinity, infinity: Infinity };

            try {
                const evalMin = math.evaluate(minExpr, evalScope);
                const numMin = (evalMin && typeof evalMin.toNumber === 'function') ? evalMin.toNumber() : Number(evalMin);
                if (typeof numMin === 'number' && !isNaN(numMin)) {
                    min = numMin;
                } else if (!isIntCmd) {
                    errors.push(`Invalid range bound for "${key}": "${minExpr}" does not evaluate to a finite number.`);
                }
            } catch (err) {
                if (!isIntCmd) {
                    errors.push(`Invalid range bound for "${key}": "${minExpr}" does not evaluate to a finite number.`);
                }
            }

            try {
                const evalMax = math.evaluate(maxExpr, evalScope);
                const numMax = (evalMax && typeof evalMax.toNumber === 'function') ? evalMax.toNumber() : Number(evalMax);
                if (typeof numMax === 'number' && !isNaN(numMax)) {
                    max = numMax;
                } else if (!isIntCmd) {
                    errors.push(`Invalid range bound for "${key}": "${maxExpr}" does not evaluate to a finite number.`);
                }
            } catch (err) {
                if (!isIntCmd) {
                    errors.push(`Invalid range bound for "${key}": "${maxExpr}" does not evaluate to a finite number.`);
                }
            }

            if (isIntCmd || (min !== undefined && max !== undefined)) {
                if (!isIntCmd && min >= max) {
                    errors.push(`Range minimum (${min}) must be less than maximum (${max}) for variable "${key}".`);
                } else {
                    ranges.push({ name: key, min, max, minExpr, maxExpr });
                    normalizedOptions[key] = { min, max, minExpr, maxExpr };
                }
            }
        }
    }

    // 3. Process view (allowed: '2d', '3d')
    let view = (normCmd === 'pde') ? '3d' : '2d';
    if (parsed.options.hasOwnProperty('view')) {
        const val = String(parsed.options.view).toLowerCase().trim();
        if (val === '2d' || val === '3d') {
            view = val;
        } else {
            errors.push(`Invalid view value: expected '2d' or '3d', got "${parsed.options.view}".`);
        }
    }
    normalizedOptions.view = view;

    // 4. Process mode (allowed values depend on command)
    if (parsed.options.hasOwnProperty('mode')) {
        const val = String(parsed.options.mode).toLowerCase().trim();
        const defaultModes = new Set(['hybrid', 'sym', 'num']);
        const solveModes = new Set(['factor', 'expand', 'simplify', 'hybrid', 'sym', 'num']);
        const latexModes = new Set(['formula', 'chem', 'tikz']);
        const allowedModes = normCmd === 'solve'
            ? solveModes
            : normCmd === 'latex'
                ? latexModes
                : defaultModes;

        if (allowedModes.has(val)) {
            normalizedOptions.mode = val;
        } else {
            const expectedModes = Array.from(allowedModes).map((mode) => `'${mode}'`).join(', ');
            errors.push(`Invalid mode: expected ${expectedModes}, got "${parsed.options.mode}".`);
        }
    } else if (normCmd === 'ode') {
        normalizedOptions.mode = 'hybrid';
    }

    // 5. Process kind (validation depends on commandName and view)
    if (parsed.options.hasOwnProperty('kind')) {
        const val = String(parsed.options.kind).toLowerCase().trim();
        let isValid = false;

        if (normCmd === 'int') {
            const allowed = new Set(['line', 'surface', 'volume']);
            if (allowed.has(val)) isValid = true;
        } else if (normCmd === 'plot') {
            if (view === '3d') {
                const allowed = new Set(['surface', 'curve', 'vector']);
                if (allowed.has(val)) isValid = true;
            } else {
                const allowed = new Set(['parametric', 'polar', 'vector']);
                if (allowed.has(val)) isValid = true;
            }
        } else {
            // Other commands don't support kind in spec, but let's allow general pass through
            isValid = true;
        }

        if (isValid) {
            normalizedOptions.kind = val;
        } else {
            errors.push(`Invalid kind "${parsed.options.kind}" for command "!${commandName}" (view: "${view}").`);
        }
    }

    // 6. Process camera (allowed format: <axis><angle?> e.g. camera:z360, camera:x)
    if (parsed.options.hasOwnProperty('camera')) {
        const val = String(parsed.options.camera).trim();
        const cameraMatch = val.match(/^([xyz])(\d+)?$/i);
        if (cameraMatch) {
            const axis = cameraMatch[1].toLowerCase();
            const angle = cameraMatch[2] ? parseInt(cameraMatch[2], 10) : null;
            normalizedOptions.camera = { axis, angle };

            if (view !== '3d' && normCmd !== 'pde') {
                errors.push('Option "camera" is only valid in 3D view (view:3d).');
            }
        } else {
            errors.push(`Invalid camera format: expected <axis><angle?>, got "${parsed.options.camera}".`);
        }
    }

    // 7. Process animate
    if (parsed.options.hasOwnProperty('animate')) {
        const val = String(parsed.options.animate).trim();
        if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(val)) {
            normalizedOptions.animate = val;
        } else {
            errors.push(`Invalid animate variable name: "${parsed.options.animate}".`);
        }
    }

    // 8. Process other options (ic, bc, param)
    const passThroughKeys = ['ic', 'bc', 'param'];
    for (const key of passThroughKeys) {
        if (parsed.options.hasOwnProperty(key)) {
            normalizedOptions[key] = String(parsed.options[key]).trim();
        }
    }

    if (parsed.options.hasOwnProperty('phase')) {
        const phaseParts = splitTopLevel(String(parsed.options.phase).trim())
            .map((part) => part.trim())
            .filter(Boolean);

        if (phaseParts.length !== 2) {
            errors.push('Option "phase" must contain exactly two variables, for example phase:{x, y}.');
        } else if (!phaseParts.every((part) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(part))) {
            errors.push('Option "phase" must contain simple variable names, for example phase:{x, y}.');
        } else if (new Set(phaseParts).size !== phaseParts.length) {
            errors.push('Option "phase" must contain two distinct variables.');
        } else {
            normalizedOptions.phase = phaseParts;
        }
    }

    // 8.5. Process display range options (xlim, ylim, zlim)
    for (const key of ['xlim', 'ylim', 'zlim']) {
        if (parsed.options.hasOwnProperty(key)) {
            const val = parsed.options[key];
            if (!Array.isArray(val)) {
                errors.push(`Option "${key}" is expected to be a range option of the form ${key}:[min, max].`);
                continue;
            }

            const [minExpr, maxExpr] = val;
            let min, max;
            const evalScope = { inf: Infinity, infinity: Infinity };

            try {
                const evalMin = math.evaluate(minExpr, evalScope);
                const numMin = (evalMin && typeof evalMin.toNumber === 'function') ? evalMin.toNumber() : Number(evalMin);
                if (typeof numMin === 'number' && !isNaN(numMin)) {
                    min = numMin;
                } else {
                    errors.push(`Invalid range bound for "${key}": "${minExpr}" does not evaluate to a finite number.`);
                }
            } catch (err) {
                errors.push(`Invalid range bound for "${key}": "${minExpr}" does not evaluate to a finite number.`);
            }

            try {
                const evalMax = math.evaluate(maxExpr, evalScope);
                const numMax = (evalMax && typeof evalMax.toNumber === 'function') ? evalMax.toNumber() : Number(evalMax);
                if (typeof numMax === 'number' && !isNaN(numMax)) {
                    max = numMax;
                } else {
                    errors.push(`Invalid range bound for "${key}": "${maxExpr}" does not evaluate to a finite number.`);
                }
            } catch (err) {
                errors.push(`Invalid range bound for "${key}": "${maxExpr}" does not evaluate to a finite number.`);
            }

            if (min !== undefined && max !== undefined) {
                if (min >= max) {
                    errors.push(`Range minimum (${min}) must be less than maximum (${max}) for option "${key}".`);
                } else {
                    normalizedOptions[key] = [min, max];
                }
            }
        }
    }

    // 9. Command-Local Rules
    if (normCmd !== 'diff' && variables.some((variable) => variable.order !== 1)) {
        errors.push(`Option "vars" only supports order markers like x:2 for command "!diff".`);
    } else if (normCmd === 'ode') {
        if (!parsed.options.hasOwnProperty('ic')) {
            errors.push('Command "!ode" requires initial conditions "ic:{...}".');
        }
    } else if (normCmd === 'pde') {
        if (!parsed.options.hasOwnProperty('ic') || !parsed.options.hasOwnProperty('bc')) {
            errors.push('Command "!pde" requires initial conditions "ic:{...}" and boundary conditions "bc:{...}".');
        }
    }

    return {
        success: errors.length === 0,
        body: parsed.body,
        options: normalizedOptions,
        variables,
        ranges,
        errors
    };
}

module.exports = {
    parseCommandSyntax,
    normalizeAndValidate
};
