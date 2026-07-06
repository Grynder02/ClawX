import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { useEffect } from 'react';

import { cn } from '@/lib/utils';

import type { PrefixOption } from './types';

interface PrefixDropdownProps<TItem> {
  open: boolean;
  anchor: HTMLElement | null;
  listboxId: string;
  title: string;
  loadingLabel: string;
  loading?: boolean;
  error?: string | null;
  emptyLabel: string;
  highlightedIndex: number;
  options: PrefixOption<TItem>[];
  getOptionId: (option: PrefixOption<TItem>) => string;
  getTestId: (option: PrefixOption<TItem>) => string;
  onSelect: (item: TItem) => void;
}

export function PrefixDropdown<TItem>({
  open,
  anchor,
  listboxId,
  title,
  loadingLabel,
  loading = false,
  error = null,
  emptyLabel,
  highlightedIndex,
  options,
  getOptionId,
  getTestId,
  onSelect,
}: PrefixDropdownProps<TItem>) {
  const {
    refs: { setReference, setFloating },
    floatingStyles,
  } = useFloating({
    open,
    placement: 'top-start',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    setReference(anchor);
  }, [anchor, setReference]);

  if (!open) return null;

  return (
    <div
      id={listboxId}
      ref={setFloating}
      style={floatingStyles}
      role="listbox"
      aria-label={title}
      data-testid="chat-composer-prefix-menu"
      className="z-50 w-80 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
    >
      <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
        {title}
      </div>
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">{loadingLabel}</div>
        ) : error ? (
          <div className="px-3 py-4 text-xs text-red-700 dark:text-red-400">{error}</div>
        ) : options.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">{emptyLabel}</div>
        ) : (
          options.map((option, index) => (
            <button
              id={getOptionId(option)}
              key={option.id}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              data-testid={getTestId(option)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(option.item)}
              className={cn(
                'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                index === highlightedIndex
                  ? 'bg-black/5 text-foreground dark:bg-white/10'
                  : 'hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-meta font-semibold text-foreground">{option.label}</span>
                {option.description ? (
                  <span className="block truncate text-tiny text-muted-foreground">{option.description}</span>
                ) : null}
              </span>
              {option.sourceLabel ? (
                <span className="shrink-0 rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
                  {option.sourceLabel}
                </span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
