<!-- nina:slot edge-cf.1 -->
Here `$STRAY` is `vitest|workerd`: a Worker test boots a second runtime process alongside vitest,
and it is the one that holds ~2 GB and survives a killed test run.
