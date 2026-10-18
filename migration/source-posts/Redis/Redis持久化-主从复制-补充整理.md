---
# 文章标题
title: Redis 主从复制完全指南：全量同步、部分同步与生产优化
# 文章发布日期
published: 2026-07-28
# 文章简介
description: 解析 Redis 主从复制的 Replication ID、Offset、Backlog 与 PSYNC 机制，梳理全量和部分同步流程，并讨论持久化关系、数据丢失窗口、读写一致性及生产调优。
# 文章标签
tags: [Redis, 主从复制, PSYNC, 数据同步, 高可用]
# 文章分类
category: Redis
# 是否为草稿
draft: false
# 是否置顶
pinned: false
# 是否允许评论
comments: true
# 文章密码
# password: 
---

> 适用范围：Redis Open Source 7.x/8.x。文中优先使用 `master`（主节点）和 `replica`（副本节点）；部分配置项与 `INFO` 字段为了兼容旧版本，仍保留 `slave` 字样。

## 1. 主从复制解决什么问题

Redis 主从复制让一个或多个 replica 持续复制 master 的数据，主要用于：

- 扩展读取能力，实现读写分离。
- 保留数据的冗余副本。
- 为 Sentinel 或 Redis Cluster 的故障转移提供可提升的节点。
- 支持滚动升级、数据迁移和只读分析。

典型结构：

```text
                 写请求
                   ↓
客户端 ───────→ Master
                   │
          异步复制命令流
              ┌────┴────┐
              ↓         ↓
          Replica 1  Replica 2
              ↑         ↑
           读请求      读请求
```

需要明确：

- Redis 默认使用**异步复制**。
- master 完成内存写入后通常就可以向客户端返回，不会等待所有 replica。
- replica 可能暂时落后，读取到旧数据。
- 复制、持久化、备份和高可用解决的是不同问题，不能互相替代。

| 能力 | 主要解决的问题 | 不能保证什么 |
|---|---|---|
| 主从复制 | 在线冗余、读扩展、故障转移的数据来源 | 不保证零数据丢失，不是历史备份 |
| RDB/AOF | 单节点重启后的本地数据恢复 | 不自动完成故障转移 |
| Sentinel | 监控和自动主从切换 | 异步复制下仍可能丢失已确认写入 |
| 独立备份 | 误删、文件损坏和灾难恢复 | 不提供实时读扩展 |

---

## 2. 基础搭建与配置

### 2.1 把节点配置为 replica

配置文件：

```conf
replicaof 192.168.10.10 6379
```

运行时命令：

```bash
REPLICAOF 192.168.10.10 6379
```

取消复制关系并把当前节点提升为独立 master：

```bash
REPLICAOF NO ONE
```

### 2.2 认证配置

如果 master 需要认证，replica 必须配置连接 master 所需的凭证：

```conf
masterauth your-password
```

使用 ACL 时，还需要为复制连接配置具有相应权限的用户。生产环境应同时保护 master 和 replica，避免 replica 成为绕过认证的数据入口。

### 2.3 replica 的读写行为

```conf
# 默认开启，只允许客户端读取 replica
replica-read-only yes

# 与 master 断开或正在同步时，是否允许返回可能过期的数据
replica-serve-stale-data yes
```

即使把 `replica-read-only` 改为 `no`，也不代表 Redis 变成多主系统：

- replica 上的本地写入不会反向复制给 master。
- 重新同步时，本地写入可能被 master 的数据覆盖。
- 普通主从架构应坚持所有业务写入只进入当前 master。

---

## 3. 正常复制链路

master 与 replica 已完成同步且连接正常时，流程如下：

1. 客户端向 master 发出写命令。
2. master 修改自己的内存数据。
3. master 把产生相同数据效果的命令写入复制流。
4. replica 接收并执行复制流中的命令。
5. replica 周期性向 master 上报自己已经处理到的复制偏移量。

复制流不仅包含显式客户端写命令，还包含：

- key 过期产生的数据变更。
- 内存淘汰产生的数据变更。
- 其他会改变数据集的操作。

master 可以同时连接多个 replica。replica 也可以作为其他 replica 的上游，形成级联复制：

```text
Master
  │
  ├── Replica A
  │       ├── Sub-replica A1
  │       └── Sub-replica A2
  │
  └── Replica B
```

级联复制可以减少 master 直接服务大量副本的压力，但会增加复制延迟、拓扑复杂度和故障排查成本。

---

## 4. 复制的三个核心标识

### 4.1 Replication ID

Replication ID（复制 ID，通常称 `replid`）标识一段特定的数据历史。

- master 拥有自己的复制 ID。
- replica 同步后会记住 master 的复制 ID。
- 复制 ID 与 offset 组合起来，才能唯一描述某个数据历史中的位置。

Redis 还维护第二复制 ID：

- `master_replid`：当前复制历史。
- `master_replid2`：上一段复制历史。
- `second_repl_offset`：旧历史可以继续部分同步的边界。

第二复制 ID 主要用于故障转移后，让原 master 的其他 replica 仍有机会与新 master 进行部分同步。

### 4.2 Replication Offset

复制偏移量表示复制流已经生成或处理到的位置。

- master 的 offset 随复制流增加。
- replica 保存自己已处理的 offset。
- 两者差值可以近似反映副本落后程度。

不能只比较 offset 而忽略复制 ID。不同复制历史中的相同 offset 没有可比性。

### 4.3 Replication Backlog

Replication backlog 是 master 内存中的**固定容量环形缓冲区**，保存最近一段复制命令流。

它不是磁盘文件，正确配置名为：

```conf
repl-backlog-size 256mb
```

环形结构的特点：

1. 新复制数据持续写入 backlog。
2. 缓冲区写满后，从头覆盖最旧的数据。
3. replica 短暂断线后，可以根据 offset 获取缺失部分。
4. 如果需要的旧数据已被覆盖，就不能部分同步，只能全量同步。

文字示例：

```text
backlog 保存的 offset 范围：10001 ～ 20000
master 当前 offset：       20000
replica 已处理 offset：    17500

结果：17501 ～ 20000 仍在 backlog 中，可以部分同步。
```

如果 replica 的 offset 是 `8000`，而 backlog 最早只保留到 `10001`，则缺失的 `8001～10000` 已经被覆盖，只能全量同步。

---

## 5. PSYNC：决定部分同步还是全量同步

新版本 Redis 使用 `PSYNC` 协议进行复制协商。`SYNC` 是不支持部分同步的旧协议，只为兼容保留。

replica 建立连接时，会向 master 提供自己记住的复制 ID 和 offset。master 根据以下条件判断：

```text
复制 ID 是否属于当前或仍可识别的旧历史？
                    │
          ┌─────────┴─────────┐
          │是                 │否
          ↓                   ↓
缺失 offset 是否仍在 backlog？  全量同步
          │
    ┌─────┴─────┐
    │是         │否
    ↓           ↓
部分同步       全量同步
```

| 判断结果 | 同步方式 |
|---|---|
| 复制 ID 可识别，缺失数据仍在 backlog | 部分同步 |
| 第一次连接，没有有效复制 ID 和 offset | 全量同步 |
| 复制 ID 不属于当前或可兼容历史 | 全量同步 |
| replica 断开太久，需要的 offset 已被覆盖 | 全量同步 |
| master 的历史发生无法兼容的变化 | 全量同步 |

---

## 6. 全量同步流程

全量同步适用于首次连接或无法部分同步的情况。

### 6.1 磁盘式全量同步

完整时序：

1. replica 发送 `PSYNC`，请求继续原来的复制历史。
2. master 判断不能部分同步，回复进行全量同步。
3. master 启动后台保存，生成代表当前数据集的 RDB。
4. 生成 RDB 的同时，master 把新的写命令放入复制缓冲区。
5. master 把 RDB 传输给 replica。
6. replica 接收 RDB，清理旧数据并加载新数据集。
7. master 把生成 RDB 期间积累的命令继续发送给 replica。
8. replica 执行这些命令，追赶到 master 当前 offset。
9. 后续进入持续命令流复制。

```text
Master                                   Replica
  │                                         │
  │ ←──── PSYNC replid offset ───────────── │
  │                                         │
  │ ───── FULLRESYNC new-replid offset ───→ │
  │                                         │
  │ 生成 RDB，同时缓存新写入                 │
  │ ─────────── RDB 数据流 ───────────────→ │
  │                                         │ 清空旧数据并加载 RDB
  │ ───── RDB 期间积累的命令流 ───────────→ │
  │ ───────── 持续复制命令流 ─────────────→ │
```

### 6.2 无盘复制

```conf
repl-diskless-sync yes

# 等待一小段时间，让多个同时到来的 replica 共用一次同步
repl-diskless-sync-delay 5
```

无盘复制时，master 的子进程直接通过网络套接字把 RDB 数据流发送给 replica，而不先在 master 磁盘生成 RDB 文件。

优点：

- 避免 master 上的 RDB 磁盘写入。
- 适合磁盘较慢而网络较快的环境。
- 多个同时请求同步的 replica 可以共享一次 RDB 生成过程。

代价：

- 仍然需要 `fork`，仍存在 COW 内存开销。
- 会占用大量网络带宽。
- 网络慢或 replica 多时，子进程存活时间可能更长。
- 需要结合 `repl-diskless-load` 等配置评估 replica 的加载策略。

### 6.3 全量同步的主要成本

| 阶段 | master 成本 | replica 成本 |
|---|---|---|
| `fork` | 短暂停顿、页表复制 | 无 |
| RDB 生成 | CPU、COW 内存、磁盘或网络 | 接收数据 |
| RDB 传输 | 网络带宽、输出缓冲区 | 网络和临时存储 |
| 数据加载 | 继续缓存增量命令 | 清空旧数据、加载 RDB，可能暂停服务 |
| 追赶增量 | 发送积累命令 | 执行大量命令、增加 CPU |

因此应尽量避免多个大 replica 频繁触发全量同步。

---

## 7. 部分同步流程

部分同步用于 replica 短暂断线且缺失命令仍在 backlog 中的情况。

流程：

1. replica 重连并提交复制 ID 与上次处理的 offset。
2. master 确认复制历史兼容。
3. master 确认缺失部分仍在 backlog。
4. master 从 `offset+1` 开始发送缺失命令。
5. replica 执行缺失命令并追赶 master。
6. 双方恢复持续复制。

| 对比项 | 全量同步 | 部分同步 |
|---|---|---|
| 传输内容 | 完整 RDB + 同步期间增量命令 | backlog 中缺失的命令 |
| 网络开销 | 大 | 小 |
| master 开销 | 通常需要 `fork` 和生成 RDB | 读取内存 backlog |
| replica 行为 | 替换完整数据集 | 在现有数据上补齐命令 |
| 触发场景 | 首次连接或历史缺失 | 短暂断线且历史仍保留 |

---

## 8. 如何设置 repl-backlog-size

backlog 太小会让短暂网络故障频繁退化成全量同步；太大则持续占用 master 内存。

可按下面的思路估算：

```text
backlog 大小
≈ 峰值复制流量（字节/秒）
× 希望容忍的最长断线时间（秒）
× 安全系数
```

示例：

```text
峰值写入复制流量：20 MB/s
希望容忍断线：    5 分钟 = 300 秒
安全系数：        1.5

建议 backlog ≈ 20 × 300 × 1.5 = 9000 MB
```

实际设置前还要考虑：

- Redis 命令编码后的复制流量可能与业务数据量不同。
- 过期、淘汰、批量命令也会进入复制流。
- 网络抖动时间不一定等于故障修复时间。
- backlog 由同一 master 的 replica 共享，不需要按 replica 数量简单相乘。
- 必须确认机器有足够内存。

配置与观察：

```conf
repl-backlog-size 1gb
repl-backlog-ttl 3600
```

```bash
redis-cli INFO replication
```

关注：

- `repl_backlog_active`
- `repl_backlog_size`
- `repl_backlog_first_byte_offset`
- `repl_backlog_histlen`
- `master_repl_offset`
- replica 的复制 offset

---

## 9. 主从复制与 RDB/AOF 的关系

### 9.1 全量同步会使用 RDB

即使业务持久化配置中关闭了周期性 RDB，传统磁盘式全量复制仍可能生成 RDB 文件。

- 磁盘式复制：master 后台生成 RDB，再发送给 replica。
- 无盘复制：生成 RDB 格式的数据流并直接发送，不在 master 磁盘保留该文件。

所以“关闭 RDB 持久化”不等于“主从复制永远不会产生 RDB 相关开销”。

### 9.2 复制不能替代持久化

复制的目标是让 replica 尽量成为 master 的当前副本。如果 master 变成空数据集，空数据也可能被复制出去。

危险场景：

1. master 关闭 RDB 和 AOF。
2. master 进程崩溃后被进程管理器自动重启。
3. 因为没有持久化，master 以空数据集启动。
4. replica 重新连接并把空 master 当作正确数据源。
5. replica 的原有数据被清空，整个复制组的数据一起丢失。

因此 Redis 官方建议：

- 使用复制时，在 master 和 replica 上开启适合业务的持久化。
- 如果 master 确实关闭持久化，不要让它在崩溃后未经人工确认就自动以空数据集重启。
- Sentinel 场景尤其要避免“无持久化 master + 自动重启”的组合。

### 9.3 replica 是否需要持久化

通常建议 replica 也配置持久化，原因包括：

- replica 重启后可先从本地恢复，减少完全从 master 获取数据的风险。
- 某个 replica 可能在故障转移后成为新 master。
- 可把备份、RDB 归档等磁盘任务放到专用 replica，降低 master 压力。

但要注意：

- replica 的持久化文件同样会反映复制来的删除和误操作。
- replica 本地持久化仍不是独立、版本化的备份。
- Redis 官方文档指出，replica 平滑停机时写入的 RDB 可以保存部分同步所需元数据；仅通过 AOF 重启的 replica 不能依靠 AOF 完成相同的部分同步恢复。

### 9.4 AOF 与复制流不是同一个概念

| AOF | 主从复制流 |
|---|---|
| 写入本机磁盘，用于本节点重启恢复 | 通过网络发送给 replica |
| 耐久性由 `appendfsync` 决定 | 延迟由网络和 replica 处理速度决定 |
| 重写用于控制文件体积 | backlog 用于短暂断线后的部分同步 |
| 本机恢复时加载 AOF | replica 通过 RDB 和复制命令追赶 master |

---

## 10. 故障转移为什么仍可能丢数据

Redis 主从复制默认是异步的。下面的写入可能已经被 master 确认，但还没到达 replica：

```text
客户端 ── SET order:1 paid ──→ Master
客户端 ←──────── OK ───────── Master
                                  │
                                  │ 尚未复制完成
                                  × Master 故障
                                  │
Replica 被提升为新 Master，但没有这条写入
```

因此：

- Sentinel 能自动切换 master，但不能把异步复制变成零丢失复制。
- 网络分区时，旧 master 可能仍短暂接受写入。
- 故障恢复后，旧 master 会被配置为新 master 的 replica，其分叉数据会被新历史覆盖。
- replica 越落后，故障转移可能丢失的数据越多。

### 10.1 使用 min-replicas 限制风险

```conf
min-replicas-to-write 1
min-replicas-max-lag 10
```

含义：

- 至少需要 1 个 replica 满足最大延迟要求。
- 如果 master 在规定时间内没有收到足够 replica 的进度确认，则停止接受写入。

作用：

- 限制 master 与 replica 长时间失联时继续产生大量孤立写入。
- 缩小网络分区期间的数据分叉窗口。

代价：

- replica 不满足条件时，master 会拒绝写入，可用性下降。
- 这仍不是严格同步复制，也不能保证绝对零丢失。

### 10.2 使用 WAIT 提高关键写入安全性

```redis
SET order:1 paid
WAIT 1 1000
```

`WAIT 1 1000` 表示最多等待 1000 毫秒，希望至少 1 个 replica 确认已经接收到当前连接此前的写入。

应用必须检查返回值：

```text
返回 1：至少一个 replica 已确认相应复制位置
返回 0：超时前没有 replica 满足条件
```

注意：

- `WAIT` 提高写入已到达 replica 的概率，但不会把 Redis 变成强一致 CP 系统。
- replica 确认复制 offset 不一定等于写入已经按目标策略落到磁盘。
- `WAIT` 不能替代 AOF、RDB、备份或正确的故障转移设计。
- 执行 `WAIT` 后若业务从另一个落后 replica 读取，仍可能读到旧值；读路由也必须设计。

---

## 11. 读写分离的一致性问题

读 replica 可以扩展吞吐量，但要接受最终一致性。

常见问题：

| 问题 | 表现 | 处理思路 |
|---|---|---|
| 读到旧值 | 写 master 后立即读 replica，结果尚未同步 | 关键读回 master；按业务使用 `WAIT`；客户端做短期粘滞路由 |
| 主从切换后的旧连接 | 客户端仍向旧 master 写入 | 使用支持 Sentinel/Cluster 的客户端，及时刷新拓扑 |
| replica 正在全量加载 | 暂停响应或返回旧数据 | 配置并评估 stale-data 行为；健康检查剔除同步中节点 |
| 复制延迟扩大 | replica CPU、网络或磁盘不足 | 监控 offset 差值、链路状态和处理能力 |
| 过期时间看似不一致 | replica 复制和过期处理存在时序差 | 以 master 为权威，避免依赖 replica 做强一致判断 |

不适合直接读 replica 的场景：

- 写后立即读取。
- 库存扣减后的可售数量判断。
- 分布式锁状态确认。
- 支付、订单状态等不能容忍短暂旧值的业务。

---

## 12. 主从复制优化

### 12.1 控制单节点数据量

单节点数据集越大：

- 全量同步的 RDB 越大。
- `fork`、COW、网络传输和加载时间越长。
- replica 追赶期间积累的命令越多。
- 故障恢复 RTO 越长。

应通过合理分片、内存上限和容量规划控制单节点规模。

### 12.2 合理增大 backlog

backlog 应覆盖常见网络抖动和滚动重启时间，避免短暂断线退化为全量同步。

不要盲目设置：

- 太小：频繁全量同步。
- 太大：浪费 master 内存。
- 应基于峰值复制流量和最长断线时间计算。

### 12.3 评估无盘复制

磁盘慢、网络快时可考虑：

```conf
repl-diskless-sync yes
repl-diskless-sync-delay 5
```

但仍需压测网络、COW 内存和多个 replica 同步时的表现。

### 12.4 限制直接 replica 数量

大量 replica 同时直接连接 master 会增加：

- 网络输出。
- 每个 replica 的客户端输出缓冲区。
- 心跳和状态维护。
- 故障时的同步风暴。

可以采用级联复制降低 master 压力，但要评估多一跳延迟和级联上游故障的影响。

### 12.5 避免同步风暴

- 分批重启 replica。
- 配合 `repl-diskless-sync-delay` 合并相近的同步请求。
- 不让大量 replica 在同一时间失联和重连。
- 监控全量同步次数与网络出口带宽。
- Sentinel 中合理配置并行同步数量，避免故障转移后所有 replica 同时加载。

---

## 13. 监控与排障

### 13.1 查看复制状态

```bash
redis-cli INFO replication
redis-cli ROLE
```

master 侧重点：

- `role`
- `connected_slaves`：为兼容保留的旧字段名，表示已连接 replica 数。
- `master_replid`
- `master_replid2`
- `master_repl_offset`
- `second_repl_offset`
- `repl_backlog_active`
- `repl_backlog_size`
- `repl_backlog_first_byte_offset`
- `repl_backlog_histlen`

replica 侧重点：

- `master_host`
- `master_port`
- `master_link_status`
- `master_last_io_seconds_ago`
- `master_sync_in_progress`
- `slave_repl_offset`：兼容旧协议保留的字段名。
- `slave_read_repl_offset`
- `master_link_down_since_seconds`

还应结合：

```bash
redis-cli INFO persistence
redis-cli INFO memory
redis-cli INFO stats
redis-cli LATENCY DOCTOR
```

### 13.2 常见故障判断表

| 现象 | 可能原因 | 检查与处理 |
|---|---|---|
| `master_link_status:down` | 网络、认证、TLS、超时或 master 不可达 | 检查网络、日志、`masterauth`、ACL 和 TLS |
| 频繁全量同步 | backlog 太小、断线太久、复制历史变化 | 查看 backlog 范围和同步日志，调整容量 |
| replica 长时间追不上 | 写入过快、CPU 不足、网络慢 | 比较 offset、CPU、带宽和命令执行速度 |
| master 内存突增 | RDB/COW、输出缓冲区或 backlog 较大 | 查看 COW、客户端缓冲和 backlog 配置 |
| master 延迟抖动 | `fork`、磁盘 I/O、网络发送压力 | 查看 `latest_fork_usec`、延迟监控和磁盘 |
| replica 全量同步时不可用 | 正在清空并加载 RDB | 调整健康检查、同步策略和读流量摘除 |
| master 重启后所有数据消失 | 未开启持久化却自动重启 | 立即停止复制扩散，恢复备份，修正启动策略 |
| 故障转移后少量数据丢失 | 异步复制尚未到达被提升 replica | 评估 `WAIT`、min-replicas、持久化和业务补偿 |

---

## 14. 生产配置示例

以下仅作为思路示例，不能直接替代压测和容量规划。

### Master

```conf
# 持久化
appendonly yes
appendfsync everysec
save 3600 1

# 部分同步窗口
repl-backlog-size 1gb
repl-backlog-ttl 3600

# 全量同步
repl-diskless-sync yes
repl-diskless-sync-delay 5

# 限制失去副本后的孤立写入
min-replicas-to-write 1
min-replicas-max-lag 10
```

### Replica

```conf
replicaof 192.168.10.10 6379
masterauth your-password

replica-read-only yes
replica-serve-stale-data yes

# 作为可能被提升的新 master，通常也应具备持久化能力
appendonly yes
appendfsync everysec
```

部署时还要补充：

- ACL 或密码配置。
- TLS 复制链路。
- 主机地址通告与 NAT 环境配置。
- Sentinel 或 Cluster 故障转移。
- 跨可用区延迟与带宽评估。
- 备份、告警和恢复演练。

---

## 参考资料

- [Redis 官方：Replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [Redis 官方：Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis 官方：INFO](https://redis.io/docs/latest/commands/info/)
- [Redis 官方：WAIT](https://redis.io/docs/latest/commands/wait/)
- [Redis 官方：Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
- [Redis 官方：Administration](https://redis.io/docs/latest/operate/oss_and_stack/management/admin/)
