---
title: Redis 最佳实践（一）：Key 设计、数据结构选型与 BigKey 治理
published: 2026-08-04
description: 系统讲解 Redis Key 命名、TTL 设计与数据结构选型，分析 String、Hash 的使用边界和内部编码，并给出
  BigKey、HotKey 的发现、拆分、安全删除及数据建模方案。
tags:
  - Redis
  - Key设计
  - 数据结构
  - BigKey
  - HotKey
category: Redis
draft: false
pinned: false
comments: true
id: redis-keys
permalink: /posts/redis/01-redis键值与数据结构最佳实践/
image: soda
author: Aron
---

## 1. Key 设计

### 1.1 命名目标

好的 Key 应同时满足：

- 唯一：不同环境、租户、业务和对象不会冲突；
- 可读：看到 Key 能快速判断归属和用途；
- 稳定：不把容易变化的展示字段写进 Key；
- 紧凑：避免无意义重复，降低内存、网络和持久化开销；
- 可治理：能按业务前缀统计、扫描、限流和迁移；
- 兼容 Cluster：需要共槽的 Key 提前规划 Hash Tag。

推荐格式：

```text
业务:对象:标识[:维度]

示例：
shop:user:10086
shop:product:sku-123
shop:cart:{10086}:items
shop:cart:{10086}:meta
```

约定建议：

| 项目 | 建议 |
| --- | --- |
| 分隔符 | 统一使用 `:`，不要在同一系统混用多套风格 |
| 大小写 | 一般全部小写，避免视觉相同但实际不同的 Key |
| 环境 | 实例已物理隔离时可不写；共享实例时显式写 `dev/test/prod` |
| 租户 | 多租户系统把 tenantId 放在稳定位置，并控制单租户配额 |
| ID | 优先不可变 ID，不用昵称、手机号等可变或敏感字段 |
| 版本 | 数据结构不兼容升级时可加 `v2`，不要随发布次数盲目增长 |

### 1.2 “44 字节”不是 Key 的硬限制

一些旧资料建议 Key 不超过 44 字节，理由是 Redis 的 `embstr` 编码。这个结论不能直接用于 Key 设计：

1. `embstr` 阈值属于特定版本的 String 对象内部实现；
2. Redis 数据库 Key 和 Value 的对象组织、分配开销并不能简化为“Key 小于某值就一定省一次分配”；
3. 阈值和编码会随版本变化；
4. 可维护性与可观测性也有价值，不能为了省几个字节使用不可理解的缩写。

正确做法是：对高基数 Key 保持简洁，并在目标 Redis 版本、真实数据分布和真实 allocator 下，用 `MEMORY USAGE` 或离线样本测量。Key 多出 10 字节，在一亿个 Key 上就是约 1 GB 的原始字符差异，因此“大规模时短 Key 很重要”仍然成立，但没有统一的 44 字节红线。

### 1.3 不要把查询能力寄托在 Key 名上

Redis 不是按 Key 前缀建立索引的关系数据库。生产请求中不要通过：

```redis
KEYS order:2026-08-04:*
```

来查询业务数据。`KEYS` 会遍历当前数据库，Key 多时会阻塞服务。替代方案：

- 明确 ID 直接访问；
- 用 Set/ZSet 维护业务索引；
- 用 Hash 组织同一聚合对象；
- 用 Redis Query Engine 等专用索引能力；
- 运维遍历使用 `SCAN`，并接受它的迭代语义。

### 1.4 TTL 是数据模型的一部分

所有缓存 Key 在设计阶段都应回答“何时失效”：

| 场景 | 建议 |
| --- | --- |
| 可由数据库重建的缓存 | 设置 TTL，避免永久堆积 |
| 会话/验证码/令牌 | TTL 是业务正确性要求，写入时原子设置 |
| 永久业务状态 | 不应仅依赖淘汰；明确持久化、备份和容量 |
| 热点批量预热 | TTL 加随机抖动，避免同一时刻集中过期 |

```redis
# 写值和 TTL 一次完成，避免 SET 成功而 EXPIRE 失败
SET session:token-xxx payload EX 1800

# 对大量同周期缓存加入应用侧随机抖动，例如基础 1h + 0~10min
```

不要无条件续期。滑动过期会让长期活跃的垃圾数据永不释放，应结合业务状态和最大生命周期。

## 2. 数据类型选择

### 2.1 选择表

| 需求 | 首选类型 | 典型命令 | 注意事项 |
| --- | --- | --- | --- |
| 单值、计数、序列化对象 | String | `GET`、`SET`、`INCRBY`、`MGET` | 整体更新；大对象会放大网络和复制 |
| 对象的字段级读写 | Hash | `HGET`、`HSET`、`HINCRBY` | 避免无界 Hash 和大范围 `HGETALL` |
| 有序队列、时间线 | List | `LPUSH`、`RPOP`、`LRANGE` | 中间位置操作成本高；消息可靠性优先考虑 Stream |
| 唯一成员、集合关系 | Set | `SADD`、`SISMEMBER`、`SINTER` | 集合运算可能随规模增长并产生大结果 |
| 排行榜、延迟队列、范围查询 | Sorted Set | `ZADD`、`ZRANGE`、`ZRANGEBYSCORE` | score 是双精度浮点数；控制成员规模 |
| 消息日志、消费组 | Stream | `XADD`、`XREADGROUP`、`XACK` | 设置裁剪策略，治理 PEL 和滞后消费者 |
| 稠密布尔状态 | Bitmap | `SETBIT`、`GETBIT`、`BITCOUNT` | offset 过大会瞬间扩展 String |
| 近似去重计数 | HyperLogLog | `PFADD`、`PFCOUNT` | 有误差，不能反查成员 |
| 经纬度附近查询 | GEO | `GEOADD`、`GEOSEARCH` | 本质基于 ZSet；不是通用 GIS 引擎 |

### 2.2 String 与 Hash 如何选择

假设存储一个用户：

```text
方案 A：String
user:10086 -> JSON {name, age, city, ...}

方案 B：Hash
user:10086 -> name=Alice, age=28, city=Beijing, ...
```

| 维度 | String/JSON | Hash |
| --- | --- | --- |
| 读取整个对象 | 简单、一次 GET | 可 HGETALL，但大对象不宜全取 |
| 更新单字段 | 需读改写整个值，或使用 JSON 模块 | `HSET key field value` |
| 字段级计数 | 不方便 | `HINCRBY` 原子完成 |
| 网络流量 | 小对象整体读取合适 | 只读所需字段更省流量 |
| TTL | 整个 Key 一个 TTL | 传统版本通常 Key 级 TTL；新版本字段 TTL 能力需按目标版本验证 |
| Cluster | 单 Key 天然同槽 | 单 Hash 天然同槽，但可能形成 BigKey/HotKey |

不要为了减少 Key 数，把一个租户或一张表的所有数据塞入单个 Hash。Key 数减少了，但故障域、迁移成本、单线程处理时间和热点都会集中。

### 2.3 内部编码是优化细节，不是业务契约

小型 Hash、Set、ZSet 等可能使用 listpack、intset 等紧凑编码，超过元素数或元素大小阈值后自动转换。Redis 7.0 及以后常见配置名包括：

```conf
hash-max-listpack-entries 512
hash-max-listpack-value 64
zset-max-listpack-entries 128
zset-max-listpack-value 64
set-max-intset-entries 512
```

旧版本可能使用带 `ziplist` 的配置名。注意：

- 默认值和可用项需以目标版本 `redis.conf` 为准；
- 把阈值调得很大可能省内存，但会增加线性扫描和编码转换成本；
- 先基准测试，再修改默认值；
- 用 `OBJECT ENCODING key` 观察编码，但应用逻辑不能依赖编码结果。

## 3. BigKey

### 3.1 定义

BigKey 不是“Key 名很长”，而是 Key 对应的 Value 占用大、成员多、单次操作耗时长或响应大。没有全行业统一阈值，应按类型分别定义：

| 类型 | 可观测维度 | 示例告警条件（仅示意） |
| --- | --- | --- |
| String | 字节数 | 超过 100 KB 或明显高于同类 P99 |
| Hash | field 数、总内存、最大 field/value | 超过 5000 fields 或数 MB |
| List | 元素数、单元素大小、最大范围返回量 | 超过 10000 elements |
| Set | member 数、集合运算结果规模 | 超过 10000 members |
| ZSet | member 数、范围查询规模 | 超过 10000 members |
| Stream | entries、groups、PEL、内存 | 未裁剪且持续增长 |

真正阈值应来自：延迟 SLO、最大网络响应、复制/迁槽时间、内存预算、删除耗时和备份恢复时间。

### 3.2 危害

```text
写入/更新 BigKey
  → 主线程处理或复制大负载
  → AOF、复制链路、网络带宽升高

读取 BigKey
  → 大响应进入客户端输出缓冲区
  → 网络拥塞、慢消费者、内存突增

删除/过期 BigKey
  → 大量对象需要释放
  → DEL 可能阻塞；UNLINK 可异步释放但仍有调度和内存压力

Cluster 迁槽
  → BigKey 迁移时间长
  → 槽位重平衡尾延迟上升
```

### 3.3 发现 BigKey

低风险到高精度的常见路径：

```bash
# 按类型扫描并报告较大的 Key/基数
redis-cli --bigkeys

# 关注内存占用；具体选项随 redis-cli 版本变化
redis-cli --memkeys
redis-cli --keystats
```

抽样检查：

```redis
TYPE some:key
STRLEN some:string
HLEN some:hash
LLEN some:list
SCARD some:set
ZCARD some:zset
XLEN some:stream
MEMORY USAGE some:key SAMPLES 5
```

注意事项：

- `--bigkeys` 主要按类型的长度/基数寻找大对象，不等于精确内存排行；
- `MEMORY USAGE` 对聚合类型会抽样，`SAMPLES 0` 全量采样可能昂贵；
- 在副本或离线环境做深度扫描，仍需评估 CPU、网络和缓存污染；
- 禁止通过生产 `KEYS *` 全量拉取后逐个检查；
- `SCAN` 的 `COUNT` 是提示，不保证每次返回固定条数。

### 3.4 SCAN 的正确语义

```text
cursor = 0
do:
    cursor, keys = SCAN cursor MATCH pattern COUNT hint
    处理本批 keys
until cursor == 0
```

必须接受：

- 单次调用近似 O(1)，完整遍历总体 O(N)；
- `COUNT` 只是工作量提示；
- 遍历期间数据变化时可能重复返回；调用方要能去重或幂等处理；
- 它不是一致性快照，不能据此做强一致账务统计；
- Cluster 中通常要对各主节点/槽范围执行，客户端行为需确认。

### 3.5 治理 BigKey

| 问题 | 方案 |
| --- | --- |
| 大 String | 拆成字段或分块；只取需要的数据；压缩前先评估 CPU |
| 超大 Hash | 按稳定哈希分桶；按对象/时间段拆 Key |
| 超大 List/Stream | 设置长度上限或按时间分段；消费后裁剪 |
| 超大 Set/ZSet | 按业务维度、时间或哈希分片；限制范围查询数量 |
| 大范围读取 | 使用分页/游标；设置响应上限 |
| 删除 | 优先 `UNLINK`；必要时分批删成员，并监控 lazyfree 队列/内存 |

Hash 分桶示例：

```text
原模型：
user:all -> field=userId, value=userJson

分桶模型（bucket = stableHash(userId) mod 256）：
user:bucket:000
user:bucket:001
...
user:bucket:255
```

分桶数不是越多越好。应让单桶最大值有明确上限，并避免使用会在不同语言/进程变化的默认 `hashCode`。

### 3.6 安全删除

```redis
UNLINK huge:key
```

`UNLINK` 会先从 Keyspace 解绑，再由后台线程释放多数内存，通常比 `DEL` 更不容易造成长阻塞。但它不是零成本：

- 从字典解绑仍需主线程工作；
- 短时间大量 UNLINK 会让后台释放堆积，内存下降滞后；
- 复制和 AOF 仍需传播删除命令；
- 如果业务不断重建该 Key，必须先停止写入或切换命名空间。

推荐流程：停止生产 → 重命名/版本切换隔离 → 小批删除或 UNLINK → 监控 RSS、lazyfree、延迟 → 验证回收。

## 4. HotKey

HotKey 指访问流量高度集中，而非 Value 一定很大。BigKey 和 HotKey 可以独立存在，也可能叠加。

### 4.1 识别

- 应用侧按 Key/业务维度采样统计；
- 观察单分片 CPU、网络、命令量是否倾斜；
- 使用客户端代理或可观测平台的热点分析；
- 结合 `INFO commandstats` 判断热命令，但它不直接给出 Key；
- 生产使用 `MONITOR` 要极其谨慎，它会增加开销并暴露数据。

### 4.2 治理

| 场景 | 方案 |
| --- | --- |
| 热点只读 | 客户端本地缓存、进程缓存、CDN、只读副本（接受旧读） |
| 热点 String | 创建多个副本 Key，读取随机分散；更新时同步失效 |
| 热点计数 | 本地聚合后批量写、分片计数后汇总 |
| 热点 Hash Tag | 缩小共槽范围，避免把整个租户绑到一个槽 |
| 突发穿透 | singleflight/互斥构建、限流、空值缓存或 Bloom Filter |

热点副本会引入一致性成本。对于强一致读取，不应仅靠随机副本解决。

## 5. 数据建模示例

### 5.1 购物车

```redis
# 同一用户一个 Hash，field 是 sku，value 是数量
HSET cart:{10086}:items sku-1 2 sku-2 1
EXPIRE cart:{10086}:items 2592000
```

优点：字段级更新；同一用户相关 Key 可通过 `{10086}` 共槽。风险：超大购物车要限制商品数，不能用单个 `{tenantId}` 让全租户购物车集中到一个槽。

### 5.2 排行榜

```redis
ZADD rank:daily:2026-08-04 980 user-1 870 user-2
ZREVRANGE rank:daily:2026-08-04 0 99 WITHSCORES
EXPIRE rank:daily:2026-08-04 604800
```

按天分 Key 控制规模；翻页越深成本越高，应限制最大页数或改用基于 score/member 的游标。

### 5.3 防止缓存雪崩

```text
错误：10 万个 Key 全部 TTL=3600，且同一秒写入
建议：TTL = 3600 + random(0, 600)
```

同时配合：预热、限流、熔断、分级缓存、回源并发合并。随机 TTL 只能打散过期时间，不能解决所有回源故障。
