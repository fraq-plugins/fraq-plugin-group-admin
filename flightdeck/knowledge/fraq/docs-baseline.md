# Fraq docs baseline checklist
SUMMARY: Always use the current Fraq docs baseline when creating or changing bot, command, plugin, logging, or mock-test code.
READ WHEN: before any Fraq project implementation, command/router change, plugin change, or test setup

---

Source read on 2026-07-03:
- https://fraq.dev/docs
- https://fraq.dev/llms-full.txt

Operational baseline:
- Fraq is a TypeScript chatbot framework for the Milky protocol, which uses HTTP/WebSocket for QQ bot integrations.
- Runtime should be Node.js 22+ or another server-side JavaScript runtime with WebSocket API support. TypeScript plus `tsx` is the recommended development path.
- Install core Fraq with `@fraqjs/fraq`.
- Create a bot with `Context.fromUrl(milkyUrl, options)` for a real Milky endpoint, or `Context.fromClient(client)` for mock/custom clients. Call `ctx.start()` after setup.
- Core surfaces on `Context`: `ctx.router`, `ctx.client`, `ctx.logger`, `ctx.on`, `ctx.install`, `ctx.provide`, `ctx.resolve`, `ctx.fork`, `ctx.timeout`, `ctx.interval`, and `ctx.stop`.
- Commands use `ctx.router.command(name).arg(...).execute(...)`. Parameters include `param.literal`, `param.str`, `param.num`, `param.greedy`, `param.catchAll`, `param.union`, and `param.segment`.
- `param.catchAll()` consumes all remaining text and non-text segments and must be the final parameter. `param.greedy()` consumes only the rest of the current text segment.
- Router rules are tried in definition order. Ambiguous overloads can shadow later routes, especially when `param.str()` appears before narrower numeric or literal patterns.
- Use `ctx.router.group` for subcommands, `rawPattern` for direct pattern matching, `.describe()`, `.alias()`, and `.hide()` for command metadata.
- A command `Session` exposes `selfId`, `raw`, `reply(textOrSegments, options)`, and `reaction(type, reactionId)`. Use `ctx.client` for lower-level Milky API calls.
- Prefer deployment-side filtering with `ctx.fork(..., filter)` over plugin-internal `ctx.router.filter` for permission/scope control, unless the plugin specifically owns that routing policy.
- Fraq does not log to terminal by default. Pass `logHandler` when creating `Context`; `@fraqjs/color-log` and `combineLogHandlers` are official options.
- Define plugins with `definePlugin({ name, apply(ctx) { ... } })`. Use `requires`, `optionalRequires`, `ctx.provide`, `ctx.resolve`, and `ctx.tryResolve` for services.
- Plugin `apply` runs during setup, while plugin `start` runs at `ctx.start()` time. Avoid doing start-time work inside `apply`.
- Use `@fraqjs/mock` and `createMockMilkyClient()` for mock tests. The mock client can emit events, stub API responses, and record API calls.
- Project guidance from docs: keep TypeScript strict enough for library/plugin development, use smoke tests plus mock tests, and follow Fraq plugin naming conventions such as `fraq-plugin-*` or scoped `@scope/fraq-plugin-*`.
