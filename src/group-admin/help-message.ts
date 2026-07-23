import type { GroupAdminCommandKey } from './command-definitions';

export interface HelpMessage {
  title: string;
  content: string;
}

interface CommandHelpMessage extends HelpMessage {
  commandKey?: GroupAdminCommandKey;
}

const commandHelpMessages: readonly CommandHelpMessage[] = [
  {
    title: '帮助',
    content: 'help / 帮助 / 菜单：查看群管帮助',
  },
  {
    title: '群管开关',
    content: '群开 / 群关：开启 / 关闭群管',
  },
  {
    title: '全部命令开关',
    content: '命令开 / 命令关：开启 / 关闭全部群管命令',
  },
  {
    title: '单个命令开关',
    content: '命令开 命令名 / 命令关 命令名：开启 / 关闭指定命令',
  },
  {
    title: '静默开关',
    content: '静默开 / 静默关：开启 / 关闭静默模式',
  },
  {
    title: '一键开关',
    content: '一键开 / 一键关：同时开启 / 关闭群管和全部群管命令',
  },
  {
    title: '添加黑名单',
    content:
      '添加黑名单 user_id / 添加黑名单 at_user_id / blacklist-add user_id / blacklist-add at_user_id：添加用户到黑名单',
    commandKey: 'blacklist',
  },
  {
    title: '添加白名单',
    content:
      '添加白名单 user_id / 添加白名单 at_user_id / whitelist-add user_id / whitelist-add at_user_id：添加用户到白名单',
    commandKey: 'whitelist',
  },
  {
    title: '添加违禁词',
    content: '添加违禁词 词语 / word-add 词语：添加群聊违禁词',
    commandKey: 'forbiddenWord',
  },
  {
    title: '删除违禁词',
    content: '删除违禁词 词语 / word-del 词语：删除群聊违禁词',
    commandKey: 'forbiddenWord',
  },
  {
    title: '文件分类',
    content: '文件分类 / 群文件分类 / file-classify：立即分类当前群文件',
    commandKey: 'fileClassification',
  },
  {
    title: '名片检查',
    content: '名片检查 / 群名片检查 / card-check：立即检查当前群成员名片',
    commandKey: 'memberCard',
  },
  {
    title: '待审核入群',
    content: '待审核入群 / 入群审核列表 / join-list：查看待审核入群申请',
    commandKey: 'joinReview',
  },
  {
    title: '同意入群',
    content: '同意入群 user_id / approve-join user_id：通过指定用户的入群申请',
    commandKey: 'joinReview',
  },
  {
    title: '审核回复',
    content: '回复审核通知后发送 y / n：通过 / 拒绝入群申请',
    commandKey: 'joinReview',
  },
  {
    title: '踢人',
    content: '踢人 user_id / 踢人 at_user_id / kick user_id / kick at_user_id：踢出群成员',
    commandKey: 'kick',
  },
  {
    title: '禁言',
    content: '禁言 user_id s / 禁言 at_user_id s / mute user_id s / mute at_user_id s：禁言群成员，s 可省略',
    commandKey: 'mute',
  },
  {
    title: '按数量撤回',
    content: '撤回 数量 / recall 数量：撤回命令上方指定数量的消息',
    commandKey: 'recall',
  },
  {
    title: '按成员撤回',
    content:
      '撤回 user_id 数量 / 撤回 at_user_id 数量 / recall user_id 数量 / recall at_user_id 数量：撤回指定成员的消息',
    commandKey: 'recall',
  },
  {
    title: '回复撤回',
    content: '回复消息后发送 撤回 / 撤回 数量：从被回复消息开始撤回',
    commandKey: 'recall',
  },
];

export function buildHelpMessages(options: {
  groupId?: number;
  isGroupEnabled: (groupId: number) => boolean;
  areCommandsEnabled: (groupId: number) => boolean;
  isSilentEnabled: (groupId: number) => boolean;
  isCommandFeatureEnabled: (groupId: number, commandKey: GroupAdminCommandKey) => boolean;
}): HelpMessage[] {
  const { groupId, isGroupEnabled, areCommandsEnabled, isSilentEnabled, isCommandFeatureEnabled } = options;
  const statusText =
    groupId === undefined
      ? '当前状态\n私聊中无法查看群状态'
      : `当前状态
群管：${isGroupEnabled(groupId) ? '开启' : '关闭'}
命令：${areCommandsEnabled(groupId) ? '开启' : '关闭'}
静默：${isSilentEnabled(groupId) ? '开启' : '关闭'}`;

  return [
    {
      title: '约定',
      content: `约定
1. user_id：QQ号
2. at_user_id：艾特QQ
3. s：秒`,
    },
    {
      title: '当前状态',
      content: statusText,
    },
    ...commandHelpMessages.map(({ commandKey, title, content }) => {
      if (commandKey === undefined) {
        return { title, content };
      }

      const enabled = groupId === undefined || isCommandFeatureEnabled(groupId, commandKey);
      return {
        title: `[${enabled ? '√' : 'x'}]${title}`,
        content,
      };
    }),
  ];
}
