import sys
import json
import sympy
from sympy.parsing.sympy_parser import parse_expr
from math_utils import transformations, get_base_local_dict

local_dict = get_base_local_dict()

def deriv_impl(expr, var, val):
    expr_str = str(expr).strip("'\"").replace('^', '**')
    var_str = str(var).strip("'\"")
    expr_parsed = parse_expr(expr_str, local_dict=local_dict, transformations=transformations)
    var_parsed = sympy.Symbol(var_str)
    diff_expr = sympy.diff(expr_parsed, var_parsed)
    return diff_expr.subs(var_parsed, val)

def integ_impl(expr, var, lower, upper):
    expr_str = str(expr).strip("'\"").replace('^', '**')
    var_str = str(var).strip("'\"")
    expr_parsed = parse_expr(expr_str, local_dict=local_dict, transformations=transformations)
    var_parsed = sympy.Symbol(var_str)
    int_expr = sympy.integrate(expr_parsed, (var_parsed, lower, upper))
    return int_expr

local_dict["deriv"] = deriv_impl
local_dict["integ"] = integ_impl

def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse input JSON: {str(e)}"}))
        return

    equation_str = input_data.get("equation", "").strip()
    variable_str = input_data.get("variable", "").strip()

    if not equation_str:
        print(json.dumps({"success": False, "error": "No equation provided."}))
        return
    if not variable_str:
        print(json.dumps({"success": False, "error": "No variable to isolate provided."}))
        return

    import re
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', variable_str):
        print(json.dumps({"success": False, "error": "Invalid variable name. Variable must be a simple alphanumeric word."}))
        return

    # Normalize equation string: replace '^' with '**'
    equation_str = equation_str.replace('^', '**')

    # Define target variable symbol
    var_sym = sympy.Symbol(variable_str)

    # Make a copy of the base local dictionary and add target variable to prevent cross-call conflicts
    call_dict = local_dict.copy()
    call_dict[variable_str] = var_sym

    try:
        # Parse LHS and RHS
        if '=' in equation_str:
            parts = equation_str.split('=')
            if len(parts) != 2:
                print(json.dumps({"success": False, "error": "Equation must contain exactly one '=' sign."}))
                return
            lhs = parse_expr(parts[0].strip(), local_dict=call_dict, transformations=transformations)
            rhs = parse_expr(parts[1].strip(), local_dict=call_dict, transformations=transformations)
            eq = sympy.Eq(lhs, rhs)
        else:
            expr = parse_expr(equation_str, local_dict=call_dict, transformations=transformations)
            eq = sympy.Eq(expr, 0)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse equation: {str(e)}"}))
        return

    # Solve for target variable
    try:
        solutions = sympy.solve(eq, var_sym)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"SymPy solver error: {str(e)}"}))
        return

    if not solutions:
        # Try solveset as a fallback
        try:
            solutions_set = sympy.solveset(eq, var_sym)
            if solutions_set and not isinstance(solutions_set, sympy.EmptySet):
                if hasattr(solutions_set, 'args'):
                    solutions = list(solutions_set)
        except Exception:
            pass

    if not solutions:
        print(json.dumps({"success": False, "error": f"Could not symbolically isolate variable '{variable_str}' from the equation."}))
        return

    try:
        # Construct LaTeX representing the original equation
        original_latex = sympy.latex(eq)

        # Construct LaTeX for solutions
        latex_parts = [f"{sympy.latex(var_sym)} = {sympy.latex(sol)}" for sol in solutions]
        
        # Build final LaTeX aligned block
        latex = "\\begin{aligned}\n"
        latex += f"{original_latex} \\\\\n"
        latex += "\\implies "
        if len(latex_parts) == 1:
            latex += latex_parts[0] + "\n"
        else:
            latex += ", \\quad ".join(latex_parts) + "\n"
        latex += "\\end{aligned}"

        print(json.dumps({"success": True, "latex": latex}))
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to format solutions as LaTeX: {str(e)}"}))

if __name__ == "__main__":
    main()
