import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy aria-label="Loading">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-8 h-9 w-72" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-5 h-80 w-full rounded-2xl" />
    </div>
  );
}
