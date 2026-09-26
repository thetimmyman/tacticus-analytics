import { redirect } from 'next/navigation'

/** Without this route /wars/analyze falls through to /wars/[warId] and errors. */
export default async function AnalyzeIndexPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value))
      value.forEach((entry) => params.append(key, entry))
    else if (value !== undefined) params.set(key, value)
  }
  const query = params.toString()
  redirect(`/wars/analyze/team${query ? `?${query}` : ''}`)
}
