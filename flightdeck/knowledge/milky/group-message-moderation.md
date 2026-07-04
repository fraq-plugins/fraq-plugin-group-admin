# Milky group message moderation checklist
SUMMARY: Always implement group message moderation from message_receive events, checking every incoming segment and using Milky mute/kick APIs for enforcement; use group_member_decrease for leave notices; manual moderation commands should parse mention segments and raw QQ numbers; recall commands need reply-aware raw patterns and history APIs; blacklist enforcement should cover requests, joins, messages, and daily sweeps; whitelist checks must run before punitive actions; persisted lists and switches live in data/data.json.
READ WHEN: before implementing or changing group message moderation, spam detection, mute, kick behavior, leave notifications, manual moderation commands, recall commands, blacklist behavior, whitelist behavior, or group-admin switches

---

Milky/Fraq fields used for spam detection:
- Listen for `ctx.on('message_receive', handler)`.
- Only group messages have `data.message_scene === 'group'`, `data.peer_id` as group ID, `data.sender_id` as sender ID, `data.group_member.role`, and `data.segments`.
- To cover text, images, mentions, replies, and other content equally, count every item in `data.segments`; treat an empty segment list as one unit if defensive handling is needed.
- Skip the bot's own messages using `sender_id === self_id`.
- Avoid enforcing member-only punishments on owners/admins unless explicitly requested.
- Kick with `ctx.client.kick_group_member({ group_id, user_id, reject_add_request: false })`.
- Mute with `ctx.client.set_group_member_mute({ group_id, user_id, duration })`; duration is seconds.
- Listen for `ctx.on('group_member_decrease', handler)` to notify on member departures. `data.operator_id` is present when the member was kicked by an operator; otherwise treat it as a voluntary leave.
- Use `param.catchAll()` when a command must support both mention targets and raw QQ numbers. Mention targets come from `segment.type === 'mention'` and `segment.data.user_id`; raw QQ numbers can be parsed from remaining text segments.
- Check `get_group_member_info({ group_id, user_id, no_cache: true })` for both the bot and target before manual kick/mute commands. Owner bots can operate on admins and members; admin bots can operate only on members; member bots cannot moderate.
- For recall commands, `recall_group_message({ group_id, message_seq })` withdraws one group message. Use `get_history_messages({ message_scene: 'group', peer_id, start_message_seq, limit: 30 })` to scan older messages from a command or reply anchor; responses are ascending by `message_seq`, so sort newest-first before selecting "above" messages.
- A reply-prefixed command may arrive as `reply` segment before text, so add a `rawPattern()` beginning with `param.segment('reply')` in addition to the normal command route.
- Blacklist enforcement should reject direct `group_join_request` entries, kick on `group_member_increase`, kick on blacklisted `message_receive`, and use a scheduled `get_group_list()`/`get_group_member_list()` sweep for members who joined before the blacklist was added.
- Whitelist enforcement should be checked before any punitive action: manual kick/mute, recall candidate selection, spam mute/kick, blacklist kick/reject, inactive cleanup, and join-request auto-reject.
- Blacklist and whitelist data persist in `data/data.json` with `blacklistUserIds` and `whitelistUserIds` arrays. Load it before event/command checks and write it after commands mutate either list.
- Group-admin switches also persist in `data/data.json`: `groupSwitches` gates automatic event/scheduled handling for a group, and `commandSwitches` gates group-admin commands. Switch commands should remain available even when `commandSwitches` is off so moderators can re-enable commands.
