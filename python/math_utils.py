import re
import sympy
from sympy.parsing.sympy_parser import (
    standard_transformations,
    implicit_multiplication_application,
    rationalize,
    parse_expr,
)

transformations = (standard_transformations + (implicit_multiplication_application, rationalize))
VALID_INLINE_VAR_RE = r"^[a-zA-Z_][a-zA-Z0-9_]*$"


class InlineGradient(sympy.Expr):
    def __new__(cls, expr, coords, solved_value):
        if not isinstance(coords, sympy.Tuple):
            coords = sympy.Tuple(*coords)
        obj = sympy.Expr.__new__(cls, expr, coords, solved_value)
        return obj

    @property
    def expr(self):
        return self.args[0]

    @property
    def coords(self):
        return self.args[1]

    @property
    def _solved_value(self):
        return self.args[2]

    def doit(self, **hints):
        val = self._solved_value
        return val.doit(**hints) if hasattr(val, "doit") else val

    def _latex(self, printer):
        return f"\\nabla \\left({printer._print(self.expr)}\\right)"

    def _eval_subs(self, old, new):
        if old in self.free_symbols:
            return sympy.Subs(self, old, new)
        return self


class InlineLaplacian(sympy.Expr):
    def __new__(cls, expr, coords, solved_value):
        if not isinstance(coords, sympy.Tuple):
            coords = sympy.Tuple(*coords)
        obj = sympy.Expr.__new__(cls, expr, coords, solved_value)
        return obj

    @property
    def expr(self):
        return self.args[0]

    @property
    def coords(self):
        return self.args[1]

    @property
    def _solved_value(self):
        return self.args[2]

    def doit(self, **hints):
        val = self._solved_value
        return val.doit(**hints) if hasattr(val, "doit") else val

    def _latex(self, printer):
        return f"\\nabla^2 \\left({printer._print(self.expr)}\\right)"

    def _eval_subs(self, old, new):
        if old in self.free_symbols:
            return sympy.Subs(self, old, new)
        return self


class InlineDivergence(sympy.Expr):
    def __new__(cls, field, coords, solved_value):
        if not isinstance(field, sympy.Tuple):
            field = sympy.Tuple(*field)
        if not isinstance(coords, sympy.Tuple):
            coords = sympy.Tuple(*coords)
        obj = sympy.Expr.__new__(cls, field, coords, solved_value)
        return obj

    @property
    def field(self):
        return self.args[0]

    @property
    def coords(self):
        return self.args[1]

    @property
    def _solved_value(self):
        return self.args[2]

    def doit(self, **hints):
        val = self._solved_value
        return val.doit(**hints) if hasattr(val, "doit") else val

    def _latex(self, printer):
        return f"\\nabla \\cdot {printer._print(self.field)}"

    def _eval_subs(self, old, new):
        if old in self.free_symbols:
            return sympy.Subs(self, old, new)
        return self


class InlineCurl(sympy.Expr):
    def __new__(cls, field, coords, solved_value):
        if not isinstance(field, sympy.Tuple):
            field = sympy.Tuple(*field)
        if not isinstance(coords, sympy.Tuple):
            coords = sympy.Tuple(*coords)
        obj = sympy.Expr.__new__(cls, field, coords, solved_value)
        return obj

    @property
    def field(self):
        return self.args[0]

    @property
    def coords(self):
        return self.args[1]

    @property
    def _solved_value(self):
        return self.args[2]

    def doit(self, **hints):
        val = self._solved_value
        return val.doit(**hints) if hasattr(val, "doit") else val

    def _latex(self, printer):
        return f"\\nabla \\times {printer._print(self.field)}"

    def _eval_subs(self, old, new):
        if old in self.free_symbols:
            return sympy.Subs(self, old, new)
        return self


class ImplicitDerivative(sympy.Expr):
    def __new__(cls, dep_arg, independent_symbol, order, solved_value):
        if isinstance(dep_arg, (list, tuple, sympy.Tuple)):
            dep_arg = dep_arg[0]
        obj = sympy.Expr.__new__(cls, dep_arg, independent_symbol, sympy.sympify(order), solved_value)
        return obj

    @property
    def dep_arg(self):
        return self.args[0]

    @property
    def independent_symbol(self):
        return self.args[1]

    @property
    def order(self):
        return self.args[2]

    @property
    def _solved_value(self):
        return self.args[3]

    def doit(self, **hints):
        val = self._solved_value
        return val.doit(**hints) if hasattr(val, "doit") else val

    def _latex(self, printer):
        order_val = int(self.order)
        if order_val == 1:
            return f"\\frac{{d {printer._print(self.dep_arg)}}}{{d {printer._print(self.independent_symbol)}}}"
        else:
            return f"\\frac{{d^{{{order_val}}} {printer._print(self.dep_arg)}}}{{d {printer._print(self.independent_symbol)}^{{{order_val}}}}}"

    def _eval_subs(self, old, new):
        if old in self.free_symbols:
            return sympy.Subs(self, old, new)
        return self


class InlineIntegral(sympy.Integral):
    __slots__ = ("expr_parsed", "kind", "param_source", "is_vector")

    def __new__(cls, integrand, *limits, **kwargs):
        expr_parsed = kwargs.pop("expr_parsed", None)
        kind = kwargs.pop("kind", "standard")
        param_source = kwargs.pop("param_source", None)
        is_vector = kwargs.pop("is_vector", False)

        obj = sympy.Integral.__new__(cls, integrand, *limits, **kwargs)
        obj.expr_parsed = expr_parsed
        obj.kind = kind
        obj.param_source = param_source
        obj.is_vector = is_vector
        return obj

    def _latex(self, printer):
        base_integral = sympy.Integral(self.function, *self.limits)
        iterated_latex = printer._print(base_integral)
        if self.expr_parsed is None:
            return iterated_latex

        if self.kind == "line":
            if self.is_vector:
                vector_latex = f"\\int_C \\left({printer._print(self.expr_parsed)}\\right) \\cdot d\\mathbf{{r}}"
            else:
                vector_latex = f"\\int_C \\left({printer._print(self.expr_parsed)}\\right) ds"
            return f"{vector_latex} = {iterated_latex}"
        elif self.kind == "surface":
            if self.is_vector:
                vector_latex = f"\\iint_S \\left({printer._print(self.expr_parsed)}\\right) \\cdot d\\mathbf{{S}}"
            else:
                vector_latex = f"\\iint_S \\left({printer._print(self.expr_parsed)}\\right) dS"
            return f"{vector_latex} = {iterated_latex}"
        elif self.kind == "volume":
            vector_latex = f"\\iiint_V \\left({printer._print(self.expr_parsed)}\\right) dV"
            return f"{vector_latex} = {iterated_latex}"

        return iterated_latex




def split_top_level(text, delimiter=","):
    parts = []
    current = []
    depth = 0
    in_quotes = False
    quote_char = None

    for index, char in enumerate(text):
        if in_quotes:
            current.append(char)
            if char == quote_char:
                in_quotes = False
                quote_char = None
            continue

        if char == '"' or (char == "'" and not (index > 0 and re.match(r"[a-zA-Z0-9_'}\)]", text[index - 1]))):
            in_quotes = True
            quote_char = char
            current.append(char)
            continue

        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1

        if char == delimiter and depth == 0:
            part = "".join(current).strip()
            if part:
                parts.append(part)
            current = []
            continue

        current.append(char)

    part = "".join(current).strip()
    if part:
        parts.append(part)

    return parts
def _inline_local_dict(symbols):
    local_dict = get_base_local_dict()
    for symbol in symbols:
        local_dict[symbol.name] = symbol
    return local_dict


def _parse_inline_scalar(expr, symbols, label):
    if isinstance(expr, str):
        return parse_expr(
            expr.replace("^", "**"),
            local_dict=_inline_local_dict(symbols),
            transformations=transformations,
        )
    try:
        return sympy.sympify(expr)
    except Exception as exc:
        raise ValueError(f"{label} could not parse the scalar field.") from exc


def _parse_inline_vector(field, symbols, label):
    if isinstance(field, str):
        stripped = field.strip()
        if (
            (stripped.startswith("(") and stripped.endswith(")")) or
            (stripped.startswith("[") and stripped.endswith("]"))
        ):
            stripped = stripped[1:-1].strip()

        parts = split_top_level(stripped)
    elif isinstance(field, (list, tuple, sympy.Tuple)):
        parts = list(field)
    else:
        raise ValueError(f"{label} expects a 2D or 3D vector field.")

    if len(parts) < 2 or len(parts) > 3:
        raise ValueError(f"{label} only supports 2D or 3D vector fields.")

    return [_parse_inline_scalar(part, symbols, label) for part in parts]


def grad_inline(expr, *coords):
    _expr_source, symbols, scalar = _parse_inline_vector_helper_args("grad", expr, coords)
    solved_value = sympy.Tuple(*(sympy.diff(scalar, symbol) for symbol in symbols))
    return InlineGradient(scalar, symbols, solved_value)


def _grad_component(index, label):
    def impl(expr, *coords):
        _expr_source, symbols, scalar = _parse_inline_vector_helper_args(label, expr, coords)
        if index >= len(symbols):
            raise ValueError(f"{label} requires at least {index + 1} coordinate variables.")
        return sympy.Derivative(scalar, symbols[index])
    return impl


gradx_inline = _grad_component(0, "gradx")
grady_inline = _grad_component(1, "grady")
gradz_inline = _grad_component(2, "gradz")


def lap_inline(expr, *coords):
    _expr_source, symbols, scalar = _parse_inline_vector_helper_args("lap", expr, coords)
    solved_value = sum(sympy.diff(scalar, symbol, 2) for symbol in symbols)
    return InlineLaplacian(scalar, symbols, solved_value)


def div_inline(field, *coords):
    _expr_source, symbols, components = _parse_inline_vector_helper_args("div", field, coords, field=True)
    if len(components) != len(symbols):
        raise ValueError("div requires the same number of components and coordinate variables.")
    solved_value = sum(sympy.diff(component, symbols[index]) for index, component in enumerate(components))
    return InlineDivergence(sympy.Tuple(*components), symbols, solved_value)


def curl_inline(field, *coords):
    _expr_source, symbols, components = _parse_inline_vector_helper_args("curl", field, coords, field=True)
    if len(components) != len(symbols):
        raise ValueError("curl requires the same number of components and coordinate variables.")

    if len(symbols) == 2:
        solved_value = sympy.diff(components[1], symbols[0]) - sympy.diff(components[0], symbols[1])
    elif len(symbols) == 3:
        solved_value = sympy.Tuple(
            sympy.diff(components[2], symbols[1]) - sympy.diff(components[1], symbols[2]),
            sympy.diff(components[0], symbols[2]) - sympy.diff(components[2], symbols[0]),
            sympy.diff(components[1], symbols[0]) - sympy.diff(components[0], symbols[1]),
        )
    else:
        raise ValueError("curl only supports 2D or 3D vector fields.")

    return InlineCurl(sympy.Tuple(*components), symbols, solved_value)


def curlx_inline(field, *coords):
    _expr_source, symbols, components = _parse_inline_vector_helper_args("curlx", field, coords, field=True)
    if len(symbols) != 3 or len(components) != 3:
        raise ValueError("curlx only applies to 3D vector fields.")
    return sympy.Derivative(components[2], symbols[1]) - sympy.Derivative(components[1], symbols[2])


def curly_inline(field, *coords):
    _expr_source, symbols, components = _parse_inline_vector_helper_args("curly", field, coords, field=True)
    if len(symbols) != 3 or len(components) != 3:
        raise ValueError("curly only applies to 3D vector fields.")
    return sympy.Derivative(components[0], symbols[2]) - sympy.Derivative(components[2], symbols[0])


def curlz_inline(field, *coords):
    _expr_source, symbols, components = _parse_inline_vector_helper_args("curlz", field, coords, field=True)
    if len(symbols) != 3 or len(components) != 3:
        raise ValueError("curlz only applies to 3D vector fields.")
    return sympy.Derivative(components[1], symbols[0]) - sympy.Derivative(components[0], symbols[1])

LINE_PARAM_PREFERENCES = ("t", "s", "tau", "theta", "u", "v")
SURFACE_PARAM_PREFERENCES = ("u", "v", "s", "t", "theta", "phi", "r", "w")
VECTOR_VAR_PREFERENCES = ("x", "y", "z", "r", "theta", "phi", "u", "v", "w", "s", "t")


def _find_top_level_colon(text):
    depth = 0
    in_quotes = False
    quote_char = None

    for index, char in enumerate(text):
        if in_quotes:
            if char == quote_char:
                in_quotes = False
                quote_char = None
            continue

        if char == '"' or (char == "'" and not (index > 0 and re.match(r"[a-zA-Z0-9_'}\)]", text[index - 1]))):
            in_quotes = True
            quote_char = char
            continue

        if char in "([{":
            depth += 1
            continue
        if char in ")]}":
            depth = max(0, depth - 1)
            continue

        if char == ":" and depth == 0:
            return index

    return -1


def _parse_inline_option(text):
    source = str(text or "").strip()
    colon_index = _find_top_level_colon(source)
    if colon_index == -1:
        return None

    key = source[:colon_index].strip().lower()
    value = source[colon_index + 1 :].strip()
    if not re.match(VALID_INLINE_VAR_RE, key) or not value:
        return None

    if value.startswith("{") and value.endswith("}"):
        return {"key": key, "type": "grouped", "value": value[1:-1].strip()}

    if value.startswith("[") and value.endswith("]"):
        return {"key": key, "type": "range", "value": value[1:-1].strip()}

    return {"key": key, "type": "scalar", "value": value}


def _parse_inline_variable_recipe(raw_text, label):
    variables = []
    for part in split_top_level(str(raw_text or "")):
        trimmed = part.strip()
        if not trimmed:
            continue

        order_match = re.match(r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(\d+)$", trimmed)
        if order_match:
            order = int(order_match.group(2))
            if order < 1:
                raise ValueError(f"{label} order must be a positive integer.")
            variables.append((sympy.Symbol(order_match.group(1)), order))
            continue

        if not re.match(VALID_INLINE_VAR_RE, trimmed):
            raise ValueError(f"{label} received an invalid variable name: {trimmed}")
        variables.append((sympy.Symbol(trimmed), 1))

    if not variables:
        raise ValueError(f"{label} expects at least one variable.")

    return variables


def _parse_inline_assignments(raw_text, label):
    assignments = []
    for part in split_top_level(str(raw_text or "")):
        option = _parse_inline_option(part)
        if not option or option["type"] == "range":
            raise ValueError(f"{label} expects assignments like x:expr.")
        assignments.append((option["key"], option["value"]))
    return assignments


def _extract_expr_symbols(expr_source, call_dict):
    expr = parse_expr(
        str(expr_source).replace("^", "**"),
        local_dict=call_dict,
        transformations=transformations,
    )
    return sorted(expr.free_symbols, key=lambda symbol: symbol.name)


def _infer_default_inline_variable(expr_source, call_dict, action_label):
    symbols = _extract_expr_symbols(expr_source, call_dict)
    if not symbols:
        return sympy.Symbol("x")
    if len(symbols) == 1:
        return symbols[0]
    for symbol in symbols:
        if symbol.name == "x":
            return symbol
    names = ", ".join(symbol.name for symbol in symbols)
    raise ValueError(f"Could not infer a single variable for {action_label}. Found: {names}.")


def _ordered_unique_symbols(entries):
    ordered = []
    seen = set()
    for symbol, _order in entries:
        if symbol.name in seen:
            continue
        seen.add(symbol.name)
        ordered.append(symbol)
    return ordered


def _parse_inline_range_option(source_text):
    option = _parse_inline_option(source_text)
    if not option or option["type"] != "range":
        return None

    parts = split_top_level(option["value"])
    if len(parts) != 2:
        raise ValueError(f'Range "{source_text}" must contain exactly two bounds.')

    return {
        "name": option["key"],
        "lower": parts[0].strip(),
        "upper": parts[1].strip(),
    }


def _parse_inline_parametrization(param_source, call_dict, label):
    stripped = str(param_source or "").strip()
    if (
        (stripped.startswith("(") and stripped.endswith(")"))
        or (stripped.startswith("[") and stripped.endswith("]"))
        or (stripped.startswith("{") and stripped.endswith("}"))
    ):
        parts = split_top_level(stripped[1:-1])
    else:
        parts = split_top_level(stripped)
    if not parts:
        raise ValueError(f"{label} cannot be empty.")

    return [
        parse_expr(part.replace("^", "**"), local_dict=call_dict, transformations=transformations)
        for part in parts
    ]


def _choose_parameter_symbols(expressions, expected_count, call_dict, preferences):
    candidate_names = set()
    for expr in expressions:
        for symbol in expr.free_symbols:
            if symbol.name not in ("x", "y", "z"):
                candidate_names.add(symbol.name)
                call_dict.setdefault(symbol.name, symbol)

    if len(candidate_names) == expected_count:
        ordered = sorted(
            candidate_names,
            key=lambda name: (preferences.index(name) if name in preferences else len(preferences), name),
        )
        return [call_dict[name] for name in ordered]

    preferred_names = [name for name in preferences if name in candidate_names]
    if len(preferred_names) >= expected_count:
        return [call_dict[name] for name in preferred_names[:expected_count]]

    if expected_count == 1:
        for fallback_name in ("t", "s"):
            if fallback_name in candidate_names:
                return [call_dict[fallback_name]]

    if expected_count == 2 and len(candidate_names) >= 2:
        ordered = sorted(candidate_names)
        return [call_dict[ordered[0]], call_dict[ordered[1]]]

    raise ValueError("Could not determine the parameter variables for the inline integral.")


def _unsupported_inline_vector_args_error(label):
    return ValueError(
        f"{label} no longer accepts positional coordinate arguments. "
        "Omit them and let the helper infer variables, or use vars:{...}."
    )


def _order_inline_symbols(symbols):
    unique_symbols = {}
    for symbol in symbols:
        unique_symbols[symbol.name] = symbol

    def rank(name):
        return VECTOR_VAR_PREFERENCES.index(name) if name in VECTOR_VAR_PREFERENCES else len(VECTOR_VAR_PREFERENCES)

    return [
        unique_symbols[name]
        for name in sorted(unique_symbols, key=lambda name: (rank(name), name))
    ]


def _infer_inline_scalar_vector_symbols(expr_source, call_dict):
    symbols = _order_inline_symbols(_extract_expr_symbols(expr_source, call_dict))
    return symbols or [sympy.Symbol("x")]


def _infer_inline_field_vector_symbols(parts, dimension, call_dict, label):
    candidate_symbols = []
    for part in parts:
        candidate_symbols.extend(_extract_expr_symbols(part, call_dict))

    symbols = _order_inline_symbols(candidate_symbols)
    if len(symbols) == dimension:
        return symbols

    if len(symbols) > dimension:
        return symbols[:dimension]

    if len(symbols) == 0:
        return [sympy.Symbol(name) for name in ("x", "y", "z")[:dimension]]

    if all(symbol.name in ("x", "y", "z") for symbol in symbols):
        filled = list(symbols)
        used_names = {symbol.name for symbol in filled}
        for name in ("x", "y", "z"):
            if len(filled) == dimension:
                break
            if name not in used_names:
                filled.append(sympy.Symbol(name))
                used_names.add(name)
        return filled

    raise ValueError(
        f"Could not infer {dimension} coordinate variables for {label}. "
        "Use vars:{...} to specify them explicitly."
    )


def _parse_inline_vector_helper_args(label, expr, args, field=False):
    call_dict = get_base_local_dict()
    expr_source = str(expr).strip("'\"")
    remaining = list(args)
    variable_recipe = None

    for arg in remaining:
        if not isinstance(arg, str):
            raise _unsupported_inline_vector_args_error(label)

        option = _parse_inline_option(arg)
        if not option:
            if re.match(VALID_INLINE_VAR_RE, arg.strip()):
                raise _unsupported_inline_vector_args_error(label)
            raise ValueError(f'Unsupported {label} helper argument "{arg}".')

        if option["key"] != "vars":
            raise ValueError(f'{label} does not support option "{option["key"]}".')

        variable_recipe = _parse_inline_variable_recipe(option["value"], label)
        if any(order != 1 for _symbol, order in variable_recipe):
            raise ValueError(f"{label} vars do not support derivative-style order markers.")

        names = [symbol.name for symbol, _order in variable_recipe]
        if len(set(names)) != len(names):
            raise ValueError(f"{label} coordinate variables must be unique.")

    if field:
        if isinstance(expr, str):
            stripped = expr_source.strip()
            if (
                (stripped.startswith("(") and stripped.endswith(")"))
                or (stripped.startswith("[") and stripped.endswith("]"))
            ):
                stripped = stripped[1:-1].strip()
            parts = split_top_level(stripped)
        elif isinstance(expr, (list, tuple, sympy.Tuple)):
            parts = [str(part) for part in expr]
        else:
            raise ValueError(f"{label} only supports 2D or 3D vector fields.")

        if len(parts) < 2 or len(parts) > 3:
            raise ValueError(f"{label} only supports 2D or 3D vector fields.")

        if variable_recipe:
            symbols = [symbol for symbol, _order in variable_recipe]
        else:
            symbols = _infer_inline_field_vector_symbols(parts, len(parts), call_dict, label)

        components = _parse_inline_vector(expr_source, symbols, label)
        return expr_source, symbols, components

    if variable_recipe:
        symbols = [symbol for symbol, _order in variable_recipe]
    else:
        symbols = _infer_inline_scalar_vector_symbols(expr_source, call_dict)

    if len(symbols) < 1 or len(symbols) > 3:
        raise ValueError(f"{label} only supports 1 to 3 coordinate variables.")

    scalar = _parse_inline_scalar(expr_source, symbols, label)
    return expr_source, symbols, scalar


def deriv_inline(expr, *args):
    call_dict = get_base_local_dict()
    expr_source = str(expr).strip("'\"")
    remaining = list(args)

    variable_recipe = None
    dep_vars = None
    positional_values = []
    assignment_specs = []

    has_option_like = any(isinstance(arg, str) and _parse_inline_option(arg) for arg in remaining)
    if remaining and isinstance(remaining[0], str) and re.match(VALID_INLINE_VAR_RE, remaining[0]) and not has_option_like:
        variable_recipe = [(sympy.Symbol(remaining[0]), 1)]
        positional_values = remaining[1:]
    else:
        for arg in remaining:
            if not isinstance(arg, str):
                positional_values.append(arg)
                continue

            option = _parse_inline_option(arg)
            if not option:
                if variable_recipe is None and re.match(VALID_INLINE_VAR_RE, arg):
                    variable_recipe = [(sympy.Symbol(arg), 1)]
                    continue
                positional_values.append(arg)
                continue

            if option["key"] == "vars":
                variable_recipe = _parse_inline_variable_recipe(option["value"], "deriv")
                continue

            if option["key"] == "dep":
                dep_vars = [sympy.Symbol(name.strip()) for name in split_top_level(option["value"]) if name.strip()]
                continue

            if option["key"] == "at":
                assignment_specs = _parse_inline_assignments(option["value"], "deriv at")
                continue

            raise ValueError(f'deriv does not support option "{option["key"]}".')

    if variable_recipe is None:
        exclude_names = {sym.name for sym in dep_vars} if dep_vars else set()
        symbols = _extract_expr_symbols(expr_source, call_dict)
        filtered_symbols = [sym for sym in symbols if sym.name not in exclude_names]
        if not filtered_symbols:
            ind_sym = sympy.Symbol("x")
        elif len(filtered_symbols) == 1:
            ind_sym = filtered_symbols[0]
        else:
            ind_sym = next((sym for sym in filtered_symbols if sym.name == "x"), None)
            if ind_sym is None:
                names = ", ".join(sym.name for sym in filtered_symbols)
                raise ValueError(f"Could not infer a single independent variable for inline differentiation. Found: {names}.")
        variable_recipe = [(ind_sym, 1)]

    for symbol, _order in variable_recipe:
        call_dict[symbol.name] = symbol

    if dep_vars:
        for symbol in dep_vars:
            call_dict[symbol.name] = symbol

    # Parse expression/equation
    if "=" in expr_source:
        lhs_str, rhs_str = expr_source.split("=", 1)
        lhs_parsed = parse_expr(lhs_str.replace("^", "**"), local_dict=call_dict, transformations=transformations)
        rhs_parsed = parse_expr(rhs_str.replace("^", "**"), local_dict=call_dict, transformations=transformations)
        expr_parsed = lhs_parsed - rhs_parsed
    else:
        expr_parsed = parse_expr(expr_source.replace("^", "**"), local_dict=call_dict, transformations=transformations)

    if dep_vars:
        if len(variable_recipe) != 1:
            raise ValueError("Implicit differentiation requires exactly one independent variable.")
        independent_symbol, order = variable_recipe[0]
        from sympy.geometry.util import idiff
        dep_arg = dep_vars[0] if len(dep_vars) == 1 else dep_vars
        solved_value = idiff(expr_parsed, dep_arg, independent_symbol, order)
        result = ImplicitDerivative(dep_arg, independent_symbol, order, solved_value)
    else:
        result = sympy.Derivative(expr_parsed, *variable_recipe)

    unique_symbols = _ordered_unique_symbols(variable_recipe)
    if positional_values and len(positional_values) != len(unique_symbols):
        raise ValueError("deriv positional evaluation arguments must match the number of unique variables.")

    substitutions = {}
    for symbol, value in zip(unique_symbols, positional_values):
        substitutions[symbol] = value

    for name, expr_text in assignment_specs:
        symbol = sympy.Symbol(name)
        call_dict[name] = symbol
        substitutions[symbol] = parse_expr(
            expr_text.replace("^", "**"),
            local_dict=call_dict,
            transformations=transformations,
        )

    if substitutions:
        result = result.subs(substitutions)

    return result


def integ_inline(expr, *args):
    call_dict = get_base_local_dict()
    expr_source = str(expr).strip("'\"")
    remaining = list(args)

    kind = None
    param_source = None
    ranges = []
    variable_recipe = None

    has_option_like = any(isinstance(arg, str) and _parse_inline_option(arg) for arg in remaining)
    if remaining and isinstance(remaining[0], str) and re.match(VALID_INLINE_VAR_RE, remaining[0]) and not has_option_like:
        variable_name = remaining[0]
        if len(remaining) == 1:
            variable_recipe = [(sympy.Symbol(variable_name), 1)]
        else:
            raise ValueError(
                'Definite integ syntax no longer accepts positional bounds. '
                'Use integ[expr, x:[lower, upper]] or integ("expr", "x:[lower, upper]").'
            )
    else:
        for arg in remaining:
            if not isinstance(arg, str):
                raise ValueError("integ helper options must be written as strings.")

            range_option = _parse_inline_range_option(arg)
            if range_option:
                ranges.append(range_option)
                continue

            option = _parse_inline_option(arg)
            if not option:
                if variable_recipe is None and re.match(VALID_INLINE_VAR_RE, arg):
                    variable_recipe = [(sympy.Symbol(arg), 1)]
                    continue
                raise ValueError(f'Unsupported integ helper argument "{arg}".')

            if option["key"] == "kind":
                kind = option["value"].lower()
                continue

            if option["key"] == "param":
                param_source = option["value"]
                continue

            if option["key"] == "vars":
                variable_recipe = _parse_inline_variable_recipe(option["value"], "integ")
                if any(order != 1 for _symbol, order in variable_recipe):
                    raise ValueError("integ vars do not support derivative-style order markers.")
                continue

            raise ValueError(f'integ does not support option "{option["key"]}".')

    if kind and kind not in {"line", "surface", "volume"}:
        raise ValueError(f'Unsupported inline integral kind "{kind}".')

    if kind == "line":
        if not param_source or len(ranges) != 1:
            raise ValueError("integ kind:line requires param:{...} and exactly one range.")

        coords = {name: sympy.Symbol(name) for name in ("x", "y", "z")}
        call_dict.update(coords)
        expr_parsed = _parse_inline_scalar(expr_source, tuple(coords.values()), "integ")
        expr_eval = expr_parsed.doit() if hasattr(expr_parsed, "doit") else expr_parsed
        if isinstance(expr_eval, (sympy.Tuple, sympy.MatrixBase, list, tuple)):
            vector_parts = list(expr_eval)
        else:
            vector_parts = None
        path_components = _parse_inline_parametrization(param_source, call_dict, "Line parametrization")
        if len(path_components) not in (2, 3):
            raise ValueError("Line-integral parametrizations must have 2 or 3 components.")

        param_symbol = _choose_parameter_symbols(path_components, 1, call_dict, LINE_PARAM_PREFERENCES)[0]
        lower = parse_expr(str(ranges[0]["lower"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)
        upper = parse_expr(str(ranges[0]["upper"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)
        substitution_map = {coords["x"]: path_components[0], coords["y"]: path_components[1]}
        if len(path_components) == 3:
            substitution_map[coords["z"]] = path_components[2]

        if vector_parts and len(vector_parts) == len(path_components):
            tangent = [sympy.diff(component, param_symbol) for component in path_components]
            substituted = [component.subs(substitution_map) for component in vector_parts]
            integrand = sum(component * derivative for component, derivative in zip(substituted, tangent))
        else:
            speed = sympy.sqrt(sum(sympy.diff(component, param_symbol) ** 2 for component in path_components))
        is_vector = bool(vector_parts and len(vector_parts) == len(path_components))
        return InlineIntegral(
            integrand,
            (param_symbol, lower, upper),
            expr_parsed=expr_parsed,
            kind="line",
            param_source=param_source,
            is_vector=is_vector,
        )


    if kind == "surface":
        if not param_source or len(ranges) != 2:
            raise ValueError("integ kind:surface requires param:{...} and exactly two ranges.")

        coords = {name: sympy.Symbol(name) for name in ("x", "y", "z")}
        call_dict.update(coords)
        expr_parsed = _parse_inline_scalar(expr_source, tuple(coords.values()), "integ")
        expr_eval = expr_parsed.doit() if hasattr(expr_parsed, "doit") else expr_parsed
        if isinstance(expr_eval, (sympy.Tuple, sympy.MatrixBase, list, tuple)):
            vector_parts = list(expr_eval)
        else:
            vector_parts = None
        surface_components = _parse_inline_parametrization(param_source, call_dict, "Surface parametrization")
        if len(surface_components) != 3:
            raise ValueError("Surface-integral parametrizations must have exactly 3 components.")

        param_symbols = _choose_parameter_symbols(surface_components, 2, call_dict, SURFACE_PARAM_PREFERENCES)
        first_param, second_param = param_symbols
        range_by_name = {entry["name"]: entry for entry in ranges}
        first_range = range_by_name.get(first_param.name, ranges[0])
        second_range = range_by_name.get(second_param.name, ranges[1])

        first_lower = parse_expr(str(first_range["lower"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)
        first_upper = parse_expr(str(first_range["upper"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)
        second_lower = parse_expr(str(second_range["lower"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)
        second_upper = parse_expr(str(second_range["upper"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)

        substitution_map = {
            coords["x"]: surface_components[0],
            coords["y"]: surface_components[1],
            coords["z"]: surface_components[2],
        }
        r_u = sympy.Matrix([sympy.diff(component, first_param) for component in surface_components])
        r_v = sympy.Matrix([sympy.diff(component, second_param) for component in surface_components])
        normal = sympy.simplify(r_u.cross(r_v))

        if vector_parts and len(vector_parts) == 3:
            substituted = sympy.Matrix([component.subs(substitution_map) for component in vector_parts])
            integrand = substituted.dot(normal)
        else:
            integrand = expr_parsed.subs(substitution_map) * sympy.sqrt(normal.dot(normal))

        is_vector = bool(vector_parts and len(vector_parts) == 3)
        return InlineIntegral(
            integrand,
            (second_param, second_lower, second_upper),
            (first_param, first_lower, first_upper),
            expr_parsed=expr_parsed,
            kind="surface",
            param_source=param_source,
            is_vector=is_vector,
        )


    if kind == "volume":
        if len(ranges) != 3:
            raise ValueError("integ kind:volume requires exactly three ranges.")

        coords = {name: sympy.Symbol(name) for name in ("x", "y", "z")}
        call_dict.update(coords)
        expr_parsed = parse_expr(expr_source.replace("^", "**"), local_dict=call_dict, transformations=transformations)
        range_by_name = {entry["name"]: entry for entry in ranges}
        x_range = range_by_name.get("x", ranges[0])
        y_range = range_by_name.get("y", ranges[1])
        z_range = range_by_name.get("z", ranges[2])

        return InlineIntegral(
            expr_parsed,
            (coords["z"], parse_expr(str(z_range["lower"]).replace("^", "**"), local_dict=call_dict, transformations=transformations), parse_expr(str(z_range["upper"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)),
            (coords["y"], parse_expr(str(y_range["lower"]).replace("^", "**"), local_dict=call_dict, transformations=transformations), parse_expr(str(y_range["upper"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)),
            (coords["x"], parse_expr(str(x_range["lower"]).replace("^", "**"), local_dict=call_dict, transformations=transformations), parse_expr(str(x_range["upper"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)),
            expr_parsed=expr_parsed,
            kind="volume",
        )


    for range_entry in ranges:
        call_dict[range_entry["name"]] = sympy.Symbol(range_entry["name"])

    if variable_recipe is None and not ranges:
        variable_recipe = [(_infer_default_inline_variable(expr_source, call_dict, "inline integration"), 1)]

    expr_parsed = parse_expr(expr_source.replace("^", "**"), local_dict=call_dict, transformations=transformations)

    if ranges:
        integrate_args = []
        for range_entry in ranges:
            symbol = call_dict[range_entry["name"]]
            lower = parse_expr(str(range_entry["lower"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)
            upper = parse_expr(str(range_entry["upper"]).replace("^", "**"), local_dict=call_dict, transformations=transformations)
            integrate_args.append((symbol, lower, upper))
        integrate_args.reverse()
        return sympy.Integral(expr_parsed, *integrate_args)

    variable_symbols = []
    for symbol, _order in variable_recipe:
        call_dict[symbol.name] = symbol
        variable_symbols.append(symbol)

    integrate_args = list(reversed(variable_symbols))
    return sympy.Integral(expr_parsed, *integrate_args)


def get_base_local_dict():
    base_dict = {
        "ln": sympy.log,
        "arcsin": sympy.asin,
        "arccos": sympy.acos,
        "arctan": sympy.atan,
        "arccot": sympy.acot,
        "arcsec": sympy.asec,
        "arccsc": sympy.acsc,
        "arcsinh": sympy.asinh,
        "arccosh": sympy.acosh,
        "arctanh": sympy.atanh,
        "arccoth": sympy.acoth,
        "arcsech": sympy.asech,
        "arccsch": sympy.acsch,
        "cosec": sympy.csc,
        "cosech": sympy.csch,
        "tg": sympy.tan,
        "ctg": sympy.cot,
        "arctg": sympy.atan,
        "arcctg": sympy.acot,
        "pi": sympy.pi,
        "e": sympy.E,
        "inf": sympy.oo,
        "infinity": sympy.oo,
        "grad": grad_inline,
        "gradx": gradx_inline,
        "grady": grady_inline,
        "gradz": gradz_inline,
        "lap": lap_inline,
        "div": div_inline,
        "curl": curl_inline,
        "curlx": curlx_inline,
        "curly": curly_inline,
        "curlz": curlz_inline,
        "deriv": deriv_inline,
        "integ": integ_inline,
    }
    
    # Map all uppercase letters A-Z to Symbols to prevent conflicts with SymPy built-in constants (like E, I)
    for char_code in range(65, 91):
        letter = chr(char_code)
        base_dict[letter] = sympy.Symbol(letter)
        
    return base_dict
