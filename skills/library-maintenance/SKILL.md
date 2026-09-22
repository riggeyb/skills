# Sentient Standard Library Maintenance

Version: 1.0.0

## Purpose
Govern how proven implementations become reusable Sentient Standard Library modules and how they evolve.

## Promotion gate
Promote code only when it is generic, has a clear contract, has been verified in at least one real integration, and is likely to reduce future implementation work. Prefer evidence of repeated need before extracting commodity infrastructure.

Donot promote project-specific domain logic, unstable experiments, or test-weakening shortcuts.

## Module contract
Each module must have a unique id, version, purpose, language/framework, dependencies, exports, applicable_when, do_not_use_when, integration notes, verification, and exact source paths.

## Versioning
Follow semantic versioning for module contracts. Increase major when a consumer cannot upgrade without code changes. Never silently replace an older module in a target repository.

## Provenance and divergence
Consumer lock records should pin module id/version, source repository/commit/blob, destination, and installed blob. Before upgrading, compare the current destination blob with the lock. If it differs, treat the copy as locally diverged and don't overwrite it mechanically.

## Reuse decision
The target repository remains authoritative. Inspect it before the library. Prefer a compatible local implementation. Use the library when its contract fits better than new generation. Never force-fit a module.

## Verification
A library module is not proven by being copied. Verify its own tests and the target repository's typecheck, tests, and relevant runtime/CI/browser gates.

## Maintenance loop
Observe repeated problem => extract generic contract => add tests => register in catalog => reuse in real target => observe divergence => improve or deprecate.
