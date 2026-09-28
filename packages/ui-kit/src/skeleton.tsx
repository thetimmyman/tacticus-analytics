import { cn } from './cn'

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-(--card-bg)', className)}
      {...props}
    />
  )
}

export { Skeleton }
