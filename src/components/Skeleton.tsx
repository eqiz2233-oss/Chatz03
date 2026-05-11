/**
 * Lightweight skeleton primitives — calm shimmer for first-load only.
 * Render whenever waiting for the API; hide as soon as data lands so the
 * shimmer never competes for attention with real content.
 */

interface BarProps {
  className?: string;
}

export function SkeletonBar({ className = '' }: BarProps) {
  return (
    <div
      aria-hidden
      className={
        'animate-pulse rounded-md bg-slate-200/70 dark:bg-slate-700/50 ' + className
      }
    />
  );
}

export function SkeletonCircle({ className = '' }: BarProps) {
  return (
    <div
      aria-hidden
      className={
        'animate-pulse rounded-full bg-slate-200/70 dark:bg-slate-700/50 ' + className
      }
    />
  );
}

/** Row that mimics a ConversationList item — avatar + 2 lines + timestamp */
export function ConversationRowSkeleton() {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100/90 px-4 py-3.5 dark:border-slate-800/90">
      <SkeletonCircle className="h-12 w-12 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SkeletonBar className="h-3 w-24" />
          <SkeletonBar className="h-2.5 w-8" />
        </div>
        <SkeletonBar className="h-2.5 w-40" />
        <SkeletonBar className="h-2.5 w-32" />
      </div>
    </div>
  );
}

/** Bubble that mimics a chat message */
export function MessageBubbleSkeleton({ side = 'left' as 'left' | 'right' }: { side?: 'left' | 'right' }) {
  return (
    <div className={'flex ' + (side === 'right' ? 'justify-end' : 'justify-start')}>
      <SkeletonBar className={'h-9 ' + (side === 'right' ? 'w-44' : 'w-52')} />
    </div>
  );
}
