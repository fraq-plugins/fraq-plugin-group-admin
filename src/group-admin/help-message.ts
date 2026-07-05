import { groupAdminCommandDefinitions } from './command-definitions';

export function buildHelpMessage(options: {
  groupId?: number;
  withCommandPrefix: (name: string) => string;
  isGroupEnabled: (groupId: number) => boolean;
  areCommandsEnabled: (groupId: number) => boolean;
  isSilentEnabled: (groupId: number) => boolean;
  isCommandFeatureEnabled: (
    groupId: number,
    commandKey: (typeof groupAdminCommandDefinitions)[number]['key'],
  ) => boolean;
}): string {
  const { groupId, withCommandPrefix, isGroupEnabled, areCommandsEnabled, isSilentEnabled, isCommandFeatureEnabled } =
    options;
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
${withCommandPrefix('群开')} / ${withCommandPrefix('群关')}：开启或关闭自动群管
${withCommandPrefix('命令开')} / ${withCommandPrefix('命令关')}：开启或关闭全部群管命令
${withCommandPrefix('命令开')} 名称 / ${withCommandPrefix('命令关')} 名称：开启或关闭单个命令
${withCommandPrefix('静默开')} / ${withCommandPrefix('静默关')}：开启或关闭静默模式
${withCommandPrefix('一键开')} / ${withCommandPrefix('一键关')}：同时开关群管和命令

更多命令
${commandStatusText}

名单
${withCommandPrefix('添加黑名单')} @成员或QQ号 / ${withCommandPrefix('blacklist-add')} @成员或QQ号
${withCommandPrefix('添加白名单')} @成员或QQ号 / ${withCommandPrefix('whitelist-add')} @成员或QQ号
${withCommandPrefix('添加违禁词')} 词语 / ${withCommandPrefix('word-add')} 词语
${withCommandPrefix('删除违禁词')} 词语 / ${withCommandPrefix('word-del')} 词语

管理
${withCommandPrefix('踢人')} @成员或QQ号 / ${withCommandPrefix('kick')} @成员或QQ号
${withCommandPrefix('禁言')} @成员或QQ号 [秒数] / ${withCommandPrefix('mute')} @成员或QQ号 [秒数]
${withCommandPrefix('撤回')} 数量 / ${withCommandPrefix('recall')} 数量
${withCommandPrefix('撤回')} @成员或QQ号 数量 / ${withCommandPrefix('recall')} @成员或QQ号 数量
回复消息后发送 ${withCommandPrefix('撤回')} 或 ${withCommandPrefix('撤回')} 数量

其他
${withCommandPrefix('title')} 头衔：设置专属头衔
回复审核通知 ${withCommandPrefix('y')} 通过，${withCommandPrefix('n')} 拒绝`;
}
