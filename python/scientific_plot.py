"""Evaluate scientific plot subexpressions once before numerical sampling."""

import json
import math
import sys

import sympy
from sympy.printing.str import StrPrinter

from scientific_helpers import configure, inline


class MathJsPrinter(StrPrinter):
    def _print_Exp1(self, expr):
        return "e"

    def _print_ImaginaryUnit(self, expr):
        return "i"

    def _print_Abs(self, expr):
        return "abs(" + self._print(expr.args[0]) + ")"

    def _print_ceiling(self, expr):
        return "ceil(" + self._print(expr.args[0]) + ")"

    def _print_Heaviside(self, expr):
        arg = self._print(expr.args[0])
        at_zero = expr.args[1] if len(expr.args) > 1 else sympy.Rational(1, 2)
        step = "((sign(" + arg + ")+1)/2)"
        if at_zero == sympy.Rational(1, 2):
            return step
        return "(" + step + "+(" + self._print(at_zero) + "-1/2)*(1-abs(sign(" + arg + "))))"


def validate_convergence(conditions, ranges):
    for item in conditions:
        if item["condition"] != sympy.true:
            raise ValueError("This Laplace transform has an unresolved convergence condition and cannot be plotted safely.")
        plane = item["plane"]
        if plane == -sympy.oo:
            continue
        name = item["target"].name
        bounds = ranges.get(name)
        if (not bounds or len(bounds) != 2 or not plane.is_number or plane.is_real is not True
                or not all(isinstance(bound, (int, float)) and math.isfinite(bound) for bound in bounds)):
            raise ValueError(f"This Laplace transform requires an explicit {name} range entirely inside its convergence region.")
        if not float(bounds[0]) > float(plane):
            raise ValueError(f"The {name} plot range must be entirely above the Laplace convergence boundary {plane}.")


def main():
    try:
        data = json.loads(sys.stdin.read())
        context = configure({}, plot=True)
        values = []
        truncated = False
        printer = MathJsPrinter()
        for task in data.get("tasks", []):
            value = inline(task.get("operation"), *(task.get("args") or []))
            if not isinstance(value, sympy.Expr):
                raise ValueError("This helper does not produce a plottable scalar expression.")
            if value.has(sympy.oo, -sympy.oo, sympy.zoo, sympy.nan):
                raise ValueError("A non-finite helper result cannot be plotted.")
            if value.has(sympy.Order):
                if value.getO() is None:
                    raise ValueError("This series remainder cannot be converted to a plot polynomial.")
                value = value.removeO()
                truncated = True
            values.append(printer.doprint(value).replace("**", "^"))
        validate_convergence(context["conditions"], data.get("ranges") or {})
        restricted = any(item["plane"] != -sympy.oo or item["condition"] != sympy.true
                         for item in context["conditions"])
        print(json.dumps({"success": True, "values": values, "seriesTruncated": truncated,
                          "restricted": restricted, "notes": context["lines"]}))
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))


if __name__ == "__main__":
    main()
