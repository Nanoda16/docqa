import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileTextOutlined,
  LinkOutlined,
  DownOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import type { SourceRef } from '../types';

interface SourceCardsProps {
  sources: SourceRef[];
  highlightedIndex?: number | null;
}

/**
 * 参考来源列表：支持单条折叠/点击展开原文片段，并提供跳往知识库的次级入口。
 */
export default function SourceCards({ sources, highlightedIndex }: SourceCardsProps) {
  const navigate = useNavigate();
  const [expandedItems, setExpandedItems] = useState<Set<number>>(() =>
    highlightedIndex ? new Set([highlightedIndex]) : new Set(),
  );

  // 点击正文 [S1] 角标时自动展开对应来源详情
  useEffect(() => {
    if (highlightedIndex && highlightedIndex > 0) {
      setExpandedItems((prev) => {
        if (prev.has(highlightedIndex)) return prev;
        const next = new Set(prev);
        next.add(highlightedIndex);
        return next;
      });
    }
  }, [highlightedIndex]);

  const toggleItem = (indexNo: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(indexNo)) {
        next.delete(indexNo);
      } else {
        next.add(indexNo);
      }
      return next;
    });
  };

  if (!sources || sources.length === 0) {
    return (
      <div className="mt-3 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-[var(--ink-2)]">
        <span>本次回答未关联到可展示的参考片段</span>
        <button
          type="button"
          onClick={() => navigate('/knowledge/list')}
          className="inline-flex items-center gap-1 font-medium text-[var(--ink)] hover:opacity-75 transition-opacity"
        >
          <span>前往知识库</span>
          <ArrowRightOutlined className="text-[10px]" />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden">
      <ul className="divide-y divide-[var(--border)] m-0 p-0 list-none">
        {sources.map((src, i) => {
          const indexNo = i + 1;
          const hasScore = typeof src.score === 'number';
          const pct = hasScore
            ? Math.min(100, Math.max(0, Math.round((src.score as number) * 100)))
            : 0;
          const isHighlighted = highlightedIndex === indexNo;
          const hasDetail = Boolean(
            src.content_preview || (src.source_url && src.source_url !== '#') || src.published_at,
          );
          const isExpanded = expandedItems.has(indexNo);

          return (
            <li
              key={i}
              className={`transition-colors ${
                isHighlighted ? 'bg-[var(--surface)]' : ''
              }`}
            >
              <button
                type="button"
                disabled={!hasDetail}
                aria-expanded={hasDetail ? isExpanded : undefined}
                onClick={() => hasDetail && toggleItem(indexNo)}
                className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                  hasDetail ? 'hover:bg-[var(--surface-hover)] cursor-pointer' : 'cursor-default'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className={`num inline-flex items-center justify-center px-1.5 h-5 text-[11px] font-semibold rounded-full border shrink-0 ${
                      isHighlighted
                        ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                        : 'bg-[var(--surface)] text-[var(--ink)] border-[var(--border-strong)]'
                    }`}
                  >
                    S{indexNo}
                  </span>
                  <FileTextOutlined className="text-[var(--ink-3)] text-[12px] shrink-0" />
                  <span className="text-[13px] font-medium text-[var(--ink)] truncate">
                    {src.title || '未命名文档'}
                  </span>
                  {src.category && (
                    <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-[var(--surface)] text-[var(--ink-2)] border border-[var(--border)] shrink-0">
                      {src.category}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {hasScore && (
                    <span
                      className="num text-[11.5px] font-medium text-[var(--ink-2)]"
                      title={`匹配相似度 ${pct}%`}
                    >
                      {pct}%
                    </span>
                  )}
                  {hasDetail && (
                    <DownOutlined
                      className={`text-[10px] text-[var(--ink-3)] transition-transform duration-200 ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </div>
              </button>

              {hasDetail && isExpanded && (
                <div className="px-3.5 pb-3 pt-0.5">
                  {src.content_preview && (
                    <p className="m-0 text-[12.5px] leading-[1.68] text-[var(--ink-2)] bg-[var(--surface)] rounded-[var(--radius-sm)] px-3 py-2.5 border border-[var(--border)] whitespace-pre-wrap break-words">
                      {src.content_preview}
                    </p>
                  )}

                  {(src.source_url || src.published_at) && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] text-[var(--ink-3)]">
                      {src.source_url && src.source_url !== '#' && (
                        <a
                          href={src.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--ink)] underline underline-offset-2 hover:opacity-75"
                        >
                          <LinkOutlined />
                          查看原文
                        </a>
                      )}
                      {src.published_at && (
                        <span className="num">
                          {new Date(src.published_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="px-3.5 py-2 border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-between text-[11.5px] text-[var(--ink-2)]">
        <span className="num">共 {sources.length} 条参考片段</span>
        <button
          type="button"
          onClick={() => navigate('/knowledge/list')}
          className="inline-flex items-center gap-1 font-medium text-[var(--ink)] hover:opacity-75 transition-opacity"
        >
          <span>查看知识库文档</span>
          <ArrowRightOutlined className="text-[10px]" />
        </button>
      </div>
    </div>
  );
}
