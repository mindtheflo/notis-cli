'use client';

import type { AnchorHTMLAttributes, ReactElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface MarkdownProps {
  /** Markdown source to render. */
  value: string;
  /** Typography scale. 'sm' suits dense surfaces (cards, list rows). */
  size?: 'sm' | 'base';
  className?: string;
  /** Per-element overrides, passed through to react-markdown. */
  components?: Components;
}

function MarkdownLink({
  href,
  children,
  node: _node,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

const defaultComponents: Components = {
  a: MarkdownLink,
};

/**
 * Renders a markdown value with Notis typography. Markdown is a value type:
 * use this anywhere markdown appears — document content, database fields,
 * generated text. Styling comes from `.notis-markdown` rules in the SDK
 * stylesheet and follows the portal theme variables.
 */
export function Markdown({ value, size = 'base', className, components }: MarkdownProps): ReactElement {
  const classes = ['notis-markdown', size === 'sm' ? 'notis-markdown--sm' : null, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components ? { ...defaultComponents, ...components } : defaultComponents}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
