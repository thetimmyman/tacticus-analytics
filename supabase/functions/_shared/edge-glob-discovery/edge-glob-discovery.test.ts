import { assertEquals } from 'https://deno.land/std@0.203.0/assert/mod.ts'

Deno.test(
  'edge test discovery - a test in a new subdirectory is picked up',
  () => {
    assertEquals(1 + 1, 2)
  }
)
