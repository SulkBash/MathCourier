import json
import re
import sys

import sympy
from sympy.parsing.sympy_parser import parse_expr
from sympy.solvers.inequalities import reduce_inequalities, solve_univariate_inequality

from math_utils import get_base_local_dict, split_top_level, transformations


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

        if char in ("'", '"'):
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

        if char in ("'", '"'):
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


def parse_math_expr(expr_str, call_dict):
    normalized = convert_matrix_literals(str(expr_str).replace("^", "**"))
    return parse_expr(
        normalized,
        local_dict=call_dict,
        transformations=transformations,
    )


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

        if char in ("'", '"'):
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


def parse_statement(raw_text, call_dict):
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
        return {
            "kind": "expression",
            "raw": text,
            "expr": expr,
            "display": sympy.latex(expr),
            "free_symbols": set(expr.free_symbols),
        }

    index, operator = relations[0]
    lhs_text = text[:index].strip()
    rhs_text = text[index + len(operator) :].strip()
    if not lhs_text or not rhs_text:
        raise ValueError(f'Equation "{text}" is missing one side of the relation operator.')

    lhs = parse_math_expr(lhs_text, call_dict)
    rhs = parse_math_expr(rhs_text, call_dict)

    return {
        "kind": "relation",
        "raw": text,
        "operator": operator,
        "lhs": lhs,
        "rhs": rhs,
        "display": f"{sympy.latex(lhs)} {relation_latex(operator)} {sympy.latex(rhs)}",
        "free_symbols": set(lhs.free_symbols) | set(rhs.free_symbols),
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

    if isinstance(simplified, sympy.Intersection):
        non_real_parts = [part for part in simplified.args if part != sympy.S.Reals]
        if len(non_real_parts) == 1 and isinstance(
            non_real_parts[0],
            (sympy.FiniteSet, sympy.Interval, sympy.Union, sympy.ImageSet),
        ):
            simplified = sympy.simplify(non_real_parts[0])

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

        if len(solutions) > 1:
            formatted.append(f"\\text{{Solution {index}}}: " + ", \\quad ".join(pieces))
        else:
            formatted.append(", \\quad ".join(pieces))

    if not formatted:
        return "\\text{No solution}"

    return " \\\\ ".join(formatted)


def statement_residual(statement):
    if statement["kind"] == "expression":
        return statement["expr"]
    return sympy.simplify(statement["lhs"] - statement["rhs"])


def statement_relation(statement):
    lhs = statement["lhs"]
    rhs = statement["rhs"]
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


def filter_solutions_by_domain(solutions, domain_map):
    if isinstance(solutions, dict):
        solutions = [solutions]

    filtered = []
    for solution in solutions:
        keep = True
        for name, domain in domain_map.items():
            symbol = sympy.Symbol(name)
            if symbol not in solution:
                continue
            membership = domain.contains(sympy.simplify(solution[symbol]))
            if falsy(membership):
                keep = False
                break
        if keep:
            filtered.append(solution)

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


def solve_single_equation(statement, var_symbol, domain_map):
    residual = statement_residual(statement)
    domain = domain_map.get(var_symbol.name)

    if domain is not None:
        solution_set = sympy.solveset(residual, var_symbol, domain=domain)
    else:
        solution_set = sympy.solveset(residual, var_symbol, domain=sympy.S.Reals)
        if solution_set == sympy.EmptySet:
            solution_set = sympy.solveset(residual, var_symbol, domain=sympy.S.Complexes)

    if isinstance(solution_set, sympy.ConditionSet):
        fallback = sympy.solve(sympy.Eq(residual, 0), var_symbol)
        if fallback:
            solution_set = sympy.FiniteSet(*fallback)

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
    if domain is not None:
        solution = solution.intersect(domain)

    return sympy.simplify(solution)


def handle_expression_mode(statements, mode):
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
        lines.append(f"{sympy.latex(original)} &= {sympy.latex(result)}")

    return build_latex(lines)


def handle_solving_mode(statements, explicit_variables, domain_map):
    original_latex = format_original_statements(statements, solving_mode=True)
    expanded_statements = expand_matrix_equalities(statements)
    all_symbol_names = ordered_symbol_names(expanded_statements)

    if explicit_variables:
        target_symbols = [sympy.Symbol(name) for name in explicit_variables]
    else:
        if not all_symbol_names:
            outcome = "\\text{Tautology (always true)}" if evaluate_truth(expanded_statements) else "\\text{Contradiction (no solution)}"
            return build_latex([
                original_latex,
                f"\\implies {outcome}",
            ])

        if len(all_symbol_names) > 1:
            raise ValueError(
                "Multiple variables detected: "
                + ", ".join(all_symbol_names)
                + ". Please specify vars:<variable>."
            )

        target_symbols = [sympy.Symbol(all_symbol_names[0])]

    has_inequality = any(
        statement["kind"] == "relation" and statement["operator"] in {"<", ">", "<=", ">="}
        for statement in expanded_statements
    )

    if has_inequality:
        if len(target_symbols) != 1:
            raise ValueError("Inequality solving currently supports exactly one target variable.")

        solution = solve_inequalities(expanded_statements, target_symbols[0], domain_map)
        return build_latex([
            original_latex,
            f"\\implies {format_solution_set(target_symbols[0], solution)}",
        ])

    if len(expanded_statements) == 1 and len(target_symbols) == 1:
        solution = solve_single_equation(expanded_statements[0], target_symbols[0], domain_map)
        return build_latex([
            original_latex,
            f"\\implies {format_solution_set(target_symbols[0], solution)}",
        ])

    equations = [statement_residual(statement) for statement in expanded_statements]
    solutions = sympy.solve(equations, target_symbols, dict=True)
    solutions = filter_solutions_by_domain(solutions, domain_map)

    return build_latex([
        original_latex,
        f"\\implies {format_system_solutions(target_symbols, solutions)}",
    ])


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
        mode = input_data.get("mode")
        if mode is not None:
            mode = str(mode).strip().lower()
            if mode == "null":
                mode = None

        call_dict = get_base_local_dict()
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
            call_dict[name] = sympy.Symbol(name)

        statements = [parse_statement(entry, call_dict) for entry in equations]
        domain_map = build_domain_map(ranges, call_dict)

        if mode is None:
            latex = handle_solving_mode(statements, variables, domain_map)
        else:
            latex = handle_expression_mode(statements, mode)

        emit({"success": True, "latex": latex})
    except Exception as exc:
        emit({"success": False, "error": str(exc)})


if __name__ == "__main__":
    main()
