# Group-admin title grant checklist
SUMMARY: Always keep fraqjs/plugin-title-grant behavior inside the group-admin plugin, using the title command and Milky special-title API.
READ WHEN: before changing group-admin title-grant behavior or upgrading Fraq/plugin-title-grant integration

---

Source checked on 2026-07-03:
- https://github.com/fraqjs/plugin-title-grant
- Upstream HEAD `7d918a8d616de39616de8df124f507558ae57c63`.

Porting notes:
- Upstream package `fraq-plugin-title-grant@0.1.0` declares peer dependency `@fraqjs/fraq ^0.11.0`, matching the current project dependency after the 2026-07-03 dependency update.
- The behavior is intentionally merged into `plugins/group-admin.ts`; do not keep a separate `plugins/title-grant.ts` unless the user asks to split it back out.
- Command behavior: `title <title>` sets the caller's group special title through `ctx.client.set_group_member_special_title`.
- Guard for `session.raw.message_scene === 'group'` before calling the group API.
- Milky special titles must be no more than 18 UTF-8 bytes. Use `new TextEncoder().encode(title).length` in this project to avoid adding Node `Buffer` types.
