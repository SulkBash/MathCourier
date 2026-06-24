import json
import re
import sys

import sympy
from sympy.parsing.sympy_parser import parse_expr

from math_utils import get_base_local_dict, transformations

try:
    import numpy as np
    from scipy import integrate as scipy_integrate

    HAS_SCIPY = True
except Exception:
    np = None
    scipy_integrate = None
    HAS_SCIPY = False


local_dict = get_base_local_dict()
VALID_VAR_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
COORDINATE_NAMES = ("x", "y", "z")
LINE_PARAM_PREFERENCES = ("t", "s", "tau", "theta", "u", "v")
SURFACE_PARAM_PREFERENCES = ("u", "v", "s", "t", "theta", "phi", "r", "w")


def emit(payload):
    print(json.dumps(payload))


def parse_math_expr(expr_str, call_dict):
    return parse_expr(
        expr_str.replace("^", "**"),
        local_dict=call_dict,
        transformations=transformations,
    )


def split_top_level(text, delimiter=","):
    parts = []
    current = []
    depth = 0

    for char in text:
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == delimiter and depth == 0:
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


def tuple_latex(items):
    return sympy.latex(sympy.Tuple(*items))


def parse_parametrization(expr_str, call_dict, label):
    stripped = expr_str.strip()
    if not (stripped.startswith("(") and stripped.endswith(")")):
        raise ValueError(f"{label} must be written as a tuple like (x(t), y(t)) or (x(u,v), y(u,v), z(u,v)).")

    inner = stripped[1:-1]
    parts = split_top_level(inner)
    if not parts:
        raise ValueError(f"{label} cannot be empty.")

    return [parse_math_expr(part, call_dict) for part in parts]


def parse_field(expr_str, call_dict):
    stripped = expr_str.strip()
    try:
        expr = parse_math_expr(stripped, call_dict)
        if isinstance(expr, (sympy.Tuple, sympy.MatrixBase, list, tuple)):
            return {
                "kind": "vector",
                "components": list(expr),
            }
        return {
            "kind": "scalar",
            "expr": expr,
        }
    except Exception:
        if stripped.startswith("(") and stripped.endswith(")"):
            inner = stripped[1:-1]
            parts = split_top_level(inner)
            if len(parts) < 2:
                raise ValueError("Vector fields must contain at least two components.")
            return {
                "kind": "vector",
                "components": [parse_math_expr(part, call_dict) for part in parts],
            }
        return {
            "kind": "scalar",
            "expr": parse_math_expr(stripped, call_dict),
        }


def choose_parameter_symbols(expressions, expected_count, call_dict, preferences):
    candidate_names = set()
    for expr in expressions:
        for symbol in expr.free_symbols:
            if symbol.name not in COORDINATE_NAMES:
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
        for pair in (("u", "v"), ("s", "t"), ("theta", "phi")):
            if all(name in candidate_names for name in pair):
                return [call_dict[pair[0]], call_dict[pair[1]]]

    expected_text = "one parameter variable" if expected_count == 1 else "two parameter variables"
    raise ValueError(
        f"Could not determine {expected_text} from the parametrization. "
        f"Use conventional names like {', '.join(preferences[:expected_count])}."
    )


def numeric_bounds(limits):
    bounds = []
    for _, lower, upper in limits:
        lower_eval = sympy.N(lower)
        upper_eval = sympy.N(upper)
        if lower_eval.free_symbols or upper_eval.free_symbols:
            raise ValueError("Numerical fallback requires numeric integration bounds.")
        bounds.append([float(lower_eval), float(upper_eval)])
    return bounds


def make_numeric_callable(expr, variables):
    func = sympy.lambdify(variables, expr, modules=["numpy"])

    def wrapped(*values):
        numeric = np.real_if_close(func(*values))
        if hasattr(numeric, "item"):
            numeric = numeric.item()
        return float(numeric)

    return wrapped


def evaluate_definite_integral(integrand, limits, failure_label):
    simplified_integrand = sympy.simplify(integrand)
    symbolic_result = sympy.integrate(simplified_integrand, *limits)

    if not symbolic_result.has(sympy.Integral):
        return simplified_integrand, symbolic_result, "="

    if not HAS_SCIPY:
        raise ValueError(f"{failure_label} could not be evaluated symbolically, and SciPy is not installed for numerical fallback.")

    bounds = numeric_bounds(limits)
    variables = [limit[0] for limit in limits]
    callable_expr = make_numeric_callable(simplified_integrand, variables)

    try:
        numeric_result, _ = scipy_integrate.nquad(lambda *vals: callable_expr(*vals), bounds)
    except Exception as exc:
        raise ValueError(f"{failure_label} could not be evaluated symbolically or numerically: {str(exc)}") from exc

    return simplified_integrand, sympy.Float(numeric_result, 12), "\\approx"


def build_latex(lines):
    return "\\begin{aligned}\n" + " \\\\\n".join(lines) + "\n\\end{aligned}"


def format_result_lines(field_label, field_expr, parametrization_label, parametrization_expr, integral_label, transformed_integral, result, relation):
    return build_latex([
        f"{field_label} &= {field_expr}",
        f"{parametrization_label} &= {parametrization_expr}",
        f"{integral_label} &= {transformed_integral}",
        f"&{relation} {sympy.latex(result)}",
    ])


def handle_idiff(expr_str, dep_input, independent_var, order):
    call_dict = local_dict.copy()

    # Parse dependent variables
    dep_vars = []
    for var in dep_input:
        var_name = str(var).strip()
        if not VALID_VAR_RE.match(var_name):
            raise ValueError(f"Invalid dependent variable name '{var_name}'.")
        var_sym = sympy.Symbol(var_name)
        call_dict[var_name] = var_sym
        dep_vars.append(var_sym)

    # Parse independent variable
    ind_name = str(independent_var).strip()
    if not VALID_VAR_RE.match(ind_name):
        raise ValueError(f"Invalid independent variable name '{ind_name}'.")
    ind_sym = sympy.Symbol(ind_name)
    call_dict[ind_name] = ind_sym

    # If expression contains '=', split it and do lhs - rhs
    if "=" in expr_str:
        lhs_str, rhs_str = expr_str.split("=", 1)
        lhs_parsed = parse_math_expr(lhs_str, call_dict)
        rhs_parsed = parse_math_expr(rhs_str, call_dict)
        expr_parsed = lhs_parsed - rhs_parsed
    else:
        expr_parsed = parse_math_expr(expr_str, call_dict)

    from sympy.geometry.util import idiff
    dep_arg = dep_vars[0] if len(dep_vars) == 1 else dep_vars
    result = idiff(expr_parsed, dep_arg, ind_sym, int(order))

    # Generate LaTeX representation
    dep_str = ", ".join(v.name for v in dep_vars)
    d_num = f"d{dep_str}" if order == 1 else f"d^{{{order}}}{dep_str}"
    d_den = f"d{ind_sym.name}" if order == 1 else f"d{ind_sym.name}^{{{order}}}"

    lhs_latex = f"\\frac{{{d_num}}}{{{d_den}}}"
    result_latex = sympy.latex(result)

    # Format original equation nicely
    orig_eq_latex = sympy.latex(expr_parsed) + " = 0"
    if "=" in expr_str:
        try:
            lhs_str, rhs_str = expr_str.split("=", 1)
            lhs_l = sympy.latex(parse_math_expr(lhs_str, call_dict))
            rhs_l = sympy.latex(parse_math_expr(rhs_str, call_dict))
            orig_eq_latex = f"{lhs_l} = {rhs_l}"
        except Exception:
            pass

    return build_latex([
        f"{orig_eq_latex}",
        f"{lhs_latex} &= {result_latex}"
    ])


def handle_diff(expr_str, args_input):
    if not args_input:
        args_input = ["x"]

    diff_args = []
    call_dict = local_dict.copy()

    for arg in args_input:
        if isinstance(arg, int):
            diff_args.append(arg)
        else:
            var_name = str(arg).strip()
            if not VALID_VAR_RE.match(var_name):
                raise ValueError(f"Invalid variable name '{var_name}'.")
            var_sym = sympy.Symbol(var_name)
            call_dict[var_name] = var_sym
            diff_args.append(var_sym)

    expr_parsed = parse_math_expr(expr_str, call_dict)
    result = sympy.diff(expr_parsed, *diff_args)

    deriv_op = sympy.Derivative(expr_parsed, *diff_args)
    deriv_latex = sympy.latex(deriv_op)
    result_latex = sympy.latex(result)

    return build_latex([
        f"{deriv_latex} &= {result_latex}",
    ])


def handle_standard_integral(expr_str, args_input):
    if not args_input:
        args_input = [{"variable": "x"}]

    call_dict = local_dict.copy()

    for arg in args_input:
        var_name = arg.get("variable", "x").strip()
        if not VALID_VAR_RE.match(var_name):
            raise ValueError(f"Invalid integration variable name '{var_name}'.")
        call_dict[var_name] = sympy.Symbol(var_name)

    expr_parsed = parse_math_expr(expr_str, call_dict)

    int_args = []
    has_limits = False
    for arg in args_input:
        var_name = arg.get("variable", "x").strip()
        var_sym = call_dict[var_name]

        lower_str = arg.get("lower")
        upper_str = arg.get("upper")

        if (lower_str is not None) and (upper_str is not None):
            has_limits = True
            lower_parsed = parse_math_expr(str(lower_str), call_dict)
            upper_parsed = parse_math_expr(str(upper_str), call_dict)
            int_args.append((var_sym, lower_parsed, upper_parsed))
        else:
            int_args.append(var_sym)

    int_args.reverse()
    result = sympy.integrate(expr_parsed, *int_args)

    if result.has(sympy.Integral):
        if has_limits:
            eval_success = False
            try:
                eval_res = result.evalf()
                if eval_res.is_number and not eval_res.has(sympy.Integral):
                    result_latex = sympy.latex(eval_res.evalf(8))
                    relation = "\\approx"
                    eval_success = True
            except Exception:
                pass

            if not eval_success:
                if HAS_SCIPY:
                    try:
                        bounds = numeric_bounds(int_args)
                        variables = [limit[0] for limit in int_args]
                        callable_expr = make_numeric_callable(expr_parsed, variables)
                        numeric_result, _ = scipy_integrate.nquad(lambda *vals: callable_expr(*vals), bounds)
                        result_latex = sympy.latex(sympy.Float(numeric_result, 8))
                        relation = "\\approx"
                    except Exception as exc:
                        raise ValueError(f"Could not evaluate definite integral symbolically or numerically: {str(exc)}") from exc
                else:
                    raise ValueError("Could not evaluate definite integral symbolically, and SciPy is not installed for numerical fallback.")
        else:
            if len(int_args) == 1 and isinstance(int_args[0], sympy.Symbol):
                var_sym = int_args[0]
                try:
                    series_approx = expr_parsed.series(var_sym, 0, 8).removeO()
                    integrated_series = sympy.integrate(series_approx, var_sym)
                    integral_op_latex = sympy.latex(sympy.Integral(expr_parsed, var_sym))

                    return build_latex([
                        f"{integral_op_latex} &\\approx {sympy.latex(integrated_series)} + C",
                        f"&\\text{{(Taylor series approximation around }}{sympy.latex(var_sym)}=0\\text{{)}}",
                    ])
                except Exception:
                    pass

            raise ValueError("Could not find a symbolic antiderivative for the expression.")
    else:
        result_latex = sympy.latex(result)
        relation = "="

    integral_op = sympy.Integral(expr_parsed, *int_args)
    integral_op_latex = sympy.latex(integral_op)

    if has_limits:
        return build_latex([
            f"{integral_op_latex} &{relation} {result_latex}",
        ])

    return build_latex([
        f"{integral_op_latex} &= {result_latex} + C",
    ])


def handle_line_integral(input_data):
    call_dict = local_dict.copy()
    coords = {name: sympy.Symbol(name) for name in COORDINATE_NAMES}
    call_dict.update(coords)

    path_components = parse_parametrization(input_data.get("parametrization", ""), call_dict, "Path parametrization")
    if len(path_components) not in (2, 3):
        raise ValueError("Line integral paths must have 2 or 3 components.")

    param_symbol = choose_parameter_symbols(path_components, 1, call_dict, LINE_PARAM_PREFERENCES)[0]
    field = parse_field(input_data.get("field", ""), call_dict)

    if field["kind"] == "vector" and len(field["components"]) != len(path_components):
        raise ValueError("Vector field dimension must match the path dimension.")

    range_data = input_data.get("ranges", [])
    if len(range_data) != 1:
        raise ValueError("Line integrals require exactly one parameter range.")

    lower = parse_math_expr(str(range_data[0]["lower"]), call_dict)
    upper = parse_math_expr(str(range_data[0]["upper"]), call_dict)

    substitution_map = {
        coords["x"]: path_components[0],
        coords["y"]: path_components[1],
    }
    coord_names = ["x", "y"]
    if len(path_components) == 3:
        substitution_map[coords["z"]] = path_components[2]
        coord_names.append("z")

    if field["kind"] == "vector":
        tangent = [sympy.diff(component, param_symbol) for component in path_components]
        substituted_field = [component.subs(substitution_map) for component in field["components"]]
        integrand = sum(component * tangent_component for component, tangent_component in zip(substituted_field, tangent))
        field_label = f"\\mathbf{{F}}({', '.join(coord_names)})"
        field_expr = tuple_latex(field["components"])
        operator_label = "\\int_C \\mathbf{F} \\cdot d\\mathbf{r}"
    else:
        speed = sympy.sqrt(sum(sympy.diff(component, param_symbol) ** 2 for component in path_components))
        substituted_field = field["expr"].subs(substitution_map)
        integrand = substituted_field * speed
        field_label = f"f({', '.join(coord_names)})"
        field_expr = sympy.latex(field["expr"])
        operator_label = "\\int_C f\\, ds"

    integrand, result, relation = evaluate_definite_integral(
        integrand,
        [(param_symbol, lower, upper)],
        "Line integral",
    )

    parametrization_label = f"\\mathbf{{r}}({sympy.latex(param_symbol)})"
    parametrization_expr = (
        f"{tuple_latex(path_components)},\\quad "
        f"{sympy.latex(lower)} \\le {sympy.latex(param_symbol)} \\le {sympy.latex(upper)}"
    )
    transformed_integral = sympy.latex(sympy.Integral(integrand, (param_symbol, lower, upper)))

    return format_result_lines(
        field_label,
        field_expr,
        parametrization_label,
        parametrization_expr,
        operator_label,
        transformed_integral,
        result,
        relation,
    )


def handle_surface_integral(input_data):
    call_dict = local_dict.copy()
    coords = {name: sympy.Symbol(name) for name in COORDINATE_NAMES}
    call_dict.update(coords)

    surface_components = parse_parametrization(input_data.get("parametrization", ""), call_dict, "Surface parametrization")
    if len(surface_components) != 3:
        raise ValueError("Surface parametrizations must have exactly three components.")

    params = choose_parameter_symbols(surface_components, 2, call_dict, SURFACE_PARAM_PREFERENCES)
    first_param, second_param = params
    field = parse_field(input_data.get("field", ""), call_dict)

    if field["kind"] == "vector" and len(field["components"]) != 3:
        raise ValueError("Surface vector fields must have exactly three components.")

    range_data = input_data.get("ranges", [])
    if len(range_data) != 2:
        raise ValueError("Surface integrals require two parameter ranges.")

    first_range = None
    second_range = None

    # Try matching by label names
    for r in range_data:
        label = r.get("label")
        if label == first_param.name:
            first_range = r
        elif label == second_param.name:
            second_range = r

    # Fallback to positional matching for unassigned ones
    for r in range_data:
        if r.get("label") is None:
            if not first_range:
                first_range = r
            elif not second_range:
                second_range = r

    if not first_range or not second_range:
        raise ValueError("Could not map parameter ranges. Make sure they are provided positionally or match u and v.")

    first_lower = parse_math_expr(str(first_range["lower"]), call_dict)
    first_upper = parse_math_expr(str(first_range["upper"]), call_dict)
    second_lower = parse_math_expr(str(second_range["lower"]), call_dict)
    second_upper = parse_math_expr(str(second_range["upper"]), call_dict)

    substitution_map = {
        coords["x"]: surface_components[0],
        coords["y"]: surface_components[1],
        coords["z"]: surface_components[2],
    }

    r_u = sympy.Matrix([sympy.diff(component, first_param) for component in surface_components])
    r_v = sympy.Matrix([sympy.diff(component, second_param) for component in surface_components])
    normal = sympy.simplify(r_u.cross(r_v))

    if field["kind"] == "vector":
        substituted_field = sympy.Matrix([component.subs(substitution_map) for component in field["components"]])
        integrand = substituted_field.dot(normal)
        field_label = "\\mathbf{F}(x, y, z)"
        field_expr = tuple_latex(field["components"])
        operator_label = "\\iint_S \\mathbf{F} \\cdot d\\mathbf{S}"
    else:
        area_density = sympy.sqrt(normal.dot(normal))
        substituted_field = field["expr"].subs(substitution_map)
        integrand = substituted_field * area_density
        field_label = "f(x, y, z)"
        field_expr = sympy.latex(field["expr"])
        operator_label = "\\iint_S f\\, dS"

    integrand, result, relation = evaluate_definite_integral(
        integrand,
        [
            (first_param, first_lower, first_upper),
            (second_param, second_lower, second_upper),
        ],
        "Surface integral",
    )

    parametrization_label = f"\\mathbf{{r}}({sympy.latex(first_param)}, {sympy.latex(second_param)})"
    parametrization_expr = (
        f"{tuple_latex(surface_components)},\\quad "
        f"{sympy.latex(first_lower)} \\le {sympy.latex(first_param)} \\le {sympy.latex(first_upper)},\\quad "
        f"{sympy.latex(second_lower)} \\le {sympy.latex(second_param)} \\le {sympy.latex(second_upper)}"
    )
    transformed_integral = sympy.latex(
        sympy.Integral(
            integrand,
            (first_param, first_lower, first_upper),
            (second_param, second_lower, second_upper),
        )
    )

    return format_result_lines(
        field_label,
        field_expr,
        parametrization_label,
        parametrization_expr,
        operator_label,
        transformed_integral,
        result,
        relation,
    )


def handle_volume_integral(input_data):
    call_dict = local_dict.copy()
    coords = {name: sympy.Symbol(name) for name in COORDINATE_NAMES}
    call_dict.update(coords)

    expr_str = input_data.get("expr", "").strip()
    if not expr_str:
        raise ValueError("Volume integrals require a scalar field expression.")

    range_data = input_data.get("ranges", [])
    if len(range_data) != 3:
        raise ValueError("Volume integrals require exactly three ranges.")

    x_range = None
    y_range = None
    z_range = None

    # Try matching by label names
    for r in range_data:
        label = r.get("label")
        if label == "x":
            x_range = r
        elif label == "y":
            y_range = r
        elif label == "z":
            z_range = r

    # Fallback to positional matching for unassigned ones
    for r in range_data:
        if r.get("label") is None:
            if not x_range:
                x_range = r
            elif not y_range:
                y_range = r
            elif not z_range:
                z_range = r

    if not x_range or not y_range or not z_range:
        raise ValueError("Could not map volume integral ranges. Make sure they are provided positionally or match x, y, and z.")

    expr_parsed = parse_math_expr(expr_str, call_dict)
    x_lower = parse_math_expr(str(x_range["lower"]), call_dict)
    x_upper = parse_math_expr(str(x_range["upper"]), call_dict)
    y_lower = parse_math_expr(str(y_range["lower"]), call_dict)
    y_upper = parse_math_expr(str(y_range["upper"]), call_dict)
    z_lower = parse_math_expr(str(z_range["lower"]), call_dict)
    z_upper = parse_math_expr(str(z_range["upper"]), call_dict)

    integrand, result, relation = evaluate_definite_integral(
        expr_parsed,
        [
            (coords["z"], z_lower, z_upper),
            (coords["y"], y_lower, y_upper),
            (coords["x"], x_lower, x_upper),
        ],
        "Volume integral",
    )

    transformed_integral = sympy.latex(
        sympy.Integral(
            integrand,
            (coords["z"], z_lower, z_upper),
            (coords["y"], y_lower, y_upper),
            (coords["x"], x_lower, x_upper),
        )
    )

    return build_latex([
        f"f(x, y, z) &= {sympy.latex(expr_parsed)}",
        (
            "\\text{Bounds} &= "
            f"{sympy.latex(x_lower)} \\le x \\le {sympy.latex(x_upper)},\\ "
            f"{sympy.latex(y_lower)} \\le y \\le {sympy.latex(y_upper)},\\ "
            f"{sympy.latex(z_lower)} \\le z \\le {sympy.latex(z_upper)}"
        ),
        f"\\iiint_V f\\, dV &= {transformed_integral}",
        f"&{relation} {sympy.latex(result)}",
    ])


def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except Exception as exc:
        emit({"success": False, "error": f"Failed to parse input JSON: {str(exc)}"})
        return

    operation = input_data.get("operation", "int")
    expr_str = input_data.get("expr", "").strip()

    try:
        if operation == "idiff":
            dep_input = input_data.get("dep")
            independent_var = input_data.get("independentVar", "x")
            order = input_data.get("order", 1)

            if not expr_str:
                raise ValueError("No mathematical expression/equation provided.")
            if not dep_input:
                raise ValueError("No dependent variables provided for implicit differentiation.")

            emit({"success": True, "latex": handle_idiff(expr_str, dep_input, independent_var, order)})
            return

        if operation == "diff":
            args_input = input_data.get("args")
            if args_input is None:
                var_str = input_data.get("variable", "").strip()
                args_input = [var_str] if var_str else []

            if not expr_str:
                raise ValueError("No mathematical expression provided.")

            emit({"success": True, "latex": handle_diff(expr_str, args_input)})
            return

        if operation == "int":
            args_input = input_data.get("args")
            if args_input is None:
                var_str = input_data.get("variable", "").strip()
                lower_str = input_data.get("lower")
                upper_str = input_data.get("upper")
                if var_str:
                    if (lower_str is not None) and (upper_str is not None):
                        args_input = [{"variable": var_str, "lower": lower_str, "upper": upper_str}]
                    else:
                        args_input = [{"variable": var_str}]
                else:
                    args_input = []

            if not expr_str:
                raise ValueError("No mathematical expression provided.")

            emit({"success": True, "latex": handle_standard_integral(expr_str, args_input)})
            return

        if operation == "line_int":
            emit({"success": True, "latex": handle_line_integral(input_data)})
            return

        if operation == "surface_int":
            emit({"success": True, "latex": handle_surface_integral(input_data)})
            return

        if operation == "volume_int":
            emit({"success": True, "latex": handle_volume_integral(input_data)})
            return

        raise ValueError(f"Unknown operation: {operation}")
    except Exception as exc:
        label_map = {
            "diff": "Differentiation",
            "idiff": "Implicit differentiation",
            "int": "Integration",
            "line_int": "Line integral",
            "surface_int": "Surface integral",
            "volume_int": "Volume integral",
        }
        label = label_map.get(operation, "Calculation")
        emit({"success": False, "error": f"{label} error: {str(exc)}"})


if __name__ == "__main__":
    main()
