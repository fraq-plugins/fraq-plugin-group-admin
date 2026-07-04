# Fraq mock package compatibility trap
SUMMARY: Do not assume @fraqjs/mock follows @fraqjs/fraq version numbers; verify its published version and peer dependency before adding it to a Fraq 0.12+ plugin package.
READ WHEN: before adding or updating Fraq mock-test dependencies
RECHECK WHEN: @fraqjs/mock publishes a new release

---

Observed on 2026-07-05:
- `@fraqjs/fraq` latest is `0.12.0`.
- `@fraqjs/mock` latest is `0.1.0`.
- `@fraqjs/mock@0.1.0` declares peer dependency `@fraqjs/fraq ^0.6.0`, so using `@fraqjs/mock ^0.12.0` fails with `ERR_PNPM_NO_MATCHING_VERSION`, and using `0.1.0` with Fraq 0.12 is peer-incompatible.
- For this plugin package, keep smoke tests lightweight unless a compatible mock release exists.
