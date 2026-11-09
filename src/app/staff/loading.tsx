export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-9 w-48 rounded-lg bg-line-2" />
      <div className="h-4 w-80 rounded bg-line-2" />
      <div className="mt-6 h-64 rounded-[14px] bg-line-2" />
    </div>
  );
}
