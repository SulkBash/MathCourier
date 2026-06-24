import sys
import json
import re
import numpy as np
import scipy.integrate
import sympy
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application

def split_clauses(text):
    # Split by comma or semicolon when not inside brackets or parens
    clauses = []
    current = []
    depth = 0
    for char in text:
        if char in ('(', '[', '{'):
            depth += 1
        elif char in (')', ']', '}'):
            depth -= 1
        if char in (',', ';') and depth == 0:
            clauses.append("".join(current).strip())
            current = []
        else:
            current.append(char)
    if current:
        clauses.append("".join(current).strip())
    return [c for c in clauses if c]

def get_highest_derivative_order(eqs, dep_func, ind_sym):
    max_order = 0
    for eq in eqs:
        for node in sympy.preorder_traversal(eq):
            if isinstance(node, sympy.Derivative) and node.expr == dep_func:
                # Count variables matching independent symbol
                order = sum(1 for v in node.variables if v == ind_sym)
                if order > max_order:
                    max_order = order
    return max_order

def normalize_eq_str(eq_str, dep_vars, ind_var_name):
    # 1. Replace y(x) -> y for all dependent variables
    for dep in dep_vars:
        eq_str = re.sub(rf'\b{dep}\s*\(\s*{ind_var_name}\s*\)', dep, eq_str)
    
    # 2. Replace higher-order derivatives: d2y/dx2 -> diff(y, x, 2)
    eq_str = re.sub(r'd(\d+)([a-zA-Z]+)/d([a-zA-Z]+)\1', r'diff(\2, \3, \1)', eq_str)
    # Replace first-order derivative: dy/dx -> diff(y, x)
    eq_str = re.sub(r'd([a-zA-Z]+)/d([a-zA-Z]+)', r'diff(\1, \2)', eq_str)
    
    # 3. Replace tick marks: y'' -> diff(y, x, 2), y' -> diff(y, x)
    for dep in dep_vars:
        for order in range(3, 0, -1):
            ticks = "'" * order
            eq_str = re.sub(rf'\b{dep}{ticks}', f'diff({dep}, {ind_var_name}, {order})', eq_str)
            
    # Replace '^' with '**'
    eq_str = eq_str.replace('^', '**')
    return eq_str


def is_linear_system(ode_eqs, dep_syms, ind_sym):
    dep_functions = list(dep_syms.values())
    dep_nodes = set()
    for eq in ode_eqs:
        expr = eq.lhs - eq.rhs
        for node in sympy.preorder_traversal(expr):
            if node in dep_functions:
                dep_nodes.add(node)
            elif isinstance(node, sympy.Derivative) and node.expr in dep_functions:
                dep_nodes.add(node)
    
    dep_nodes = list(dep_nodes)
    for eq in ode_eqs:
        expr = eq.lhs - eq.rhs
        for node in dep_nodes:
            try:
                deriv = sympy.diff(expr, node)
                deriv_atoms = set(sympy.preorder_traversal(deriv))
                if deriv_atoms.intersection(dep_nodes):
                    return False
            except Exception:
                return False
    return True


def solve_ode():
    try:
        input_data = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse input JSON: {str(e)}"}))
        return

    text = input_data.get("text", "")
    mode = input_data.get("mode", "hybrid")
    
    x_min_val = input_data.get("x_min")
    x_min = float(x_min_val) if x_min_val is not None else -10.0
    x_max_val = input_data.get("x_max")
    x_max = float(x_max_val) if x_max_val is not None else 10.0
    plot_axes = input_data.get("plot_axes")

    # Split into clauses
    clauses = split_clauses(text)
    if not clauses:
        print(json.dumps({"success": False, "error": "No equation provided."}))
        return

    # Separate equations and initial conditions
    # IC pattern matches: var(num) = num, var'(num) = num, dy/dx(num) = num
    ic_pattern = re.compile(r'^([a-zA-Z_][a-zA-Z0-9_]*\'*|d[a-zA-Z0-9_]*/d[a-zA-Z0-9_]*)\(([^)]+)\)\s*=\s*(.+)$')
    equations = []
    ics = []
    for c in clauses:
        if ic_pattern.match(c):
            ics.append(c)
        else:
            equations.append(c)

    if not equations:
        print(json.dumps({"success": False, "error": "Could not identify differential equations in the expression."}))
        return

    # Identify independent variable
    ind_var_name = None
    for eq in equations:
        m = re.findall(r'd(\d*)([a-zA-Z_][a-zA-Z0-9_]*)/d([a-zA-Z_][a-zA-Z0-9_]*)\1', eq)
        if m:
            ind_var_name = m[0][2]
            break
    if not ind_var_name:
        if 't' in "".join(equations) or 't' in "".join(ics):
            ind_var_name = 't'
        else:
            ind_var_name = 'x'

    # Identify dependent variables
    dep_vars = set()
    for eq in equations:
        m = re.findall(r'd\d*([a-zA-Z_][a-zA-Z0-9_]*)/d', eq)
        for v in m:
            dep_vars.add(v)
        m2 = re.findall(r'([a-zA-Z_][a-zA-Z0-9_]*)\'+', eq)
        for v in m2:
            dep_vars.add(v)
    for ic in ics:
        match = ic_pattern.match(ic)
        if match:
            lhs = match.group(1).strip()
            var_match = re.search(r'([a-zA-Z]+)', lhs)
            if var_match:
                if lhs.startswith('d') and '/' in lhs:
                    dep_m = re.search(r'd\d*([a-zA-Z_][a-zA-Z0-9_]*)/d', lhs)
                    if dep_m:
                        dep_vars.add(dep_m.group(1))
                else:
                    dep_vars.add(var_match.group(1))

    # If no dependent variables found, try parsing the equation LHS/RHS variables
    if not dep_vars:
        print(json.dumps({"success": False, "error": "Could not identify dependent variables. Format example: dy/dx = -y"}))
        return

    dep_list = sorted(list(dep_vars))

    # Validate independent and dependent variable names
    ident_pattern = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')
    if not ident_pattern.match(ind_var_name):
        print(json.dumps({"success": False, "error": f"Invalid independent variable name '{ind_var_name}'."}))
        return
    for dep in dep_list:
        if not ident_pattern.match(dep):
            print(json.dumps({"success": False, "error": f"Invalid dependent variable name '{dep}'."}))
            return

    if plot_axes:
        for var_name in plot_axes:
            if var_name != ind_var_name and var_name not in dep_list:
                print(json.dumps({"success": False, "error": f"Variable '{var_name}' in plot axes is not defined in the ODE system."}))
                return

    # Define SymPy symbols
    ind_sym = sympy.Symbol(ind_var_name)
    dep_syms = {}
    for name in dep_list:
        dep_syms[name] = sympy.Function(name)(ind_sym)

    local_dict = {ind_var_name: ind_sym}
    for name in dep_list:
        local_dict[name] = dep_syms[name]

    transformations = (standard_transformations + (implicit_multiplication_application,))

    # Parse equations
    ode_eqs = []
    for eq_str in equations:
        try:
            norm = normalize_eq_str(eq_str, dep_list, ind_var_name)
            if '=' in norm:
                parts = norm.split('=')
                lhs = parse_expr(parts[0].strip(), local_dict=local_dict, transformations=transformations)
                rhs = parse_expr(parts[1].strip(), local_dict=local_dict, transformations=transformations)
                ode_eqs.append(sympy.Eq(lhs, rhs))
            else:
                expr = parse_expr(norm.strip(), local_dict=local_dict, transformations=transformations)
                ode_eqs.append(sympy.Eq(expr, 0))
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to parse equation '{eq_str}': {str(e)}"}))
            return

    # Parse ICs
    ics_dict = {}
    x0_val = None
    for ic_str in ics:
        try:
            norm = normalize_eq_str(ic_str, dep_list, ind_var_name)
            match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*|diff\([a-zA-Z0-9_,\s]+\))\(([^)]+)\)\s*=\s*(.+)$', norm)
            if match:
                lhs_part = match.group(1).strip()
                val_part = match.group(2).strip()
                res_part = match.group(3).strip()
                
                lhs_expr = parse_expr(lhs_part, local_dict=local_dict, transformations=transformations)
                val_expr = parse_expr(val_part, local_dict=local_dict, transformations=transformations)
                res_expr = parse_expr(res_part, local_dict=local_dict, transformations=transformations)
                
                x0_val = float(val_expr.evalf())
                key = lhs_expr.subs(ind_sym, x0_val)
                ics_dict[key] = res_expr
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to parse initial condition '{ic_str}': {str(e)}"}))
            return

    if x0_val is None:
        print(json.dumps({"success": False, "error": "An initial condition is required. Format: y(x0) = y0"}))
        return

    # Check X ranges relative to initial condition
    if x_min >= x_max:
        x_min = x0_val - 5.0
        x_max = x0_val + 5.0

    # Build LaTeX representation of the input ODE and initial conditions
    ode_latex_parts = [sympy.latex(eq) for eq in ode_eqs]
    ic_latex_parts = [f"{sympy.latex(k)} = {sympy.latex(v)}" for k, v in ics_dict.items()]
    if len(ode_latex_parts) > 1:
        ode_title = "\\begin{cases} " + " \\\\ ".join(ode_latex_parts) + " \\end{cases}"
    else:
        ode_title = ode_latex_parts[0]
    ic_title = ", \\quad ".join(ic_latex_parts)
    ode_latex = f"{ode_title}, \\quad {ic_title}"

    symbolic_success = False
    symbolic_latex = ""
    curves = {}

    # Try SymPy symbolic solver first
    if mode in ("sym", "hybrid"):
        skip_symbolic = False
        if len(ode_eqs) > 1:
            if not is_linear_system(ode_eqs, dep_syms, ind_sym):
                skip_symbolic = True
        
        if skip_symbolic:
            if mode == "sym":
                print(json.dumps({"success": False, "error": "Analytical solver does not support non-linear systems symbolically."}))
                return
        else:
            try:
                # Solve symbolically
                sol = sympy.dsolve(ode_eqs, list(dep_syms.values()), ics=ics_dict)
            
                # If successfully solved
                if sol:
                    # Format Latex representation
                    if isinstance(sol, list):
                        sol_list = sol
                    else:
                        sol_list = [sol]

                    latex_parts = []
                    for s in sol_list:
                        if isinstance(s, sympy.Eq):
                            latex_parts.append(sympy.latex(s))
                    
                    if len(latex_parts) > 1:
                        symbolic_latex = "\\begin{cases} " + " \\\\ ".join(latex_parts) + " \\end{cases}"
                    elif len(latex_parts) == 1:
                        symbolic_latex = latex_parts[0]
                    else:
                        symbolic_latex = sympy.latex(sol)

                    # Generate points for each solved equation
                    funcs = {}
                    points_generated = True
                    for s in sol_list:
                        if isinstance(s, sympy.Eq):
                            # LHS is function (e.g. y(x)), RHS is expression
                            lhs_func = s.lhs
                            rhs_expr = s.rhs
                            
                            # Find name of function
                            func_name = str(lhs_func.func)
                            funcs[func_name] = sympy.lambdify(ind_sym, rhs_expr, modules=['numpy', 'math'])
                        else:
                            points_generated = False
                            break

                    if points_generated:
                        x_vals = np.linspace(x_min, x_max, 400)
                        if plot_axes:
                            x_var_name = plot_axes[0]
                            y_var_name = plot_axes[1]
                            
                            trajectory = []
                            for xv in x_vals:
                                try:
                                    # Get x-axis value
                                    if x_var_name == ind_var_name:
                                        x_val = float(xv)
                                    else:
                                        x_val = funcs[x_var_name](xv)
                                        if isinstance(x_val, (complex, np.complex128)):
                                            x_val = x_val.real if abs(x_val.imag) < 1e-9 else None
                                        x_val = float(x_val)
                                    
                                    # Get y-axis value
                                    if y_var_name == ind_var_name:
                                        y_val = float(xv)
                                    else:
                                        y_val = funcs[y_var_name](xv)
                                        if isinstance(y_val, (complex, np.complex128)):
                                            y_val = y_val.real if abs(y_val.imag) < 1e-9 else None
                                        y_val = float(y_val)
                                    
                                    if x_val is not None and y_val is not None and not np.isnan(x_val) and not np.isinf(x_val) and not np.isnan(y_val) and not np.isinf(y_val):
                                        trajectory.append({"x": x_val, "y": y_val})
                                except Exception:
                                    pass
                            
                            if len(trajectory) > 2:
                                curves[f"{x_var_name} vs {y_var_name}"] = trajectory
                            else:
                                points_generated = False
                        else:
                            for func_name, f_lambdified in funcs.items():
                                pts = []
                                for xv in x_vals:
                                    try:
                                        yv = f_lambdified(xv)
                                        if isinstance(yv, (complex, np.complex128)):
                                            yv = yv.real if abs(yv.imag) < 1e-9 else None
                                        yv = float(yv)
                                        if np.isnan(yv) or np.isinf(yv):
                                            yv = None
                                        pts.append({"x": float(xv), "y": yv})
                                    except Exception:
                                        pts.append({"x": float(xv), "y": None})
                                
                                valid_pts = [p for p in pts if p["y"] is not None]
                                if len(valid_pts) > 2:
                                    curves[func_name] = pts
                                else:
                                    points_generated = False
                                    break

                    if points_generated and curves:
                        symbolic_success = True
                        combined_latex = f"\\begin{{aligned}} & {ode_latex} \\\\ & {symbolic_latex} \\end{{aligned}}"
                        print(json.dumps({
                            "success": True,
                            "has_symbolic": True,
                            "symbolic_latex": combined_latex,
                            "curves": curves
                        }))
                        return
            except Exception as e:
                # Fall back to numerical if in hybrid mode
                if mode == "sym":
                    print(json.dumps({"success": False, "error": f"Symbolic solver failed: {str(e)}"}))
                    return


    # If symbolic solver was forced and failed
    if mode == "sym":
        print(json.dumps({"success": False, "error": "Analytical solver could not solve this ODE symbolically. Try running without symbolic-only flag."}))
        return

    # SciPy Numerical Integration
    try:
        # Construct state vector U
        state_vars = []
        dep_orders = {}
        dep_indices = {}
        idx = 0
        for name in dep_list:
            dep_func = dep_syms[name]
            n = get_highest_derivative_order(ode_eqs, dep_func, ind_sym)
            if n == 0:
                n = 1
            dep_orders[name] = n
            dep_indices[name] = idx
            for i in range(n):
                state_vars.append(dep_func.diff(ind_sym, i))
            idx += n

        # Build highest derivative expressions to solve for
        highest_derivs = [dep_syms[name].diff(ind_sym, dep_orders[name]) for name in dep_list]
        solved = sympy.solve(ode_eqs, highest_derivs)

        # Ensure solved is a dictionary
        if not isinstance(solved, dict):
            # If system.solve returns a list of tuples, map it
            if isinstance(solved, list) and len(solved) > 0:
                solved_dict = {}
                for h_d, sol_val in zip(highest_derivs, solved[0]):
                    solved_dict[h_d] = sol_val
                solved = solved_dict
            else:
                solved = {}

        # Construct derivatives of state vector elements
        deriv_exprs = []
        for name in dep_list:
            n = dep_orders[name]
            start_idx = dep_indices[name]
            for i in range(n):
                if i < n - 1:
                    # Derivative of state variable is just the next state variable
                    deriv_exprs.append(state_vars[start_idx + i + 1])
                else:
                    # Highest derivative, solve from equations
                    highest_d = dep_syms[name].diff(ind_sym, n)
                    expr = solved.get(highest_d)
                    if expr is None:
                        for k, v in solved.items():
                            if k == highest_d or sympy.simplify(k - highest_d) == 0:
                                expr = v
                                break
                    if expr is None:
                        raise ValueError(f"Could not solve ODE for highest derivative of {name}")
                    deriv_exprs.append(expr)

        # Dummy symbols for lambdifying state vector variables
        dummy_symbols = [sympy.Symbol(f'U_{k}') for k in range(len(state_vars))]
        sub_map = {state_vars[k]: dummy_symbols[k] for k in range(len(state_vars))}
        
        replaced_exprs = []
        for expr in deriv_exprs:
            replaced_exprs.append(expr.subs(sub_map))

        f_num = sympy.lambdify((ind_sym, dummy_symbols), replaced_exprs, modules=['numpy', 'math'])

        def odefun(t, U):
            try:
                res = f_num(t, list(U))
                # Handle single scalar output from lambdify if state is 1D
                if not isinstance(res, (list, tuple, np.ndarray)):
                    res = [res]
                return [float(rv) for rv in res]
            except Exception:
                return [0.0] * len(U)

        # Construct initial condition values
        U0_vals = []
        for var in state_vars:
            key = var.subs(ind_sym, x0_val)
            val = None
            for k, v in ics_dict.items():
                if k == key or sympy.simplify(k - key) == 0:
                    val = float(v.evalf())
                    break
            if val is None:
                val = 0.0
            U0_vals.append(val)

        # Solve numerically in both directions
        t_points = set()
        U_points = {}

        # Direction 1: Forward
        if x_max > x0_val:
            t_eval = np.linspace(x0_val, x_max, 1500)
            sol_f = scipy.integrate.solve_ivp(
                odefun, (x0_val, x_max), U0_vals, t_eval=t_eval, method='RK45'
            )
            if sol_f.success:
                for i, t in enumerate(sol_f.t):
                    t_points.add(float(t))
                    U_points[float(t)] = [float(v) for v in sol_f.y[:, i]]

        # Direction 2: Backward
        if x_min < x0_val:
            t_eval = np.linspace(x0_val, x_min, 1500)
            sol_b = scipy.integrate.solve_ivp(
                odefun, (x0_val, x_min), U0_vals, t_eval=t_eval, method='RK45'
            )
            if sol_b.success:
                for i, t in enumerate(sol_b.t):
                    t_points.add(float(t))
                    U_points[float(t)] = [float(v) for v in sol_b.y[:, i]]

        # Ensure exact initial point is included
        t_points.add(float(x0_val))
        U_points[float(x0_val)] = U0_vals

        sorted_t = sorted(list(t_points))

        # Extract coordinates for each dependent variable (derivative order 0)
        curves = {}
        if plot_axes:
            x_var_name = plot_axes[0]
            y_var_name = plot_axes[1]
            
            x_idx = dep_indices.get(x_var_name) if x_var_name in dep_indices else None
            y_idx = dep_indices.get(y_var_name) if y_var_name in dep_indices else None
            
            trajectory = []
            for t in sorted_t:
                # Get x value
                if x_var_name == ind_var_name:
                    xv = t
                elif x_idx is not None:
                    xv = U_points[t][x_idx]
                else:
                    xv = 0.0
                    
                # Get y value
                if y_var_name == ind_var_name:
                    yv = t
                elif y_idx is not None:
                    yv = U_points[t][y_idx]
                else:
                    yv = 0.0
                    
                trajectory.append({"x": xv, "y": yv})
            
            curves[f"{x_var_name} vs {y_var_name}"] = trajectory
        else:
            for name in dep_list:
                curve_pts = []
                state_idx = dep_indices[name]
                for t in sorted_t:
                    y_val = U_points[t][state_idx]
                    curve_pts.append({"x": t, "y": y_val})
                curves[name] = curve_pts

        print(json.dumps({
            "success": True,
            "has_symbolic": False,
            "ode_latex": ode_latex,
            "curves": curves
        }))

    except Exception as e:
        print(json.dumps({"success": False, "error": f"Numerical solver failed: {str(e)}"}))

if __name__ == "__main__":
    solve_ode()
