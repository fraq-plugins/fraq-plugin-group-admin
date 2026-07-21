# Fraq activation-aware raw pattern checklist
SUMMARY: Always anchor command-like top-level rawPattern routes with param.literal so Fraq activation policies apply; param.union is not an activation anchor.
READ WHEN: before adding or changing any Fraq rawPattern route that should follow command activation policies

---

Source checked on 2026-07-22:
- https://fraq.dev/docs/deployment/cli/activation
- Fraq 0.14.0 `packages/fraq/src/routing/router.ts` and `parameter.ts`

Checklist:
- Ordinary `router.command()` routes automatically consult the configured activation resolver.
- A top-level `router.rawPattern()` consults activation only when its pattern contains `param.literal()`; a grouped raw pattern can also activate at its group path.
- `param.union()` has the type instruction `union`, not `literal`, even when every member is a fixed string. A top-level pattern using only `param.union()` therefore remains direct and can bypass mention/prefix policies.
- Register aliases as separate literal-backed raw patterns when each alias must obey activation.
- For reply-aware patterns, place `param.segment('reply')` before the literal. Fraq consumes mention/prefix activation immediately before that literal, preserving the reply segment as the first token.
- Verify both rejection without the required activation and matching with the configured prefix or mention.
