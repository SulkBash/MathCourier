"""First-class limits, series, transforms and dimensional calculations."""

import json
import re
import sys

import sympy
from sympy.physics import units as u
from sympy.physics.units.systems.si import SI
from sympy.integrals.transforms import IntegralTransform

from assumptions import assumed_symbols, assumption_latex, parse_assumptions
from math_utils import get_base_local_dict, transformations
from safe_parser import _SAFE_GLOBALS, parse_expr

_IDENT = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_UNIT_NAMES = {
    "m": u.meter, "meter": u.meter, "meters": u.meter,
    "km": u.kilometer, "kilometer": u.kilometer,
    "cm": u.centimeter, "mm": u.millimeter,
    "inch": u.inch, "inches": u.inch, "ft": u.foot, "foot": u.foot,
    "yard": u.yard, "mile": u.mile,
    "s": u.second, "second": u.second, "seconds": u.second,
    "min": u.minute, "minute": u.minute, "h": u.hour, "hour": u.hour, "day": u.day,
    "kg": u.kilogram, "kilogram": u.kilogram, "g": u.gram, "gram": u.gram, "pound": u.pound,
    "A": u.ampere, "ampere": u.ampere, "K": u.kelvin, "kelvin": u.kelvin,
    "mol": u.mole, "mole": u.mole, "cd": u.candela,
    "N": u.newton, "newton": u.newton, "J": u.joule, "joule": u.joule,
    "W": u.watt, "watt": u.watt, "Pa": u.pascal, "pascal": u.pascal,
    "Hz": u.hertz, "hertz": u.hertz, "C": u.coulomb, "coulomb": u.coulomb,
    "V": u.volt, "volt": u.volt, "ohm": u.ohm, "F": u.farad, "farad": u.farad,
    "T": u.tesla, "tesla": u.tesla, "L": u.liter, "liter": u.liter, "mL": u.milliliter,
    "H": u.henry, "henry": u.henry, "Wb": u.weber, "weber": u.weber,
    "S": u.siemens, "siemens": u.siemens, "bar": u.bar, "atm": u.atmosphere,
    "eV": u.electronvolt, "electronvolt": u.electronvolt,
    "c": u.speed_of_light, "hbar": u.hbar, "G": u.gravitational_constant,
    "rad": u.radian, "radian": u.radian, "degree": u.degree,
}
_DIMENSION_NAMES = {
    "length": "L", "mass": "M", "time": "T", "current": "I",
    "temperature": r"\Theta", "amount_of_substance": "N", "luminous_intensity": "J",
}


def latex(lines):
    return "\\begin{aligned}\n" + " \\\\\n".join(lines) + "\n\\end{aligned}"


def variable(name, local, real=False):
    name = str(name).strip()
    if (not _IDENT.fullmatch(name) or name in {"pi", "e", "i", "inf", "infinity"}
            or callable(_SAFE_GLOBALS.get(name))):
        raise ValueError("Expected a simple variable name.")
    if name not in local or not isinstance(local[name], sympy.Symbol):
        local[name] = sympy.Symbol(name, real=True) if real else sympy.Symbol(name)
    if real and local[name].is_real is False:
        raise ValueError("This operation requires a real variable.")
    if real and local[name].is_real is not True:
        properties = dict(local[name].assumptions0)
        properties["real"] = True
        local[name] = sympy.Symbol(name, **properties)
    return local[name]


def parse(source, local):
    value = parse_expr(str(source).replace("^", "**"), local_dict=local, transformations=transformations)
    if hasattr(value, "free_symbols"):
        value = value.xreplace({symbol: local[symbol.name] for symbol in value.free_symbols
                                if isinstance(local.get(symbol.name), sympy.Symbol)})
    return value


def must_evaluate(value, label):
    if value.has(sympy.Limit, sympy.Integral, IntegralTransform):
        raise ValueError(f"{label} could not be evaluated in closed form.")
    return value


def dimensional_dependencies(expr):
    if expr.free_symbols:
        raise ValueError("Unit expressions may contain numbers and supported units only.")
    for node in sympy.preorder_traversal(expr):
        if isinstance(node, sympy.Add):
            dimensions = [dimensional_dependencies(term) for term in node.args]
            if dimensions and any(dim != dimensions[0] for dim in dimensions[1:]):
                raise ValueError("Cannot add quantities with different dimensions.")
    dimensional_expr = SI.get_dimensional_expr(expr)
    return SI.get_dimension_system().get_dimensional_dependencies(u.Dimension(dimensional_expr))


def validate_nested_input(expr, operation, variable, point=None, condition_start=0):
    """Do not treat a local approximation or transform outside its domain as exact."""
    from scientific_helpers import current
    context = current()
    for item in (context["conditions"][condition_start:] if context else []):
        constrained = {item["target"].name} | {
            symbol.name for symbol in item["plane"].free_symbols | item["condition"].free_symbols
        }
        if (item["plane"] != -sympy.oo or item["condition"] != sympy.true) and variable.name in constrained:
            raise ValueError("A nested Laplace transform's convergence region depends on the variable used by this helper; its domain cannot be propagated safely.")
    for remainder in expr.atoms(sympy.Order):
        if (operation != "limit" or remainder.variables != (variable,)
                or remainder.point != (point,)
                or sympy.limit(remainder.expr, variable, point) != 0):
            raise ValueError("A series remainder is only valid near its expansion point and cannot be used as an exact input here.")


def format_dimension(dependencies):
    parts = []
    for dimension, exponent in sorted(dependencies.items(), key=lambda item: str(item[0])):
        symbol = _DIMENSION_NAMES.get(str(dimension.name), str(dimension.name))
        text = r"\mathrm{" + symbol + "}" if not symbol.startswith("\\") else symbol
        parts.append(text if exponent == 1 else text + "^{" + sympy.latex(exponent) + "}")
    return " ".join(parts) or "1"


def evaluate(data, embedded=False):
    operation = data.get("operation")
    from scientific_helpers import parse_arguments, unit_expression
    args, direction, convention = parse_arguments(
        operation, data.get("args") or [], data.get("direction"), data.get("convention"))
    facts = data.get("_facts") if "_facts" in data else parse_assumptions(data.get("assume"))
    local = get_base_local_dict()
    local.update(assumed_symbols(facts))

    if operation in {"convert", "dimension"}:
        if facts:
            raise ValueError("Assumptions are not supported for unit expressions.")
        local.update(_UNIT_NAMES)
        with unit_expression():
            expr = parse(args[0], local)
        dimensions = dimensional_dependencies(expr)
        if operation == "dimension":
            return {"lines": [r"\dim\left(" + sympy.latex(expr) + r"\right) &= " + format_dimension(dimensions)], "value": None}
        with unit_expression():
            target = parse(args[1], local)
        if dimensional_dependencies(target) != dimensions:
            raise ValueError("Source and target units have incompatible dimensions.")
        converted = u.convert_to(expr, target)
        return {"lines": [sympy.latex(expr) + " &= " + sympy.latex(converted)], "value": converted}

    if operation in {"limit", "series"}:
        var = variable(args[1], local, real=True)
        point = parse(args[2], local)
        from scientific_helpers import current
        context = current()
        condition_start = len(context["conditions"]) if context else 0
        expr = parse(args[0], local)
        validate_nested_input(expr, operation, var, point, condition_start)
        expr = expr.doit()
        if point.has(var):
            raise ValueError("The expansion or limit point must not depend on the variable.")
        if operation == "limit":
            if direction not in {"both", "left", "right"}:
                raise ValueError("Invalid limit direction.")
            if point not in {sympy.oo, -sympy.oo} and point.is_real is not True:
                raise ValueError("The real-axis limit point must be real; use assume:{a:real} for a symbolic point.")
            if var.is_integer is True or var.is_zero is True:
                raise ValueError("A real-axis limit requires a continuous variable, not an integer or fixed-zero variable.")
            if point.is_negative is True and var.is_nonnegative is True:
                raise ValueError("The limit point is outside the assumed variable domain.")
            if point.is_positive is True and var.is_nonpositive is True:
                raise ValueError("The limit point is outside the assumed variable domain.")
            if point.is_zero is True:
                if var.is_nonnegative is True and direction != "right":
                    raise ValueError("The variable is nonnegative; use dir:right at zero.")
                if var.is_nonpositive is True and direction != "left":
                    raise ValueError("The variable is nonpositive; use dir:left at zero.")
            if point in {sympy.oo, -sympy.oo} and direction != "both":
                raise ValueError("Use a two-sided direction for limits at infinity.")
            if direction == "both" and point not in {sympy.oo, -sympy.oo}:
                left = must_evaluate(sympy.limit(expr, var, point, dir="-"), "Limit")
                right = must_evaluate(sympy.limit(expr, var, point, dir="+"), "Limit")
                if left != right:
                    difference = sympy.simplify(left - right)
                    if difference.is_zero is None:
                        raise ValueError("Could not determine whether the one-sided limits agree; provide more assumptions.")
                    if difference.is_zero is True:
                        right = left
                if left != right:
                    if embedded:
                        raise ValueError("The two-sided limit does not exist; choose dir:left or dir:right if appropriate.")
                    return {"value": None, "lines": [
                        r"\lim_{" + sympy.latex(var) + r"\to " + sympy.latex(point) + r"^-} " + sympy.latex(expr) + " &= " + sympy.latex(left),
                        r"\lim_{" + sympy.latex(var) + r"\to " + sympy.latex(point) + r"^+} " + sympy.latex(expr) + " &= " + sympy.latex(right),
                        r"\text{Two-sided limit} &\text{ does not exist}",
                        r"\text{Approach: }&\text{real axis}",
                    ]}
                result = left
            else:
                direction_sign = "-" if direction == "left" else "+"
                result = must_evaluate(sympy.limit(expr, var, point, dir=direction_sign), "Limit")
            if result.has(sympy.AccumBounds) or result in {sympy.zoo, sympy.nan}:
                raise ValueError("The limit does not exist as a single value.")
            suffix = {"both": "", "left": "^-", "right": "^+"}[direction]
            return {"value": result, "lines": [
                r"\lim_{" + sympy.latex(var) + r"\to " + sympy.latex(point) + suffix + "} " + sympy.latex(expr) + " &= " + sympy.latex(result),
                r"\text{Approach: }&\text{real axis}",
            ]}
        try:
            order = int(args[3])
        except (TypeError, ValueError) as exc:
            raise ValueError("Series order must be an integer from 1 to 50.") from exc
        if str(order) != str(args[3]).strip() or not 1 <= order <= 50:
            raise ValueError("Series order must be an integer from 1 to 50.")
        result = expr.series(var, point, order)
        return {"value": result, "lines": [sympy.latex(expr) + " &= " + sympy.latex(result)]}

    if operation in {"laplace", "invlaplace", "fourier", "invfourier"}:
        source_var = variable(args[1], local, real=operation != "invlaplace")
        target_var = variable(args[2], local, real=operation != "laplace")
        if source_var.name == target_var.name:
            raise ValueError("Transform input and output variables must be different.")
        if operation in {"fourier", "invfourier"} and (
                source_var.is_integer is True or source_var.is_nonnegative is True
                or source_var.is_nonpositive is True):
            raise ValueError("A Fourier transform integrates over the real line; its input variable cannot be restricted to integers or one side of zero.")
        if operation == "laplace" and (
                source_var.is_integer is True or source_var.is_nonpositive is True):
            raise ValueError("A unilateral Laplace transform requires a continuous input variable on the nonnegative real axis.")
        from scientific_helpers import current
        context = current()
        condition_start = len(context["conditions"]) if context else 0
        expr = parse(args[0], local)
        validate_nested_input(expr, operation, source_var, condition_start=condition_start)
        expr = expr.doit()
        if operation == "laplace":
            result, plane, condition = sympy.laplace_transform(expr, source_var, target_var)
            must_evaluate(result, "Laplace transform")
            lines = [r"\mathcal L\left\{" + sympy.latex(expr) + r"\right\}(" + sympy.latex(target_var) + ") &= " + sympy.latex(result)]
            if plane != -sympy.oo:
                lines.append(r"\operatorname{Re}\left(" + sympy.latex(target_var) + r"\right) &> " + sympy.latex(plane))
            if condition != sympy.true:
                lines.append(r"\text{Condition: }& " + sympy.latex(condition))
            return {"value": result, "lines": lines, "plane": plane,
                    "condition": condition, "target": target_var}
        if operation == "invlaplace":
            result = must_evaluate(sympy.inverse_laplace_transform(expr, source_var, target_var), "Inverse Laplace transform")
            return {"value": result, "real_target": target_var, "lines": [
                r"\mathcal L^{-1}\left\{" + sympy.latex(expr) + r"\right\}(" + sympy.latex(target_var) + ") &= " + sympy.latex(result),
                r"\text{Real variable: }& " + sympy.latex(target_var) + r"\in\mathbb{R}",
            ]}

        # SymPy may return misleading values for non-integrable functions such
        # as cos(t); this route currently supports absolutely convergent integrals.
        absolute_integral = sympy.integrate(sympy.Abs(expr), (source_var, -sympy.oo, sympy.oo))
        if absolute_integral.is_finite is not True:
            raise ValueError("Absolute convergence could not be established; conditional and distributional Fourier transforms are not supported.")
        if convention not in {"cycles", "angular"}:
            raise ValueError("Invalid Fourier convention.")
        if operation == "fourier":
            frequency = target_var if convention == "cycles" else target_var / (2 * sympy.pi)
            result = must_evaluate(sympy.fourier_transform(expr, source_var, frequency), "Fourier transform")
            kernel = r"e^{-2\pi i " if convention == "cycles" else r"e^{-i "
        else:
            time = target_var if convention == "cycles" else target_var / (2 * sympy.pi)
            result = must_evaluate(sympy.inverse_fourier_transform(expr, source_var, time), "Inverse Fourier transform")
            if convention == "angular":
                result /= 2 * sympy.pi
            kernel = r"e^{2\pi i " if convention == "cycles" else r"e^{i "
        factor = r",\quad 1/(2\pi)" if operation == "invfourier" and convention == "angular" else ""
        transform_label = r"\mathcal F" if operation == "fourier" else r"\mathcal F^{-1}"
        return {"value": result, "real_target": target_var, "lines": [
            transform_label + r"\left\{" + sympy.latex(expr) + r"\right\}(" + sympy.latex(target_var) + ") &= " + sympy.latex(result),
            r"\text{Kernel: }& " + kernel + sympy.latex(source_var) + sympy.latex(target_var) + "}" + factor,
            r"\text{Real variable: }& " + sympy.latex(target_var) + r"\in\mathbb{R}",
        ]}
    raise ValueError("Unsupported scientific operation.")


def solve(data):
    return latex(evaluate(data)["lines"])


def main():
    try:
        data = json.loads(sys.stdin.read())
        from scientific_helpers import configure, annotations
        configure(parse_assumptions(data.get("assume")))
        result = solve(data)
        extra_lines = annotations()
        if extra_lines:
            result = result.replace("\n\\end{aligned}", " \\\\\n" + " \\\\\n".join(extra_lines) + "\n\\end{aligned}")
        facts = parse_assumptions(data.get("assume"))
        if facts:
            result = result.replace("\n\\end{aligned}", " \\\\\n" + r"\text{Assumptions: }& " + assumption_latex(facts) + "\n\\end{aligned}")
        print(json.dumps({"success": True, "latex": result}))
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))


if __name__ == "__main__":
    main()
