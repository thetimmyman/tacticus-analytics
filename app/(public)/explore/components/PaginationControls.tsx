'use client'

interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  startIndex: number
  endIndex: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
}

export function PaginationControls({
  currentPage,
  totalPages,
  startIndex,
  endIndex,
  totalItems,
  itemsPerPage,
  onPageChange
}: PaginationControlsProps) {
  return (
    <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="text-sm text-secondary-wh40k">
          Showing {startIndex + 1}-{Math.min(endIndex, totalItems)} of{' '}
          {totalItems} guilds
        </div>

        {/* Items per page selector */}
        <select
          value={itemsPerPage}
          onChange={(e) => {
            const newItemsPerPage = parseInt(e.target.value)
            const currentFirstItem = (currentPage - 1) * itemsPerPage
            const newPage = Math.floor(currentFirstItem / newItemsPerPage) + 1
            onPageChange(newPage)
          }}
          className="px-2 py-1 bg-(--card-bg) border border-(--card-border) rounded-sm text-sm text-primary-wh40k"
          disabled // Disabled for now since itemsPerPage is not a state variable
        >
          <option value="10">10 per page</option>
          <option value="20">20 per page</option>
          <option value="50">50 per page</option>
          <option value="100">100 per page</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className={`px-3 py-1 rounded border ${
            currentPage === 1
              ? 'border-(--card-border) text-(--text-tertiary) cursor-not-allowed'
              : 'border-(--card-border) text-primary-wh40k hover:bg-(--card-bg)'
          }`}
        >
          Previous
        </button>

        <div className="flex items-center gap-1">
          {/* Show first page */}
          {currentPage > 3 && (
            <>
              <button
                onClick={() => onPageChange(1)}
                className="px-3 py-1 rounded-sm border border-(--card-border) text-primary-wh40k hover:bg-(--card-bg)"
              >
                1
              </button>
              {currentPage > 4 && (
                <span className="text-(--text-tertiary)">...</span>
              )}
            </>
          )}

          {/* Show pages around current */}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((page) => {
              const distance = Math.abs(page - currentPage)
              return distance <= 2
            })
            .map((page) => (
              <button
                key={`page-${page}`}
                onClick={() => onPageChange(page)}
                className={`px-3 py-1 rounded border ${
                  page === currentPage
                    ? 'border-primary-wh40k bg-primary-wh40k text-white'
                    : 'border-(--card-border) text-primary-wh40k hover:bg-(--card-bg)'
                }`}
              >
                {page}
              </button>
            ))}

          {/* Show last page */}
          {currentPage < totalPages - 2 && (
            <>
              {currentPage < totalPages - 3 && (
                <span className="text-(--text-tertiary)">...</span>
              )}
              <button
                onClick={() => onPageChange(totalPages)}
                className="px-3 py-1 rounded-sm border border-(--card-border) text-primary-wh40k hover:bg-(--card-bg)"
              >
                {totalPages}
              </button>
            </>
          )}
        </div>

        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className={`px-3 py-1 rounded border ${
            currentPage === totalPages
              ? 'border-(--card-border) text-(--text-tertiary) cursor-not-allowed'
              : 'border-(--card-border) text-primary-wh40k hover:bg-(--card-bg)'
          }`}
        >
          Next
        </button>
      </div>
    </div>
  )
}
