import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  onCitationClick?: (index: number) => void;
}

const CITATION_REGEX = /(\[S\d+\])/g;

/**
 * 递归替换纯文本子节点中的 `[S1]` 等引用标号为可点击的高亮角标。
 */
function renderWithCitations(
  children: React.ReactNode,
  onCitationClick?: (index: number) => void,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      const parts = child.split(CITATION_REGEX);
      if (parts.length === 1) return child;
      return parts.map((part, idx) => {
        const match = /^\[S(\d+)\]$/.exec(part);
        if (!match) return part;
        const sourceIndex = Number(match[1]);
        return (
          <button
            key={idx}
            type="button"
            className="citation-badge"
            title={`查看参考来源 ${sourceIndex}`}
            onClick={() => onCitationClick?.(sourceIndex)}
          >
            {part}
          </button>
        );
      });
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      // 跳过代码块和行内代码，不破坏代码示例
      if (child.type === 'code' || child.type === 'pre') {
        return child;
      }
      if (child.props.children) {
        return React.cloneElement(child, {
          children: renderWithCitations(child.props.children, onCitationClick),
        });
      }
    }
    return child;
  });
}

export default function MarkdownRenderer({ content, onCitationClick }: MarkdownRendererProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{renderWithCitations(children, onCitationClick)}</p>,
          li: ({ children }) => <li>{renderWithCitations(children, onCitationClick)}</li>,
          td: ({ children }) => <td>{renderWithCitations(children, onCitationClick)}</td>,
          th: ({ children }) => <th>{renderWithCitations(children, onCitationClick)}</th>,
          blockquote: ({ children }) => (
            <blockquote>{renderWithCitations(children, onCitationClick)}</blockquote>
          ),
          strong: ({ children }) => (
            <strong>{renderWithCitations(children, onCitationClick)}</strong>
          ),
          em: ({ children }) => <em>{renderWithCitations(children, onCitationClick)}</em>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
