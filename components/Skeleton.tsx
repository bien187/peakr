export function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 h-5 w-2/3 rounded bg-slate-700" />
      <div className="mb-2 h-4 w-1/3 rounded bg-slate-800" />
      <div className="flex gap-2">
        <div className="h-6 w-16 rounded-full bg-slate-800" />
        <div className="h-6 w-20 rounded-full bg-slate-800" />
      </div>
    </div>
  );
}

export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
