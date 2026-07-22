import type { Context, milky } from '@fraqjs/fraq';

import type { GroupAdminApi } from './api';

export type GroupFileClassificationCategories = Record<string, readonly string[]>;
export type GroupFileClassificationMode = 'extension' | 'category';

export const defaultGroupFileClassificationCategories: GroupFileClassificationCategories = {
  图片: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic', 'heif'],
  文档: ['txt', 'md', 'pdf', 'doc', 'docx', 'rtf', 'wps'],
  表格: ['xls', 'xlsx', 'csv', 'et', 'ods'],
  演示: ['ppt', 'pptx', 'dps', 'odp'],
  压缩包: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'],
  音频: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a'],
  视频: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm'],
  代码: ['js', 'ts', 'jsx', 'tsx', 'json', 'html', 'css', 'py', 'java', 'go', 'rs', 'cpp', 'c', 'h', 'cs'],
};

type GroupFileClassificationContext = Pick<Context, 'logger'> & { api: GroupAdminApi };
type MoveGroupFileInput = Parameters<Context['client']['move_group_file']>[0];

function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\.+/u, '').toLocaleLowerCase();
}

function getFileExtension(fileName: string): string | undefined {
  const lastDotIndex = fileName.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return undefined;
  }

  return normalizeExtension(fileName.slice(lastDotIndex + 1));
}

function buildExtensionFolderMap(categories: GroupFileClassificationCategories): Map<string, string> {
  const extensionFolderMap = new Map<string, string>();

  for (const [folderName, extensions] of Object.entries(categories)) {
    const normalizedFolderName = folderName.trim();
    if (!normalizedFolderName) {
      continue;
    }

    for (const extension of extensions) {
      const normalizedExtension = normalizeExtension(extension);
      if (normalizedExtension) {
        extensionFolderMap.set(normalizedExtension, normalizedFolderName);
      }
    }
  }

  return extensionFolderMap;
}

function uniqueTexts(values: string[]): string[] {
  return [...new Set(values)];
}

function stripLeadingSlashes(value: string): string {
  return value.replace(/^\/+/u, '');
}

function textOrEmpty(value: string | null | undefined): string {
  return value ?? '';
}

async function moveGroupFileWithFallbacks(ctx: GroupFileClassificationContext, input: MoveGroupFileInput) {
  const fileIds = uniqueTexts([input.file_id, stripLeadingSlashes(input.file_id)]).filter(Boolean);
  const parentFolderId = textOrEmpty(input.parent_folder_id);
  const targetFolderId = textOrEmpty(input.target_folder_id);
  const parentFolderIds = uniqueTexts([parentFolderId, stripLeadingSlashes(parentFolderId), '/']).filter(Boolean);
  const targetFolderIds = uniqueTexts([targetFolderId, stripLeadingSlashes(targetFolderId)]).filter(Boolean);
  let lastError: unknown;

  for (const fileId of fileIds) {
    for (const parentFolderId of parentFolderIds) {
      for (const targetFolderId of targetFolderIds) {
        try {
          await ctx.api.move_group_file({
            group_id: input.group_id,
            file_id: fileId,
            parent_folder_id: parentFolderId,
            target_folder_id: targetFolderId,
          });
          return;
        } catch (error) {
          lastError = error;
        }
      }
    }
  }

  throw lastError;
}

async function ensureFolder(
  ctx: GroupFileClassificationContext,
  groupId: number,
  folders: milky.GroupFolderEntity[],
  folderName: string,
): Promise<string> {
  const existingFolder = folders.find((folder) => folder.folder_name === folderName);
  if (existingFolder) {
    return existingFolder.folder_id;
  }

  const { folder_id } = await ctx.api.create_group_folder({
    group_id: groupId,
    folder_name: folderName,
  });

  folders.push({
    group_id: groupId,
    folder_id,
    parent_folder_id: '/',
    folder_name: folderName,
    created_time: Math.floor(Date.now() / 1000),
    last_modified_time: Math.floor(Date.now() / 1000),
    creator_id: 0,
    file_count: 0,
  });

  return folder_id;
}

export async function classifyRootGroupFiles(options: {
  ctx: GroupFileClassificationContext;
  groupId: number;
  mode?: GroupFileClassificationMode;
  categories?: GroupFileClassificationCategories;
  fallbackFolderName?: string;
}): Promise<{ moved: number; skipped: number; failed: number }> {
  const {
    ctx,
    groupId,
    mode = 'extension',
    categories = defaultGroupFileClassificationCategories,
    fallbackFolderName = '其他',
  } = options;
  const rootFolderId = '/';
  const extensionFolderMap = buildExtensionFolderMap(categories);
  const fallbackFolder = fallbackFolderName.trim();
  const { files, folders } = await ctx.api.get_group_files({
    group_id: groupId,
    parent_folder_id: rootFolderId,
  });

  let moved = 0;
  let skipped = 0;
  let failed = 0;
  const folderIdCache = new Map<string, string>();

  for (const file of files) {
    const extension = getFileExtension(file.file_name);
    const targetFolderName =
      extension && mode === 'extension' ? extension : extension ? extensionFolderMap.get(extension) : undefined;
    const finalFolderName = targetFolderName ?? fallbackFolder;
    if (!finalFolderName) {
      skipped += 1;
      continue;
    }

    try {
      let targetFolderId = folderIdCache.get(finalFolderName);
      if (!targetFolderId) {
        targetFolderId = await ensureFolder(ctx, groupId, folders, finalFolderName);
        folderIdCache.set(finalFolderName, targetFolderId);
      }

      if (file.parent_folder_id === targetFolderId) {
        skipped += 1;
        continue;
      }

      await moveGroupFileWithFallbacks(ctx, {
        group_id: groupId,
        file_id: file.file_id,
        parent_folder_id: file.parent_folder_id || rootFolderId,
        target_folder_id: targetFolderId,
      });
      moved += 1;
    } catch (error) {
      failed += 1;
      ctx.logger.error(`群文件分类失败：群 ${groupId}，文件 ${file.file_name}(${file.file_id})`, error);
    }
  }

  return { moved, skipped, failed };
}
