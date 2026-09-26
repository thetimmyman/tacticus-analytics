import { Spinner } from '@tacticus/ui-kit'

interface AssignmentsLoadingProps {
  label: string
}

export function AssignmentsLoading({ label }: AssignmentsLoadingProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <Spinner size="lg" className="mx-auto mb-4 h-12 w-12 text-amber-400" />
        <p className="text-amber-100/60">{label}</p>
      </div>
    </div>
  )
}
