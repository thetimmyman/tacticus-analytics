import { Registry } from 'prom-client'

/**
 * One registry for the process, shared by the metrics route and any module that
 * counts during normal request handling. A second registry would silently serve
 * metrics nobody scrapes.
 */
export const register = new Registry()
