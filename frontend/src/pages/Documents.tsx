import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  Button,
  Input,
  Tag,
  Modal,
  Form,
  Select,
  message,
  Space,
  Popconfirm,
  Tooltip,
  Badge,
  Drawer,
  Alert,
  Descriptions,
  Radio,
} from 'antd';
import type { TableProps } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  FileTextOutlined,
  DeleteOutlined,
  ReloadOutlined,
  UploadOutlined,
  SyncOutlined,
  EyeOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { DocumentItem, DocumentSyncStatus } from '../types';

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const STATUS_META: Record<
  number,
  { label: string; color: string; bg: string; border: string }
> = {
  1: {
    label: '待索引',
    color: '#7c9cc4',
    bg: 'rgba(124, 156, 196, 0.14)',
    border: 'rgba(124, 156, 196, 0.35)',
  },
  2: {
    label: '待更新',
    color: '#fbbf24',
    bg: 'rgba(251, 191, 36, 0.12)',
    border: 'rgba(251, 191, 36, 0.35)',
  },
  3: {
    label: '已同步',
    color: '#34d399',
    bg: 'rgba(52, 211, 153, 0.12)',
    border: 'rgba(52, 211, 153, 0.32)',
  },
  4: {
    label: '同步失败',
    color: '#f87171',
    bg: 'rgba(248, 113, 113, 0.12)',
    border: 'rgba(248, 113, 113, 0.35)',
  },
};

const FILE_TYPE_LABEL: Record<string, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  txt: 'TXT',
  md: 'MD',
  text: '纯文本',
};

function formatCompactTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export default function Documents() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canManageIndex = user?.role === 'admin' || user?.role === 'editor';

  /* 列表与查询状态（任何筛选/搜索变化同步重置 page = 1） */
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState<{
    page: number;
    pageSize: number;
    keyword: string;
    category: string;
    status?: number;
  }>({
    page: 1,
    pageSize: 10,
    keyword: '',
    category: '',
    status: undefined,
  });
  const [keywordInput, setKeywordInput] = useState('');
  const [categories, setCategories] = useState<string[]>([]);

  /* 索引同步状态 */
  const [syncStatus, setSyncStatus] = useState<DocumentSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  /* 批量勾选与清空 */
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearScope, setClearScope] = useState<'filtered' | 'all'>('filtered');
  const [clearing, setClearing] = useState(false);

  /* 多文件依次上传 */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');

  /* 新建文档弹窗 */
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();

  /* 文档查看 / 编辑抽屉 */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'view' | 'edit'>('view');
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [activeDoc, setActiveDoc] = useState<DocumentItem | null>(null);
  const [editForm] = Form.useForm();

  /* 关键词防抖并重置 page = 1 */
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((prev) => {
        const trimmed = keywordInput.trim();
        if (prev.keyword === trimmed) return prev;
        return { ...prev, keyword: trimmed, page: 1 };
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  const loadSyncStatus = useCallback(async () => {
    try {
      const res: any = await api.get('/document/sync-status', { silentError: true });
      if (res?.code === 200 && res?.data) {
        setSyncStatus(res.data);
      }
    } catch {
      /* 忽略状态栏拉取失败 */
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res: any = await api.get('/document/categories', { silentError: true });
      if (res?.code === 200) {
        setCategories(res.data?.categories || []);
      }
    } catch {
      /* 忽略 */
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(query.page),
        page_size: String(query.pageSize),
      });
      if (query.keyword) params.set('keyword', query.keyword);
      if (query.category) params.set('category', query.category);
      if (query.status !== undefined) params.set('status', String(query.status));

      const res: any = await api.get(`/document/list?${params}`);
      if (res?.code === 200) {
        setDocuments(res.data?.items || []);
        setTotal(res.data?.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    loadSyncStatus();
    loadCategories();
  }, [loadSyncStatus, loadCategories]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadDocuments(), loadSyncStatus(), loadCategories()]);
  }, [loadDocuments, loadSyncStatus, loadCategories]);

  /* ── 文件依次上传 ──────────────────────────────────────────── */
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (fileList.length === 0) return;

    const validFiles: File[] = [];
    for (const file of fileList) {
      const dotIdx = file.name.lastIndexOf('.');
      const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : '';
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        message.error(`不支持的文件格式：${file.name}（仅支持 .pdf / .docx / .txt / .md）`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        message.error(`文件超出 50MB 上限：${file.name}`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        setUploadProgressText(
          validFiles.length > 1 ? `上传中 (${i + 1}/${validFiles.length})` : '上传中...',
        );
        const formData = new FormData();
        formData.append('file', file);
        try {
          const res: any = await api.post('/document/upload', formData, { timeout: 120000 });
          if (res?.code === 200) {
            successCount++;
          } else {
            failCount++;
          }
        } catch {
          failCount++;
        }
      }

      if (successCount > 0 && failCount === 0) {
        message.success(
          successCount === 1
            ? '文档上传成功，已标记为「待索引」'
            : `成功上传 ${successCount} 篇文档，请点击「同步索引」入库`,
        );
      } else if (successCount > 0 && failCount > 0) {
        message.warning(`上传完成：成功 ${successCount} 篇，失败 ${failCount} 篇`);
      }

      if (successCount > 0) {
        setSelectedRowKeys([]);
        if (query.page !== 1) {
          setQuery((prev) => ({ ...prev, page: 1 }));
        } else {
          await loadDocuments();
        }
        await Promise.all([loadSyncStatus(), loadCategories()]);
      }
    } finally {
      setUploading(false);
      setUploadProgressText('');
    }
  };

  /* ── 新建纯文本文档 ────────────────────────────────────────── */
  const openCreateModal = () => {
    createForm.resetFields();
    setCreateOpen(true);
  };

  const handleCreateSubmit = async () => {
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      await api.post('/document', values);
      message.success('文档已保存为「待索引」，请点击「同步索引」入库');
      setCreateOpen(false);
      createForm.resetFields();
      setSelectedRowKeys([]);
      if (query.page !== 1) {
        setQuery((prev) => ({ ...prev, page: 1 }));
      } else {
        await loadDocuments();
      }
      await Promise.all([loadSyncStatus(), loadCategories()]);
    } catch {
      /* 表单校验或接口异常由拦截器提示 */
    } finally {
      setCreating(false);
    }
  };

  /* ── 查看 / 编辑抽屉 ───────────────────────────────────────── */
  const openDocDrawer = async (id: number, mode: 'view' | 'edit') => {
    setDrawerMode(mode);
    setDrawerOpen(true);
    setDetailLoading(true);
    setActiveDoc(null);
    try {
      const res: any = await api.get(`/document/${id}`);
      if (res?.code === 200 && res?.data) {
        setActiveDoc(res.data);
        editForm.setFieldsValue({
          title: res.data.title,
          category: res.data.category || '',
          department: res.data.department || '',
          content: res.data.content || '',
        });
      }
    } catch {
      setDrawerOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!activeDoc) return;
    try {
      const values = await editForm.validateFields();
      setSavingEdit(true);
      const res: any = await api.put(`/document/${activeDoc.id}`, values);
      if (res?.code === 200) {
        message.success('文档已更新');
        setActiveDoc(res.data);
        setDrawerMode('view');
        await refreshAll();
      }
    } catch {
      /* 校验或接口错误 */
    } finally {
      setSavingEdit(false);
    }
  };

  /* ── 单条删除 / 批量删除 / 一键清空 ────────────────────────── */
  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/document/${id}`);
      message.success('文档已删除');
      setSelectedRowKeys((prev) => prev.filter((k) => k !== id));
      const isLastOnPage = documents.length <= 1 && query.page > 1;
      if (isLastOnPage) {
        setQuery((prev) => ({ ...prev, page: prev.page - 1 }));
      } else {
        await loadDocuments();
      }
      await Promise.all([loadSyncStatus(), loadCategories()]);
    } catch {
      /* 拦截器处理 */
    }
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    setBatchDeleting(true);
    try {
      const idsToDelete = [...selectedRowKeys];
      await api.post('/document/batch-delete', { ids: idsToDelete });
      message.success(`已删除 ${idsToDelete.length} 篇文档`);
      const deletedOnPageCount = documents.filter((d) => idsToDelete.includes(d.id)).length;
      const isPageEmptied = deletedOnPageCount >= documents.length && query.page > 1;
      setSelectedRowKeys([]);
      if (isPageEmptied) {
        setQuery((prev) => ({ ...prev, page: prev.page - 1 }));
      } else {
        await loadDocuments();
      }
      await Promise.all([loadSyncStatus(), loadCategories()]);
    } catch {
      /* 拦截器处理 */
    } finally {
      setBatchDeleting(false);
    }
  };

  const hasActiveFilters = Boolean(query.keyword || query.category || query.status !== undefined);

  const openClearModal = () => {
    setClearScope(hasActiveFilters ? 'filtered' : 'all');
    setClearModalOpen(true);
  };

  const handleClearDocuments = async () => {
    setClearing(true);
    try {
      const payload =
        clearScope === 'filtered' && hasActiveFilters
          ? {
              category: query.category || null,
              keyword: query.keyword || null,
              status: query.status ?? null,
            }
          : {};
      const res: any = await api.post('/document/clear', payload);
      const count = res?.data?.deleted_count ?? 0;
      message.success(`已清空 ${count} 篇文档，请点击「同步索引」清理对应向量`);
      setClearModalOpen(false);
      setSelectedRowKeys([]);
      if (query.page !== 1) {
        setQuery((prev) => ({ ...prev, page: 1 }));
      } else {
        await loadDocuments();
      }
      await Promise.all([loadSyncStatus(), loadCategories()]);
    } catch {
      /* 拦截器处理 */
    } finally {
      setClearing(false);
    }
  };

  /* ── 增量同步 / 全量重建 ───────────────────────────────────── */
  const handleSyncIndex = async () => {
    if (!canManageIndex) return;
    setSyncing(true);
    try {
      const res: any = await api.post('/document/sync-index', {}, { timeout: 600000 });
      if (res?.code === 200) {
        const d = res.data || {};
        const parts: string[] = [];
        if (d.upserted_count) parts.push(`新增/更新 ${d.upserted_count} 篇`);
        if (d.deleted_count) parts.push(`清理 ${d.deleted_count} 篇`);
        if (d.skipped_count) parts.push(`跳过 ${d.skipped_count} 篇`);
        if (d.failed_count) parts.push(`失败 ${d.failed_count} 篇`);
        const summary = parts.length > 0 ? parts.join('，') : '索引已是最新状态';
        if (d.failed_count > 0) {
          message.warning(`同步完成（部分失败）：${summary}`);
        } else {
          message.success(`索引同步完成：${summary}`);
        }
        await refreshAll();
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleRebuildIndex = async () => {
    if (!canManageIndex) return;
    setRebuilding(true);
    try {
      const res: any = await api.post('/document/rebuild-index', {}, { timeout: 600000 });
      if (res?.code === 200) {
        const d = res.data || {};
        message.success(
          `全量重建完成：${d.total_docs ?? d.docs_count ?? 0} 篇文档，${d.total_chunks ?? d.chunks_count ?? 0} 个切片`,
        );
        await refreshAll();
      }
    } finally {
      setRebuilding(false);
    }
  };

  /* ── 表格列定义（紧凑列宽 + 弹性标题 + 固定右侧操作列） ───────── */
  const columns: TableProps<DocumentItem>['columns'] = [
    {
      title: '文档标题',
      dataIndex: 'title',
      ellipsis: { showTitle: true },
      render: (title: string, record: DocumentItem) => (
        <button
          type="button"
          onClick={() => openDocDrawer(record.id, 'view')}
          className="inline-flex items-center gap-2 w-full min-w-0 text-left group"
        >
          <FileTextOutlined className="text-moon-light group-hover:text-champagne shrink-0 transition-colors" />
          <span className="font-medium text-white group-hover:text-champagne transition-colors truncate">
            {title}
          </span>
          {record.file_type && (
            <span className="num shrink-0 px-1.5 py-0.5 text-[10px] rounded-full bg-white/[0.06] text-moon-light border border-white/15">
              {FILE_TYPE_LABEL[record.file_type.toLowerCase()] || record.file_type.toUpperCase()}
            </span>
          )}
        </button>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 100,
      ellipsis: true,
      render: (c: string | null) =>
        c ? (
          <Tag className="!m-0 !bg-white/[0.06] !border-white/15 !text-moon-light">{c}</Tag>
        ) : (
          <span className="text-moon-light/50">-</span>
        ),
    },
    {
      title: '部门',
      dataIndex: 'department',
      width: 100,
      ellipsis: true,
      render: (d: string | null) =>
        d ? <span className="text-white/80">{d}</span> : <span className="text-moon-light/50">-</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 96,
      render: (status: number, record: DocumentItem) => {
        const meta = STATUS_META[status];
        if (!meta) return <Tag>{status}</Tag>;
        const tagEl = (
          <Tag
            className="!m-0 font-medium"
            style={{
              color: meta.color,
              backgroundColor: meta.bg,
              borderColor: meta.border,
            }}
          >
            {meta.label}
          </Tag>
        );
        if (status === 4) {
          return (
            <Tooltip title={record.error_message || '索引同步失败，请检查文档内容或服务日志'}>
              <span className="inline-flex items-center gap-1 cursor-help">
                {tagEl}
                <ExclamationCircleOutlined className="text-danger text-[12px]" />
              </span>
            </Tooltip>
          );
        }
        return tagEl;
      },
    },
    {
      title: '切片数',
      dataIndex: 'chunk_count',
      width: 72,
      align: 'right',
      render: (c: number) => <span className="num text-white/80">{c != null ? c : '-'}</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 145,
      render: (d: string) => (
        <span className="num text-[12px] text-moon-light whitespace-nowrap">
          {formatCompactTime(d)}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 224,
      fixed: 'right',
      render: (_: any, record: DocumentItem) => (
        <Space size={2} className="whitespace-nowrap">
          <Button
            type="link"
            size="small"
            className="!px-1.5"
            icon={<EyeOutlined />}
            onClick={() => openDocDrawer(record.id, 'view')}
          >
            查看
          </Button>
          <Button
            type="link"
            size="small"
            className="!px-1.5"
            icon={<EditOutlined />}
            onClick={() => openDocDrawer(record.id, 'edit')}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该文档？"
            description="删除后将在下次同步索引时从检索库移除"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            okType="danger"
            cancelText="取消"
          >
            <Button type="link" danger size="small" className="!px-1.5" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const pendingUpsert = syncStatus?.pending_upsert ?? 0;
  const pendingDelete = syncStatus?.pending_delete ?? 0;
  const pendingTotal = pendingUpsert + pendingDelete;
  const hasPendingChanges = pendingTotal > 0;
  const aiOffline = syncStatus?.ai_service_online === false;

  const syncButton = (
    <Badge count={pendingTotal > 0 ? pendingTotal : 0} size="small" offset={[-4, 4]}>
      <Button
        icon={<SyncOutlined spin={syncing} />}
        onClick={handleSyncIndex}
        loading={syncing}
        disabled={!canManageIndex || syncing || rebuilding}
        className="btn-champagne !px-5 !h-10"
      >
        {syncing ? '同步中...' : '同步索引'}
      </Button>
    </Badge>
  );

  const rebuildButton = canManageIndex ? (
    <Popconfirm
      title="确认执行全量重建索引？"
      description="将清空现有向量与全文索引并重新对所有有效文档分片建模，耗时可能较长。"
      onConfirm={handleRebuildIndex}
      okText="开始重建"
      cancelText="取消"
    >
      <Button
        className="btn-glass !h-10"
        icon={<ReloadOutlined />}
        loading={rebuilding}
        disabled={syncing || rebuilding}
      >
        {rebuilding ? '重建中...' : '全量重建'}
      </Button>
    </Popconfirm>
  ) : (
    <Button className="btn-glass !h-10" icon={<ReloadOutlined />} disabled>
      全量重建
    </Button>
  );

  const batchDeleteButton =
    selectedRowKeys.length > 0 ? (
      <Popconfirm
        title={`确认批量删除选中的 ${selectedRowKeys.length} 篇文档？`}
        description="删除后将在下次同步索引时从检索库移除"
        onConfirm={handleBatchDelete}
        okText="确认删除"
        okType="danger"
        cancelText="取消"
      >
        <Button
          danger
          loading={batchDeleting}
          icon={<DeleteOutlined />}
          className="!rounded-btn !border-danger/50 !bg-danger/15 !text-danger hover:!bg-danger/25"
        >
          批量删除 ({selectedRowKeys.length})
        </Button>
      </Popconfirm>
    ) : (
      <Tooltip title="勾选下方文档后可批量删除">
        <Button disabled icon={<DeleteOutlined />} className="btn-glass">
          批量删除
        </Button>
      </Tooltip>
    );

  return (
    <div className="space-y-5 min-w-0">
      {/* 隐藏的多文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* 玻璃面板 1：顶部索引同步状态栏 */}
      <div className="glass-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              {aiOffline ? (
                <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-warn">
                  <ExclamationCircleOutlined />
                  检索服务当前离线
                </span>
              ) : hasPendingChanges ? (
                <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-champagne">
                  <ClockCircleOutlined />
                  有 <span className="num">{pendingTotal}</span> 项索引变更待同步
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ok">
                  <CheckCircleOutlined />
                  知识库索引已同步
                </span>
              )}

              {syncStatus && syncStatus.failed_docs > 0 && (
                <Tag
                  className="!m-0"
                  style={{
                    color: '#f87171',
                    backgroundColor: 'rgba(248, 113, 113, 0.14)',
                    borderColor: 'rgba(248, 113, 113, 0.35)',
                  }}
                >
                  {syncStatus.failed_docs} 篇同步失败
                </Tag>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px] text-moon-light">
              <span>
                文档总数{' '}
                <strong className="num text-white font-semibold">
                  {syncStatus?.total_docs ?? total}
                </strong>
              </span>
              <span>
                已同步{' '}
                <strong className="num text-ok font-semibold">
                  {syncStatus?.synced_docs ?? 0}
                </strong>
              </span>
              <span>
                待新增/更新{' '}
                <strong
                  className={`num font-semibold ${pendingUpsert > 0 ? 'text-champagne' : 'text-white'}`}
                >
                  {pendingUpsert}
                </strong>
              </span>
              <span>
                待清理{' '}
                <strong
                  className={`num font-semibold ${pendingDelete > 0 ? 'text-warn' : 'text-white'}`}
                >
                  {pendingDelete}
                </strong>
              </span>
              <span>
                总切片数{' '}
                <strong className="num text-white font-semibold">
                  {syncStatus?.indexed_chunks ?? 0}
                </strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {canManageIndex ? (
              syncButton
            ) : (
              <Tooltip title="需要管理员或编辑者权限">{syncButton}</Tooltip>
            )}
            {canManageIndex ? (
              rebuildButton
            ) : (
              <Tooltip title="需要管理员或编辑者权限">{rebuildButton}</Tooltip>
            )}
          </div>
        </div>

        {aiOffline && (
          <Alert
            type="warning"
            showIcon
            className="mt-4 !bg-warn/10 !border-warn/30"
            message={
              <span className="text-white/90 text-[13px]">
                AI 检索服务当前未连接，文档新增、编辑或删除仍可正常保存，待服务恢复后点击「同步索引」即可更新检索库。
              </span>
            }
          />
        )}
      </div>

      {/* 玻璃面板 2：工具栏 + 表格（不设 overflow-hidden，确保横向滚动条与右侧操作列完整可见） */}
      <div className="glass-panel min-w-0">
        {/* 工具栏 */}
        <div className="p-4 border-b border-white/10 flex flex-wrap items-center gap-2.5">
          <Input
            placeholder="搜索文档标题或关键词"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onPressEnter={() =>
              setQuery((prev) => ({ ...prev, keyword: keywordInput.trim(), page: 1 }))
            }
            prefix={<SearchOutlined className="text-moon-light" />}
            style={{ width: 230 }}
            allowClear
          />

          <Select
            placeholder="全部分类"
            value={query.category || undefined}
            onChange={(v) => setQuery((prev) => ({ ...prev, category: v || '', page: 1 }))}
            allowClear
            style={{ width: 140 }}
            options={categories.map((c) => ({ label: c, value: c }))}
          />

          <Select
            placeholder="全部状态"
            value={query.status}
            onChange={(v) => setQuery((prev) => ({ ...prev, status: v, page: 1 }))}
            allowClear
            style={{ width: 130 }}
            options={[
              { label: '已同步', value: 3 },
              { label: '待索引', value: 1 },
              { label: '待更新', value: 2 },
              { label: '同步失败', value: 4 },
            ]}
          />

          <div className="flex-1" />

          <div className="flex flex-wrap items-center gap-2">
            {batchDeleteButton}

            {selectedRowKeys.length > 0 && (
              <Button
                type="link"
                size="small"
                onClick={() => setSelectedRowKeys([])}
                className="!px-1.5"
              >
                取消选择
              </Button>
            )}

            <Button
              className="btn-glass"
              icon={<UploadOutlined />}
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? uploadProgressText || '上传中...' : '上传文档'}
            </Button>

            <Button className="btn-glass" icon={<PlusOutlined />} onClick={openCreateModal}>
              新建文档
            </Button>

            {isAdmin && (
              <Button
                danger
                icon={<ClearOutlined />}
                onClick={openClearModal}
                disabled={total === 0 && !hasActiveFilters}
                className="!rounded-btn !bg-white/[0.04] !border-danger/40 !text-danger hover:!bg-danger/15"
              >
                清空文档
              </Button>
            )}
          </div>
        </div>

        {/* 列表统计条 */}
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-white/[0.08] bg-white/[0.03] text-[12.5px]">
          <span className="text-moon-light">
            共 <strong className="num text-white">{total}</strong> 篇文档
          </span>
          <span className="text-moon-light/80">支持 PDF、DOCX、TXT、MD 格式</span>
        </div>

        {/* 表格区：使用固定最小宽度启用 table-layout: fixed，1280px+ 零横向滚动，窄屏可流畅滑动 */}
        <div className="glass-table min-w-0">
          <Table<DocumentItem>
            rowKey="id"
            columns={columns}
            dataSource={documents}
            loading={loading}
            scroll={{ x: 980 }}
            rowSelection={{
              columnWidth: 44,
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys as number[]),
            }}
            locale={{
              emptyText: (
                <div className="py-14 px-4 text-center">
                  <div className="mx-auto w-12 h-12 rounded-[16px] bg-white/[0.06] border border-white/15 grid place-items-center text-champagne text-[20px]">
                    <FileTextOutlined />
                  </div>
                  <p className="mt-4 text-[14.5px] text-white font-medium">暂无知识库文档</p>
                  <p className="mt-1.5 mx-auto max-w-[420px] text-[12.5px] text-moon-light leading-relaxed">
                    可批量上传 PDF、DOCX、TXT、MD 文件或直接新建纯文本文档，保存后点击顶部「同步索引」即可投入问答检索。
                  </p>
                </div>
              ),
            }}
            pagination={{
              current: query.page,
              pageSize: query.pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100'],
              showTotal: (t) => <span className="text-moon-light">共 {t} 条</span>,
              onChange: (p, ps) => {
                setQuery((prev) => ({
                  ...prev,
                  page: ps !== prev.pageSize ? 1 : p,
                  pageSize: ps,
                }));
              },
            }}
          />
        </div>
      </div>

      {/* 新建纯文本文档弹窗 */}
      <Modal
        title={<span className="text-white">新建纯文本文档</span>}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreateSubmit}
        confirmLoading={creating}
        okText="保存为待索引"
        okButtonProps={{ className: 'btn-champagne !px-5' }}
        cancelButtonProps={{ className: 'btn-glass' }}
        width={640}
      >
        <Form form={createForm} layout="vertical" className="mt-3">
          <Form.Item
            label="文档标题"
            name="title"
            rules={[{ required: true, message: '请输入文档标题' }]}
          >
            <Input placeholder="例如：员工报销制度规范（2026版）" />
          </Form.Item>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
            <Form.Item label="分类" name="category">
              <Input placeholder="例如：财务制度、研发规范" />
            </Form.Item>
            <Form.Item label="所属部门" name="department">
              <Input placeholder="例如：财务部、技术部" />
            </Form.Item>
          </div>
          <Form.Item
            label="正文内容"
            name="content"
            rules={[{ required: true, message: '请输入文档正文内容' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder="输入文档的完整正文内容（支持 Markdown 格式）"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 管理员清空文档强确认弹窗 */}
      <Modal
        title={
          <span className="flex items-center gap-2 text-white">
            <ExclamationCircleOutlined className="text-danger" />
            清空知识库文档
          </span>
        }
        open={clearModalOpen}
        onCancel={() => setClearModalOpen(false)}
        onOk={handleClearDocuments}
        confirmLoading={clearing}
        okText="确认清空"
        okButtonProps={{ danger: true, className: '!rounded-btn' }}
        cancelButtonProps={{ className: 'btn-glass' }}
      >
        <div className="space-y-4 pt-2">
          <Alert
            type="warning"
            showIcon
            className="!bg-warn/10 !border-warn/30"
            message={<span className="text-white">此操作将直接删除数据库中的文档记录，不可恢复</span>}
            description={
              <span className="text-moon-light text-[12.5px]">
                清空后，请点击顶部「同步索引」或「全量重建」以同步清理 AI 检索库中的旧切片。
              </span>
            }
          />

          {hasActiveFilters ? (
            <div className="space-y-2">
              <div className="text-[13px] text-moon-light">请选择清空范围：</div>
              <Radio.Group
                value={clearScope}
                onChange={(e) => setClearScope(e.target.value)}
                className="flex flex-col gap-2"
              >
                <Radio value="filtered" className="!text-white">
                  仅清空当前筛选匹配的文档（共 <span className="num text-champagne">{total}</span> 篇）
                </Radio>
                <Radio value="all" className="!text-white">
                  清空知识库中的全部文档（共{' '}
                  <span className="num text-danger">{syncStatus?.total_docs ?? total}</span> 篇）
                </Radio>
              </Radio.Group>
            </div>
          ) : (
            <p className="text-[13.5px] text-white/90">
              即将清空知识库中的全部{' '}
              <strong className="num text-danger">{syncStatus?.total_docs ?? total}</strong>{' '}
              篇文档记录，是否确认继续？
            </p>
          )}
        </div>
      </Modal>

      {/* 查看 / 编辑抽屉 */}
      <Drawer
        title={<span className="text-white">{drawerMode === 'edit' ? '编辑文档' : '文档详情'}</span>}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={680}
        loading={detailLoading}
        extra={
          activeDoc && (
            <Space>
              {drawerMode === 'view' ? (
                <Button
                  className="btn-champagne !px-4"
                  icon={<EditOutlined />}
                  onClick={() => setDrawerMode('edit')}
                >
                  编辑文档
                </Button>
              ) : (
                <>
                  <Button className="btn-glass" onClick={() => setDrawerMode('view')}>
                    取消
                  </Button>
                  <Button
                    className="btn-champagne !px-4"
                    loading={savingEdit}
                    onClick={handleSaveEdit}
                  >
                    保存修改
                  </Button>
                </>
              )}
            </Space>
          )
        }
      >
        {activeDoc && drawerMode === 'view' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-[18px] font-semibold text-white">{activeDoc.title}</h3>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {(() => {
                  const meta = STATUS_META[activeDoc.status];
                  return meta ? (
                    <Tag
                      style={{
                        color: meta.color,
                        backgroundColor: meta.bg,
                        borderColor: meta.border,
                      }}
                    >
                      {meta.label}
                    </Tag>
                  ) : null;
                })()}
                {activeDoc.file_type && (
                  <Tag className="!bg-white/[0.06] !border-white/15 !text-moon-light">
                    {FILE_TYPE_LABEL[activeDoc.file_type.toLowerCase()] || activeDoc.file_type}
                  </Tag>
                )}
                {activeDoc.category && (
                  <Tag className="!bg-white/[0.06] !border-white/15 !text-champagne">
                    {activeDoc.category}
                  </Tag>
                )}
              </div>
            </div>

            {activeDoc.status === 4 && activeDoc.error_message && (
              <Alert
                type="error"
                showIcon
                icon={<CloseCircleOutlined />}
                className="!bg-danger/10 !border-danger/35"
                message={<span className="text-white">同步失败原因</span>}
                description={<span className="text-white/85">{activeDoc.error_message}</span>}
              />
            )}

            <Descriptions
              size="small"
              column={2}
              bordered
              items={[
                { label: '所属部门', children: activeDoc.department || '-' },
                {
                  label: '切片数量',
                  children: <span className="num">{activeDoc.chunk_count ?? 0}</span>,
                },
                {
                  label: '创建时间',
                  children: activeDoc.created_at
                    ? new Date(activeDoc.created_at).toLocaleString()
                    : '-',
                },
                {
                  label: '更新时间',
                  children: activeDoc.updated_at
                    ? new Date(activeDoc.updated_at).toLocaleString()
                    : '-',
                },
              ]}
            />

            <div>
              <div className="text-[13px] font-medium text-moon-light mb-2">文档正文</div>
              <div className="rounded-[16px] border border-white/12 bg-night-deep/55 p-4 text-[13.5px] leading-[1.75] text-white/90 whitespace-pre-wrap break-words max-h-[55vh] overflow-y-auto">
                {activeDoc.content?.trim() ? (
                  activeDoc.content
                ) : (
                  <span className="text-moon-light">暂无可预览的文本正文</span>
                )}
              </div>
            </div>
          </div>
        )}

        {activeDoc && drawerMode === 'edit' && (
          <Form form={editForm} layout="vertical">
            <Form.Item
              label="文档标题"
              name="title"
              rules={[{ required: true, message: '请输入文档标题' }]}
            >
              <Input />
            </Form.Item>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <Form.Item label="分类" name="category">
                <Input placeholder="可选" />
              </Form.Item>
              <Form.Item label="所属部门" name="department">
                <Input placeholder="可选" />
              </Form.Item>
            </div>
            <Form.Item label="正文内容" name="content">
              <Input.TextArea rows={14} placeholder="输入文档正文内容" />
            </Form.Item>
            <Alert
              type="info"
              showIcon
              className="!bg-white/[0.06] !border-white/15"
              message={
                <span className="text-moon-light text-[12.5px]">
                  修改保存后，如文档此前已同步，状态将自动变为「待更新」，需点击「同步索引」生效。
                </span>
              }
            />
          </Form>
        )}
      </Drawer>
    </div>
  );
}
