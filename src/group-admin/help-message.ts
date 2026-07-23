import type { GroupAdminCommandKey } from './command-definitions';

export interface HelpMessage {
  title: string;
  content: string;
}

interface CommandHelpMessage {
  title: string;
  command: string;
  description: string;
  aliases: readonly string[];
  commandKey?: GroupAdminCommandKey;
}

const commandHelpMessages: readonly CommandHelpMessage[] = [
  {
    title: '帮助',
    command: 'help',
    description: '查看群管帮助',
    aliases: ['帮助', '菜单'],
  },
  {
    title: '群开',
    command: '群开',
    description: '开启群管',
    aliases: ['群管开'],
  },
  {
    title: '群关',
    command: '群关',
    description: '关闭群管',
    aliases: ['群管关'],
  },
  {
    title: '命令开',
    command: '命令开 [命令名]',
    description: '开启全部群管命令；指定命令名时开启单个命令',
    aliases: [],
  },
  {
    title: '命令关',
    command: '命令关 [命令名]',
    description: '关闭全部群管命令；指定命令名时关闭单个命令',
    aliases: [],
  },
  {
    title: '静默开',
    command: '静默开',
    description: '开启静默模式',
    aliases: [],
  },
  {
    title: '静默关',
    command: '静默关',
    description: '关闭静默模式',
    aliases: [],
  },
  {
    title: '一键开',
    command: '一键开',
    description: '同时开启群管和全部群管命令',
    aliases: [],
  },
  {
    title: '一键关',
    command: '一键关',
    description: '同时关闭群管和全部群管命令',
    aliases: [],
  },
  {
    title: '添加黑名单',
    command: '添加黑名单 [user_id | at_user_id]',
    description: '添加用户到黑名单',
    aliases: ['blacklist-add'],
    commandKey: 'blacklist',
  },
  {
    title: '添加白名单',
    command: '添加白名单 [user_id | at_user_id]',
    description: '添加用户到白名单',
    aliases: ['whitelist-add'],
    commandKey: 'whitelist',
  },
  {
    title: '添加违禁词',
    command: '添加违禁词 [词语]',
    description: '添加群聊违禁词',
    aliases: ['word-add'],
    commandKey: 'forbiddenWord',
  },
  {
    title: '删除违禁词',
    command: '删除违禁词 [词语]',
    description: '删除群聊违禁词',
    aliases: ['word-del'],
    commandKey: 'forbiddenWord',
  },
  {
    title: '文件分类',
    command: '文件分类',
    description: '立即分类当前群文件',
    aliases: ['群文件分类', 'file-classify'],
    commandKey: 'fileClassification',
  },
  {
    title: '名片检查',
    command: '名片检查',
    description: '立即检查当前群成员名片',
    aliases: ['群名片检查', 'card-check'],
    commandKey: 'memberCard',
  },
  {
    title: '待审核入群',
    command: '待审核入群',
    description: '查看待审核入群申请',
    aliases: ['入群审核列表', 'join-list'],
    commandKey: 'joinReview',
  },
  {
    title: '同意入群',
    command: '同意入群 [user_id]',
    description: '通过指定用户的入群申请',
    aliases: ['approve-join'],
    commandKey: 'joinReview',
  },
  {
    title: '通过入群申请',
    command: '回复审核通知后发送 y',
    description: '通过入群申请',
    aliases: [],
    commandKey: 'joinReview',
  },
  {
    title: '拒绝入群申请',
    command: '回复审核通知后发送 n',
    description: '拒绝入群申请',
    aliases: [],
    commandKey: 'joinReview',
  },
  {
    title: '踢人',
    command: '踢人 [user_id | at_user_id]',
    description: '踢出群成员',
    aliases: ['踢', 'kick'],
    commandKey: 'kick',
  },
  {
    title: '禁言',
    command: '禁言 [user_id | at_user_id] [s]',
    description: '禁言群成员；不填写 s 时使用默认时长',
    aliases: ['mute'],
    commandKey: 'mute',
  },
  {
    title: '按数量撤回',
    command: '撤回 [number]',
    description: '撤回命令上方指定数量的消息',
    aliases: ['recall'],
    commandKey: 'recall',
  },
  {
    title: '按成员撤回',
    command: '撤回 [user_id | at_user_id] [number]',
    description: '撤回指定成员的消息',
    aliases: ['recall'],
    commandKey: 'recall',
  },
  {
    title: '回复撤回',
    command: '回复消息后发送 撤回 [number]',
    description: '从被回复消息开始撤回；number 可省略',
    aliases: ['recall'],
    commandKey: 'recall',
  },
];

function formatCommandHelpMessage({ command, description, aliases }: CommandHelpMessage): string {
  return `命令：${command}
说明：${description}
别名：${aliases.length > 0 ? aliases.join(' / ') : '无'}`;
}

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
1.user_id: qq号
2.at_user_id: 艾特qq
3.s: 秒
4.number：数量
5.别名参数同命令
6. 带有 “|” 符号的参数代表可选其中之一`,
    },
    {
      title: '当前状态',
      content: statusText,
    },
    ...commandHelpMessages.map((message) => {
      const { commandKey, title } = message;
      if (commandKey === undefined) {
        return { title, content: formatCommandHelpMessage(message) };
      }

      const enabled = groupId === undefined || isCommandFeatureEnabled(groupId, commandKey);
      return {
        title: `[${enabled ? '√' : 'x'}]${title}`,
        content: formatCommandHelpMessage(message),
      };
    }),
  ];
}
