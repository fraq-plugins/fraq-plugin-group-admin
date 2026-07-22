# Fraq CLI 兼容性审计

审计基线：`@fraqjs/cli 0.7.0`、`@fraqjs/fraq 0.14.0`，Fraq 仓库提交 `f989f83b020341a7d668ddf2a2e30530a580af63`。

## CLI 的关键加载行为

CLI 生成的启动代码对每个插件只执行：

```ts
ctx.install((await import(normalizePluginName(pluginName))).default, pluginConfig);
```

插件配置在 CLI schema 中是 `z.any()`；fork filter 只决定哪些事件转发到子 Context，不会限制插件主动调用 `ctx.client`。Activation 的 `match.command` 只检查 command 路由的主名称；alias 和 rawPattern 必须使用 `match.plugin` 或 `match.tag`。

## 原实现可能导致故障的地方

| 风险 | 原因 | 本次处理 |
| --- | --- | --- |
| CLI 启动直接失败 | 默认导出的 `GroupAdminPlugin` 注入 `SchedulerService`，但服务只由同包命名导出的 `SchedulerPlugin` 提供；CLI 不会安装命名导出 | 默认插件内部创建 `SchedulerService`，移除注入依赖；保留命名导出仅供代码兼容 |
| fork 中跨群执行 | 定时任务调用 `get_group_list()` 后遍历机器人全部群，fork filter 不过滤主动 API | 新增必填语义的 `groupIds`，事件、命令和定时任务共用 fail-closed predicate |
| 空配置执行破坏性管理 | 群文件分类、容量清理、入群审核和提醒曾默认开启，未记录群的群管开关默认开启 | 空 `groupIds` 不管理任何群；入群审核、提醒、文件分类、容量清理和黑名单扫描默认关闭 |
| CLI 配置类型静默错误 | CLI 接受任意插件配置，`${{ env:... }}` 等引用通常产生字符串，TypeScript 类型不会在运行时生效 | `apply()` 开始时校验 ID、数组、布尔值、整数、枚举、cron、正则和 Record，错误会明确指出字段 |
| activation override 漏匹配 | `match.command` 不匹配 alias/rawPattern；回复撤回和审核决策是 rawPattern | 所有 command-like rawPattern 使用 `param.literal()`，并给命令族和 rawPattern 添加同一稳定 tag |
| 数据文件位置意外 | CLI 子进程工作目录是项目的 `app`，硬编码相对路径会落到 `app/data` | 公开 `dataPath`，保留兼容默认值 `./data/data.json`，README 说明 CLI cwd |
| 并发保存丢更新或损坏 JSON | 多个事件直接 `writeFile()`，旧快照可能覆盖新快照，进程中多个 fork 各持一份状态 | 同一路径复用进程内 store；保存快照进入串行队列，并以同目录临时文件 `rename` 原子替换 |
| 无效 cron 延迟到运行期 | 旧配置只有在注册表达式时才报错，错误上下文不清晰 | 配置归一化阶段统一解析所有 cron，即使相应功能暂未启用也能及时发现错误 |
| 业务文件直接散落 Milky 调用 | 命令、事件、审核和计划任务直接依赖 `ctx.client`，重构时容易漏掉作用域或替换点 | 所有原始 Milky client 访问收口到 `api.ts` facade，功能模块只依赖 API 接口 |

## 仍需注意的边界

- `groupIds` 与 CLI fork filter 需要同时维护：这是因为 Fraq 当前没有向插件公开 fork filter 的可枚举群范围。
- 多个独立 Node 进程仍不共享内存锁；原子替换可避免半截 JSON，但两个进程写同一 `dataPath` 仍可能最后写入者覆盖前者。部署时应让每个数据文件只有一个进程写入。
- 定时入群提醒需要读取全局群通知，其他定时任务需要读取群列表；代码只会对 `groupIds` 内的群继续查询或执行变更，但全局列表读取本身无法由 fork filter 限制。
- `SchedulerService.expression()` 按服务器本地时区解析五段 cron，并每秒检查一次。部署机器时区应与预期一致。
- CLI 的 `match.command` 仍不会识别英文 alias；需要覆盖 `recall`、回复 `y` / `n` 等路由时应配置 `match.plugin` 或 `match.tag`。
