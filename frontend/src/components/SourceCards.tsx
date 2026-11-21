import { Tag } from 'antd';
import { FileTextOutlined, LinkOutlined } from '@ant-design/icons';
import type { SourceRef } from '../types';

interface SourceCardsProps {
  sources: SourceRef[];
  highlightedIndex?: number | null;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function scoreColor(score: number): string {
  if (score >= 0.7) return '#34d399';
  if (score >= 0.5) return '#e4b863';
  return '#7c9cc4';
}

/**
 * 参考来源卡片列表（适配暗夜液态玻璃）
 */
export default function SourceCards({ sources, highlightedIndex }: SourceCardsProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-3 grid grid-cols-1 gap-2.5">
      {sources.map((src, i) => {
        const indexNo = i + 1;
        const hasScore = typeof src.score === 'number';
        const pct = hasScore ? Math.min(100, Math.max(0, Math.round((src.score as number) * 100))) : 0;
        const isHighlighted = highlightedIndex === indexNo;

        return (
          <div
            key={i}
            className={`rounded-[16px] border p-3.5 transition-all duration-500 ease-liquid ${
              isHighlighted
                ? 'bg-champagne/10 border-champagne/45 shadow-[0_0_24px_rgba(228,184,99,0.12)]'
                : 'bg-white/[0.04] border-white/[0.12] hover:bg-white/[0.08] hover:border-white/[0.22]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="num inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full bg-champagne/15 text-champagne border border-champagne/40 shrink-0">
                  S{indexNo}
                </span>
                <FileTextOutlined className="text-moon-light text-[12px] shrink-0" />
                <span className="text-[13px] font-medium text-white truncate">
                  {src.title || '未命名文档'}
                </span>
                {src.category && (
                  <Tag className="!m-0 !text-[11px] !bg-white/[0.06] !border-white/15 !text-moon-light">
                    {src.category}
                  </Tag>
                )}
              </div>

              {hasScore && (
                <div className="flex items-center gap-2 shrink-0" title={`匹配相似度 ${pct}%`}>
                  <span className="text-[11px] text-moon-light">相似度</span>
                  <span className="inline-block h-1.5 w-12 rounded-full bg-white/10 overflow-hidden">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: scoreColor(src.score as number),
                      }}
                    />
                  </span>
                  <span className="num text-[11.5px] font-medium text-white">{pct}%</span>
                </div>
              )}
            </div>

            {src.content_preview && (
              <p className="mt-2.5 mb-0 text-[12.5px] leading-[1.68] text-white/80 bg-night-deep/45 rounded-[12px] px-3 py-2.5 border border-white/[0.08]">
                {truncate(src.content_preview, 280)}
              </p>
            )}

            {(src.source_url || src.published_at) && (
              <div className="mt-2 flex items-center gap-3 text-[11.5px] text-moon-light">
                {src.source_url && src.source_url !== '#' && (
                  <a
                    href={src.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-champagne hover:opacity-85"
                  >
                    <LinkOutlined />
                    查看原文
                  </a>
                )}
                {src.published_at && (
                  <span className="num">{new Date(src.published_at).toLocaleDateString()}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
