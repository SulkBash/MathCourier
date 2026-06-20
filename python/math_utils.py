import sympy
from sympy.parsing.sympy_parser import standard_transformations, implicit_multiplication_application

transformations = (standard_transformations + (implicit_multiplication_application,))

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
    }
    
    # Map all uppercase letters A-Z to Symbols to prevent conflicts with SymPy built-in constants (like E, I)
    for char_code in range(65, 91):
        letter = chr(char_code)
        base_dict[letter] = sympy.Symbol(letter)
        
    return base_dict
