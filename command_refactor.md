# Unified solve routing

MathCourier exposes `!solve` for equations, expression transformations, calculus, matrices, vector operations, and differential equations. Routing order is part of the command interface:

1. Parse and validate the command body and labeled options.
2. Route complete top-level scientific helpers—`limit`, `series`, `laplace`, `invlaplace`, `fourier`, `invfourier`, `convert`, and `dimension`—to the scientific solver. Scalar scientific helpers can also be nested in supported expressions, including plots; unit conversion can be nested within unit helpers.
3. Route top-level `grad`, `lap`, `div`, and `curl` to vector solvers. `coords:cylindrical` and `coords:spherical` use three ordered physical components in the local orthonormal basis. Spherical `theta` is polar and `phi` is azimuthal.
4. Route expression modes `simplify`, `factor`, and `expand` to the equation backend.
5. Detect PDEs before ODEs, then route them to their respective handlers.
6. Give relations, including matrix relations, precedence over matrix-expression evaluation.
7. Route remaining matrix expressions to the matrix solver; reject ambiguous bare tuples.
8. Simplify any remaining expression through the equation backend.

`assume:{...}` and `domain:real|complex` are accepted only where their effects are implemented; unsupported routes return an error rather than silently discarding options. Fourier convention and one-sided-limit direction are specific to their helpers and can be placed inside the brackets for nested calls. Series retain their remainder in solves and are explicitly labeled truncated in plots; Laplace convergence restrictions must be satisfied. See `!help scientific` and `!help coords` for the live syntax and limitations.

Range-variable names preserve case. Route-specific validation rejects options and ranges that cannot be applied. Vector helper `vars` can appear inside or after the helper, but not both. A contiguous multi-letter name is one symbol across the local and symbolic backends; use `*` between variables (for example, `P*V=n*R*T`).

Router precedence is covered by `tests/test-solve-router.js`; mathematical behavior is covered by `tests/test-scientific.js` and the existing solver suites.
