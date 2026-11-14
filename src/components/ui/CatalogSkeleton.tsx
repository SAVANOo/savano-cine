/** Skeleton loader matching the Hero banner and MediaCard carousels during catalog fetches. */
export function CatalogSkeleton() {
  return (
    <div className="flex flex-col gap-9" aria-busy="true" aria-label="Carregando catálogo">
      {/* Hero Skeleton */}
      <div className="relative h-[380px] w-full animate-pulse overflow-hidden rounded-[var(--sc-radius-xl)] border border-white/10 bg-neutral-900 sm:h-[420px]">
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute bottom-8 left-6 right-6 flex max-w-xl flex-col gap-3 sm:left-10">
          <div className="h-4 w-24 rounded-full bg-white/10" />
          <div className="h-9 w-3/4 rounded-lg bg-white/15" />
          <div className="h-4 w-full rounded bg-white/10" />
          <div className="h-4 w-2/3 rounded bg-white/10" />
          <div className="mt-2 flex gap-3">
            <div className="h-10 w-32 rounded-full bg-white/20" />
            <div className="h-10 w-36 rounded-full bg-white/10" />
          </div>
        </div>
      </div>

      {/* Carousel Row Skeletons */}
      {[0, 1].map((row) => (
        <section key={row} className="flex flex-col gap-3">
          <div className="h-6 w-48 animate-pulse rounded bg-white/10" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="flex flex-col overflow-hidden rounded-[var(--sc-radius-lg)] border border-white/10 bg-[var(--sc-bg-surface)]"
              >
                <div className="aspect-[2/3] w-full animate-pulse bg-neutral-800" />
                <div className="flex flex-col gap-2 p-3">
                  <div className="h-4 w-4/5 animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
