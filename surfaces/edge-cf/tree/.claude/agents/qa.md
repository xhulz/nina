<!-- nina:slot edge-cf.1 -->
Here `$STRAY` is `vitest|workerd`: a Worker test boots a second runtime process alongside vitest,
and it is the one that holds ~2 GB and survives a killed test run.

<!-- nina:slot edge-cf.2 -->
  A test that runs in the Workers pool does not run from that copy with its root `node_modules` linked back: the pool
  stops with "Vitest failed to find the runner". Install the copy's own instead, once, from the store and offline
  (`pnpm install --offline --frozen-lockfile` in the copy), and see one unmutated test pass in it before the first
  mutation.
