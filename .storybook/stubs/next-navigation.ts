// Storybook has no Next router, so usePathname resolves to null there and
// resolveActiveWorkspace dereferences it. Stub just what the chrome reads.
export const usePathname = () => '/command'
export const useSearchParams = () => new URLSearchParams()
export const useRouter = () => ({ push: () => {}, replace: () => {} })
