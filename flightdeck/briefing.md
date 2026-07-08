# Briefing - fraq

## Conventions

- Commit messages for every new feature or bug fix must follow https://gitmoji.js.org/: use the relevant emoji plus a concise Chinese description of what was added or fixed, for example `✨ 添加消息转发功能` or `🐛 修复空消息处理`.
- Do not extract a literal value into a constant unless that value appears more than once.
- Before implementing a new feature, if there are unrelated uncommitted changes from earlier turns, commit those changes first in a separate commit.
- Before implementing a new Fraq feature, first check https://github.com/fraqjs/fraq/tree/main/plugins for an official plugin or reusable implementation; prefer reusing plugin functions over reimplementing behavior locally when it fits.
- When adding or changing features, place logic in the corresponding feature file instead of concentrating it in `src/group-admin/index.ts`; create a focused module when no suitable file exists. Keep `index.ts` primarily for plugin assembly, dependency wiring, and command registration glue.

<!-- Project house rules + AI-maintenance preferences, in plain prose.
     e.g. "publishing surface is English", "ask before force-pushing". -->

## Subscriptions

<!-- one ~/.flightdeck-relative path per line; empty = subscribe to nothing global -->
