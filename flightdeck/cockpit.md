# Cockpit - fraq

Focus:
Maintain and release the reusable `fraq-plugin-group-admin` moderation package for current Fraq versions.

## In flight
- group-admin - package version `1.0.2` is published; the running test deployment remains on `1.0.1`. Fraq market ingests the package but marks it unlisted because the npm manifest lacks `fraq.category`.

## Next
- Add `fraq.category: "management"`, bump and publish the package, then verify its Fraq market listing.
- Update the test deployment from `1.0.1` to `1.0.2` when requested.
- Configure deployment `groupIds` and opt-in automatic tasks before upgrading a running bot.

## Open questions
- Should the minimum QQ level or rejection reason vary by group?
