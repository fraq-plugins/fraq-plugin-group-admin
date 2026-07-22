# Cockpit - fraq

Focus:
Maintain and release the reusable `fraq-plugin-group-admin` moderation package for current Fraq versions.

## In flight
- group-admin - package version `0.10.0` is refactored for Fraq CLI 0.7/Fraq 0.14: self-contained default export, explicit group scope, runtime validation, stable activation tags, modular commands/API/data/config, and atomic persistence.

## Next
- Publish `fraq-plugin-group-admin@0.10.0` when npm authentication is available.
- Configure deployment `groupIds` and opt-in automatic tasks before upgrading a running bot.

## Open questions
- Should the minimum QQ level or rejection reason vary by group?
