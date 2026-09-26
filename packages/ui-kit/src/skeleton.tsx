import { cn } from './cn'

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[var(--card-bg)]', className)}
      {...props}
    />
  )
}

export { Skeleton }
