# fraq-plugin-group-admin

Fraq 的 Milky 群管理插件。它把入群审核、刷屏处理、退群通知、手动踢人/禁言、消息撤回、黑白名单、群管开关和群头衔设置放在一个插件里，并附带一个轻量的定时任务服务。

## 安装

```bash
pnpm add fraq-plugin-group-admin
```

这个包需要 Node.js 22+，并依赖 `@fraqjs/fraq ^0.12.0`。

## 使用

先安装 `SchedulerPlugin`，再安装 `GroupAdminPlugin`。群管插件会注入 `SchedulerService` 来执行每日清理任务。

```ts
import { Context } from '@fraqjs/fraq';
import GroupAdminPlugin, { SchedulerPlugin } from 'fraq-plugin-group-admin';

const ctx = Context.fromUrl(process.env.MILKY_URL ?? 'ws://127.0.0.1:3001');

ctx.install(SchedulerPlugin);
ctx.install(GroupAdminPlugin, {
  reviewerUserIds: [123456789],
  moderatorUserIds: [123456789],
});

await ctx.start();
```

## 功能

- 入群审核：低于最低 QQ 等级的申请自动拒绝，高于阈值的申请发送群内审核通知。
- 审核回复：管理员或配置的审核员回复审核通知 `y` 同意、`n` 拒绝。
- 容量清理：定时检查群容量，名额不足时踢出长期未发言的普通成员。
- 刷屏处理：按消息段计数，默认 10 秒内 8 段触发警告，第三次违规禁言或踢出。
- 退群通知：成员主动退群或被移出时在群内提示。
- 手动管理：支持踢人、禁言、撤回群消息。
- 黑名单：可拒绝入群、入群后踢出、发言时踢出，并支持每日扫描。
- 白名单：保护用户免受踢人、禁言、撤回、刷屏处罚、黑名单处罚和清理任务影响。
- 群开关：按群持久化开启/关闭自动群管和群管命令。
- 群头衔：`title` 命令设置调用者的群专属头衔。

## 命令

| 命令 | 说明 |
| --- | --- |
| `help` / `帮助` / `菜单` | 查看命令和当前群开关状态 |
| `群开` / `群管开` | 开启当前群自动群管 |
| `群关` / `群管关` | 关闭当前群自动群管 |
| `命令开` | 开启当前群群管命令 |
| `命令关` | 关闭当前群群管命令 |
| `一键开` | 同时开启自动群管和群管命令 |
| `一键关` | 同时关闭自动群管和群管命令 |
| `title 头衔` | 设置自己的群专属头衔，最多 18 个 UTF-8 字节 |
| `添加黑名单 @成员` / `添加黑名单 QQ号` | 添加黑名单用户 |
| `添加白名单 @成员` / `添加白名单 QQ号` | 添加白名单用户 |
| `踢人 @成员` / `踢人 QQ号` | 踢出成员 |
| `禁言 @成员 [秒数]` / `禁言 QQ号 [秒数]` | 禁言成员 |
| `撤回 数量` | 撤回命令上方的若干条消息 |
| `撤回 @成员 数量` / `撤回 QQ号 数量` | 只撤回指定用户的历史消息 |
| 回复消息后发送 `撤回` | 撤回被回复的消息 |
| 回复消息后发送 `撤回 数量` | 从被回复消息开始向上撤回若干条 |

英文别名：`kick`、`mute`、`recall`、`blacklist-add`、`whitelist-add`。

## 配置

```ts
interface GroupAdminPluginOptions {
  minimumAllowedLevel?: number;
  rejectionReason?: string;
  manualRejectionReason?: string;
  reviewerUserIds?: number[];
  moderatorUserIds?: number[];
  inactiveCleanupCron?: string;
  inactiveCleanupFreeSlotsThreshold?: number;
  inactiveCleanupKickLimit?: number;
  inactiveCleanupGroupIds?: number[];
  spamDetectionWindowMs?: number;
  spamDetectionSegmentLimit?: number;
  spamAction?: 'kick' | 'mute';
  spamMuteDurationSeconds?: number;
  manualMuteDurationSeconds?: number;
  spamIgnoredUserIds?: number[];
  blacklistUserIds?: number[];
  blacklistRejectionReason?: string;
  blacklistCleanupCron?: string;
  whitelistUserIds?: number[];
}
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `minimumAllowedLevel` | `5` | 入群自动拒绝的最低 QQ 等级阈值，低于该值会拒绝 |
| `rejectionReason` | `QQ 等级低于 ${minimumAllowedLevel}，暂不允许入群` | 自动拒绝低等级申请时使用的理由 |
| `manualRejectionReason` | `管理员拒绝入群` | 审核员回复 `n` 时使用的拒绝理由 |
| `reviewerUserIds` | `[]` | 可处理入群审核通知的用户 ID；群主和管理员始终可处理 |
| `moderatorUserIds` | `reviewerUserIds` | 可使用群管命令的用户 ID；群主和管理员始终可使用 |
| `inactiveCleanupCron` | `0 4 * * *` | 容量清理 cron 表达式 |
| `inactiveCleanupFreeSlotsThreshold` | `9` | 群剩余名额小于等于该值时触发清理 |
| `inactiveCleanupKickLimit` | `100` | 单群单次最多清理人数 |
| `inactiveCleanupGroupIds` | 所有群 | 指定容量清理生效的群 |
| `spamDetectionWindowMs` | `10000` | 刷屏检测窗口，单位毫秒 |
| `spamDetectionSegmentLimit` | `8` | 窗口内触发刷屏的消息段数量 |
| `spamAction` | `mute` | 第三次刷屏后的处理方式，可选 `mute` 或 `kick` |
| `spamMuteDurationSeconds` | `600` | 刷屏禁言时长，单位秒 |
| `manualMuteDurationSeconds` | `spamMuteDurationSeconds` | 手动禁言未传秒数时使用的默认时长 |
| `spamIgnoredUserIds` | `[]` | 跳过刷屏检测的用户 ID |
| `blacklistUserIds` | `[]` | 启动时注入的黑名单用户 |
| `blacklistRejectionReason` | `已被加入黑名单` | 黑名单用户入群申请的拒绝理由 |
| `blacklistCleanupCron` | `0 3 * * *` | 黑名单每日扫描 cron 表达式 |
| `whitelistUserIds` | `[]` | 启动时注入的白名单用户 |

## 权限与限制

- 群管命令只能在群聊中使用。
- 群主、管理员和 `moderatorUserIds` 可以使用群管命令。
- 入群审核可由群主、管理员和 `reviewerUserIds` 处理。
- 机器人不能操作自己。
- 机器人为群主时可以操作管理员和普通成员；机器人为管理员时只能操作普通成员；机器人为普通成员时不能执行踢人、禁言或撤回。
- 白名单用户会跳过所有惩罚性操作。

## 持久化

插件会读写 `./data/data.json`，保存这些运行时数据：

- `blacklistUserIds`
- `whitelistUserIds`
- `groupSwitches`
- `commandSwitches`

启动时会把配置中的黑白名单和文件中的持久化名单合并，并在命令修改名单或开关后立即写回文件。

## SchedulerPlugin

`SchedulerPlugin` 会提供 `SchedulerService`，支持：

- `after(delayMs, callback)`
- `every(intervalMs, callback)`
- `at(date, callback)`
- `atText(datetimeText, callback)`
- `expression(cron, callback)`
- `cancel(timer)`

`expression` 使用 5 段 cron：`分 时 日 月 周`。

## 开发

```bash
pnpm install
pnpm lint
pnpm check
pnpm smoke
pnpm build
```

`pnpm start` 会执行轻量 smoke 测试，用来确认插件导出可以正常加载。这个包是 Fraq 插件，不是独立机器人主程序，因此不会启动常驻服务。
