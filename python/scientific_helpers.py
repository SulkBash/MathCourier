"""Shared context and inline adapters for the scientific solve helpers.

The actual mathematics lives in scientific_solver.  The context also records
the conditions that would otherwise be lost when a helper becomes a scalar
subexpression.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from functools import partial
import re

import sympy
from assumptions import assumed_symbols


ARITY = {
    "limit": 3, "series": 4, "laplace": 3, "invlaplace": 3,
    "fourier": 3, "invfourier": 3, "convert": 2, "dimension": 1,
}
_context = ContextVar("scientific_helper_context", default=None)


def configure(facts, *, plot=False):
    context = {"facts": facts, "lines": [], "conditions": [], "real_targets": [], "used": set(),
               "plot": plot, "unit_depth": 0}
    _context.set(context)
    return context


def current():
    return _context.get()


@contextmanager
def unit_expression():
    context = current()
    if context is not None:
        context["unit_depth"] += 1
    try:
        yield
    finally:
        if context is not None:
            context["unit_depth"] -= 1


def parse_arguments(operation, args, direction=None, convention=None):
    count = ARITY.get(operation)
    if count is None:
        raise ValueError("Unsupported scientific operation.")
    args = list(args)
    positional, options = args[:count], args[count:]
    if len(positional) != count or any(not str(arg).strip() for arg in positional):
        raise ValueError(f"{operation} expects {count} arguments. See !help {operation}.")
    seen = set()
    for option in options:
        match = re.fullmatch(r"\s*([A-Za-z]+)\s*:\s*([A-Za-z]+)\s*", str(option))
        if not match:
            raise ValueError(f"{operation} expects {count} arguments, followed by an optional named option.")
        key, value = (part.lower() for part in match.groups())
        if key in seen:
            raise ValueError(f"Duplicate {key} option in {operation}.")
        seen.add(key)
        if key == "dir" and operation == "limit":
            if direction is not None:
                raise ValueError("Specify limit direction inside or after the helper, not both.")
            direction = value
        elif key == "convention" and operation in {"fourier", "invfourier"}:
            if convention is not None:
                raise ValueError("Specify Fourier convention inside or after the helper, not both.")
            convention = value
        else:
            raise ValueError(f'Option "{key}" is not supported for {operation}.')
    return positional, direction or "both", convention or "cycles"


def annotations():
    context = current()
    return context["lines"] if context else []


def _canonical_symbols(value, facts):
    if not hasattr(value, "free_symbols"):
        return value
    assumed = assumed_symbols(facts)
    replacements = {symbol: assumed.get(symbol.name, sympy.Symbol(symbol.name))
                    for symbol in value.free_symbols}
    return value.xreplace(replacements)


def inline(operation, *args):
    context = current()
    if context is None:
        raise ValueError("Scientific helpers are not supported in this route.")
    if operation == "dimension":
        raise ValueError("dimension[...] reports metadata, not a scalar expression; use it as a complete !solve command.")
    if operation == "convert" and not context["unit_depth"]:
        raise ValueError("Unit conversions can be nested inside convert[...] or dimension[...], but not mixed with scalar expressions.")

    # Import lazily: scientific_solver itself imports math_utils, which supplies
    # these adapters to nested derivative and integral parsers.
    from scientific_solver import evaluate
    outcome = evaluate({"operation": operation, "args": list(args),
                        "_facts": context["facts"]}, embedded=True)
    value = outcome["value"]
    if value is None:
        raise ValueError(f"{operation} did not produce a scalar expression.")
    context["used"].add(operation)
    for line in outcome["lines"]:
        if line not in context["lines"]:
            context["lines"].append(line)
    if "plane" in outcome:
        context["conditions"].append({key: outcome[key] for key in ("plane", "condition", "target")})
    if "real_target" in outcome:
        context["real_targets"].append(outcome["real_target"].name)
    return _canonical_symbols(value, context["facts"])


def local_helpers():
    return {name: partial(inline, name) for name in ARITY}
