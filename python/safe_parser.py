"""Parse mathematical expressions without exposing Python's builtins to input.

SymPy's default parser evaluates the transformed expression with a namespace
that includes Python builtins. Validate that expression and use an explicitly
limited namespace before evaluating it.
"""

import ast
import re

import sympy
from sympy.parsing.sympy_parser import evaluateFalse, standard_transformations, stringify_expr


_SYMPY_NAMES = """
    Symbol Function Integer Float Rational Add Mul Pow Matrix Tuple
    pi E I oo zoo nan EulerGamma Catalan GoldenRatio
    sin cos tan cot sec csc asin acos atan acot asec acsc atan2
    sinh cosh tanh coth sech csch asinh acosh atanh acoth asech acsch
    exp log sqrt root cbrt Abs sign floor ceiling frac conjugate re im arg
    factorial factorial2 binomial gamma lowergamma uppergamma polygamma digamma
    beta zeta dirichlet_eta erf erfc erfi erfinv erfcinv
    besselj bessely besseli besselk hankel1 hankel2 airy Ai Bi
    elliptic_k elliptic_e elliptic_f elliptic_pi
    sinc Heaviside DiracDelta KroneckerDelta Piecewise Min Max
    factor expand simplify cancel together apart trigsimp powsimp logcombine
    powdenest radsimp ratsimp nsimplify
    diff Derivative Integral integrate Sum summation Product product Limit limit
    Eq Ne Lt Le Gt Ge And Or Not
""".split()

_SAFE_GLOBALS = {name: getattr(sympy, name) for name in _SYMPY_NAMES if hasattr(sympy, name)}
_SAFE_GLOBALS['abs'] = sympy.Abs
# Preserve SymPy's mathematical special functions without exposing general
# utilities such as sympify, lambdify, or Python's builtins to expressions.
for _name in sympy.__all__:
    _value = getattr(sympy, _name, None)
    if isinstance(_value, type) and issubclass(_value, sympy.Function):
        _SAFE_GLOBALS.setdefault(_name, _value)
_SAFE_GLOBALS['__builtins__'] = {}
_STRING_ARGUMENT_CALLS = {
    'Symbol', 'Function', 'Integer', 'Float', 'Rational',
    'deriv', 'integ', 'grad', 'gradx', 'grady', 'gradz',
    'lap', 'div', 'curl', 'curlx', 'curly', 'curlz',
    'limit', 'series', 'laplace', 'invlaplace', 'fourier', 'invfourier',
    'convert', 'dimension',
}
_NUMBER = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:/\d+)?$')
_ALLOWED_NODES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare,
    ast.Tuple, ast.List, ast.Name, ast.Load, ast.Constant, ast.Call, ast.keyword,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.FloorDiv,
    ast.UAdd, ast.USub, ast.And, ast.Or, ast.Not, ast.Invert, ast.BitAnd,
    ast.BitOr, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
)


def _is_identifier(value):
    return value.isidentifier() and not value.startswith('_')


class _MathExpressionValidator(ast.NodeVisitor):
    def __init__(self, namespace):
        self.namespace = namespace

    def generic_visit(self, node):
        if not isinstance(node, _ALLOWED_NODES):
            raise ValueError('Unsupported syntax in mathematical expression.')
        super().generic_visit(node)

    def visit_Name(self, node):
        if node.id.startswith('_') or node.id not in self.namespace:
            raise ValueError('Unsupported name in mathematical expression.')

    def visit_Constant(self, node):
        if not isinstance(node.value, (int, float, bool)):
            raise ValueError('Strings are only supported as math helper arguments.')

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name):
            name = node.func.id
            self.visit(node.func)
            if not callable(self.namespace[name]):
                raise ValueError('Only mathematical functions can be called.')
        elif (isinstance(node.func, ast.Call) and isinstance(node.func.func, ast.Name)
              and node.func.func.id == 'Function' and len(node.func.args) == 1
              and isinstance(node.func.args[0], ast.Constant)
              and isinstance(node.func.args[0].value, str)
              and _is_identifier(node.func.args[0].value)
              and not node.func.keywords):
            name = None
            self.visit(node.func)
        else:
            raise ValueError('Unsupported function call in mathematical expression.')

        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and name in _STRING_ARGUMENT_CALLS:
                if name in {'Symbol', 'Function'} and not _is_identifier(arg.value):
                    raise ValueError('Invalid symbol or function name.')
                if name in {'Integer', 'Float', 'Rational'} and not _NUMBER.fullmatch(arg.value):
                    raise ValueError('Invalid numeric value.')
                continue
            self.visit(arg)
        for keyword in node.keywords:
            if keyword.arg is None or keyword.arg.startswith('_'):
                raise ValueError('Unsupported function argument in mathematical expression.')
            self.visit(keyword.value)


def parse_expr(source, local_dict=None, transformations=standard_transformations, evaluate=True):
    local_namespace = dict(local_dict or {})
    namespace = {**_SAFE_GLOBALS, **local_namespace}
    transformed = stringify_expr(str(source), local_namespace, _SAFE_GLOBALS, transformations)
    tree = ast.parse(transformed, mode='eval')
    _MathExpressionValidator(namespace).visit(tree)
    if not evaluate:
        tree = evaluateFalse(transformed)
        _MathExpressionValidator(namespace).visit(tree)
    return eval(compile(tree, '<math expression>', 'eval'), _SAFE_GLOBALS, local_namespace)
