/** 用户角色枚举 */
export type UserRole = 'user' | 'editor' | 'admin';

/** 用户信息 */
export interface UserProfile {
  id: number;
  username: string;
  nickname?: string | null;
  email?: string | null;
  role: UserRole | string;
  avatar?: string | null;
  status: number;
  created_at?: string;
}

/** 角色展示映射（适配暗夜液态玻璃） */
export const ROLE_META: Record<
  string,
  { label: string; color: string; bg: string; border: string }
> = {
  admin: {
    label: '管理员',
    color: '#e4b863',
    bg: 'rgba(228, 184, 99, 0.12)',
    border: 'rgba(228, 184, 99, 0.35)',
  },
  editor: {
    label: '编辑者',
    color: '#7c9cc4',
    bg: 'rgba(124, 156, 196, 0.14)',
    border: 'rgba(124, 156, 196, 0.32)',
  },
  user: {
    label: '普通用户',
    color: 'rgba(255, 255, 255, 0.78)',
    bg: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.16)',
  },
};

export function getRoleLabel(role?: string | null): string {
  if (!role) return '普通用户';
  return ROLE_META[role]?.label ?? '普通用户';
}

/** 文档记录 */
export interface DocumentItem {
  id: number;
  title: string;
  content?: string | null;
  category?: string | null;
  department?: string | null;
  file_type?: string | null;
  file_path?: string | null;
  status: number;
  chunk_count?: number;
  error_message?: string | null;
  created_by?: number | null;
  created_at: string;
  updated_at?: string;
  processed_at?: string | null;
}

/** 文档索引同步状态 */
export interface DocumentSyncStatus {
  total_docs: number;
  synced_docs: number;
  pending_upsert: number;
  pending_delete: number;
  failed_docs: number;
  indexed_chunks: number;
  ai_service_online: boolean;
  in_sync: boolean;
}

/** RAG 检索返回的单条参考来源 */
export interface SourceRef {
  title: string;
  category?: string;
  content_preview?: string;
  score?: number;
  source_url?: string;
  published_at?: string;
}
