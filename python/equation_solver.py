import json
import re
import sys

import sympy
from safe_parser import parse_expr
from sympy.solvers.inequalities import reduce_inequalities, solve_univariate_inequality
from sympy.solvers.solveset import NonlinearError

from math_utils import get_base_local_dict, split_top_level, transformations
from assumptions import assumed_symbols, assumption_latex, parse_assumptions, symbol_domain


VALID_VAR_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
EXPRESSION_MODES = {"simplify", "factor", "expand"}


def emit(payload):
    print(json.dumps(payload))


def build_latex(lines):
    return "\\begin{aligned}\n" + " \\\\\n".join(lines) + "\n\\end{aligned}"


def ensure_matrix(value, label="Matrix operation"):
    if isinstance(value, sympy.MatrixBase):
        return value

    if isinstance(value, (list, tuple)):
        return sympy.Matrix(value)

    raise ValueError(f"{label} expects a matrix literal like [1, 2; 3, 4].")


def det_inline(matrix_value):
    return sympy.simplify(ensure_matrix(matrix_value, "det").det())


def inv_inline(matrix_value):
    return ensure_matrix(matrix_value, "inv").inv()


def rref_inline(matrix_value):
    return ensure_matrix(matrix_value, "rref").rref()[0]


def transpose_inline(matrix_value):
    return ensure_matrix(matrix_value, "transpose").T


def trace_inline(matrix_value):
    return sympy.simplify(ensure_matrix(matrix_value, "trace").trace())


def find_matching_matrix_bracket(text, start_index):
    depth = 0
    in_quotes = False
    quote_char = None
    paren_depth = 0
    brace_depth = 0
    index = start_index

    while index < len(text):
        char = text[index]

        if in_quotes:
            if char == "\\" and index + 1 < len(text):
                index += 2
                continue
            if char == quote_char:
                in_quotes = False
                quote_char = None
            index += 1
            continue

        if char == '"' or (char == "'" and not (index > 0 and re.match(r"[a-zA-Z0-9_'}\)]", text[index - 1]))):
            in_quotes = True
            quote_char = char
            index += 1
            continue

        if char == "(":
            paren_depth += 1
            index += 1
            continue
        if char == ")":
            paren_depth = max(0, paren_depth - 1)
            index += 1
            continue
        if char == "{":
            brace_depth += 1
            index += 1
            continue
        if char == "}":
            brace_depth = max(0, brace_depth - 1)
            index += 1
            continue

        if char == "[" and paren_depth == 0 and brace_depth == 0:
            depth += 1
            index += 1
            continue

        if char == "]" and paren_depth == 0 and brace_depth == 0:
            depth -= 1
            if depth == 0:
                return index
            index += 1
            continue

        index += 1

    raise ValueError("Unclosed matrix literal. Make sure every '[' has a matching ']'.")


def convert_matrix_literal(literal_text):
    literal = str(literal_text or "").strip()
    if not literal.startswith("[") or not literal.endswith("]"):
        raise ValueError(f'Invalid matrix literal "{literal_text}".')

    inner = literal[1:-1].strip()
    if not inner:
        raise ValueError("Matrix literal cannot be empty.")

    row_texts = split_top_level(inner, ";")
    converted_rows = []
    expected_columns = None

    for row_index, row_text in enumerate(row_texts, start=1):
        column_texts = [part.strip() for part in split_top_level(row_text, ",") if part.strip()]
        if not column_texts:
            raise ValueError(f"Row {row_index} is empty in matrix literal {literal}.")

        if expected_columns is None:
            expected_columns = len(column_texts)
        elif len(column_texts) != expected_columns:
            raise ValueError("Matrix rows must all have the same number of columns.")

        converted_columns = [convert_matrix_literals(column_text) for column_text in column_texts]
        converted_rows.append("[" + ", ".join(converted_columns) + "]")

    return "Matrix([" + ", ".join(converted_rows) + "])"


def convert_matrix_literals(text):
    source = str(text or "")
    if "[" not in source:
        return source

    output = []
    index = 0
    in_quotes = False
    quote_char = None

    while index < len(source):
        char = source[index]

        if in_quotes:
            output.append(char)
            if char == "\\" and index + 1 < len(source):
                output.append(source[index + 1])
                index += 2
                continue
            if char == quote_char:
                in_quotes = False
                quote_char = None
            index += 1
            continue

        if char == '"' or (char == "'" and not (index > 0 and re.match(r"[a-zA-Z0-9_'}\)]", source[index - 1]))):
            in_quotes = True
            quote_char = char
            output.append(char)
            index += 1
            continue

        if char == "[":
            end_index = find_matching_matrix_bracket(source, index)
            output.append(convert_matrix_literal(source[index:end_index + 1]))
            index = end_index + 1
            continue

        output.append(char)
        index += 1

    return "".join(output)


def parse_math_expr(expr_str, call_dict, evaluate=True):
    normalized = convert_matrix_literals(str(expr_str).replace("^", "**"))
    result = parse_expr(
        normalized,
        local_dict=call_dict,
        transformations=transformations,
        evaluate=evaluate,
    )
    if hasattr(result, "atoms"):
        substitutions = {
            symbol: call_dict[symbol.name]
            for symbol in result.atoms(sympy.Symbol)
            if isinstance(call_dict.get(symbol.name), sympy.Symbol) and call_dict[symbol.name] != symbol
        }
        if substitutions:
            result = result.xreplace(substitutions)
    return result


def relation_latex(operator):
    return {
        "=": "=",
        "<": "<",
        ">": ">",
        "<=": "\\le",
        ">=": "\\ge",
    }[operator]


def truthy(value):
    return value is True or value == sympy.true


def falsy(value):
    return value is False or value == sympy.false


def find_top_level_relations(text):
    relations = []
    depth = 0
    in_quotes = False
    quote_char = None
    i = 0

    while i < len(text):
        char = text[i]

        if in_quotes:
            if char == "\\" and i + 1 < len(text):
                i += 2
                continue
            if char == quote_char:
                in_quotes = False
                quote_char = None
            i += 1
            continue

        if char == '"' or (char == "'" and not (i > 0 and re.match(r"[a-zA-Z0-9_'}\)]", text[i - 1]))):
            in_quotes = True
            quote_char = char
            i += 1
            continue

        if char in "([{":
            depth += 1
            i += 1
            continue
        if char in ")]}":
            depth = max(0, depth - 1)
            i += 1
            continue

        if depth == 0:
            two_char = text[i : i + 2]
            if two_char in ("<=", ">="):
                relations.append((i, two_char))
                i += 2
                continue
            if char in ("=", "<", ">"):
                relations.append((i, char))

        i += 1

    return relations


def denominator_symbols(expr):
    symbols = set()
    for node in sympy.preorder_traversal(expr):
        if isinstance(node, sympy.Pow) and node.exp.is_negative is True:
            symbols.update(node.base.free_symbols)
    return symbols


def display_expression(expr, original):
    if denominator_symbols(original) - denominator_symbols(expr):
        return original
    return expr


def needs_domain_preservation(text):
    return "/" in text or bool(re.search(r"(?:\^|\*\*)\s*(?:\(\s*)?-", text))


def parse_statement(raw_text, call_dict, preserve_input=False):
    text = str(raw_text or "").strip()
    if not text:
        raise ValueError("Empty equation entry.")

    relations = find_top_level_relations(text)
    if len(relations) > 1:
        raise ValueError(
            f'Equation "{text}" contains multiple top-level relation operators. '
            "Please split chained relations into separate statements."
        )

    if not relations:
        expr = parse_math_expr(text, call_dict)
        original_expr = parse_math_expr(text, call_dict, evaluate=False) if preserve_input or needs_domain_preservation(text) else expr
        return {
            "kind": "expression",
            "raw": text,
            "expr": expr,
            "original_expr": original_expr,
            "display": sympy.latex(original_expr if preserve_input else display_expression(expr, original_expr)),
            "free_symbols": set(original_expr.free_symbols),
        }

    index, operator = relations[0]
    lhs_text = text[:index].strip()
    rhs_text = text[index + len(operator) :].strip()
    if not lhs_text or not rhs_text:
        raise ValueError(f'Equation "{text}" is missing one side of the relation operator.')

    lhs = parse_math_expr(lhs_text, call_dict)
    rhs = parse_math_expr(rhs_text, call_dict)
    original_lhs = parse_math_expr(lhs_text, call_dict, evaluate=False) if preserve_input or needs_domain_preservation(lhs_text) else lhs
    original_rhs = parse_math_expr(rhs_text, call_dict, evaluate=False) if preserve_input or needs_domain_preservation(rhs_text) else rhs

    return {
        "kind": "relation",
        "raw": text,
        "operator": operator,
        "lhs": lhs,
        "rhs": rhs,
        "original_lhs": original_lhs,
        "original_rhs": original_rhs,
        "display": f"{sympy.latex(original_lhs if preserve_input else display_expression(lhs, original_lhs))} {relation_latex(operator)} {sympy.latex(original_rhs if preserve_input else display_expression(rhs, original_rhs))}",
        "free_symbols": set(original_lhs.free_symbols) | set(original_rhs.free_symbols),
    }


def normalize_equations(raw_input):
    if isinstance(raw_input, list):
        entries = raw_input
    elif isinstance(raw_input, str):
        entries = split_top_level(raw_input, ";")
    else:
        entries = []

    equations = [str(entry).strip() for entry in entries if str(entry).strip()]
    if not equations:
        raise ValueError("No equations or expressions were provided.")
    return equations


def normalize_variables(raw_variables):
    if raw_variables is None:
        return []

    if isinstance(raw_variables, str):
        entries = split_top_level(raw_variables)
    else:
        entries = raw_variables

    variables = []
    for entry in entries:
        if isinstance(entry, dict):
            name = str(entry.get("name") or entry.get("variable") or "").strip()
        else:
            name = str(entry).strip()

        if not name:
            continue
        if not VALID_VAR_RE.match(name):
            raise ValueError(f'Invalid variable name "{name}".')
        if name not in variables:
            variables.append(name)

    return variables


def extract_range_bounds(name, raw_value):
    if isinstance(raw_value, dict):
        lower = raw_value.get("lower")
        upper = raw_value.get("upper")
        if lower is None:
            lower = raw_value.get("minExpr", raw_value.get("min"))
        if upper is None:
            upper = raw_value.get("maxExpr", raw_value.get("max"))
    elif isinstance(raw_value, (list, tuple)) and len(raw_value) == 2:
        lower, upper = raw_value
    else:
        raise ValueError(f'Range for "{name}" must contain exactly two bounds.')

    if lower is None or upper is None:
        raise ValueError(f'Range for "{name}" must contain both lower and upper bounds.')

    return str(lower).strip(), str(upper).strip()


def normalize_ranges(raw_ranges):
    if raw_ranges is None:
        return {}

    normalized = {}

    if isinstance(raw_ranges, dict):
        items = raw_ranges.items()
    elif isinstance(raw_ranges, list):
        items = []
        for entry in raw_ranges:
            if not isinstance(entry, dict):
                raise ValueError("Range entries must be objects with a variable name and bounds.")
            name = str(entry.get("name") or entry.get("variable") or "").strip()
            if not name:
                raise ValueError("Range entries must include a variable name.")
            items.append((name, entry))
    else:
        raise ValueError("Ranges must be an object or array of range entries.")

    for name, raw_value in items:
        var_name = str(name).strip()
        if not VALID_VAR_RE.match(var_name):
            raise ValueError(f'Invalid range variable name "{var_name}".')
        lower, upper = extract_range_bounds(var_name, raw_value)
        normalized[var_name] = {"lower": lower, "upper": upper}

    return normalized


def build_domain_map(range_specs, call_dict):
    domains = {}

    for name, bounds in range_specs.items():
        lower = parse_math_expr(bounds["lower"], call_dict)
        upper = parse_math_expr(bounds["upper"], call_dict)
        interval = sympy.Interval(lower, upper)
        delta = sympy.simplify(upper - lower)
        if truthy(delta.is_negative):
            raise ValueError(f'Range for "{name}" has lower bound greater than upper bound.')
        domains[name] = interval

    return domains


def ordered_symbol_names(statements):
    names = set()
    for statement in statements:
        for symbol in statement["free_symbols"]:
            names.add(symbol.name)
    return sorted(names)


def format_original_statements(statements, solving_mode=False):
    rendered = []
    for statement in statements:
        if solving_mode and statement["kind"] == "expression":
            rendered.append(f"{statement['display']} = 0")
        else:
            rendered.append(statement["display"])

    if len(rendered) == 1:
        return rendered[0]

    return "\\begin{cases} " + " \\\\ ".join(rendered) + " \\end{cases}"


def format_solution_set(var_symbol, solution_set):
    simplified = sympy.simplify(solution_set)

    if simplified == sympy.EmptySet:
        return "\\text{No solution}"

    if isinstance(simplified, sympy.FiniteSet):
        ordered = sorted(list(simplified), key=sympy.default_sort_key)
        if len(ordered) == 1:
            return f"{sympy.latex(var_symbol)} = {sympy.latex(ordered[0])}"
        return f"{sympy.latex(var_symbol)} \\in {sympy.latex(sympy.FiniteSet(*ordered))}"

    return f"{sympy.latex(var_symbol)} \\in {sympy.latex(simplified)}"


def format_system_solutions(target_symbols, solutions):
    if isinstance(solutions, dict):
        solutions = [solutions]

    if not solutions:
        return "\\text{No solution}"

    formatted = []
    for index, solution in enumerate(solutions, start=1):
        pieces = []
        for symbol in target_symbols:
            if symbol in solution:
                pieces.append(f"{sympy.latex(symbol)} = {sympy.latex(sympy.simplify(solution[symbol]))}")

        if not pieces:
            continue
        if solution.get("_conditions"):
            condition = sympy.And(*solution["_conditions"])
            pieces.append(r"\text{provided } " + sympy.latex(condition))

        if len(solutions) > 1:
            formatted.append(f"\\text{{Solution {index}}}: " + ", \\quad ".join(pieces))
        else:
            formatted.append(", \\quad ".join(pieces))

    if not formatted:
        return "\\text{No solution}"

    return " \\\\ ".join(formatted)


def statement_residual(statement):
    if statement["kind"] == "expression":
        return statement["expr"].doit()
    return sympy.simplify(statement["lhs"].doit() - statement["rhs"].doit())


def statement_relation(statement):
    lhs = statement["lhs"].doit()
    rhs = statement["rhs"].doit()
    operator = statement["operator"]

    if operator == "=":
        return sympy.Eq(lhs, rhs)
    if operator == "<":
        return sympy.StrictLessThan(lhs, rhs)
    if operator == ">":
        return sympy.StrictGreaterThan(lhs, rhs)
    if operator == "<=":
        return sympy.LessThan(lhs, rhs)
    if operator == ">=":
        return sympy.GreaterThan(lhs, rhs)

    raise ValueError(f"Unsupported relation operator: {operator}")


def evaluate_truth(statements):
    for statement in statements:
        if statement["kind"] == "expression":
            value = sympy.simplify(statement["expr"].doit())
            comparison = sympy.simplify(sympy.Eq(value, 0))
        else:
            lhs = sympy.simplify(statement["lhs"].doit())
            rhs = sympy.simplify(statement["rhs"].doit())
            comparison = sympy.simplify(statement_relation({
                "lhs": lhs,
                "rhs": rhs,
                "operator": statement["operator"],
            }))

        if not truthy(comparison):
            return False

    return True


def original_expressions(statement):
    if statement["kind"] == "expression":
        return [statement.get("original_expr", statement["expr"])]
    return [
        statement.get("original_lhs", statement["lhs"]),
        statement.get("original_rhs", statement["rhs"]),
    ]


def input_denominator_conditions(statements):
    """Keep restrictions from the input, even if algebra cancels a factor."""
    conditions = []
    for statement in statements:
        for expr in original_expressions(statement):
            for node in sympy.preorder_traversal(expr):
                if not (isinstance(node, sympy.Pow) and node.exp.is_negative is True):
                    continue
                condition = sympy.Ne(node.base, 0)
                if condition is sympy.false:
                    raise ValueError("The input has a zero denominator under the given assumptions.")
                if condition is not sympy.true and condition not in conditions:
                    conditions.append(condition)
    return conditions


def has_variable_denominator(expr, variable):
    return any(
        isinstance(node, sympy.Pow) and node.exp.is_negative is True and node.base.has(variable)
        for node in sympy.preorder_traversal(expr)
    )


def solution_satisfies_denominators(statement, solution):
    for expr in original_expressions(statement):
        for node in sympy.preorder_traversal(expr):
            if isinstance(node, sympy.Pow) and node.exp.is_negative is True:
                denominator = sympy.simplify(node.base.subs(solution))
                if denominator.is_zero is True:
                    return False
    return True


def filter_solutions_by_domain(solutions, domain_map, statements=(), target_symbols=(), requested_domain=None):
    if isinstance(solutions, dict):
        solutions = [solutions]

    filtered = []
    for solution in solutions:
        keep = all(solution_satisfies_denominators(statement, solution) for statement in statements)
        conditions = []
        for symbol in target_symbols:
            if symbol not in solution:
                continue
            domain = domain_map.get(symbol.name)
            if domain is None and requested_domain:
                domain = sympy.S.Reals if requested_domain == "real" else sympy.S.Complexes
            if domain is None and (symbol.is_real is True or symbol.is_zero is False):
                domain = sympy.S.Complexes
            if domain is None:
                continue
            domain = symbol_domain(symbol, domain)
            value = sympy.simplify(solution[symbol])
            membership = domain.contains(value)
            if falsy(membership):
                keep = False
                break
            if not truthy(membership):
                conditions.append(sympy.Contains(value, domain, evaluate=False))
        if keep:
            result = dict(solution)
            if conditions:
                result["_conditions"] = conditions
            filtered.append(result)

    return filtered


def is_matrix_value(value):
    return isinstance(value, sympy.MatrixBase)


def expand_matrix_equalities(statements):
    expanded = []

    for statement in statements:
        if statement["kind"] == "expression":
            if is_matrix_value(statement["expr"]):
                raise ValueError("Matrix expressions in solve mode must use a relational operator or a scalar matrix function like det(...).")
            expanded.append(statement)
            continue

        lhs_is_matrix = is_matrix_value(statement["lhs"])
        rhs_is_matrix = is_matrix_value(statement["rhs"])

        if statement["operator"] != "=":
            if lhs_is_matrix or rhs_is_matrix:
                raise ValueError("Matrix inequalities are not supported.")
            expanded.append(statement)
            continue

        if not lhs_is_matrix and not rhs_is_matrix:
            expanded.append(statement)
            continue

        if lhs_is_matrix != rhs_is_matrix:
            raise ValueError("Matrix equations must compare a matrix to another matrix of the same shape.")

        if statement["lhs"].shape != statement["rhs"].shape:
            raise ValueError("Matrix equations must compare matrices with the same dimensions.")

        for row_index in range(statement["lhs"].rows):
            for col_index in range(statement["lhs"].cols):
                lhs_entry = sympy.simplify(statement["lhs"][row_index, col_index])
                rhs_entry = sympy.simplify(statement["rhs"][row_index, col_index])
                expanded.append({
                    "kind": "relation",
                    "raw": statement["raw"],
                    "operator": "=",
                    "lhs": lhs_entry,
                    "rhs": rhs_entry,
                    "display": f"{sympy.latex(lhs_entry)} = {sympy.latex(rhs_entry)}",
                    "free_symbols": set(lhs_entry.free_symbols) | set(rhs_entry.free_symbols),
                })

    return expanded


def restrict_variable_domains(statements, var_symbol, domain=None):
    real_domain = domain if domain is not None else sympy.S.Reals
    complex_domain = sympy.S.Complexes

    for statement in statements:
        for expr in original_expressions(statement):
            if not has_variable_denominator(expr, var_symbol):
                continue
            try:
                real_domain = real_domain.intersect(
                    sympy.calculus.util.continuous_domain(expr, var_symbol, sympy.S.Reals)
                )
                excluded = sympy.singularities(expr, var_symbol, domain=sympy.S.Complexes)
                complex_domain = complex_domain - excluded
            except (NotImplementedError, ValueError) as exc:
                raise ValueError("Could not determine the expression's domain reliably.") from exc
    return real_domain, complex_domain


def solve_single_equation(statement, var_symbol, domain_map, requested_domain=None):
    residual = statement_residual(statement)
    domain = domain_map.get(var_symbol.name)
    real_domain, complex_domain = restrict_variable_domains([statement], var_symbol, domain)
    real_domain = symbol_domain(var_symbol, real_domain)
    complex_domain = symbol_domain(var_symbol, complex_domain)

    use_complex = requested_domain != "real" and domain is None
    try:
        solution_set = sympy.solveset(residual, var_symbol, domain=complex_domain if use_complex else real_domain)
    except (ValueError, NotImplementedError):
        if not use_complex or requested_domain is not None:
            raise
        # Some complex solves (notably Abs) are unsupported even though a
        # complete real subset can still be computed.
        solution_set = sympy.solveset(residual, var_symbol, domain=real_domain)
        statement["real_fallback"] = True
        statement["partial_solution"] = True

    if isinstance(solution_set, sympy.ConditionSet):
        try:
            fallback = sympy.solve(sympy.Eq(residual, 0), var_symbol)
        except (NotImplementedError, ValueError):
            fallback = []
        if fallback:
            solution_set = sympy.FiniteSet(*fallback)
            statement["partial_solution"] = True
            if domain is not None:
                solution_set = solution_set.intersect(real_domain)
            elif requested_domain == "real":
                solution_set = solution_set.intersect(real_domain)
            elif complex_domain != sympy.S.Complexes:
                solution_set = solution_set.intersect(complex_domain)
        else:
            statement["partial_solution"] = True

    if domain is not None and isinstance(solution_set, sympy.Set):
        solution_set = solution_set.intersect(domain)

    return sympy.simplify(solution_set)


def solve_inequalities(statements, var_symbol, domain_map):
    if any(statement["kind"] != "relation" or statement["operator"] == "=" for statement in statements):
        raise ValueError("Inequality solving expects inequality relations only.")

    relations = [statement_relation(statement) for statement in statements]

    if len(relations) == 1:
        solution = solve_univariate_inequality(relations[0], var_symbol, relational=False)
    else:
        reduced = reduce_inequalities(relations, var_symbol)
        solution = reduced.as_set()

    domain = domain_map.get(var_symbol.name)
    real_domain, _ = restrict_variable_domains(statements, var_symbol, domain)
    real_domain = symbol_domain(var_symbol, real_domain)
    solution = solution.intersect(real_domain)

    return sympy.simplify(solution)


def parameterized_linear_cases(statement, variable, domain_map, requested_domain):
    """Keep the degenerate coefficient cases of a*x + b = 0."""
    residual = statement_residual(statement)
    try:
        polynomial = sympy.Poly(residual, variable)
    except sympy.PolynomialError:
        return None
    if polynomial.degree() != 1:
        return None
    coefficient, constant = polynomial.all_coeffs()
    if coefficient.is_zero is not None or not coefficient.free_symbols:
        return None
    if any(has_variable_denominator(expr, variable) for expr in original_expressions(statement)):
        return None

    real_domain, complex_domain = restrict_variable_domains([statement], variable, domain_map.get(variable.name))
    real_domain = symbol_domain(variable, real_domain)
    complex_domain = symbol_domain(variable, complex_domain)
    domain = complex_domain if requested_domain != "real" and variable.name not in domain_map else real_domain
    root = sympy.cancel(-constant / coefficient)
    nonzero = sympy.Ne(coefficient, 0)
    if domain in (sympy.S.Reals, sympy.S.Complexes):
        predicate = sympy.Q.real(root) if domain == sympy.S.Reals else sympy.Q.complex(root)
        try:
            known = sympy.ask(predicate, nonzero)
        except (TypeError, ValueError, NotImplementedError):
            known = None
        membership = sympy.true if known is True else sympy.false if known is False else sympy.Contains(root, domain, evaluate=False)
    else:
        membership = domain.contains(root)
    cases = []
    if membership is not sympy.false:
        condition = nonzero if membership is sympy.true else sympy.And(nonzero, membership)
        cases.append(f"{sympy.latex(variable)} = {sympy.latex(root)} & \\text{{if }} {sympy.latex(condition)}")
    if membership is not sympy.true:
        condition = nonzero if membership is sympy.false else sympy.And(nonzero, sympy.Not(membership))
        cases.append(f"\\text{{No solution}} & \\text{{if }} {sympy.latex(condition)}")
    coefficient_zero = sympy.Eq(coefficient, 0)
    constant_zero = sympy.Eq(constant, 0)
    all_condition = sympy.And(coefficient_zero, constant_zero)
    empty_condition = sympy.And(coefficient_zero, sympy.Ne(constant, 0))
    if all_condition is not sympy.false:
        cases.append(f"{sympy.latex(variable)} \\in {sympy.latex(domain)} & \\text{{if }} {sympy.latex(all_condition)}")
    if empty_condition is not sympy.false:
        cases.append(f"\\text{{No solution}} & \\text{{if }} {sympy.latex(empty_condition)}")
    return r"\begin{cases} " + r" \\ ".join(cases) + r" \end{cases}"


def handle_expression_mode(statements, mode, helper_used=False):
    if mode not in EXPRESSION_MODES:
        raise ValueError(f'Unsupported expression mode "{mode}".')

    transform = {
        "simplify": sympy.simplify,
        "factor": sympy.factor,
        "expand": sympy.expand,
    }[mode]

    lines = []
    for statement in statements:
        if statement["kind"] != "expression":
            raise ValueError("Expression modes only support non-relational expressions.")

        original = statement["expr"]
        evaluated = sympy.simplify(original.doit())
        result = transform(evaluated)
        rendered_result = sympy.latex(result)
        display = statement["display"]
        if helper_used and display == rendered_result:
            display = r"\text{Result}"
        lines.append(f"{display} &= {rendered_result}")
        if result.has(sympy.Integral, sympy.Derivative, sympy.Limit, sympy.Sum):
            statement["partial_solution"] = True
            lines.append(r"\text{Some cases remain unevaluated}")

    return build_latex(lines)


def handle_solving_mode(statements, explicit_variables, domain_map, call_dict, requested_domain=None):
    original_latex = format_original_statements(statements, solving_mode=True)
    expanded_statements = expand_matrix_equalities(statements)
    all_symbol_names = ordered_symbol_names(expanded_statements)

    if explicit_variables:
        missing = [name for name in explicit_variables if name not in all_symbol_names]
        if missing and all_symbol_names:
            raise ValueError(
                "Variable " + ", ".join(missing) + " does not appear as a separate symbol. "
                "Multi-letter names are single variables; use * between variables when multiplying."
            )
        target_symbols = [call_dict.get(name, sympy.Symbol(name)) for name in explicit_variables]
    else:
        if not all_symbol_names:
            if domain_map:
                raise ValueError("Ranges require a variable in the equation or an explicit vars option.")
            outcome = "\\text{Tautology (always true)}" if evaluate_truth(expanded_statements) else "\\text{Contradiction (no solution)}"
            return build_latex([
                original_latex,
                f"\\implies {outcome}",
            ])

        if len(all_symbol_names) > 1:
            if len(expanded_statements) == 1:
                raise ValueError(
                    "Multiple variables detected: "
                    + ", ".join(all_symbol_names)
                    + ". Please specify vars:<variable>."
                )
            target_symbols = [call_dict.get(name, sympy.Symbol(name)) for name in all_symbol_names]
        else:
            target_symbols = [call_dict.get(all_symbol_names[0], sympy.Symbol(all_symbol_names[0]))]

    target_names = {symbol.name for symbol in target_symbols}
    unused_ranges = [name for name in domain_map if name not in target_names]
    if unused_ranges:
        raise ValueError("Range " + ", ".join(unused_ranges) + " does not match a variable being solved for.")

    has_inequality = any(
        statement["kind"] == "relation" and statement["operator"] in {"<", ">", "<=", ">="}
        for statement in expanded_statements
    )

    if has_inequality:
        if requested_domain == "complex":
            raise ValueError("Inequalities require a real domain.")
        if len(target_symbols) != 1:
            raise ValueError("Inequality solving currently supports exactly one target variable.")

        solution = solve_inequalities(expanded_statements, target_symbols[0], domain_map)
        return build_latex([
            original_latex,
            f"\\implies {format_solution_set(target_symbols[0], solution)}",
        ])

    if len(expanded_statements) == 1 and len(target_symbols) == 1:
        cases = parameterized_linear_cases(expanded_statements[0], target_symbols[0], domain_map, requested_domain)
        if cases:
            return build_latex([original_latex, f"\\implies {cases}"])
        try:
            polynomial = sympy.Poly(statement_residual(expanded_statements[0]), target_symbols[0])
            leading = polynomial.LC()
            parameters = {
                symbol for symbol in polynomial.as_expr().free_symbols - {target_symbols[0]}
                if symbol.is_zero is not True
            }
            if (polynomial.degree() > 1 and leading.free_symbols and leading.is_zero is None) or (
                    polynomial.degree() > 2 and parameters):
                # Radical formulas for higher-degree parameterized polynomials
                # can be undefined at exceptional parameter values.
                expanded_statements[0]["partial_solution"] = True
        except sympy.PolynomialError:
            pass
        solution = solve_single_equation(expanded_statements[0], target_symbols[0], domain_map, requested_domain)
        lines = [
            original_latex,
            f"\\implies {format_solution_set(target_symbols[0], solution)}",
        ]
        if expanded_statements[0].get("partial_solution"):
            if solution == sympy.EmptySet:
                lines[1] = r"\implies \text{No solution found}"
            lines.append(r"\text{Partial solution; completeness not established}")
            if expanded_statements[0].get("real_fallback"):
                lines.append(r"\text{Only real solutions shown; complex case unresolved}")
        return build_latex(lines)

    equations = [statement_residual(statement) for statement in expanded_statements]
    solutions = sympy.solve(equations, target_symbols, dict=True)
    solutions = filter_solutions_by_domain(solutions, domain_map, expanded_statements, target_symbols, requested_domain or "complex")

    # solve() can omit periodic families and parameter-dependent degeneracies.
    # Only claim completeness for systems that are linear and have no free
    # parameters outside the requested unknowns.
    parameters = set().union(*(equation.free_symbols for equation in equations)) - set(target_symbols)
    try:
        sympy.linear_eq_to_matrix(equations, target_symbols)
        partial = bool(parameters)
    except NonlinearError:
        partial = True
    formatted = format_system_solutions(target_symbols, solutions)
    if partial and formatted == r"\text{No solution}":
        formatted = r"\text{No solution found}"
    lines = [
        original_latex,
        f"\\implies {formatted}",
    ]
    if partial:
        statements[0]["partial_solution"] = True
        lines.append(r"\text{Partial solution; completeness not established}")
    return build_latex(lines)


def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except Exception as exc:
        emit({"success": False, "error": f"Failed to parse input JSON: {str(exc)}"})
        return

    try:
        equations = normalize_equations(
            input_data.get("equations", input_data.get("equation", input_data.get("text", [])))
        )
        variables = normalize_variables(input_data.get("variables", input_data.get("variable")))
        ranges = normalize_ranges(input_data.get("ranges"))
        assumption_facts = parse_assumptions(input_data.get("assume"))
        from scientific_helpers import configure
        scientific_context = configure(assumption_facts)
        requested_domain = input_data.get("domain")
        if requested_domain not in (None, "real", "complex"):
            raise ValueError("Domain must be real or complex.")
        mode = input_data.get("mode")
        if mode is not None:
            mode = str(mode).strip().lower()
            if mode == "null":
                mode = None
        if mode is not None and requested_domain:
            raise ValueError("For expression modes, use assume:{x:real} rather than domain.")

        call_dict = get_base_local_dict()
        call_dict.update(assumed_symbols(assumption_facts))
        call_dict.update({
            "Matrix": sympy.Matrix,
            "det": det_inline,
            "inv": inv_inline,
            "inverse": inv_inline,
            "rref": rref_inline,
            "transpose": transpose_inline,
            "trace": trace_inline,
        })
        for name in set(variables) | set(ranges.keys()):
            if name not in assumption_facts:
                call_dict[name] = sympy.Symbol(name)

        statements = [parse_statement(entry, call_dict, preserve_input=bool(assumption_facts)) for entry in equations]
        if scientific_context["used"]:
            for statement in statements:
                values = ([statement["expr"]] if statement["kind"] == "expression"
                          else [statement["lhs"], statement["rhs"]])
                if any(hasattr(value, "has") and value.has(sympy.nan, sympy.zoo) for value in values):
                    raise ValueError("The combined helper expression is indeterminate or undefined.")
        if mode is None and "series" in scientific_context["used"]:
            raise ValueError("A series includes a remainder and cannot be solved as an exact equation. Use it in an expression or plot its truncated polynomial.")
        if mode is None and scientific_context["real_targets"]:
            targets = set(variables) if variables else {
                symbol.name for statement in statements for symbol in statement["free_symbols"]
            }
            real_targets = set(scientific_context["real_targets"])
            if targets & real_targets:
                if requested_domain == "complex":
                    raise ValueError("Fourier and inverse Laplace output variables are real; use domain:real.")
                if requested_domain is None:
                    if not targets <= real_targets:
                        raise ValueError("The transform output variable is real. Use domain:real or isolate that variable with vars.")
                    requested_domain = "real"
        if mode is None and scientific_context["conditions"]:
            targets = set(variables) if variables else {
                symbol.name for statement in statements for symbol in statement["free_symbols"]
            }
            for item in scientific_context["conditions"]:
                if item["plane"] == -sympy.oo and item["condition"] == sympy.true:
                    continue
                constrained = {item["target"].name} | {
                    symbol.name for symbol in item["plane"].free_symbols | item["condition"].free_symbols
                }
                if targets & constrained:
                    raise ValueError("Solving for a variable in a Laplace convergence condition is not yet supported. Solve the closed form separately and check the convergence region.")
        denominator_conditions = input_denominator_conditions(statements)
        domain_map = build_domain_map(ranges, call_dict)

        if mode is None:
            latex = handle_solving_mode(statements, variables, domain_map, call_dict, requested_domain)
        else:
            latex = handle_expression_mode(statements, mode, bool(scientific_context["used"]))

        labels = []
        if requested_domain:
            labels.append(r"\text{Domain: }& \mathbb{" + ("R" if requested_domain == "real" else "C") + "}")
        elif mode is None:
            has_inequality = any(statement["kind"] == "relation" and statement["operator"] != "=" for statement in statements)
            labels.append(r"\text{Default domain: }& \mathbb{" + ("R" if has_inequality else "C") + "}")
        if domain_map:
            labels.append(r"\text{Ranges: }& " + r",\quad ".join(
                sympy.latex(call_dict[name]) + r"\in " + sympy.latex(interval)
                for name, interval in domain_map.items()
            ))
        if assumption_facts:
            labels.append(r"\text{Assumptions: }& " + assumption_latex(assumption_facts))
        if denominator_conditions:
            labels.append(r"\text{Input requires: }& " + r",\quad ".join(sympy.latex(condition) for condition in denominator_conditions))
        labels.extend(scientific_context["lines"])
        if labels:
            latex = latex.replace("\n\\end{aligned}", " \\\\\n" + " \\\\\n".join(labels) + "\n\\end{aligned}")
        emit({
            "success": True,
            "latex": latex,
            "complete": not any(statement.get("partial_solution") for statement in statements),
            "real_subset": any(statement.get("real_fallback") for statement in statements)
        })
    except Exception as exc:
        emit({"success": False, "error": str(exc)})


if __name__ == "__main__":
    main()
