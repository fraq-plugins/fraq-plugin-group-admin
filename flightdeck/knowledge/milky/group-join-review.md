# Milky group join review checklist
SUMMARY: Always handle direct group join review by combining the group_join_request event, get_user_profile.level, notification messages, and group request accept/reject metadata.
READ WHEN: before implementing or changing Milky group join request moderation

---

Source checked on 2026-07-03:
- https://milky.ntqqrev.org/
- `@fraqjs/fraq@0.8.0` bundled Milky type definitions.

Milky/Fraq fields used for direct join requests:
- Listen for `ctx.on('group_join_request', handler)`.
- Event data contains `group_id`, `notification_seq`, `is_filtered`, `initiator_id`, and `comment`.
- The join request event does not include QQ level. Call `ctx.client.get_user_profile({ user_id: initiator_id })` and read `profile.level`.
- To create a manual review prompt, send a group message with `ctx.client.send_group_message`; store the returned `message_seq` as the key for the pending request.
- To handle reviewer replies, match a `reply` incoming segment and read `reply.data.message_seq`; use that sequence to find the pending request.
- Accept with `ctx.client.accept_group_request({ group_id, notification_seq, notification_type: 'join_request', is_filtered })`.
- Reject with `ctx.client.reject_group_request({ group_id, notification_seq, notification_type: 'join_request', is_filtered, reason })`.
- `reject_group_request.notification_type` must be `'join_request'` for direct user join requests and `'invited_join_request'` for member-invited join requests.

Milky/Fraq fields used for capacity cleanup:
- `ctx.client.get_group_list()` returns `groups`, each with `group_id`, `member_count`, and `max_member_count`.
- `ctx.client.get_group_member_list({ group_id, no_cache: true })` returns members with `role` and `last_sent_time`.
- Only kick members where `role === 'member'`; never target owners/admins from this cleanup.
- Kick with `ctx.client.kick_group_member({ group_id, user_id, reject_add_request: false })`.
