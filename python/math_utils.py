import re
import sympy
from sympy.parsing.sympy_parser import (
    standard_transformations,
    implicit_multiplication_application,
    parse_expr,
)

transformations = (standard_transformations + (implicit_multiplication_application,))
VALID_INLINE_VAR_RE = r"^[a-zA-Z_][a-zA-Z0-9_]*$"


def split_top_level(text, delimiter=","):
    parts = []
    current = []
    depth = 0
    in_quotes = False
    quote_char = None

    for char in text:
        if in_quotes:
            current.append(char)
            if char == quote_char:
                in_quotes = False
                quote_char = None
            continue

        if char in ("'", '"'):
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


def _coerce_inline_symbols(args, label):
    symbols = []
    for arg in args:
        if isinstance(arg, sympy.Symbol):
            symbols.append(arg)
        elif isinstance(arg, str) and arg and re.match(VALID_INLINE_VAR_RE, arg):
            symbols.append(sympy.Symbol(arg))
        else:
            raise ValueError(f"{label} expects coordinate symbols such as x, y, or z.")

    names = [sym.name for sym in symbols]
    if len(set(names)) != len(names):
        raise ValueError(f"{label} coordinate symbols must be unique.")

    return symbols


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
    symbols = _coerce_inline_symbols(coords, "grad")
    scalar = _parse_inline_scalar(expr, symbols, "grad")
    return sympy.Tuple(*(sympy.diff(scalar, symbol) for symbol in symbols))


def _grad_component(index, label):
    def impl(expr, *coords):
        symbols = _coerce_inline_symbols(coords, label)
        if index >= len(symbols):
            raise ValueError(f"{label} requires at least {index + 1} coordinate symbols.")
        scalar = _parse_inline_scalar(expr, symbols, label)
        return sympy.diff(scalar, symbols[index])
    return impl


gradx_inline = _grad_component(0, "gradx")
grady_inline = _grad_component(1, "grady")
gradz_inline = _grad_component(2, "gradz")


def lap_inline(expr, *coords):
    symbols = _coerce_inline_symbols(coords, "lap")
    scalar = _parse_inline_scalar(expr, symbols, "lap")
    return sum(sympy.diff(scalar, symbol, 2) for symbol in symbols)


def div_inline(field, *coords):
    symbols = _coerce_inline_symbols(coords, "div")
    components = _parse_inline_vector(field, symbols, "div")
    if len(components) != len(symbols):
        raise ValueError("div requires the same number of components and coordinate symbols.")
    return sum(sympy.diff(component, symbols[index]) for index, component in enumerate(components))


def curl_inline(field, *coords):
    symbols = _coerce_inline_symbols(coords, "curl")
    components = _parse_inline_vector(field, symbols, "curl")
    if len(components) != len(symbols):
        raise ValueError("curl requires the same number of components and coordinate symbols.")

    if len(symbols) == 2:
        return sympy.diff(components[1], symbols[0]) - sympy.diff(components[0], symbols[1])

    if len(symbols) == 3:
        return sympy.Tuple(
            sympy.diff(components[2], symbols[1]) - sympy.diff(components[1], symbols[2]),
            sympy.diff(components[0], symbols[2]) - sympy.diff(components[2], symbols[0]),
            sympy.diff(components[1], symbols[0]) - sympy.diff(components[0], symbols[1]),
        )

    raise ValueError("curl only supports 2D or 3D vector fields.")


def _curl_component(index, label):
    def impl(field, *coords):
        result = curl_inline(field, *coords)
        if not isinstance(result, sympy.Tuple):
            raise ValueError(f"{label} only applies to 3D vector fields.")
        return result[index]
    return impl


curlx_inline = _curl_component(0, "curlx")
curly_inline = _curl_component(1, "curly")
curlz_inline = _curl_component(2, "curlz")

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
    }
    
    # Map all uppercase letters A-Z to Symbols to prevent conflicts with SymPy built-in constants (like E, I)
    for char_code in range(65, 91):
        letter = chr(char_code)
        base_dict[letter] = sympy.Symbol(letter)
        
    return base_dict
