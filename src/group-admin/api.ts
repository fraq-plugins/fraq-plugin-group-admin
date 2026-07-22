import type { Context } from '@fraqjs/fraq';

type MilkyClient = Context['client'];
type GroupAdminEndpoint =
  | 'get_login_info'
  | 'get_group_list'
  | 'get_group_member_info'
  | 'get_group_member_list'
  | 'get_user_profile'
  | 'get_message'
  | 'get_history_messages'
  | 'send_group_message'
  | 'recall_group_message'
  | 'kick_group_member'
  | 'set_group_member_mute'
  | 'set_group_member_card'
  | 'get_group_notifications'
  | 'accept_group_request'
  | 'reject_group_request'
  | 'get_group_files'
  | 'create_group_folder'
  | 'move_group_file';

/** Feature modules use this facade instead of reaching into Context.client. */
export type GroupAdminApi = Pick<MilkyClient, GroupAdminEndpoint>;

export function createGroupAdminApi(client: MilkyClient): GroupAdminApi {
  return new Proxy({} as GroupAdminApi, {
    get: (_target, property: GroupAdminEndpoint) => client[property].bind(client),
  });
}

export type GroupMessage = Parameters<MilkyClient['send_group_message']>[0]['message'];
export type SentGroupMessage = Awaited<ReturnType<MilkyClient['send_group_message']>>;
