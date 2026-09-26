// Barrel for postHerald*Event (owns herald_posted_events / herald_boss_availability dedup writes).

import 'server-only'

export { postHeraldEvent } from '@/app/lib/herald/dispatch/defeat-dispatch'

export { postHeraldBombRangeEvent } from '@/app/lib/herald/dispatch/bomb-range-dispatch'

export { postHeraldAvailabilityEvent } from '@/app/lib/herald/dispatch/availability-dispatch'
