# Fraq official plugin reuse first
SUMMARY: Before adding a new feature, check the official Fraq plugins directory and prefer reusing existing plugin behavior when it fits.
READ WHEN: before implementing any new Fraq feature, especially generic utilities such as random numbers, AI, conversation state, webhooks, storage, or HTTP integrations

---

Source checked on 2026-07-06:
- https://github.com/fraqjs/fraq/tree/main/plugins

Observed official plugin folders:
- `ai`
- `conversation`
- `hono`
- `kysely`
- `milky-webhook`
- `random`
- `takumi`

Project rule:
- When a requested feature overlaps with an official Fraq plugin, inspect that plugin first.
- Prefer importing or adapting the official plugin's exposed functions/types/patterns instead of reimplementing local logic.
- If the official plugin does not fit this package's API or moderation boundaries, document why before writing a local implementation.
