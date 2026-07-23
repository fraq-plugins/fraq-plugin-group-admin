# Cockpit - fraq

Focus:
Maintain and release the reusable `fraq-plugin-group-admin` moderation package for current Fraq versions.

## In flight
- group-admin - package version `1.0.0` is published and installed in the test deployment; an unreleased help refactor now gives every command its own command/description/alias node.

## Next
- Bump and publish the next package version when requested, then update the test deployment and verify the new help output against Milky.
- Configure deployment `groupIds` and opt-in automatic tasks before upgrading a running bot.

## Open questions
- Should the minimum QQ level or rejection reason vary by group?
