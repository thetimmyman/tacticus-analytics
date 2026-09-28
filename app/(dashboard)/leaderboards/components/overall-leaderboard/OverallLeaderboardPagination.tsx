'use client'

import type { Dispatch, SetStateAction } from 'react'

interface OverallLeaderboardPaginationProps {
  currentPage: number
  totalPages: number
  setCurrentPage: Dispatch<SetStateAction<number>>
}

function mobilePageNumbers(currentPage: number, totalPages: number): number[] {
  return Array.from({ length: Math.min(3, totalPages) }, (_, index) => {
    if (totalPages <= 3 || currentPage === 1) return index + 1
    if (currentPage === totalPages) return totalPages - 2 + index
    return currentPage - 1 + index
  })
}

function desktopPageNumbers(currentPage: number, totalPages: number): number[] {
  return Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
    if (totalPages <= 5 || currentPage <= 3) return index + 1
    if (currentPage >= totalPages - 2) return totalPages - 4 + index
    return currentPage - 2 + index
  })
}

export function OverallLeaderboardPagination({
  currentPage,
  totalPages,
  setCurrentPage
}: OverallLeaderboardPaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
      <div className="sm:hidden flex items-center justify-center gap-2 w-full">
        <button
          onClick={() =>
            setCurrentPage((previous) => Math.max(1, previous - 1))
          }
          disabled={currentPage === 1}
          className="px-3 py-2 bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k disabled:opacity-50"
        >
          ←
        </button>

        <div className="flex items-center gap-1 flex-1 justify-center">
          {mobilePageNumbers(currentPage, totalPages).map((pageNumber) => (
            <button
              key={pageNumber}
              onClick={() => setCurrentPage(pageNumber)}
              className={`px-3 py-2 rounded text-sm ${
                currentPage === pageNumber
                  ? 'bg-primary-wh40k text-(--bg-primary) font-bold'
                  : 'bg-(--card-bg) border border-(--card-border) text-primary-wh40k'
              }`}
            >
              {pageNumber}
            </button>
          ))}
          {currentPage < totalPages - 1 && totalPages > 3 && (
            <span className="text-secondary-wh40k px-2">...</span>
          )}
          {currentPage < totalPages - 1 && totalPages > 3 && (
            <button
              onClick={() => setCurrentPage(totalPages)}
              className="px-3 py-2 bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k text-sm"
            >
              {totalPages}
            </button>
          )}
        </div>

        <button
          onClick={() =>
            setCurrentPage((previous) => Math.min(totalPages, previous + 1))
          }
          disabled={currentPage === totalPages}
          className="px-3 py-2 bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k disabled:opacity-50"
        >
          →
        </button>
      </div>

      <div className="hidden sm:flex items-center justify-center gap-2">
        <button
          onClick={() => setCurrentPage(1)}
          disabled={currentPage === 1}
          className="px-3 py-1 bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k disabled:opacity-50"
        >
          First
        </button>
        <button
          onClick={() =>
            setCurrentPage((previous) => Math.max(1, previous - 1))
          }
          disabled={currentPage === 1}
          className="px-3 py-1 bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k disabled:opacity-50"
        >
          Previous
        </button>

        <div className="flex items-center gap-1">
          {desktopPageNumbers(currentPage, totalPages).map((pageNumber) => (
            <button
              key={pageNumber}
              onClick={() => setCurrentPage(pageNumber)}
              className={`px-3 py-1 rounded ${
                currentPage === pageNumber
                  ? 'bg-primary-wh40k text-(--bg-primary) font-bold'
                  : 'bg-(--card-bg) border border-(--card-border) text-primary-wh40k'
              }`}
            >
              {pageNumber}
            </button>
          ))}
        </div>

        <button
          onClick={() =>
            setCurrentPage((previous) => Math.min(totalPages, previous + 1))
          }
          disabled={currentPage === totalPages}
          className="px-3 py-1 bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k disabled:opacity-50"
        >
          Next
        </button>
        <button
          onClick={() => setCurrentPage(totalPages)}
          disabled={currentPage === totalPages}
          className="px-3 py-1 bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k disabled:opacity-50"
        >
          Last
        </button>
      </div>

      <div className="sm:hidden text-center text-sm text-secondary-wh40k mt-2">
        Page {currentPage} of {totalPages}
      </div>
    </div>
  )
}
