# Dilamme Scheduler — Benchmark Results

| Operation | Operations | Time (s) | Op/s |
|---|---|---|---|
| Heap insert | 10000 | 0.113101 | 88417 |
| Heap extract | 10000 | 0.025222 | 396482 |
| Wheel schedule | 10000 | 0.067572 | 147989 |
| Wheel tick (full rotation) | 3600 | 0.010401 | 346111 |
| MongoDB query (indexed) | 100k docs, top 100 | 0.051569 | 19 ops/s |
| MongoDB query (no index) | 100k docs, top 100 | 0.005172 | 193 ops/s |
