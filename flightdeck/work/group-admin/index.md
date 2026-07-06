# Index - group-admin

## State

Implemented the first group-admin features: automatically reject direct group join requests when the applicant's QQ level is below the configured minimum, send manual review notifications for higher-level applicants, run a daily capacity cleanup, detect group spam across every message segment, notify the group when members leave or are kicked, provide manual kick/mute commands, recall group messages by reply/history anchor, maintain persistent blacklist/whitelist data, and persist per-group group-admin/command switches. Reviewers can reply to the notification with `y` to accept or `n` to reject; only group owners, admins, and configured reviewer user IDs may operate it. Default minimum is level 5, so level 4 and below are rejected. Merged `fraqjs/plugin-title-grant` behavior into the group-admin plugin. The repo is now shaped as a reusable `fraq-plugin-group-admin` package with `src/index.ts`, `src/group-admin.ts`, `src/scheduler.ts`, `test/smoke.ts`, `tsdown.config.ts`, and package metadata modeled after `fraqjs/plugin-template`.

## Next

- Complete npm two-factor authentication, then publish `fraq-plugin-group-admin@0.5.0`.
- Choose the next group-admin moderation feature or adjust configuration if the threshold/rejection text should be group-specific.

## Read now

- flightdeck/knowledge/fraq/docs-baseline.md
- flightdeck/knowledge/fraq/duplicate-command-processes.md
- flightdeck/knowledge/fraq/mock-version-compat.md
- flightdeck/knowledge/fraq/plugin-reuse-first.md
- flightdeck/knowledge/fraq/title-grant-port.md
- flightdeck/knowledge/milky/group-join-review.md
- flightdeck/knowledge/milky/group-message-moderation.md

## Read if

- src/group-admin/index.ts - if changing plugin assembly or command registration.
- src/group-admin/event-handlers.ts - if changing message, member, or join-request event behavior.
- src/group-admin/scheduled-tasks.ts - if changing inactive cleanup or blacklist scans.
- src/group-admin/data-store.ts - if changing persisted runtime data.
- src/index.ts - if changing package exports.

## Progress

Done:
- Added `plugins/group-admin.ts`.
- Installed `GroupAdminPlugin` in `index.ts`.
- Verified with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/echo.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Inlined the one-use default QQ level after adding the project convention to avoid constants unless a value appears more than once.
- Added and installed `plugins/title-grant.ts` from `fraqjs/plugin-title-grant`, adapted for Fraq 0.8 object-style router commands.
- Merged title-grant behavior into `plugins/group-admin.ts` and removed the separate plugin install/file after the project moved to Fraq 0.11.
- Verified touched runtime files with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/echo.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added manual join review notifications. Higher-level join requests now send a group message and store the returned `message_seq`; replying to that notification with `y` accepts and `n` rejects the pending request.
- Verified the manual review change with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/echo.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Restricted `y`/`n` review actions to group owner, group admins, or IDs configured with `reviewerUserIds`.
- Verified the review permission change with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/echo.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added daily inactive-member cleanup through `SchedulerService`. By default it checks all groups at `0 4 * * *`; when a group has 9 or fewer free slots, it kicks up to 100 ordinary members sorted by earliest `last_sent_time`.
- The cleanup skips group owners/admins, uses `reject_add_request: false`, and can be scoped with `inactiveCleanupGroupIds`.
- Verified the cleanup change with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/echo.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added spam detection for group messages. Every message segment counts toward the sliding window; default is 8 segments within 10 seconds, warning twice and applying the configured third-violation action.
- Spam handling defaults to mute for 600 seconds; `spamAction: 'kick'` switches the third violation to a kick. Owners/admins and `spamIgnoredUserIds` are skipped.
- Verified current runtime files with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added group leave notifications from `group_member_decrease`, with different messages for voluntary leaves and operator kicks.
- Verified the leave notification change with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added `踢人`/`kick`/`踢` and `禁言`/`mute` commands. Both support mention targets and raw QQ numbers, require group owner/admin or `moderatorUserIds`, and refuse to operate on the bot, owners, or admins.
- `禁言` accepts an optional duration in seconds; when omitted it uses `manualMuteDurationSeconds`, defaulting to `spamMuteDurationSeconds`.
- Verified manual moderation commands with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Updated manual kick/mute target checks to inspect the bot's group role: owner bots may operate on admins and members, admin bots may operate only on members, and member bots are rejected.
- Verified the bot-role moderation check with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added `撤回`/`recall` commands. `撤回 数量` recalls messages above the command; `撤回 @成员 数量` and `撤回 QQ号 数量` filter by sender; replying with `撤回` recalls the replied message; replying with `撤回 数量` recalls from the replied message upward.
- Recall uses `get_message`, `get_history_messages`, and `recall_group_message`; use is restricted to owner/admin/`moderatorUserIds`, and the bot must be owner/admin.
- Verified recall commands with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added `添加黑名单`/`blacklist-add`, accepting mention targets or raw QQ numbers. The runtime blacklist can also be seeded with `blacklistUserIds`.
- Blacklisted users are rejected on `group_join_request`, kicked on `group_member_increase`, kicked when sending a group message, and swept daily by `blacklistCleanupCron` (default `0 3 * * *`).
- Verified blacklist handling with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added `添加白名单`/`whitelist-add`, accepting mention targets or raw QQ numbers. The runtime whitelist can also be seeded with `whitelistUserIds`.
- Whitelisted users are protected from manual kick/mute, recall selection, spam handling, blacklist kick/reject paths, inactive cleanup, and are auto-accepted on direct join requests.
- Verified whitelist handling with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Fixed the `recall` alias conflict by keeping the alias only on the argument-taking `撤回` command and adding a separate no-argument `recall` command.
- Verified the alias fix with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Fixed the remaining command-name conflict by handling no-argument `撤回`/`recall` through a `rawPattern` instead of registering another command.
- Verified the raw-pattern alias fix with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Persisted blacklist and whitelist data in `data/data.json`. Startup merges configured `blacklistUserIds`/`whitelistUserIds` with the JSON file and normalizes the file; `添加黑名单` and `添加白名单` write changes back immediately.
- Added `types/node-shims.d.ts` for the minimal `fs/promises` and `path` declarations needed by the repo's no-tsconfig typecheck command.
- Verified list persistence with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added persisted per-group switches in `data/data.json`: `群开`/`群关` (`群管开`/`群管关`) controls automatic group-admin features, `命令开`/`命令关` controls group-admin commands, and `一键开`/`一键关` updates both.
- Switch commands stay usable while command handling is disabled so a group can turn commands back on.
- Verified switches with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Moved startup configuration into `data/config.json`. `index.ts` loads `milkyUrl`, `scheduler`, and `groupAdmin` from that file and creates a default file if it is missing.
- Verified config loading with `pnpm --package=typescript dlx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck index.ts plugins/group-admin.ts plugins/scheduler.ts`.
- Added `.gitignore` and removed already tracked `node_modules/` plus runtime `data/data.json` from the Git index. `data/config.json` remains tracked as the editable startup config.
- Added `README.md` covering feature scope, setup, `data/config.json`, commands, and permissions.
- Added `help`/`帮助`/`菜单`, which stays available when group-admin commands are disabled and reports current group switch status.
- Confirmed the two source plugins in `D:\bot\fraq\plugins` (`group-admin.ts` and `scheduler.ts`) already match the current `src/` implementations, apart from removing the old missing `types/node-shims.d.ts` triple-slash reference in favor of package-level `@types/node`.
- Added `src/index.ts` to export `GroupAdminPlugin`, `GroupAdminPluginOptions`, `SchedulerPlugin`, `SchedulerService`, and `SchedulerPluginOptions`, with `GroupAdminPlugin` as the default export.
- Rewrote `package.json` into plugin-template package form: ESM package, `dist/index.mjs`/`dist/index.d.mts`, `tsdown` build, smoke/check/lint/format scripts, `@fraqjs/fraq` peer dependency, Node 22+ engine, and development dependencies for Fraq, TypeScript, tsx, tsdown, Biome, and Node types.
- Added `test/smoke.ts` as a lightweight export-load smoke test for `GroupAdminPlugin`, `SchedulerPlugin`, and `SchedulerService`.
- Verified `package.json` parses with Node.
- Fixed the missing Node type definition error by installing dependencies successfully; `@types/node` is now present from `pnpm install`.
- Corrected the incompatible `@fraqjs/mock ^0.12.0` dev dependency after verifying npm publishes `@fraqjs/mock` only at `0.1.0` with a Fraq `^0.6.0` peer. `test/smoke.ts` is now a lightweight export-load smoke test with no mock dependency.
- Updated Biome schema to 2.5.2, switched Node built-in imports to `node:` specifiers, handled the unused scheduler options parameter, and applied Biome formatting/import organization.
- Verified with `pnpm lint`, `pnpm check`, `pnpm smoke`, and `pnpm build`.
- Prepared npm release `fraq-plugin-group-admin@0.1.0`: package name is available on npm, `pnpm lint`, `pnpm check`, `pnpm smoke`, `pnpm build`, and `npm pack --dry-run` all pass. Publish is blocked because `npm whoami` returns `ENEEDAUTH`.
- Added `npm start` support by wiring the `start` script to the lightweight export-load smoke test, fixing npm's fallback error `Missing script start or file server.js`.
- Verified the start-script fix with `npm start`, `pnpm lint`, `pnpm check`, `pnpm build`, and `npm pack --dry-run`.
- Added `README.md` covering installation, Fraq usage, feature scope, commands, configuration options, permissions, persisted data, `SchedulerPlugin`, and development commands.
- Verified the README change with `pnpm lint`, `pnpm check`, `pnpm build`, and `npm pack --dry-run`; dry-run includes `README.md` in the npm tarball.
- Bumped the package version from `0.1.0` to `0.1.1` because npm already has `fraq-plugin-group-admin@0.1.0` and versions cannot be overwritten.
- Verified `0.1.1` with `pnpm lint`, `pnpm check`, `pnpm smoke`, `pnpm build`, and `npm pack --dry-run`; `npm publish --access public` reached npm but is blocked by `EOTP`.
- Added npm metadata in `package.json`: `repository`, `homepage`, and `bugs.url` point at `zhongwen-4-fraq-plugins/fraq-plugin-group-admin`.
- Verified package metadata with JSON inspection, `pnpm lint`, `pnpm check`, and `npm pack --dry-run`.
- Diagnosed `D:\bot\fraq-plugins` showing no plugin response: the app installed `fraq-plugin-group-admin` and called `ctx.install(SchedulerPlugin)` / `ctx.install(GroupAdminPlugin, {})`, but `src/index.ts` never imported those symbols. Added `import GroupAdminPlugin, { SchedulerPlugin } from 'fraq-plugin-group-admin';`, removed the unused `param` import, and changed `ctx.start()` to `await ctx.start()`. `pnpm exec tsc --noEmit` passes; `pnpm start` no longer throws and stays running.
- Diagnosed commands running three times in `D:\bot\fraq-plugins`: three `pnpm start`/`tsx src/index.ts` process chains were connected to the same Milky endpoint. Stopped all duplicate Node processes; restart exactly one copy of the app.
- Moved README English aliases into the command table rows for `blacklist-add`, `whitelist-add`, `kick`, `mute`, and `recall`, removing the separate alias sentence. Verified with `pnpm lint`, `pnpm check`, and `npm pack --dry-run`.
- Added per-group persisted silent mode. `静默开` / `静默关` updates `silentSwitches` in `data/data.json`; when enabled, only `help` and switch command confirmations are sent. Other command replies, spam warnings/punishment notices, leave notices, review replies, and manual join-review notifications are suppressed while moderation actions still run. `help` now shows the silent status.
- Bumped the package version to `0.2.0` for the silent-mode feature.
- Restricted `tsconfig.json` `include` to `src`, `test`, and `tsdown.config.ts` so `pnpm check` does not race with `tsdown` cleaning `dist`.
- Verified silent-mode changes with `pnpm format`, `pnpm lint`, `pnpm check`, `pnpm smoke`, `pnpm build`, and `npm pack --dry-run`.
- Added per-group per-command switches. `命令开` / `命令关` without arguments still control the global command switch; `命令开 名称` / `命令关 名称` controls `title`, `添加黑名单`, `添加白名单`, `踢人`, `禁言`, or `撤回` by command name or alias. Switch commands and help remain always available so groups cannot lock themselves out.
- Persisted single-command switch state in `data/data.json` as `commandFeatureSwitches`; missing entries default to enabled for backward compatibility.
- Bumped the package version to `0.3.0` for the per-command switch feature.
- Verified per-command switches with `pnpm format`, `pnpm lint`, `pnpm check`, `pnpm smoke`, `pnpm build`, and `npm pack --dry-run`.
- Added configurable command prefix. `GroupAdminPluginOptions.commandPrefix` defaults to `/`; all registered router commands, aliases, reply-aware recall patterns, and review decisions are prefixed. Setting `commandPrefix: ''` restores no-prefix commands.
- Updated README command examples to use the default `/` prefix and documented `commandPrefix`.
- Bumped the package version to `0.4.0` for the command-prefix feature.
- Verified command-prefix changes with `pnpm format`, `pnpm lint`, `pnpm check`, `pnpm smoke`, `pnpm build`, and `npm pack --dry-run`.
- Removed `spamIgnoredUserIds`; users that should skip spam checks should be placed in `whitelistUserIds` / the persisted whitelist, which already protects them from spam punishments.
- Removed `inactiveCleanupGroupIds`; use the persisted per-group group-admin switch to control whether a group participates in scheduled cleanup and other automatic moderation.
- Bumped the package version to `0.5.0` for the configuration cleanup.
- Verified the cleanup with `pnpm format`, `pnpm lint`, `pnpm check`, `pnpm smoke`, `pnpm build`, and `npm pack --dry-run`.
- Updated README command-switch examples so aliases in `/命令开 名称` / `/命令关 名称` are shown with the default `/` prefix as well.
- Verified README prefix examples with `pnpm format`, `pnpm lint`, `pnpm check`, and `npm pack --dry-run`.
- Rolled README content back to the user-provided earlier command/config examples while leaving runtime code unchanged.
- Verified the README rollback with `pnpm format`, `pnpm lint`, `pnpm check`, and `npm pack --dry-run`.
- Restored README to the prefixed command examples version after the rollback proved to be the wrong target, while keeping the cleaned configuration docs without `inactiveCleanupGroupIds` or `spamIgnoredUserIds`.

Blocked/known:
- npm publish needs a one-time password or browser authentication for the logged-in npm account.
- Publishing `0.5.0` is currently blocked because `npm whoami` reports `ENEEDAUTH`; npm shows `fraq-plugin-group-admin` is owned by `wanjunhui <2401128923@qq.com>` and currently has published versions `0.1.0`, `0.1.1`, and `0.1.2`.
- Added forbidden-word moderation for `0.6.0`: persisted `forbiddenWords`, configurable `forbiddenWordMuteDurationSeconds`, `/添加违禁词` and `/删除违禁词` commands with `word-add`/`word-del` aliases, and automatic mute when ordinary non-whitelisted members send matching text.
- Added the project rule to check official Fraq plugins before implementing new features, with `random` noted as an example of existing reusable plugin behavior.
- Refactored group-admin into a directory-based module with `src/group-admin/index.ts` as the plugin entry and separate files for command definitions, data persistence, event handlers, scheduled tasks, message utilities, and public option types.
- Added the final-response convention to include a summary report table with file, change content, and line location after each completed task.
- Committed the `package.json` version bump to `0.6.1` so `pnpm publish` can pass its clean-working-tree check.
- Clarified the final-response report convention: list all changed locations, and use `第 x-y 行` for continuous multi-line ranges.
- Refactored the help command content into `src/group-admin/help-message.ts` and reorganized the visible help output by status, switches, lists, moderation, and other actions.
- Added a `更多命令` section to help output that lists every feature command with `[√]命令名` or `[x]命令名` status markers.
- Removed the command-prefix feature again: `commandPrefix` is gone from public options, router commands and reply actions are registered without `/`, help output and README examples now show no-prefix commands, and verification passed with `pnpm lint`, `pnpm check`, `pnpm smoke`, and `npm pack --dry-run`.

## Open questions

- Should the minimum QQ level or rejection reason vary by group?
