import sys
import json
import sympy
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application

transformations = (standard_transformations + (implicit_multiplication_application,))

local_dict = {
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
}

# Map all uppercase letters A-Z to Symbols to prevent conflicts with SymPy built-in constants (like E, I)
for char_code in range(65, 91):
    letter = chr(char_code)
    local_dict[letter] = sympy.Symbol(letter)

def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse input JSON: {str(e)}"}))
        return

    operation = input_data.get("operation", "int")
    expr_str = input_data.get("expr", "").strip()
    var_str = input_data.get("variable", "").strip()
    lower_str = input_data.get("lower")
    upper_str = input_data.get("upper")

    if not expr_str:
        print(json.dumps({"success": False, "error": "No mathematical expression provided."}))
        return

    # Default to 'x' if variable not specified
    if not var_str:
        var_str = "x"

    expr_str = expr_str.replace('^', '**')
    var_sym = sympy.Symbol(var_str)

    call_dict = local_dict.copy()
    call_dict[var_str] = var_sym

    try:
        expr_parsed = parse_expr(expr_str, local_dict=call_dict, transformations=transformations)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse expression: {str(e)}"}))
        return

    if operation == "diff":
        try:
            result = sympy.diff(expr_parsed, var_sym)
            expr_latex = sympy.latex(expr_parsed)
            result_latex = sympy.latex(result)
            latex = "\\begin{aligned}\n"
            latex += f"\\frac{{d}}{{d{var_str}}}\\left({expr_latex}\\right) &= {result_latex}\n"
            latex += "\\end{aligned}"
            print(json.dumps({"success": True, "latex": latex}))
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Differentiation error: {str(e)}"}))
        return

    elif operation == "int":
        is_definite = (lower_str is not None) and (upper_str is not None)
        try:
            if is_definite:
                # Parse limits
                lower_normalized = str(lower_str).replace('^', '**')
                upper_normalized = str(upper_str).replace('^', '**')
                lower_parsed = parse_expr(lower_normalized, local_dict=call_dict, transformations=transformations)
                upper_parsed = parse_expr(upper_normalized, local_dict=call_dict, transformations=transformations)

                result = sympy.integrate(expr_parsed, (var_sym, lower_parsed, upper_parsed))
                
                expr_latex = sympy.latex(expr_parsed)
                lower_latex = sympy.latex(lower_parsed)
                upper_latex = sympy.latex(upper_parsed)

                # Check if it returned an unevaluated Integral
                if isinstance(result, sympy.Integral):
                    eval_res = result.evalf()
                    if eval_res.is_number:
                        result_latex = sympy.latex(eval_res.evalf(8))
                        relation = "\\approx"
                    else:
                        print(json.dumps({"success": False, "error": "Could not evaluate definite integral symbolically or numerically."}))
                        return
                else:
                    result_latex = sympy.latex(result)
                    relation = "="
                
                latex = "\\begin{aligned}\n"
                latex += f"\\int_{{{lower_latex}}}^{{{upper_latex}}} {expr_latex} \\, d{var_str} &{relation} {result_latex}\n"
                latex += "\\end{aligned}"
            else:
                result = sympy.integrate(expr_parsed, var_sym)
                
                if isinstance(result, sympy.Integral):
                    print(json.dumps({"success": False, "error": "Could not find a symbolic antiderivative for the expression."}))
                    return
                
                expr_latex = sympy.latex(expr_parsed)
                result_latex = sympy.latex(result)
                
                latex = "\\begin{aligned}\n"
                latex += f"\\int {expr_latex} \\, d{var_str} &= {result_latex} + C\n"
                latex += "\\end{aligned}"

            print(json.dumps({"success": True, "latex": latex}))
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Integration error: {str(e)}"}))
        return
    else:
        print(json.dumps({"success": False, "error": f"Unknown operation: {operation}"}))

if __name__ == "__main__":
    main()
