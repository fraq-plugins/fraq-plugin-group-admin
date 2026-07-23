# Group-admin help output checklist
SUMMARY: Always give each group-admin command its own merged-forward node with exact `命令：` / `说明：` / `别名：` lines; parameters stay on the command line and aliases inherit them.
READ WHEN: before adding, changing, or removing any group-admin command, alias, argument, or help output

---

Required convention node:

```text
约定
1.user_id: qq号
2.at_user_id: 艾特qq
3.s: 秒
4.number：数量
5.别名参数同命令
```

Command node template:

```text
命令：禁言 [user_id | at_user_id] [s]
说明：禁言群成员；不填写 s 时使用默认时长
别名：mute
```

Rules:
- One forwarded node represents one command; paired commands such as `群开` / `群关` and `y` / `n` use separate nodes.
- Put arguments only after the canonical command. The alias line contains alias names only because aliases inherit the canonical command arguments.
- Use `别名：无` when a command has no alias.
- Preserve the current-state node and feature-enabled title markers.
- Smoke coverage must assert the exact convention text, the mute template, and the three-line shape of every command node.
