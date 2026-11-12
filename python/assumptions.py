"""Validated symbol assumptions shared by symbolic solve operations."""

import re
import sympy
from safe_parser import _SAFE_GLOBALS

_NAME = r"[A-Za-z][A-Za-z0-9_]*"
_PROPERTIES = {
    "real": {"real": True},
    "complex": {"complex": True},
    "integer": {"integer": True},
    "positive": {"positive": True},
    "negative": {"negative": True},
    "nonnegative": {"nonnegative": True},
    "nonpositive": {"nonpositive": True},
    "nonzero": {"zero": False},
    "zero": {"zero": True},
}
_RELATIONS = {
    ">": "positive", ">=": "nonnegative",
    "<": "negative", "<=": "nonpositive",
    "!=": "nonzero", "=": "zero",
}


def parse_assumptions(raw):
    facts = {}
    if not raw:
        return facts
    for item in re.split(r"[,;]", str(raw)):
        item = item.strip()
        match = re.fullmatch(rf"({_NAME})\s*:\s*([A-Za-z]+)", item)
        if match:
            name, prop = match.group(1), match.group(2).lower()
        else:
            match = re.fullmatch(rf"({_NAME})\s*(>=|<=|!=|>|<|=)\s*0", item)
            if not match:
                raise ValueError("Use assumptions such as assume:{a>0, x:real, n:integer}.")
            name, prop = match.group(1), _RELATIONS[match.group(2)]
        if prop not in _PROPERTIES:
            raise ValueError(f'Unsupported assumption \"{prop}\" for {name}.')
        if name in {"pi", "e", "i", "inf", "infinity"} or callable(_SAFE_GLOBALS.get(name)):
            raise ValueError(f'Assumption name \"{name}\" conflicts with a mathematical function or constant.')
        entry = facts.setdefault(name, {})
        for key, value in _PROPERTIES[prop].items():
            if key in entry and entry[key] != value:
                raise ValueError(f"Conflicting assumptions for {name}.")
            entry[key] = value
    for name, properties in facts.items():
        try:
            sympy.Symbol(name, **properties)
        except Exception as exc:
            raise ValueError(f"Conflicting assumptions for {name}.") from exc
    return facts


def assumed_symbols(facts):
    return {name: sympy.Symbol(name, **properties) for name, properties in facts.items()}


def symbol_domain(symbol, base):
    domain = base
    if symbol.is_real is True:
        domain = domain.intersect(sympy.S.Reals)
    if symbol.is_integer is True:
        domain = domain.intersect(sympy.S.Integers)
    if symbol.is_positive is True:
        domain = domain.intersect(sympy.Interval.open(0, sympy.oo))
    elif symbol.is_negative is True:
        domain = domain.intersect(sympy.Interval.open(-sympy.oo, 0))
    elif symbol.is_nonnegative is True:
        domain = domain.intersect(sympy.Interval(0, sympy.oo))
    elif symbol.is_nonpositive is True:
        domain = domain.intersect(sympy.Interval(-sympy.oo, 0))
    if symbol.is_zero is True:
        domain = domain.intersect(sympy.FiniteSet(0))
    elif symbol.is_zero is False:
        domain = domain - sympy.FiniteSet(0)
    return domain


def assumption_latex(facts):
    parts = []
    for name, properties in facts.items():
        symbol = sympy.latex(sympy.Symbol(name))
        for prop, value in properties.items():
            if prop == "positive":
                parts.append(symbol + ">0")
            elif prop == "negative":
                parts.append(symbol + "<0")
            elif prop == "nonnegative":
                parts.append(symbol + r"\ge 0")
            elif prop == "nonpositive":
                parts.append(symbol + r"\le 0")
            elif prop == "zero":
                parts.append(symbol + ("=0" if value else r"\ne 0"))
            elif prop == "real":
                parts.append(symbol + r"\in\mathbb{R}")
            elif prop == "complex":
                parts.append(symbol + r"\in\mathbb{C}")
            elif prop == "integer":
                parts.append(symbol + r"\in\mathbb{Z}")
    return r",\quad ".join(parts)
