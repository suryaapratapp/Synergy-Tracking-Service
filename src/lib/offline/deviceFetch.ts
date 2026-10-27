/**
 * `fetch` for everything that talks to the server.
 *
 * In development only, `localStorage['dev.offline'] = '1'` makes every request
 * fail the way a dead connection does, and survives reloads - the only
 * practical way to test "the app was closed and reopened with no signal".
 * `import.meta.env.DEV` is false in a production build, so this branch is
 * removed from what ships.
 */
export const deviceFetch: typeof fetch = (input, init) => {
  if (import.meta.env.DEV) {
    try {
      if (localStorage.getItem('dev.offline') === '1') {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
    } catch {
      /* no storage - nothing to switch */
    }
  }
  return fetch(input, init)
}
