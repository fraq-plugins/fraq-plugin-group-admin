import { groupAdminCommandDefinitions } from './command-definitions';

export function buildHelpMessage(options: {
  groupId?: number;
  isGroupEnabled: (groupId: number) => boolean;
  areCommandsEnabled: (groupId: number) => boolean;
  isSilentEnabled: (groupId: number) => boolean;
  isCommandFeatureEnabled: (
    groupId: number,
    commandKey: (typeof groupAdminCommandDefinitions)[number]['key'],
  ) => boolean;
}): string {
  const { groupId, isGroupEnabled, areCommandsEnabled, isSilentEnabled, isCommandFeatureEnabled } = options;
  const formatCommandStatus = ({ key, label }: (typeof groupAdminCommandDefinitions)[number]): string =>
    `[${groupId === undefined || isCommandFeatureEnabled(groupId, key) ? '√' : 'x'}]${label}`;
  const commandStatusText = groupAdminCommandDefinitions.map(formatCommandStatus).join('\n');
  const statusText =
    groupId === undefined
      ? ''
      : `
当前状态
群管：${isGroupEnabled(groupId) ? '开启' : '关闭'}
命令：${areCommandsEnabled(groupId) ? '开启' : '关闭'}
静默：${isSilentEnabled(groupId) ? '开启' : '关闭'}`;

  return `群管帮助${statusText}

开关
群开 / 群关：开启或关闭自动群管
命令开 / 命令关：开启或关闭全部群管命令
命令开 名称 / 命令关 名称：开启或关闭单个命令
静默开 / 静默关：开启或关闭静默模式
一键开 / 一键关：同时开关群管和命令

更多命令
${commandStatusText}

名单
添加黑名单 @成员或QQ号 / blacklist-add @成员或QQ号
添加白名单 @成员或QQ号 / whitelist-add @成员或QQ号
添加违禁词 词语 / word-add 词语
删除违禁词 词语 / word-del 词语

管理
踢人 @成员或QQ号 / kick @成员或QQ号
禁言 @成员或QQ号 [秒数] / mute @成员或QQ号 [秒数]
撤回 数量 / recall 数量
撤回 @成员或QQ号 数量 / recall @成员或QQ号 数量
回复消息后发送 撤回 或 撤回 数量

其他
title 头衔：设置专属头衔
回复审核通知 y 通过，n 拒绝`;
}
