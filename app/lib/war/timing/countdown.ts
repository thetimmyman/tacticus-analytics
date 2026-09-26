export interface Countdown {
  days: number
  hours: number
  minutes: number
  seconds: number
  totalMs: number
  isExpired: boolean
}

export const getCountdown = (
  targetDate: Date,
  now: Date = new Date()
): Countdown => {
  const diff = targetDate.getTime() - now.getTime()
  if (diff <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalMs: diff,
      isExpired: true
    }
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((diff % (1000 * 60)) / 1000)

  return {
    days,
    hours,
    minutes,
    seconds,
    totalMs: diff,
    isExpired: false
  }
}

export const formatCountdown = (countdown: Countdown): string => {
  if (countdown.isExpired) return '0s'
  return `${countdown.days}d ${countdown.hours}h ${countdown.minutes}m ${countdown.seconds}s`
}
