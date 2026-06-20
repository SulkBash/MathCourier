import sys
import json
import re
import numpy as np
import scipy.integrate
import sympy
from math_utils import get_base_local_dict

def split_clauses(text):
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

def detect_variables(clauses):
    """
    Detect dependent variable, spatial variable, and temporal variable from clauses.
    Returns: (dep_var, spatial_var, temporal_var, spatial_pos, temporal_pos)
    """
    # 1. Detect candidate dependent variable name (e.g. u or y)
    dep_candidates = []
    for c in clauses:
        # Match d/dt, d2u/dx2, diff(u, t), etc.
        m = re.findall(r'\bd(\d*)([a-zA-Z]+)/d([a-zA-Z]+)', c)
        for _, dep, _ in m:
            dep_candidates.append(dep)
        m2 = re.findall(r'\bdiff\(\s*([a-zA-Z]+)', c)
        for dep in m2:
            dep_candidates.append(dep)
        m3 = re.findall(r'\b([a-zA-Z]+)_[xt]\b', c)
        for dep in m3:
            dep_candidates.append(dep)
        # Match u(x,0) or u(0,t)
        m4 = re.findall(r'\b([a-zA-Z]+)\s*\(\s*[^,)]+\s*,\s*[^,)]+\s*\)', c)
        for dep in m4:
            if dep not in ('sin', 'cos', 'tan', 'exp', 'log', 'sinh', 'cosh', 'tanh', 'diff'):
                dep_candidates.append(dep)

    dep_var = 'u'
    if dep_candidates:
        # Pick the most common candidate
        dep_var = max(set(dep_candidates), key=dep_candidates.count)

    # 2. Detect spatial and temporal variables based on position in function call
    # IC is u(x, 0) = ... (constant at pos 1, symbol at pos 0) -> pos 0 = space, pos 1 = time
    # BC is u(0, t) = ... (constant at pos 0, symbol at pos 1) -> pos 0 = space, pos 1 = time
    spatial_pos = 0
    temporal_pos = 1
    spatial_var = 'x'
    temporal_var = 't'

    # Search for u(arg1, arg2) or u_t(arg1, arg2) or diff(u, t)(arg1, arg2)
    # E.g. u(x, 0) or diff(u,t)(x,0)
    pattern = rf'\b{dep_var}(?:_[xt])?\s*\(\s*([^,)]+)\s*,\s*([^,)]+)\s*\)'
    # Also support derivative calls: diff(u, ...)(arg1, arg2)
    deriv_pattern = rf'diff\(\s*{dep_var}\s*,[^)]+\)\s*\(\s*([^,)]+)\s*,\s*([^,)]+)\s*\)'

    for c in clauses:
        for pat in [pattern, deriv_pattern]:
            matches = re.findall(pat, c)
            for arg1, arg2 in matches:
                arg1 = arg1.strip()
                arg2 = arg2.strip()
                
                # Check if one of them is a number/constant
                is_num1 = is_constant_expr(arg1)
                is_num2 = is_constant_expr(arg2)
                
                if is_num1 and not is_num2:
                    # Constant is first, so first is space (BC), second is time
                    spatial_pos = 0
                    temporal_pos = 1
                    if re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', arg2):
                        temporal_var = arg2
                elif is_num2 and not is_num1:
                    # Constant is second, so second is time (IC), first is space
                    spatial_pos = 0
                    temporal_pos = 1
                    if re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', arg1):
                        spatial_var = arg1
                elif not is_num1 and not is_num2:
                    # Both are symbols (e.g. u(x, t))
                    if arg1 != dep_var:
                        spatial_var = arg1
                    if arg2 != dep_var:
                        temporal_var = arg2

    return dep_var, spatial_var, temporal_var, spatial_pos, temporal_pos

def is_constant_expr(expr_str):
    try:
        # Try to parse and evaluate as a constant
        expr = sympy.sympify(expr_str, locals={'pi': sympy.pi, 'e': sympy.E})
        return expr.is_number or expr.is_constant()
    except Exception:
        return False

def evaluate_constant(expr_str):
    expr = sympy.sympify(expr_str, locals={'pi': sympy.pi, 'e': sympy.E})
    return float(expr.evalf())

def normalize_pde_derivatives(expr_str, dep_var, spatial_var, temporal_var):
    # Replace subscript notation:
    # u_xx -> diff(u(x,t), x, 2)
    expr_str = re.sub(rf'\b{dep_var}_{spatial_var}{spatial_var}\b', f'diff({dep_var}({spatial_var}, {temporal_var}), {spatial_var}, 2)', expr_str)
    expr_str = re.sub(rf'\b{dep_var}_{temporal_var}{temporal_var}\b', f'diff({dep_var}({spatial_var}, {temporal_var}), {temporal_var}, 2)', expr_str)
    expr_str = re.sub(rf'\b{dep_var}_{spatial_var}\b', f'diff({dep_var}({spatial_var}, {temporal_var}), {spatial_var})', expr_str)
    expr_str = re.sub(rf'\b{dep_var}_{temporal_var}\b', f'diff({dep_var}({spatial_var}, {temporal_var}), {temporal_var})', expr_str)
    
    # Replace standard derivatives:
    # d2u/dx2 -> diff(u(x,t), x, 2)
    expr_str = re.sub(rf'\bd2{dep_var}/d{spatial_var}2\b', f'diff({dep_var}({spatial_var}, {temporal_var}), {spatial_var}, 2)', expr_str)
    expr_str = re.sub(rf'\bd2{dep_var}/d{temporal_var}2\b', f'diff({dep_var}({spatial_var}, {temporal_var}), {temporal_var}, 2)', expr_str)
    expr_str = re.sub(rf'\bd{dep_var}/d{spatial_var}\b', f'diff({dep_var}({spatial_var}, {temporal_var}), {spatial_var})', expr_str)
    expr_str = re.sub(rf'\bd{dep_var}/d{temporal_var}\b', f'diff({dep_var}({spatial_var}, {temporal_var}), {temporal_var})', expr_str)
    
    # Replace bare dep_var not followed by (
    expr_str = re.sub(rf'\b{dep_var}\b(?!\s*\()', f'{dep_var}({spatial_var}, {temporal_var})', expr_str)
    
    # Replace '^' with '**'
    expr_str = expr_str.replace('^', '**')
    return expr_str

def solve_pde():
    try:
        input_data = json.loads(sys.stdin.read())
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse input JSON: {str(e)}"}))
        return

    text = input_data.get("text", "")
    
    # Split input text into clauses (PDE equation, ICs, BCs)
    clauses = split_clauses(text)
    if not clauses:
        print(json.dumps({"success": False, "error": "No equation provided."}))
        return

    # Detect variables
    dep_var, spatial_var, temporal_var, spatial_pos, temporal_pos = detect_variables(clauses)
    
    # Separate PDE equation from conditions
    pde_eqs = []
    ics = []
    bcs = []
    
    # Identify which clauses are conditions
    condition_pattern = rf'({dep_var}|diff)\s*\('
    for c in clauses:
        if re.search(condition_pattern, c) or f'_{spatial_var}' in c or f'_{temporal_var}' in c:
            # Check if it's initial or boundary
            # If the condition specifies temporal variable as constant, it is an Initial Condition
            # e.g., u(x,0) = ...
            # Otherwise, it's a Boundary Condition
            # e.g., u(0,t) = ...
            is_ic = False
            # Find argument lists
            arg_match = re.findall(rf'\b{dep_var}(?:_[xt])?\s*\(\s*([^,)]+)\s*,\s*([^,)]+)\s*\)', c)
            deriv_arg_match = re.findall(rf'diff\(\s*{dep_var}\s*,[^)]+\)\s*\(\s*([^,)]+)\s*,\s*([^,)]+)\s*\)', c)
            all_args = arg_match + deriv_arg_match
            
            for arg1, arg2 in all_args:
                if spatial_pos == 0:
                    # arg1 is space, arg2 is time
                    if is_constant_expr(arg2):
                        is_ic = True
                else:
                    # arg1 is time, arg2 is space
                    if is_constant_expr(arg1):
                        is_ic = True
            
            if is_ic:
                ics.append(c)
            else:
                bcs.append(c)
        else:
            pde_eqs.append(c)
            
    if not pde_eqs:
        # If no explicit PDE was separated, maybe the first clause is the PDE
        pde_eqs = [clauses[0]]
        ics = [c for c in clauses[1:] if c in ics]
        bcs = [c for c in clauses[1:] if c in bcs]

    pde_str = pde_eqs[0]

    # Set up SymPy symbols
    x_sym = sympy.Symbol(spatial_var)
    t_sym = sympy.Symbol(temporal_var)
    u_class = sympy.Function(dep_var)
    u_applied = u_class(x_sym, t_sym)
    
    local_dict = get_base_local_dict()
    local_dict[spatial_var] = x_sym
    local_dict[temporal_var] = t_sym
    local_dict[dep_var] = u_class
    
    # 1. Parse PDE
    try:
        norm_pde = normalize_pde_derivatives(pde_str, dep_var, spatial_var, temporal_var)
        # Parse expression to LHS = RHS (LHS - RHS = 0)
        if '=' in norm_pde:
            parts = norm_pde.split('=')
            lhs_expr = sympy.parse_expr(parts[0].strip(), local_dict=local_dict)
            rhs_expr = sympy.parse_expr(parts[1].strip(), local_dict=local_dict)
            pde_eq = sympy.Eq(lhs_expr, rhs_expr)
        else:
            parsed = sympy.parse_expr(norm_pde, local_dict=local_dict)
            pde_eq = sympy.Eq(parsed, 0)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse PDE: {str(e)}"}))
        return

    # Determine order of time derivative (1st order or 2nd order)
    # Check if diff(u, t, 2) is in the equation
    time_deriv_1 = sympy.diff(u_applied, t_sym)
    time_deriv_2 = sympy.diff(u_applied, t_sym, 2)
    
    is_second_order_time = False
    target_deriv = time_deriv_1
    
    if pde_eq.has(time_deriv_2):
        is_second_order_time = True
        target_deriv = time_deriv_2

    # Isolate time derivative
    try:
        isolated = sympy.solve(pde_eq, target_deriv)
        if not isolated:
            raise ValueError("Could not isolate the time derivative.")
        pde_rhs_expr = isolated[0]
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to isolate time derivative in PDE: {str(e)}"}))
        return

    # 2. Parse Boundaries (BCs) and extract spatial domain [x_min, x_max]
    x_min_val = input_data.get("x_min")
    x_max_val = input_data.get("x_max")
    
    bc_dict = {} # maps x_val to expression of t
    for bc in bcs:
        try:
            norm_bc = normalize_pde_derivatives(bc, dep_var, spatial_var, temporal_var)
            if '=' not in norm_bc:
                continue
            lhs, rhs = norm_bc.split('=')
            lhs_parsed = sympy.parse_expr(lhs.strip(), local_dict=local_dict)
            rhs_parsed = sympy.parse_expr(rhs.strip(), local_dict=local_dict)
            
            # Find the constant spatial value in lhs_parsed
            # E.g., u(0, t) -> spatial_val = 0
            if isinstance(lhs_parsed, sympy.Function) and lhs_parsed.name == dep_var:
                args = lhs_parsed.args
                spatial_arg = args[spatial_pos]
                if spatial_arg.is_number or spatial_arg.is_constant():
                    spatial_val = float(spatial_arg.evalf())
                    bc_dict[spatial_val] = rhs_parsed
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to parse boundary condition '{bc}': {str(e)}"}))
            return

    # Determine spatial domain limits
    if x_min_val is not None:
        x_min = float(x_min_val)
    elif bc_dict:
        x_min = min(bc_dict.keys())
    else:
        x_min = 0.0

    if x_max_val is not None:
        x_max = float(x_max_val)
    elif bc_dict and len(bc_dict) > 1:
        x_max = max(bc_dict.keys())
    else:
        x_max = sympy.pi.evalf()
        x_max = float(x_max)

    if x_min >= x_max:
        print(json.dumps({"success": False, "error": f"Invalid spatial domain: [{x_min}, {x_max}]. space_min must be less than space_max."}))
        return

    # Construct Left and Right boundary conditions as functions of t
    # E.g., left boundary at x_min, right boundary at x_max
    bc_left_expr = sympy.Integer(0)
    bc_right_expr = sympy.Integer(0)
    
    for val, expr in bc_dict.items():
        if abs(val - x_min) < 1e-9:
            bc_left_expr = expr
        elif abs(val - x_max) < 1e-9:
            bc_right_expr = expr

    # 3. Parse Initial Conditions (ICs)
    ic_u_expr = None
    ic_v_expr = None # only for 2nd order time derivative (velocity initial condition)
    
    for ic in ics:
        try:
            norm_ic = normalize_pde_derivatives(ic, dep_var, spatial_var, temporal_var)
            if '=' not in norm_ic:
                continue
            lhs, rhs = norm_ic.split('=')
            lhs_parsed = sympy.parse_expr(lhs.strip(), local_dict=local_dict)
            rhs_parsed = sympy.parse_expr(rhs.strip(), local_dict=local_dict)
            
            # Check if it is u(x, 0) or diff(u, t)(x, 0)
            if isinstance(lhs_parsed, sympy.Function) and lhs_parsed.name == dep_var:
                ic_u_expr = rhs_parsed
            elif isinstance(lhs_parsed, sympy.Derivative) and lhs_parsed.expr.func.name == dep_var:
                # E.g. diff(u, t) at t=0
                ic_v_expr = rhs_parsed
        except Exception as e:
            print(json.dumps({"success": False, "error": f"Failed to parse initial condition '{ic}': {str(e)}"}))
            return

    if ic_u_expr is None:
        # Default initial condition to sin(x) scaled to [x_min, x_max]
        # Or sin(pi * (x - x_min) / (x_max - x_min))
        ic_u_expr = sympy.sin(sympy.pi * (x_sym - x_min) / (x_max - x_min))

    if is_second_order_time and ic_v_expr is None:
        ic_v_expr = sympy.Integer(0)

    # Compile initial condition functions for spatial evaluation
    try:
        ic_u_func = sympy.lambdify(x_sym, ic_u_expr, modules=['numpy', 'math'])
        if is_second_order_time:
            ic_v_func = sympy.lambdify(x_sym, ic_v_expr, modules=['numpy', 'math'])
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to compile initial condition: {str(e)}"}))
        return

    # Compile boundary condition functions for temporal evaluation
    try:
        bc_left_func = sympy.lambdify(t_sym, bc_left_expr, modules=['numpy', 'math'])
        bc_right_func = sympy.lambdify(t_sym, bc_right_expr, modules=['numpy', 'math'])
        
        if is_second_order_time:
            # We need time derivatives of the boundary conditions
            d_bc_left_dt = sympy.diff(bc_left_expr, t_sym)
            d_bc_right_dt = sympy.diff(bc_right_expr, t_sym)
            bc_left_vel_func = sympy.lambdify(t_sym, d_bc_left_dt, modules=['numpy', 'math'])
            bc_right_vel_func = sympy.lambdify(t_sym, d_bc_right_dt, modules=['numpy', 'math'])
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to compile boundary condition: {str(e)}"}))
        return

    # 4. Set up space grid and Method of Lines discretization
    N = 50 # grid intervals
    x_grid = np.linspace(x_min, x_max, N + 1)
    dx = (x_max - x_min) / N
    x_interior = x_grid[1:-1]
    
    # Lambdify the PDE RHS
    # Arguments: (x, t, u, u_x, u_xx) or (x, t, u, v, u_x, u_xx)
    u_sym = sympy.Symbol('u_val')
    ux_sym = sympy.Symbol('ux_val')
    uxx_sym = sympy.Symbol('uxx_val')
    
    # Perform substitutions in order of decreasing complexity to avoid
    # inner u(x,t) substitution mutating terms inside derivatives.
    subs_list = [
        (sympy.diff(u_applied, x_sym, 2), uxx_sym),
        (sympy.diff(u_applied, x_sym), ux_sym)
    ]
    
    if is_second_order_time:
        v_sym = sympy.Symbol('v_val')
        subs_list.append((sympy.diff(u_applied, t_sym), v_sym))
        
    subs_list.append((u_applied, u_sym))
    
    pde_rhs_expr_sub = pde_rhs_expr.subs(subs_list)
    
    try:
        if is_second_order_time:
            pde_rhs_lambdified = sympy.lambdify(
                (x_sym, t_sym, u_sym, v_sym, ux_sym, uxx_sym),
                pde_rhs_expr_sub,
                modules=['numpy', 'math']
            )
        else:
            pde_rhs_lambdified = sympy.lambdify(
                (x_sym, t_sym, u_sym, ux_sym, uxx_sym),
                pde_rhs_expr_sub,
                modules=['numpy', 'math']
            )
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to compile PDE RHS: {str(e)}"}))
        return

    # Define the ODE system to solve
    def ode_system(t, state):
        try:
            # Construct boundaries
            u_l = float(bc_left_func(t))
            u_r = float(bc_right_func(t))
            
            if is_second_order_time:
                # state is: [u_1, ..., u_{N-1}, v_1, ..., v_{N-1}]
                u_interior = state[:N-1]
                v_interior = state[N-1:]
                
                u_full = np.concatenate([[u_l], u_interior, [u_r]])
                
                # Compute spatial derivatives
                u_x = (u_full[2:] - u_full[:-2]) / (2 * dx)
                u_xx = (u_full[2:] - 2 * u_full[1:-1] + u_full[:-2]) / (dx**2)
                
                # Compute RHS
                dv_dt = pde_rhs_lambdified(x_interior, t, u_interior, v_interior, u_x, u_xx)
                if isinstance(dv_dt, (int, float)):
                    dv_dt = np.full_like(x_interior, dv_dt)
                    
                du_dt = v_interior
                return np.concatenate([du_dt, dv_dt])
            else:
                # state is: [u_1, ..., u_{N-1}]
                u_full = np.concatenate([[u_l], state, [u_r]])
                
                # Compute spatial derivatives
                u_x = (u_full[2:] - u_full[:-2]) / (2 * dx)
                u_xx = (u_full[2:] - 2 * u_full[1:-1] + u_full[:-2]) / (dx**2)
                
                # Compute RHS
                du_dt = pde_rhs_lambdified(x_interior, t, state, u_x, u_xx)
                if isinstance(du_dt, (int, float)):
                    du_dt = np.full_like(x_interior, du_dt)
                return du_dt
        except Exception:
            # Return zero derivatives if evaluation fails
            return np.zeros_like(state)

    # Initial condition evaluation
    try:
        u_init = ic_u_func(x_interior)
        if isinstance(u_init, (int, float)):
            u_init = np.full_like(x_interior, u_init)
            
        if is_second_order_time:
            v_init = ic_v_func(x_interior)
            if isinstance(v_init, (int, float)):
                v_init = np.full_like(x_interior, v_init)
            state_init = np.concatenate([u_init, v_init])
        else:
            state_init = u_init
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to evaluate initial condition: {str(e)}"}))
        return

    # Solve using solve_ivp
    t_min_val = input_data.get("t_min")
    t_max_val = input_data.get("t_max")
    t_min = float(t_min_val) if t_min_val is not None else 0.0
    t_max = float(t_max_val) if t_max_val is not None else 1.0

    if t_min >= t_max:
        t_max = t_min + 1.0

    t_eval = np.linspace(t_min, t_max, 100)
    
    try:
        # Use LSODA because it is robust for stiff diffusion problems
        sol = scipy.integrate.solve_ivp(
            ode_system,
            (t_min, t_max),
            state_init,
            t_eval=t_eval,
            method='LSODA'
        )
        
        if not sol.success:
            raise ValueError(sol.message)
            
        # Reconstruct the 2D grid of u(x, t) of shape (len(t), len(x))
        u_solution = []
        for i, t_val in enumerate(sol.t):
            u_l = float(bc_left_func(t_val))
            u_r = float(bc_right_func(t_val))
            
            if is_second_order_time:
                u_int = sol.y[:N-1, i]
            else:
                u_int = sol.y[:, i]
                
            u_row = np.concatenate([[u_l], u_int, [u_r]])
            
            # Clean up non-finite numbers
            u_row = np.where(np.isnan(u_row) | np.isinf(u_row), 0.0, u_row)
            u_solution.append(u_row.tolist())
            
        # Clean x and t lists for output
        x_out = x_grid.tolist()
        t_out = sol.t.tolist()
        
        # Build LaTeX description
        pde_latex = sympy.latex(pde_eq)
        ic_latex = f"{dep_var}({spatial_var}, 0) = {sympy.latex(ic_u_expr)}"
        if is_second_order_time:
            ic_latex += f", \\quad \\frac{{\\partial {dep_var}}}{{\\partial {temporal_var}}}({spatial_var}, 0) = {sympy.latex(ic_v_expr)}"
            
        bc_latex = f"{dep_var}({sympy.latex(sympy.sympify(x_min))}, {temporal_var}) = {sympy.latex(bc_left_expr)}, \\quad {dep_var}({sympy.latex(sympy.sympify(x_max))}, {temporal_var}) = {sympy.latex(bc_right_expr)}"
        
        combined_latex = f"\\begin{{aligned}} &{pde_latex} \\\\ &{ic_latex} \\\\ &{bc_latex} \\end{{aligned}}"

        print(json.dumps({
            "success": True,
            "x": x_out,
            "t": t_out,
            "u": u_solution,
            "pde_latex": combined_latex
        }))
        
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Numerical PDE solver failed: {str(e)}"}))

if __name__ == "__main__":
    solve_pde()
