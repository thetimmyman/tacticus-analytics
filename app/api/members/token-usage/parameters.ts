import { Errors } from '@/app/lib/errors/AppError'

export function requireTokenSeason(value: string): string {
  if (!/^[1-9]\d{0,9}$/.test(value) || Number(value) > 2147483647) {
    throw Errors.validation('Season must be a positive integer')
  }
  return value
}
