import { ErrorCodeDocumentation } from './ErrorCodeDocumentation'

export const metadata = {
  title: 'Error Code Reference | Tacticus Analytics',
  description:
    'Complete reference guide for error codes and troubleshooting steps'
}

export default function ErrorCodesPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary-wh40k mb-4">
          Error Code Reference
        </h1>
        <p className="text-secondary-wh40k text-lg">
          Complete documentation of error codes with troubleshooting steps and
          version tracking.
        </p>
      </div>

      <ErrorCodeDocumentation />
    </div>
  )
}
