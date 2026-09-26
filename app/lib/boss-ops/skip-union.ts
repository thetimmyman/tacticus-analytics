/** The two skip stores can diverge, so every reader must use this union. */
export const isSkipUnion = (
  tokenStoreSkip: boolean | null | undefined,
  behaviourStoreSkip: boolean
): boolean => tokenStoreSkip === true || behaviourStoreSkip
