Benchmark          | Workload                      | Mean (ms) | P50 (ms) | P95 (ms) | Stddev (ms)
-------------------+-------------------------------+-----------+----------+----------+------------
PriorityQueue      | insert 10,000, drain in order | 64.787    | 61.406   | 93.935   | 14.797
TimingWheel + Heap | insert 10,000, drain in order | 58.859    | 52.317   | 96.654   | 20.088
Mongo indexed      | 50,000 docs, top 100          | 2.033     | 1.807    | 3.464    | 0.899
Mongo no index     | 50,000 docs, top 100          | 222.606   | 224.324  | 257.556  | 27.143