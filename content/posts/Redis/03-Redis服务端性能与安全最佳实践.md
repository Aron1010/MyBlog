---
title: Redis 最佳实践（三）：服务端性能调优、持久化与安全
published: 2026-08-04
description: 从实例角色和 RPO、RTO 出发选择 Redis 持久化策略，系统梳理慢查询与延迟诊断、内存淘汰、客户端缓冲区、容量规划，以及
  TLS、ACL 和危险命令等安全措施。
tags:
  - Redis
  - 性能调优
  - Redis持久化
  - 内存管理
  - Redis安全
category: Redis
draft: false
pinned: false
comments: true
id: post-3eb50eb31b
permalink: /posts/redis/03-redis服务端性能与安全最佳实践/
image: hello
author: Aron
---

## 1. 先确定实例角色

同一套 Redis 配置不能覆盖所有场景。先给实例分类：

| 角色 | 数据来源 | 主要目标 | 典型选择 |
| --- | --- | --- | --- |
| 纯缓存 | 可从数据库/服务重建 | 低延迟、可控回源 | 可关闭持久化，必须有 TTL、淘汰和回源保护 |
| 会话/令牌 | Redis 可能是唯一实时状态 | 低延迟与秒级数据安全 | 依据 RPO 使用 AOF，配合副本和备份 |
| 业务主存储 | Redis 是权威数据源 | 数据安全、恢复能力 | RDB + AOF、异地备份、恢复演练 |
| 队列/Stream | 消息不可随意丢失 | 消费可靠性和滞后治理 | 持久化、复制、裁剪、消费者监控 |

“缓存一定关闭持久化”或“生产一定同时开启 RDB+AOF”都过于绝对。选择依据是 RPO、RTO、回源成本、启动时间、磁盘能力和故障模型。

## 2. 持久化

### 2.1 RDB、AOF 与无持久化

| 方案 | 工作方式 | 优点 | 代价/风险 |
| --- | --- | --- | --- |
| RDB | 周期性生成时间点快照 | 文件紧凑、适合备份、恢复通常较快 | 两次快照间数据可能丢失；fork/COW 有开销 |
| AOF | 记录写命令并重放 | 数据丢失窗口可较小、可读性较好 | 文件和磁盘写入更多；需 rewrite；恢复可能更慢 |
| RDB + AOF | 同时保留快照和命令日志 | 数据安全和备份能力较全面 | 占用更多磁盘、I/O 和运维复杂度 |
| 无持久化 | 只驻留内存 | 降低持久化 I/O | 进程/节点故障后本地数据全部丢失 |

同时开启 RDB 和 AOF 时，Redis 重启通常优先使用更完整的 AOF 恢复。

### 2.2 用 RPO/RTO 选策略

```text
RPO = 故障后最多允许丢失多久的数据
RTO = 故障后业务最多允许多久恢复
```

| 目标示例 | 可考虑的策略 |
| --- | --- |
| 数据可完全回源，允许分钟级预热 | 关闭持久化或低频 RDB |
| 可丢几分钟，重视快速恢复/备份 | RDB |
| 通常最多丢约 1 秒 | AOF `everysec`，常配合 RDB |
| 尽量减少已确认写丢失 | 评估 AOF `always`、复制确认与更强外部系统；先压测延迟 |

Redis 的异步复制与持久化不等于分布式强一致提交。即使 AOF `always`，也要考虑操作系统、存储、故障切换和网络分区。

### 2.3 RDB

示意配置：

```conf
# 具体 save 规则按业务写入量和 RPO 设计
save 3600 1
save 300 100
save 60 10000

rdbcompression yes
rdbchecksum yes
stop-writes-on-bgsave-error yes
```

执行过程：

```text
主进程 fork 子进程
  → 子进程遍历内存并写临时 RDB
  → 成功后原子替换旧文件
  → fork 后主进程继续服务
  → 被修改的内存页触发 Copy-on-Write
```

风险与监控：

- 大内存实例 fork 时间增长，可能造成延迟尖峰；
- 写流量大时 COW 会额外占用大量内存；
- 磁盘慢会延长快照，增加后台任务重叠概率；
- 关注 `latest_fork_usec`、`rdb_bgsave_in_progress`、`rdb_last_bgsave_status`、COW 指标和磁盘延迟；
- 预留内存不能只看 `used_memory`，还要考虑峰值写入和 fork COW。

### 2.4 AOF

```conf
appendonly yes
appendfsync everysec

# rewrite 阈值仅示意，需按写入率、磁盘和文件大小调整
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

`appendfsync`：

| 值 | 含义 | 典型取舍 |
| --- | --- | --- |
| `always` | 尽可能每批写入后 fsync | 更耐久，延迟和吞吐代价最大 |
| `everysec` | 通常每秒 fsync | 默认常用平衡点，灾难时可能丢约 1 秒数据 |
| `no` | 交给操作系统刷盘 | 性能较高，数据丢失窗口由 OS 决定且可能更大 |

AOF rewrite 会压缩历史命令。Redis 7.0 起采用多部件 AOF 机制，旧版本与新版本的文件布局和 rewrite 内存行为不同，运维脚本不能假定只有一个固定 AOF 文件。

关于：

```conf
no-appendfsync-on-rewrite yes
```

它可减少 rewrite 与 fsync 竞争造成的延迟，但 rewrite 期间可能扩大未刷盘窗口。延迟优先且可接受更大 RPO 时才考虑 `yes`；数据耐久优先时保留 `no`。不要把它当作通用最佳值。

### 2.5 备份不等于本机持久化

RDB/AOF 文件仍可能与主机、磁盘或可用区一起丢失。完整策略至少包括：

1. 定期复制 RDB/AOF 到独立存储；
2. 保留多个时间点，防止逻辑误删覆盖最新备份；
3. 对备份加密并限制读取权限；
4. 校验文件、记录 Redis 版本和配置；
5. 在隔离环境定期恢复，测量真实 RTO；
6. 恢复后校验 Key 数、关键业务数据和应用兼容性。

副本不是备份：`FLUSHALL`、误删和错误写入会复制到副本。

## 3. 慢查询与延迟诊断

### 3.1 Slow Log 能看到什么

```conf
# 单位是微秒。以下仅为示例，请按 SLO 调整
slowlog-log-slower-than 10000
slowlog-max-len 1024
```

```redis
SLOWLOG LEN
SLOWLOG GET 20
SLOWLOG RESET
```

Slow Log 记录的是命令在 Redis 内部的执行时间，不包含客户端网络往返，也不完整覆盖请求排队、响应发送和慢消费者等待。因此：客户端看到 200 ms 超时而 Slow Log 没记录，不代表 Redis 之外没有问题。

配置语义：

- `slowlog-log-slower-than` 单位微秒；
- 负值表示不记录；
- 0 会记录所有命令，只适合短时诊断；
- Slow Log 是固定长度内存队列，满后淘汰旧记录；
- 命令参数可能包含敏感数据，日志采集和访问需脱敏/授权。

### 3.2 慢命令治理

| 问题 | 示例 | 治理 |
| --- | --- | --- |
| 全库遍历 | `KEYS *` | 改为索引或受控 `SCAN` |
| 全量集合返回 | `HGETALL`、`SMEMBERS`、`LRANGE 0 -1` | 分页、HSCAN/SSCAN、范围上限 |
| 大集合运算 | `SINTER`、`SUNIONSTORE` | 限制规模、离线计算、预计算 |
| 大量删除 | `DEL huge:key` | `UNLINK` 或分批删除 |
| 长脚本 | 大循环 Lua | 缩短脚本、拆分任务、应用侧计算 |
| 深分页 | 超大 offset 的 ZSet/List 范围 | 游标/score-based pagination |

### 3.3 延迟诊断工具

```bash
# redis-cli 本身的延迟观察方式，选项以目标版本为准
redis-cli --latency
redis-cli --latency-history
redis-cli --intrinsic-latency 100
```

```redis
LATENCY LATEST
LATENCY HISTORY event-name
LATENCY GRAPH event-name
LATENCY DOCTOR
LATENCY HISTOGRAM
```

排查矩阵：

| 现象 | 可能原因 | 重点检查 |
| --- | --- | --- |
| Redis 执行时间高 | 慢命令、BigKey、脚本 | SLOWLOG、命令复杂度、Key 大小 |
| 执行时间低但客户端慢 | 网络、连接池、排队、GC、输出缓冲 | 客户端指标、网络、CLIENT LIST |
| 周期性尖峰 | RDB/AOF rewrite、fork、定时任务 | persistence、fork、磁盘延迟 |
| 单分片慢 | HotKey、槽位倾斜、节点资源差 | 分片 CPU/网络/Key 分布 |
| RSS/Swap 后变慢 | 内存不足、碎片、OS 回收 | INFO memory、系统内存、swap in/out |

## 4. 内存管理

### 4.1 maxmemory 与实例角色

```conf
maxmemory 8gb
maxmemory-policy allkeys-lru
```

以上只示意语法，不是推荐容量。`maxmemory` 应低于机器可用内存，预留给：

- Redis 进程开销和 allocator 碎片；
- 客户端输入/输出缓冲；
- 复制 backlog 和副本连接缓冲；
- AOF 缓冲及后台 rewrite；
- fork 后 Copy-on-Write；
- 操作系统、监控 agent、页缓存和其他进程。

“物理内存减去固定 1 GB”通常不可靠。写入率越高、持久化越重、BigKey 越多，预留比例越大。

### 4.2 淘汰策略

常见策略：

| 策略 | 候选范围 | 适用思路 |
| --- | --- | --- |
| `noeviction` | 不淘汰，写入返回 OOM | 权威数据、不能悄悄丢 Key |
| `allkeys-lru` | 所有 Key，近似 LRU | 通用缓存 |
| `allkeys-lfu` | 所有 Key，近似 LFU | 热点长期稳定的缓存 |
| `allkeys-random` | 所有 Key，随机 | 很少作为首选 |
| `volatile-lru/lfu/random` | 仅有 TTL 的 Key | 同实例混合永久和缓存数据时可用，但风险高 |
| `volatile-ttl` | 仅有 TTL，优先短 TTL | 到期时间能表达淘汰优先级时 |

最佳实践是不要在同一实例混合“绝不能淘汰”的权威数据和“可以淘汰”的缓存。即使策略正确，也要监控 `evicted_keys`；持续淘汰意味着容量或模型需要调整。

### 4.3 关键内存指标

| 指标 | 含义 |
| --- | --- |
| `used_memory` | Redis 分配器统计的内存 |
| `used_memory_dataset` | 数据集主体内存 |
| `used_memory_overhead` | 字典、客户端、复制等开销 |
| `used_memory_rss` | 操作系统看到的常驻内存 |
| `mem_fragmentation_ratio/bytes` | RSS 相对 Redis 分配内存的差异 |
| `allocator_frag_ratio` | 分配器内部碎片指标 |
| `allocator_rss_ratio` | 分配器活跃页与 RSS 关系 |
| `rss_overhead_ratio` | 进程 RSS 与分配器 RSS 的关系 |
| `mem_clients_normal` | 普通客户端相关内存 |
| `mem_replication_backlog` | 复制 backlog 内存 |
| `evicted_keys` | 达到 maxmemory 后淘汰的 Key 数 |

不要仅凭 `mem_fragmentation_ratio > 1.5` 就下结论。小实例固定开销会让比率很高；更应结合绝对字节数、allocator 指标、历史峰值和 RSS 是否持续增长。

### 4.4 内存不一定立即归还 OS

删除 Key 后 `used_memory` 下降，但 RSS 可能不立刻下降，因为 allocator 的内存页仍保留给 Redis 后续复用。这不必然是泄漏。处理顺序：

1. 比较 `used_memory`、RSS、峰值和碎片绝对值；
2. 观察流量稳定后 RSS 是否可复用/回落；
3. 检查 BigKey 删除、fork COW、客户端缓冲；
4. 谨慎评估主动碎片整理和 `MEMORY PURGE`；
5. 如果必须重启回收，先做副本切换并验证容量。

## 5. 客户端与缓冲区

### 5.1 连接不是免费的

每个连接都有文件描述符、连接状态和缓冲区开销。应用侧应：

- 使用有界连接池，不为每个请求新建连接；
- 设置连接、命令和读取超时；
- 限制并发等待队列，避免请求堆积；
- 指数退避并加抖动，禁止无上限立即重试；
- 通过 `CLIENT SETNAME`/客户端库标识连接来源；
- 对阻塞命令、Pub/Sub、事务等使用独立连接。

### 5.2 输出缓冲限制

Redis 为每个客户端保留输出缓冲。慢消费者、Pub/Sub 或超大响应会导致缓冲增长。配置语法：

```conf
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60
```

数值仅为配置格式示意，使用目标版本默认值并按压测调整：

```text
hard limit：一旦超过立即断开
soft limit：连续超过 soft seconds 才断开
0：对应限制关闭
```

重点观察 `CLIENT LIST` 中输出缓冲相关字段，以及 `client_output_buffer_limit_disconnections`。不要只放大限制掩盖慢消费者；它可能把断连问题变成服务器 OOM。

### 5.3 输入缓冲与大请求

Pipeline、大参数命令和客户端发送速度过快会放大输入缓冲。不同 Redis 版本对 query buffer 和总客户端内存提供不同配置能力，不应把“固定最大 1 GB 且不可配置”当作通用结论。以目标版本 `redis.conf` 和 `CONFIG GET` 为准，并从应用端限制单请求字节数。

## 6. 安全

### 6.1 防护层次

```text
互联网/不可信网络
  → 防火墙、安全组、VPC/子网隔离
  → Redis bind/protected-mode/TLS
  → ACL 身份与最小权限
  → 应用连接密钥管理
  → 命令审计、告警、补丁与备份
```

Redis 设计为由可信客户端在可信环境访问，不应直接暴露到互联网。

### 6.2 网络与 TLS

```conf
# 示例：只监听内网/环回地址，按部署环境填写
bind 127.0.0.1 10.0.0.12
protected-mode yes
```

不要把“改成非 6379 端口”当作安全控制。端口扫描很容易发现服务。跨不可信网络或合规场景应启用 TLS；Redis 6 起提供可选 TLS 支持，复制、Cluster bus 和 Sentinel 也要分别配置加密链路。

### 6.3 ACL

Redis 6 起推荐使用 ACL，而不是所有应用共享一个 `requirepass`：

```redis
# 示例：只允许访问应用前缀和必要命令类别
ACL SETUSER app on >a-very-long-secret ~shop:* +@read +@write -@admin -@dangerous

# 先验证规则是否允许目标命令
ACL DRYRUN app GET shop:user:1

ACL LIST
ACL LOG
```

实际规则应按命令白名单进一步收紧。注意：

- 密码从密钥管理系统注入，不写入源码或普通日志；
- 管理、监控、复制、应用使用不同账号；
- 定期轮换凭据并验证客户端重连；
- Pub/Sub 还要限制 channel pattern；
- ACL 是纵深防御，不能替代网络隔离和 TLS。

### 6.4 危险命令

传统资料常建议：

```conf
rename-command FLUSHALL ""
```

`rename-command` 属于旧式兼容手段，不应作为现代主要授权机制。优先通过 ACL 禁止 `@admin`、`@dangerous` 或明确拒绝命令。重命名命令还可能破坏运维工具、脚本、复制或升级兼容性。

对应用账号通常禁止或严格限制：

- `CONFIG`、`MODULE`、`DEBUG`、`SHUTDOWN`；
- `FLUSHALL`、`FLUSHDB`、大范围删除；
- `KEYS`、`MONITOR`；
- 脚本/Function 管理命令（如业务不需要）；
- 客户端管理和集群管理命令。

### 6.5 主机安全

- Redis 使用独立、非 root 系统用户运行；
- 限制配置、ACL 文件、RDB/AOF 和日志权限；
- 及时升级受支持版本并跟踪安全公告；
- 禁止在同主机运行不可信程序；
- 备份加密，防止数据通过快照泄露；
- 日志和慢查询中的参数可能含隐私数据，应脱敏并设置保留期。

## 7. 操作系统与容量

官方生产建议通常包括：

- Linux 上合理设置 `vm.overcommit_memory=1`，避免后台保存因 fork 内存检查失败；
- 关闭 Transparent Huge Pages，降低延迟和内存异常风险；
- 监控 swap，避免 Redis 工作集频繁换入换出；
- 提高文件描述符上限并与 `maxclients` 匹配；
- Redis 与高 I/O、高内存争用进程隔离；
- 使用低延迟、容量充足的持久化磁盘；
- 时间同步、日志轮转、监控 agent 也要纳入容量预算。

这些是系统级变更，应由运维按发行版、容器/虚机环境和公司规范实施，不能直接复制命令到所有机器。
