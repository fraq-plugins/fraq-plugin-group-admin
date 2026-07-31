# Fraq market listing checklist
SUMMARY: Always set `package.json` `fraq.category` to a supported Fraq market category; a missing or invalid category leaves the npm package in the generated registry with `market.unlisted: true`.
READ WHEN: before publishing or updating any Fraq plugin package intended to appear in fraqjs/market

---

Source checked on 2026-08-01:
- https://github.com/fraqjs/market/blob/main/src/market.ts
- https://github.com/fraqjs/market/blob/main/src/types.ts
- https://github.com/fraqjs/registry/blob/main/plugins.json

Checklist:
- Use a recognized package name: `fraq-plugin-*`, `@fraqjs/plugin-*`, or `@scope/fraq-plugin-*`.
- Include `description` and `repository`; the generator reads both directly from the latest npm manifest.
- Add `fraq.category` with one of: `infrastructure`, `development`, `management`, `information`, `media`, `ai`, `social`, `entertainment`, `game-tools`, or `utilities`.
- Missing or invalid `fraq.category` does not remove the package from generated data, but sets `category: null` and `market.unlisted: true`.
- For `fraq-plugin-group-admin`, use `fraq.category: "management"`.
- Publish a new npm version after changing metadata; the market reads the latest published npm manifest, not the repository working tree.
