// Supabase (PostgREST) returns at most 1000 rows per request, silently
// dropping the rest. fetchAll() reads a list page by page until a short page
// comes back. The query must have a stable order (add a unique column such as
// `id` as the last order key). A row inserted while paging can shift later
// pages by one, so rows with an `id` are de-duplicated.

const PAGE = 1000
const MAX_PAGES = 100 // 100k rows: a safety stop, far above real use

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export async function fetchAll<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = []
  const seen = new Set<unknown>()
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data || []
    for (const r of rows) {
      const id = (r as { id?: unknown } | null)?.id
      if (id !== undefined) {
        if (seen.has(id)) continue
        seen.add(id)
      }
      out.push(r)
    }
    if (rows.length < PAGE) break
  }
  return out
}
