# Fraq CLI plugin compatibility checklist
SUMMARY: Always keep a Fraq CLI plugin's default export self-contained, validate its z.any runtime config, and explicitly scope proactive Milky API work because CLI forks only filter events.
READ WHEN: before changing any Fraq plugin dependency, CLI configuration, activation metadata, scheduled task, persistence path, or proactive Milky API traversal

---

Source checked on 2026-07-23:
- `@fraqjs/cli 0.7.0` package output and Fraq repository commit `f989f83b020341a7d668ddf2a2e30530a580af63`
- `@fraqjs/fraq 0.14.0` runtime and type declarations

Checklist:
- CLI-generated startup installs only `(await import(normalizePluginName(name))).default`; a default plugin cannot require a service provided only by a named export from the same package.
- CLI plugin options are parsed with `z.any()`. Validate and normalize IDs, arrays, enums, numbers, cron expressions, regular expressions, and records inside plugin startup.
- A fork filter controls forwarded events, not `ctx.client` calls. Any timer or startup process that lists groups, members, files, or notifications needs its own explicit group scope before performing group-specific reads or mutations.
- `activation.match.command` matches only a command route's canonical `route.name`. It does not match aliases or rawPattern routes; use shared stable tags for logical command families.
- Command-like top-level raw patterns still need `param.literal()` so activation is consumed at the intended point.
- CLI runs the generated app from its `app` directory. Document relative persistence paths and expose a configurable path.
- Multiple plugin instances in one CLI process can share a persistence path. Share in-memory state by resolved path and serialize atomic saves; separate OS processes still require deployment-level single-writer discipline.
- Fraq CLI 0.7 `install` only runs the package manager against the existing generated `app/package.json`; it does not regenerate that file from `versions.yml`. After changing a plugin lock version, `start` regenerates the app before installing, but an install-only workflow must synchronize `app/package.json` before running the package manager.
- The CLI-generated `@fraqjs/color-log@0.2.0` still declares a Fraq `^0.3.3` peer. With Fraq 0.14, npm may raise `ERESOLVE` when a dependency actually changes; use the deployment's established peer-override policy until the CLI updates this generated dependency.
