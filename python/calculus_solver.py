import sys
import json
import sympy
from sympy.parsing.sympy_parser import parse_expr
from math_utils import transformations, get_base_local_dict

local_dict = get_base_local_dict()

def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse input JSON: {str(e)}"}))
        return

    operation = input_data.get("operation", "int")
    expr_str = input_data.get("expr", "").strip()

    if not expr_str:
        print(json.dumps({"success": False, "error": "No mathematical expression provided."}))
        return

    # Backward compatibility fallback
    args_input = input_data.get("args")
    if args_input is None:
        var_str = input_data.get("variable", "").strip()
        lower_str = input_data.get("lower")
        upper_str = input_data.get("upper")
        if operation == "diff":
            args_input = [var_str] if var_str else []
        elif operation == "int":
            if var_str:
                if (lower_str is not None) and (upper_str is not None):
                    args_input = [{"variable": var_str, "lower": lower_str, "upper": upper_str}]
                else:
                    args_input = [{"variable": var_str}]
            else:
                args_input = []

    if operation == "diff":
        try:
            if not args_input:
                args_input = ["x"]
            
            diff_args = []
            call_dict = local_dict.copy()
            
            for arg in args_input:
                if isinstance(arg, int):
                    diff_args.append(arg)
                else:
                    var_name = str(arg).strip()
                    import re
                    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', var_name):
                        print(json.dumps({"success": False, "error": f"Invalid variable name '{var_name}'."}))
                        return
                    var_sym = sympy.Symbol(var_name)
                    call_dict[var_name] = var_sym
                    diff_args.append(var_sym)
            
            expr_parsed = parse_expr(expr_str.replace('^', '**'), local_dict=call_dict, transformations=transformations)
            result = sympy.diff(expr_parsed, *diff_args)
            
            deriv_op = sympy.Derivative(expr_parsed, *diff_args)
            deriv_latex = sympy.latex(deriv_op)
            result_latex = sympy.latex(result)
            
            latex = "\\begin{aligned}\n"
            latex += f"{deriv_latex} &= {result_latex}\n"
            latex += "\\end{aligned}"
            
            print(json.dumps({"success": True, "latex": latex}))
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Differentiation error: {str(e)}"}))
        return

    elif operation == "int":
        try:
            if not args_input:
                args_input = [{"variable": "x"}]
            
            call_dict = local_dict.copy()
            
            # Populate variables in the local dict first
            for arg in args_input:
                var_name = arg.get("variable", "x").strip()
                import re
                if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', var_name):
                    print(json.dumps({"success": False, "error": f"Invalid integration variable name '{var_name}'."}))
                    return
                call_dict[var_name] = sympy.Symbol(var_name)
            
            expr_parsed = parse_expr(expr_str.replace('^', '**'), local_dict=call_dict, transformations=transformations)
            
            int_args = []
            has_limits = False
            for arg in args_input:
                var_name = arg.get("variable", "x").strip()
                var_sym = call_dict[var_name]
                
                lower_str = arg.get("lower")
                upper_str = arg.get("upper")
                
                if (lower_str is not None) and (upper_str is not None):
                    has_limits = True
                    lower_normalized = str(lower_str).replace('^', '**')
                    upper_normalized = str(upper_str).replace('^', '**')
                    lower_parsed = parse_expr(lower_normalized, local_dict=call_dict, transformations=transformations)
                    upper_parsed = parse_expr(upper_normalized, local_dict=call_dict, transformations=transformations)
                    int_args.append((var_sym, lower_parsed, upper_parsed))
                else:
                    int_args.append(var_sym)
            
            result = sympy.integrate(expr_parsed, *int_args)
            
            # Check for unevaluated integrals
            if result.has(sympy.Integral):
                if has_limits:
                    eval_res = result.evalf()
                    if eval_res.is_number:
                        result_latex = sympy.latex(eval_res.evalf(8))
                        relation = "\\approx"
                    else:
                        print(json.dumps({"success": False, "error": "Could not evaluate definite integral symbolically or numerically."}))
                        return
                else:
                    # Antiderivative not found, fallback to Taylor series for single var if possible
                    if len(int_args) == 1:
                        var_sym = int_args[0]
                        try:
                            series_approx = expr_parsed.series(var_sym, 0, 8).removeO()
                            integrated_series = sympy.integrate(series_approx, var_sym)
                            
                            expr_latex = sympy.latex(expr_parsed)
                            result_latex = sympy.latex(integrated_series)
                            integral_op_latex = sympy.latex(sympy.Integral(expr_parsed, var_sym))
                            
                            latex = "\\begin{aligned}\n"
                            latex += f"{integral_op_latex} &\\approx {result_latex} + C \\\\\n"
                            latex += f"&\\text{{(Taylor series approximation around }}{sympy.latex(var_sym)}=0\\text{{)}}\n"
                            latex += "\\end{aligned}"
                            print(json.dumps({"success": True, "latex": latex}))
                            return
                        except Exception:
                            pass
                    
                    print(json.dumps({"success": False, "error": "Could not find a symbolic antiderivative for the expression."}))
                    return
            else:
                result_latex = sympy.latex(result)
                relation = "="
            
            integral_op = sympy.Integral(expr_parsed, *int_args)
            integral_op_latex = sympy.latex(integral_op)
            
            latex = "\\begin{aligned}\n"
            if has_limits:
                latex += f"{integral_op_latex} &{relation} {result_latex}\n"
            else:
                latex += f"{integral_op_latex} &= {result_latex} + C\n"
            latex += "\\end{aligned}"
            
            print(json.dumps({"success": True, "latex": latex}))
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Integration error: {str(e)}"}))
        return
    else:
        print(json.dumps({"success": False, "error": f"Unknown operation: {operation}"}))

if __name__ == "__main__":
    main()
