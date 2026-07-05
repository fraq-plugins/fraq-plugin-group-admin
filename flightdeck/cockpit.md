# Cockpit - fraq

Focus:
Group-admin plugin implementation and reusable package structure for the Fraq bot.

## In flight
- group-admin - first moderation feature implemented and package structure added for `fraq-plugin-group-admin`.
- group-admin/title-grant - self-service group title command is merged into the group-admin plugin.
- group-admin/spam - detects segment-level flooding, warns twice, then mutes or kicks by configuration.
- group-admin/leave-notice - announces member leave and kick events in the group.
- group-admin/manual-moderation - kick and mute commands support mention targets/raw QQ numbers and honor the bot's group role.
- group-admin/recall - recalls replied messages or recent history from a command/reply anchor with optional target filtering.
- group-admin/blacklist - persists users by mention/raw QQ and rejects or kicks them on request, join, message, and daily scan.
- group-admin/whitelist - persists users protected from kick, mute, recall, spam, blacklist, and cleanup operations.
- group-admin/switches - persists per-group feature and command switches, with one-tap enable/disable commands for both.
- config - startup config lives in `data/config.json` and is loaded by `index.ts`.
- git hygiene - `.gitignore` keeps dependencies, build output, logs, and runtime data out of Git while retaining `data/config.json`.
- docs - `README.md` documents features, commands, config, and permissions.
- group-admin/help - `help`/`帮助`/`菜单` shows commands and current group switch status.

## Next
- Complete npm two-factor authentication, then publish `fraq-plugin-group-admin@0.1.1`.
- Choose the next group-admin moderation feature or group-specific configuration.

## Open questions
- Should the minimum QQ level or rejection reason vary by group?
