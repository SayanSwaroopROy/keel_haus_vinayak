import { Skeleton } from "@/components/ui/skeleton";

export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading workspace">
      <div className="hidden w-64 shrink-0 bg-binding lg:block" />
      <div className="flex flex-1 flex-col">
        <div className="h-14 bg-binding lg:bg-background lg:border-b lg:border-rule" />
        <div className="flex flex-col gap-4 p-4 sm:p-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
