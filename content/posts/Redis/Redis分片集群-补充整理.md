---
title: Redis Cluster 完全指南：分片原理、扩缩容与故障转移
published: 2026-07-30
description: 深入讲解 Redis Cluster 的 Hash Slot、Hash Tag、MOVED 与 ASK
  路由机制，覆盖集群搭建、在线扩缩容、故障转移、数据一致性、客户端接入及生产排障。
tags:
  - Redis
  - Redis Cluster
  - 分片集群
  - Hash Slot
  - 故障转移
category: Redis
draft: false
pinned: false
comments: true
id: post-2362c6c1cf
permalink: /posts/redis/redis分片集群-补充整理/
image: hello
author: Aron
---

> 讲义实验环境使用 Redis 6.2.4；本文同时说明 Redis 7.x/8.x 中仍适用的核心机制。具体命令和配置应以生产版本的官方文档为准。  

## 1. 为什么需要 Redis Cluster

普通主从复制和 Sentinel 可以解决：

- master 故障后的自动切换。
- 通过 replica 扩展部分读取能力。
- 提供在线数据副本。

但它们仍然只有一个逻辑写 master，存在两个主要瓶颈：

1. **容量瓶颈**：所有数据必须能放入单个 master 的内存。
2. **写入瓶颈**：所有写请求仍由单个 master 处理。

Redis Cluster 将完整键空间拆分给多个 master：

- 不同 master 保存不同数据。
- 多个 master 可以并行处理读写请求。
- 每个 master 可以配置一个或多个 replica。
- master 故障后，其 replica 可以自动提升。
- 增加 master 并迁移一部分槽位后，可以水平扩展容量和吞吐。

一句话概括：

> Redis Cluster 通过固定的 16384 个 Hash Slot 对数据进行分片，并通过主从复制、Gossip 和多数派选举提供分片级高可用。

---

## 2. Sentinel 与 Redis Cluster 的区别

| 对比项 | Sentinel 主从架构 | Redis Cluster |
|---|---|---|
| 数据分布 | 所有 master/replica 保存同一份数据 | 不同 master 保存不同槽位的数据 |
| 写 master 数量 | 一个 | 多个 |
| 水平扩展写能力 | 不支持 | 支持 |
| 水平扩展容量 | 不支持 | 支持 |
| 自动故障转移 | 支持 | 支持 |
| 服务发现 | Sentinel 提供当前 master 地址 | Cluster 客户端维护槽位到节点映射 |
| 多 key 命令 | 单机语义 | 所有 key 通常必须属于同一槽位 |
| 数据库 | 支持多个逻辑 DB | 只支持 DB 0 |
| 适用场景 | 单 master 容量和写吞吐足够 | 数据量或写吞吐需要多 master 分担 |

Redis Cluster 不是“多个互为主节点、每个节点都有全部数据”的多主复制系统。每个 master 只负责部分槽位。

---

## 3. 集群基本结构

一个常见的六节点集群：

```text
                    Redis Cluster

        Shard A          Shard B          Shard C
    ┌────────────┐   ┌────────────┐   ┌────────────┐
    │ Master A   │   │ Master B   │   │ Master C   │
    │ slots      │   │ slots      │   │ slots      │
    │ 0-5460     │   │ 5461-10922 │   │10923-16383 │
    └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
          │复制              │复制              │复制
    ┌─────▼──────┐   ┌─────▼──────┐   ┌─────▼──────┐
    │ Replica A1 │   │ Replica B1 │   │ Replica C1 │
    └────────────┘   └────────────┘   └────────────┘

    所有节点通过 Cluster Bus 组成全连接拓扑，
    交换心跳、Gossip、槽位配置和故障转移消息。
```

### 3.1 Shard 的含义

一个逻辑分片通常由：

- 一个负责槽位和读写的 master。
- 零个、一个或多个保存该 master 数据副本的 replica。

```text
Shard = Master + Replicas
```

replica 默认不负责该分片的业务写入。master 故障后，合格 replica 可以通过集群选举被提升。

### 3.2 最小与推荐节点数

Redis 官方文档指出：

- 正常工作的最小集群需要至少 3 个 master。
- 生产通常至少使用 3 master + 3 replica。

三个 master 的原因：

- 故障确认和 replica 提升需要 master 多数派参与。
- 两个 master 无法形成稳健的多数派容错结构。

六节点也不是所有生产系统的固定答案。实际副本数还取决于：

- 可用区数量。
- 允许的故障范围。
- 数据恢复目标。
- 内存成本。
- 跨可用区网络质量。

### 3.3 故障域部署

生产建议：

- 同一 shard 的 master 与 replica 不部署在同一宿主机。
- replica 尽量位于不同机架或可用区。
- 不要把三个 master 全部放在同一故障域。
- 节点之间的客户端端口和 Cluster Bus 端口都必须互通。
- 客户端必须能访问集群通告出来的所有节点地址。

---

## 4. Hash Slot 数据分片模型

Redis Cluster 不使用传统的一致性哈希环，而是把键空间划分为固定的 16384 个槽位：

```text
slot 范围：0 ～ 16383
槽位总数：16384
```

每个槽位在同一时刻由一个 master 负责。

```text
Key
 │
 ├─提取有效哈希内容
 │
 ├─CRC16
 │
 ├─对 16384 取模
 │
 ↓
Hash Slot
 │
 ↓
负责该槽位的 Master
```

基本计算公式：

```text
slot = CRC16(key) mod 16384
```

也可以写成：

```text
slot = CRC16(key) & 16383
```

### 4.1 Key 绑定的是槽位，不是物理节点

需要理解：

- key 经过哈希计算后属于某个 slot。
- slot 当前归某个 master 管理。
- 扩缩容时迁移的是 slot 及其 key。
- key 的 slot 通常不会变化，但 slot 的负责节点可以变化。

因此客户端维护的是：

```text
slot → master 地址
```

而不是：

```text
key → 永久固定节点
```

### 4.2 查看 key 的槽位

```redis
CLUSTER KEYSLOT user:1001
```

示例：

```redis
CLUSTER KEYSLOT foo{order:1001}
CLUSTER KEYSLOT bar{order:1001}
```

两者使用相同 Hash Tag，返回相同 slot。

---

## 5. Hash Tag：让相关 key 落在同一槽位

如果 key 中存在第一个有效的 `{...}` 结构，Redis 只对大括号中的非空内容计算哈希。

```text
普通 key：
user:1001:name
有效哈希内容 = user:1001:name

Hash Tag key：
user:{1001}:name
user:{1001}:orders
有效哈希内容都为 1001
```

这两个 key 会落在同一槽位：

```text
user:{1001}:profile
order:{1001}:recent
```

### 5.1 精确规则

只有同时满足以下条件才使用 Hash Tag：

1. key 包含 `{`。
2. 在该 `{` 右侧存在 `}`。
3. 第一个匹配的 `{` 和其右侧第一个 `}` 之间至少有一个字符。

| Key | 实际参与哈希的内容 |
|---|---|
| `user:1001` | 整个 `user:1001` |
| `{user1001}.name` | `user1001` |
| `{user1001}.orders` | `user1001` |
| `foo{}{bar}` | 整个 key，因为第一个 `{}` 为空 |
| `foo{{bar}}zap` | `{bar` |
| `foo{bar}{zap}` | `bar` |

### 5.2 Hash Tag 的用途

Hash Tag 主要用于：

- 让多 key 命令中的所有 key 位于同一槽位。
- 让 Lua 脚本或事务涉及的 key 位于同一槽位。
- 将同一业务聚合的相关数据放入同一个 shard。

示例：

```redis
MSET order:{1001}:status paid order:{1001}:amount 99
MGET order:{1001}:status order:{1001}:amount
```

### 5.3 Hash Tag 的风险

Hash Tag 不是越多越好。设计不当会产生热点：

```text
所有商品 key 都使用 {product}
                 ↓
所有商品落入同一个 slot
                 ↓
一个 master 承担绝大多数流量和内存
```

建议：

- Tag 颗粒度使用租户 ID、用户 ID、订单 ID 等业务聚合标识。
- 不要让所有业务 key 共享同一个 Tag。
- 在保证多 key 原子操作的同时保持槽位分布均衡。
- 监控 hot key、big key 和各 master 的内存、QPS 差异。

---

## 6. 多 Key 命令与 CROSSSLOT

Redis Cluster 的服务器端多 key 操作通常要求所有 key 属于同一槽位。

错误示例：

```redis
MGET user:1 user:2
```

如果两个 key 不在同一槽位，可能返回：

```text
CROSSSLOT Keys in request don't hash to the same slot
```

使用 Hash Tag：

```redis
MGET {user}:1 {user}:2
```

两个 key 对 `{user}` 哈希，可以在同一槽位执行。

### 6.1 受影响的操作

需要特别检查：

- `MGET`、`MSET`
- 集合的交、并、差运算
- `RENAME`、`RENAMENX`
- 事务 `MULTI/EXEC`
- Lua 脚本和 Redis Functions
- 涉及多个 key 的阻塞命令
- pipeline 中要求服务端原子或同节点执行的业务

有些客户端会把部分跨槽操作拆成多次单 key 请求并在客户端合并结果，但这会改变：

- 原子性。
- 网络开销。
- 错误语义。
- 返回时延。

不能因为客户端“能够执行”就假定它仍等同于单机上的一个原子命令。

### 6.2 Lua 脚本和事务

脚本或事务所访问的 key 应：

- 在调用时显式声明。
- 全部属于同一槽位。
- 不要在脚本内部动态拼接并访问未知跨槽 key。

典型分布式锁的锁 key、状态 key 和 fencing token 如需同一脚本操作，应使用相同 Hash Tag。

---

## 7. 节点通信与 Cluster Bus

Redis Cluster 节点之间不通过普通客户端协议完成所有集群协作，而是使用专门的二进制 Cluster Bus。

默认情况下：

```text
客户端端口：6379
Cluster Bus：16379，即客户端端口 + 10000
```

如果节点客户端端口为 7001：

```text
客户端端口：7001
Cluster Bus：17001
```

也可以通过配置显式指定 Bus 端口：

```conf
cluster-port 17001
```

### 7.1 Cluster Bus 用途

- 节点握手和自动发现。
- PING/PONG 心跳。
- Gossip 故障信息传播。
- 槽位映射和配置纪元传播。
- master 故障确认。
- replica 选举与提升。
- Pub/Sub 和其他集群内部消息。

### 7.2 全连接拓扑

集群节点之间维持全连接关系：

```text
N 个节点中，每个节点维护到其他节点的连接。
```

业务客户端不应直接使用 Cluster Bus 协议；客户端只连接普通 Redis 数据端口。

### 7.3 防火墙要求

每个节点至少需要：

- 客户端数据端口对客户端和集群节点开放。
- Cluster Bus 端口对其他集群节点开放。

如果只开放数据端口、不开放 Bus 端口：

- 单节点可能仍能被 `redis-cli` 连接。
- 但节点无法正常交换集群消息。
- 故障检测、槽位传播和故障转移会异常。

Cluster Bus 端口不应暴露到不可信公网。

---

## 8. 节点标识、拓扑与配置纪元

### 8.1 Node ID

每个 Cluster 节点都有持久化 Node ID，例如：

```text
07c37dfeb235213a872192d90877d0cd55635b91
```

Node ID：

- 在节点首次启动时生成。
- 存储在集群配置文件中。
- 节点地址改变时通常仍保持不变。
- 用于复制关系、槽位归属和集群命令。

### 8.2 nodes.conf

配置示例：

```conf
cluster-config-file nodes-7001.conf
```

该文件由 Redis 自动维护，保存：

- Node ID。
- 已知节点。
- master/replica 关系。
- 槽位归属。
- 配置纪元。
- 故障和迁槽状态。

注意：

- 不应手工编辑 `nodes.conf`。
- 每个 Redis 进程必须使用独立文件。
- 文件所在目录必须可写。
- 同一主机多个实例不能共用一个 `nodes.conf`。
- 删除或错误复制该文件可能改变节点身份并破坏拓扑。

### 8.3 configEpoch

`configEpoch` 是槽位配置的逻辑版本：

- 故障转移会生成新的、递增且唯一的配置纪元。
- 如果多个节点声称拥有同一槽位，较新的配置纪元优先。
- 网络分区恢复后，旧节点会接受更新的槽位配置。

---

## 9. 请求路由：MOVED 与 ASK

讲义中“访问任意节点，最终会被转发到正确节点”的说法需要更精确地理解：

> Redis Cluster 节点通常不会像代理一样替客户端转发业务请求，而是返回重定向错误；Cluster 客户端根据错误重新连接正确节点。

### 9.1 MOVED：永久槽位归属重定向

客户端向错误节点发送：

```redis
GET order:1001
```

节点可能返回：

```text
-MOVED 3999 192.168.150.102:7002
```

含义：

- key 属于 slot 3999。
- slot 3999 当前由 `192.168.150.102:7002` 负责。
- 客户端应向该节点重新发送命令。
- 客户端应更新本地槽位映射。

```text
Client ──GET key──→ Node A
Client ←─MOVED──── Node A
Client ──GET key──→ Node B
Client ←─value──── Node B
```

### 9.2 ASK：迁槽期间的一次性重定向

槽位正在从 A 迁移到 B 时，部分 key 已在 B，部分仍在 A。

源节点可能返回：

```text
-ASK 3999 192.168.150.102:7002
```

客户端应：

1. 只把当前这一次命令发送到 B。
2. 先向 B 发送 `ASKING`。
3. 再发送原命令。
4. 不要立即永久修改本地 slot 映射。

```text
Client ──GET key──→ Node A
Client ←──ASK───── Node A
Client ──ASKING──→ Node B
Client ──GET key──→ Node B
Client ←─value──── Node B
```

### 9.3 MOVED 与 ASK 对比

| 对比项 | MOVED | ASK |
|---|---|---|
| 含义 | 槽位已归另一个节点负责 | 槽位正在迁移，本次命令临时去目标节点 |
| 是否更新客户端槽位表 | 是，通常刷新完整拓扑 | 否 |
| 是否先发送 `ASKING` | 否 | 是 |
| 常见时机 | 正常路由错误、故障转移后 | 在线 reshard 期间 |

### 9.4 redis-cli 的 `-c`

普通连接：

```bash
redis-cli -p 7001
```

收到 `MOVED` 后只会显示错误。

Cluster 跟随重定向模式：

```bash
redis-cli -c -p 7001
```

`-c` 会帮助命令行客户端处理重定向。生产应用仍应使用真正支持 Redis Cluster 的客户端。

---

## 10. Cluster 客户端应如何工作

Cluster 客户端通常维护：

```text
16384 个槽位 → 当前 master 地址
```

启动流程：

1. 连接任意一个可用的 seed 节点。
2. 获取当前 shard 和槽位映射。
3. 根据 key 在客户端计算 slot。
4. 直接把命令发送到负责该 slot 的节点。
5. 收到 `MOVED` 时刷新槽位映射。
6. 收到 `ASK` 时完成一次性重定向。
7. 节点故障或拓扑变化后重新建立连接。

较新客户端和运维工具应优先使用：

```redis
CLUSTER SHARDS
```

`CLUSTER SLOTS` 已被标记为弃用，但为了兼容旧客户端仍广泛存在。

### 10.1 Seed 节点

客户端配置中的节点列表是启动入口，不是静态完整拓扑。

建议：

- 配置多个位于不同故障域的 seed 节点。
- 不必在所有客户端中列出每一个节点，但不能只依赖一个节点。
- 客户端发现的节点地址必须从客户端网络可达。
- 故障转移和扩容后允许客户端刷新拓扑。

---

## 11. 核心配置

实验节点的基本配置：

```conf
port 7001

cluster-enabled yes
cluster-config-file nodes-7001.conf
cluster-node-timeout 5000

dir /var/lib/redis/7001

appendonly yes
appendfsync everysec
```

### 11.1 配置项说明

| 配置项 | 作用 | 注意事项 |
|---|---|---|
| `cluster-enabled yes` | 开启 Cluster 模式 | 每个集群节点都要配置 |
| `cluster-config-file` | Redis 自动维护的集群状态文件 | 每个实例必须独立且可写 |
| `cluster-node-timeout` | 节点不可达和故障处理的基础超时 | 应明显大于正常网络 RTT |
| `cluster-port` | 显式指定 Cluster Bus 端口 | 不指定时通常为数据端口 + 10000 |
| `cluster-require-full-coverage` | 是否要求所有槽位都可用时集群才接受请求 | 默认倾向完整覆盖 |
| `cluster-replica-validity-factor` | 控制断链过久的 replica 是否仍可自动提升 | 设为 0 会放宽新鲜度限制 |
| `cluster-migration-barrier` | replica 自动迁移后原 master 至少保留的健康副本数 | 常见默认值为 1 |
| `cluster-replica-no-failover` | 禁止该 replica 自动参与故障转移 | 灾备拓扑中可能使用 |

### 11.2 不要照搬实验安全配置

讲义实验中使用：

```conf
bind 0.0.0.0
protected-mode no
```

这只适合隔离实验环境。生产应：

- 绑定明确的内网地址。
- 保持保护机制。
- 配置 ACL 和强密码。
- 使用防火墙限制客户端端口。
- Cluster Bus 只允许集群节点访问。
- 跨不可信网络时启用 TLS。

---

## 12. NAT、容器与地址通告

Redis Cluster 客户端会根据节点通告的地址直连所有 master。容器内部地址或 NAT 后错误地址会导致：

- 客户端能连接 seed，但无法连接其他节点。
- 不断收到 `MOVED` 后连接失败。
- 节点之间 Cluster Bus 无法建立连接。

常见配置：

```conf
cluster-announce-ip 192.168.150.101
cluster-announce-port 7001
cluster-announce-bus-port 17001
```

每个节点都应通告：

- 其他集群节点可访问的地址。
- 业务客户端可访问的地址。
- 与端口映射一致的数据端口和 Bus 端口。

讲义中的 `replica-announce-ip` 主要属于复制地址通告；Redis Cluster 的客户端和 Bus 地址应重点检查 `cluster-announce-*` 配置。

---

## 13. 创建一个六节点集群

实验拓扑：

| 节点 | 初始角色 | 说明 |
|---|---|---|
| `192.168.150.101:7001` | master | Shard A |
| `192.168.150.101:7002` | master | Shard B |
| `192.168.150.101:7003` | master | Shard C |
| `192.168.150.101:8001` | replica | 复制某个 master |
| `192.168.150.101:8002` | replica | 复制某个 master |
| `192.168.150.101:8003` | replica | 复制某个 master |

创建前要求：

- 所有节点为空。
- 所有节点已开启 Cluster 模式。
- 节点之间的数据端口和 Bus 端口互通。
- 使用独立工作目录和 `nodes.conf`。
- 节点的通告地址正确。

Redis 5.0 及以后：

```bash
redis-cli --cluster create \
  192.168.150.101:7001 \
  192.168.150.101:7002 \
  192.168.150.101:7003 \
  192.168.150.101:8001 \
  192.168.150.101:8002 \
  192.168.150.101:8003 \
  --cluster-replicas 1
```

`--cluster-replicas 1` 表示希望每个 master 配置一个 replica。

创建后检查：

```bash
redis-cli -p 7001 CLUSTER INFO
redis-cli -p 7001 CLUSTER NODES
redis-cli -p 7001 CLUSTER SHARDS
redis-cli --cluster check 192.168.150.101:7001
```

健康集群应满足：

- `cluster_state:ok`。
- 0～16383 所有槽位均已分配。
- 三个 master 分别持有槽位。
- 每个 master 至少有预期 replica。
- 所有节点的 `link-state` 正常。

---

## 14. 查看集群状态

### 14.1 CLUSTER INFO

```redis
CLUSTER INFO
```

常见字段：

| 字段 | 含义 |
|---|---|
| `cluster_state` | 当前节点看到的集群总体状态 |
| `cluster_slots_assigned` | 已分配槽位数 |
| `cluster_slots_ok` | 正常槽位数 |
| `cluster_slots_pfail` | 关联 PFAIL 节点的槽位数 |
| `cluster_slots_fail` | 关联 FAIL 节点的槽位数 |
| `cluster_known_nodes` | 当前已知节点数 |
| `cluster_size` | 至少负责一个槽位的 master 数 |
| `cluster_current_epoch` | 当前集群配置纪元 |
| `cluster_my_epoch` | 当前节点的配置纪元 |
| `cluster_stats_messages_*` | Cluster Bus 消息统计 |

### 14.2 CLUSTER NODES

```redis
CLUSTER NODES
```

每行包含：

```text
node-id endpoint flags master-id ping-sent pong-recv config-epoch link-state slots
```

常见 flags：

| flag | 含义 |
|---|---|
| `myself` | 当前查询节点 |
| `master` | master |
| `slave` | 协议兼容字段，表示 replica |
| `fail?` | PFAIL，当前节点怀疑其故障 |
| `fail` | FAIL，故障已被足够 master 确认 |
| `handshake` | 正在进行节点握手 |
| `noaddr` | 地址未知 |
| `nofailover` | replica 不参与自动提升 |

### 14.3 CLUSTER SHARDS

```redis
CLUSTER SHARDS
```

用于查看：

- shard 的槽位范围。
- master 节点。
- replica 节点。
- 节点 endpoint、角色和健康状态。

它比手工解析 `CLUSTER NODES` 更适合新客户端获取拓扑。

---

## 15. 在线扩容：添加 master 并迁移槽位

新 master 加入集群后默认没有槽位，因此也不会承载普通 key。

### 15.1 添加空节点

```bash
redis-cli --cluster add-node \
  192.168.150.101:7004 \
  192.168.150.101:7001
```

参数含义：

- 第一个地址是新节点。
- 第二个地址是集群中任意一个可达的已有节点。

检查：

```bash
redis-cli -p 7001 CLUSTER NODES
```

此时 7004 通常是：

```text
master，0 slots
```

### 15.2 迁移槽位

交互式 reshard：

```bash
redis-cli --cluster reshard 192.168.150.101:7001
```

需要指定：

1. 迁移多少个槽位。
2. 接收槽位的新 master Node ID。
3. 从哪些源 master 迁移。

也可以在自动化中提供对应 `--cluster-*` 参数，但生产迁移前应先在目标版本的 `redis-cli --cluster help` 中确认语法。

### 15.3 槽位迁移的内部状态

假设 slot 2765 从 A 迁移到 B：

```text
1. B 将 2765 标记为 IMPORTING，来源 A
2. A 将 2765 标记为 MIGRATING，目标 B
3. 从 A 获取该槽位中的 key
4. 使用 MIGRATE 将 key 原子地移动到 B
5. B 成为 2765 的正式 owner
6. A 和其他 master 更新 slot 2765 的归属
```

底层涉及：

```redis
CLUSTER SETSLOT 2765 IMPORTING <source-node-id>
CLUSTER SETSLOT 2765 MIGRATING <target-node-id>
CLUSTER GETKEYSINSLOT 2765 100
MIGRATE ...
CLUSTER SETSLOT 2765 NODE <target-node-id>
```

通常应使用 `redis-cli --cluster reshard`，避免人工执行底层命令时顺序错误。

### 15.4 迁移期间的请求行为

源节点 A：

- key 仍在 A：直接处理。
- key 已经迁走或新 key 不在 A：返回 `ASK` 到 B。

目标节点 B：

- 收到普通请求但尚未正式拥有槽位：通常返回 `MOVED`。
- 收到 `ASKING` 后的请求：允许处理该导入槽位的当前命令。

### 15.5 迁槽风险

- big key 会延长单次迁移阻塞和网络传输时间。
- 热点槽位迁移时重定向和延迟可能增加。
- 多 key 命令在相关槽位迁移时可能返回 `TRYAGAIN`。
- 源和目标节点的内存峰值需要预留。
- 客户端必须正确支持 `ASK`。
- 迁移中断可能留下 `MIGRATING`/`IMPORTING` 状态。

迁移前应治理 big key，并在低峰期分批执行。

---

## 16. 添加 replica

添加新的 replica：

```bash
redis-cli --cluster add-node \
  192.168.150.101:8004 \
  192.168.150.101:7001 \
  --cluster-slave
```

如果要指定复制某个 master：

```bash
redis-cli --cluster add-node \
  192.168.150.101:8004 \
  192.168.150.101:7001 \
  --cluster-slave \
  --cluster-master-id <master-node-id>
```

也可以先把节点作为空 master 加入，再在新节点执行：

```redis
CLUSTER REPLICATE <master-node-id>
```

添加后确认：

```redis
CLUSTER NODES
CLUSTER REPLICAS <master-node-id>
INFO REPLICATION
```

---

## 17. 缩容与删除节点

### 17.1 删除 replica

```bash
redis-cli --cluster del-node \
  192.168.150.101:7001 \
  <replica-node-id>
```

### 17.2 删除 master

master 必须先清空其槽位：

1. 将该 master 的所有槽位 reshard 到其他 master。
2. 确认它不再负责任何 slot。
3. 确认业务客户端拓扑已经刷新。
4. 再执行 `del-node`。

```bash
redis-cli --cluster del-node \
  192.168.150.101:7001 \
  <empty-master-node-id>
```

不能直接删除仍持有槽位的 master。

### 17.3 删除不可达故障节点

故障节点不可连接时，普通 `del-node` 可能失败。可以根据实际版本和场景对每个节点执行：

```redis
CLUSTER FORGET <node-id>
```

或使用：

```bash
redis-cli --cluster call \
  192.168.150.101:7001 \
  CLUSTER FORGET <node-id>
```

执行前必须确认：

- 故障节点不会带着旧配置重新加入。
- 其槽位已经由新 master 正式接管。
- 集群中所有节点最终都忘记了该 Node ID。

---

## 18. 负载均衡与 Rebalance

增加 master 后只“加入节点”不会自动平均迁移全部槽位。

可使用：

```bash
redis-cli --cluster rebalance 192.168.150.101:7001
```

Rebalance 的目标通常是按节点权重重新分配槽位数量。

但槽位数量均衡不等于负载均衡：

```text
每个 Master 槽位数相同
≠
每个 Master 的 key 数、内存、QPS 和网络流量相同
```

原因：

- 不同 slot 的 key 数量不同。
- key 大小差异巨大。
- 某些 key 或 Tag 是热点。
- 不同数据结构的 CPU 成本不同。

真正的均衡应同时观察：

- 槽位数。
- key 数。
- 内存使用量。
- QPS。
- CPU。
- 网络带宽。
- 命令延迟。
- hot key 和 big key。

---

## 19. 自动故障检测：PFAIL 与 FAIL

Redis Cluster 不依赖 Sentinel。所有 Cluster 节点通过 Cluster Bus 自行完成故障检测。

### 19.1 PFAIL

PFAIL 表示 Possible Failure：

> 某个节点根据自己的本地观察，认为另一个节点超过 `cluster-node-timeout` 没有正常响应。

```text
单个节点的本地主观判断 → PFAIL
```

master 和 replica 都可以把其他节点标记为 PFAIL。

### 19.2 FAIL

PFAIL 不足以触发 replica 提升。故障报告通过 Gossip 传播，当足够多的 master 在有效时间窗口内确认目标不可达时，目标进入 FAIL。

```text
多数 master 的有效故障报告 → FAIL
```

### 19.3 与 Sentinel 的类比

| Sentinel | Redis Cluster |
|---|---|
| SDOWN | PFAIL |
| ODOWN | FAIL |
| Sentinel 多数派授权 | master 多数派参与 replica 选举 |

二者概念相似，但协议、角色和实现并不相同。

---

## 20. 自动故障转移

假设 Master B 故障，它负责一部分槽位并拥有 Replica B1。

```text
Master B 失联
    │
    ↓
部分节点标记 PFAIL
    │
    ↓
多数 master 确认 FAIL
    │
    ↓
Replica B1 发起选举
    │
    ↓
获得 master 多数派授权
    │
    ↓
B1 提升为新 Master
    │
    ↓
新 configEpoch 和槽位归属传播
```

### 20.1 replica 参与提升的基本条件

- 它的 master 已处于 FAIL。
- 原 master 负责至少一个槽位。
- replica 与 master 断链没有久到超过允许的新鲜度范围。
- replica 未被配置为禁止故障转移。
- 它能联系到足够 master 并获得选票。

### 20.2 数据更新程度与选举延迟

同一 master 的多个 replica 会根据复制进度形成不同的选举延迟：

- offset 越新，通常越早尝试选举。
- offset 较旧，延迟更长。
- 最终只有一个 replica 获得多数 master 授权。

这与 Sentinel 中按 `replica-priority → offset → run ID` 选择候选节点的流程不同。

### 20.3 configEpoch 的作用

新 master 获得新的配置纪元并广播：

- 自己现在负责原 master 的槽位。
- 其他节点采用更新的槽位配置。
- 旧 master 恢复后不能用旧配置夺回槽位。

---

## 21. 集群何时不可用

默认安全取向下，常见不可用条件包括：

- 大多数 master 不可达，集群处于少数派分区。
- 某个 master 和它的所有可提升 replica 同时不可用。
- 存在未覆盖槽位，并要求 full coverage。
- 节点之间 Cluster Bus 被阻断。
- 槽位配置冲突或迁移状态异常。

### 21.1 cluster-require-full-coverage

```conf
cluster-require-full-coverage yes
```

当任意槽位没有可用 owner 时，集群倾向停止接受查询，避免向客户端呈现不完整键空间。

设置为 `no` 时，仍有 owner 的槽位可以继续服务，但应用会得到“部分 key 可用、部分 key 不可用”的状态。

取舍：

| 配置 | 优点 | 风险 |
|---|---|---|
| `yes` | 语义明确，不返回不完整键空间 | 单个 shard 丢失可能使整个集群不可用 |
| `no` | 健康 shard 可继续服务 | 应用必须能处理部分可用和跨槽操作失败 |

不能只为了“高可用”就盲目改为 `no`，应根据业务是否能接受部分数据不可用来决定。

---

## 22. 手动故障转移

在准备提升的 replica 上执行：

```redis
CLUSTER FAILOVER
```

适合：

- 滚动升级。
- 主机维护。
- 主动切换主从。
- 将业务平滑迁离某个 master。

### 22.1 默认模式

```redis
CLUSTER FAILOVER
```

简化流程：

1. replica 请求 master 暂停处理客户端写入。
2. master 把当前复制 offset 告诉 replica。
3. replica 等待自己追平该 offset。
4. replica 向其他 master 请求故障转移授权和新配置纪元。
5. replica 提升为 master 并广播配置。
6. 原 master 接受新配置并成为 replica。

默认模式最重视数据一致性，适合计划内切换。

### 22.2 FORCE

```redis
CLUSTER FAILOVER FORCE
```

- 不与原 master 协调。
- 适用于原 master 无法访问，但集群仍可形成故障转移授权的情况。
- 仍需要 Cluster 的多数派授权。
- 可能丢失 replica 尚未收到的写入。

### 22.3 TAKEOVER

```redis
CLUSTER FAILOVER TAKEOVER
```

- 跳过与原 master 的协调。
- 还绕过正常的集群多数派授权。
- 可能违反正常配置纪元和“最后一次故障转移获胜”的安全原则。
- 只应在明确理解网络分区和数据冲突风险时使用。

对比：

| 模式 | 原 master 协调 | offset 追平 | 多数派授权 | 风险 |
|---|---:|---:|---:|---|
| 默认 | 是 | 是 | 是 | 最低 |
| `FORCE` | 否 | 不保证 | 是 | 可能丢数据 |
| `TAKEOVER` | 否 | 不保证 | 否 | 最高，可能造成冲突 |

命令返回 `OK` 只表示故障转移已被调度，不等于已经成功。之后必须检查：

```redis
ROLE
INFO REPLICATION
CLUSTER NODES
CLUSTER SHARDS
```

---

## 23. Replica Migration

Redis Cluster 可以把 replica 从“副本过多的 master”迁移给“没有健康副本的 master”，提高后续故障的可恢复性。

示例：

```text
Master A：0 个 Replica
Master B：1 个 Replica
Master C：2 个 Replica

在满足迁移屏障条件时，
Master C 的一个 Replica 可自动改为复制 Master A。
```

相关配置：

```conf
cluster-migration-barrier 1
```

值为 `1` 通常表示只有当原 master 在迁走一个 replica 后仍至少保留一个健康 replica，迁移才会发生。

Replica Migration 改变的是副本归属，不是业务槽位归属。

---

## 24. 数据一致性与丢失窗口

Redis Cluster 的 shard 内仍使用异步主从复制。

可能丢数据的基本场景：

```text
Client ──写入──→ Master
Client ←─OK──── Master
                   │
                   │ 尚未复制到 Replica
                   × Master 故障

Replica 被提升，但缺少刚才的写入。
```

### 24.1 少数派分区中的旧 master

如果客户端仍能访问处于少数派网络中的旧 master，它可能在一段时间内接受写入。多数派一侧完成故障转移后，旧 master 恢复连接并采用新配置，少数派期间的独有写入可能丢失。

可以在所有可能成为 master 的节点配置：

```conf
min-replicas-to-write 1
min-replicas-max-lag 10
```

以限制无法连接足够 replica 的 master 继续写入的时间窗口。

代价是 replica 或网络异常时 master 可能拒绝写入。

### 24.2 WAIT

关键写入可以评估：

```redis
SET order:{1001}:status paid
WAIT 1 1000
```

`WAIT` 能提高写入已经到达 replica 的概率，但不能：

- 将 Redis 变成强一致数据库。
- 保证写入已经按要求落盘。
- 替代 RDB、AOF 和独立备份。
- 消除网络分区中的全部数据丢失风险。

---

## 25. 持久化与备份

每个 master 只保存一部分数据，因此每个 shard 都必须有独立的数据保护。

建议所有可能成为 master 的节点启用合适的持久化，例如：

```conf
appendonly yes
appendfsync everysec
```

并根据 RPO/RTO 配置 RDB 和集群外备份。

### 25.1 Cluster 不等于备份

- 误删 key 会通过复制传播给 replica。
- 程序错误可以同时污染所有 shard。
- `FLUSHALL`、错误脚本或错误迁槽会影响整个集群。
- 多节点在线副本无法替代历史版本备份。

备份恢复必须考虑：

- 每个 shard 的备份时间点。
- 槽位映射和 Node ID。
- 恢复到新集群还是原集群。
- 跨 shard 数据的一致时间点。
- 恢复后的重新分片和客户端切换。

---

## 26. Spring Boot 与 RedisTemplate

Spring Boot 3.x：

```yaml
spring:
  data:
    redis:
      username: app-user
      password: app-password
      cluster:
        nodes:
          - 192.168.150.101:7001
          - 192.168.150.102:7002
          - 192.168.150.103:7003
        max-redirects: 5
      connect-timeout: 2s
      timeout: 2s
```

较早 Spring Boot 版本常使用：

```yaml
spring:
  redis:
    cluster:
      nodes:
        - 192.168.150.101:7001
        - 192.168.150.101:7002
        - 192.168.150.101:7003
```

具体属性以前端项目实际 Spring Boot 版本为准。

### 26.1 Seed 节点不必列出全部节点

`cluster.nodes` 用于启动拓扑发现。客户端连接成功后会获取完整槽位和节点信息。

但建议至少配置多个不同故障域的可用入口。

### 26.2 Topology Refresh

Lettuce 客户端应具备拓扑刷新能力：

- 启动时加载拓扑。
- 收到 `MOVED` 时刷新。
- 在故障转移和伸缩后更新连接。
- 可根据客户端版本配置周期刷新或自适应刷新。

具体属性名称和默认值随 Spring Boot / Lettuce 版本变化，应以项目依赖版本文档为准。

### 26.3 Replica 读取

Lettuce 支持把部分读取路由到 replica，但要注意：

- 主从复制异步，可能读到旧数据。
- 写后立即读、锁、余额、库存等强时效业务应读 master。
- Cluster 的副本读取需要客户端支持并正确发送只读连接语义。
- replica 故障或提升后客户端必须刷新拓扑。

### 26.4 RedisTemplate 的集群操作

```java
ClusterOperations<String, Object> clusterOps =
        redisTemplate.opsForCluster();
```

集群级操作与普通 key 操作不同：

- 普通 key 命令由客户端按槽位路由。
- 查看所有节点、在指定节点执行命令等需要 Cluster API。
- 对单个节点执行 `KEYS` 只能看到该节点负责的数据。
- Spring Data Redis 的聚合集群操作可能向多个 master 并行发送命令，成本远高于单机命令。

---

## 27. 命令和功能限制

### 27.1 只支持 DB 0

Redis Cluster 不支持多个逻辑数据库：

```redis
SELECT 1
```

不可用于 Cluster。

业务隔离应使用：

- key 前缀。
- 不同集群。
- 不同 Redis 实例或托管数据库。
- ACL 权限。

### 27.2 KEYS 与 SCAN

在某个节点执行：

```redis
KEYS *
```

只能看到该节点当前保存的 key，不等于整个集群。

全集群扫描需要：

1. 获取所有 master。
2. 分别对每个 master 使用 `SCAN`。
3. 聚合结果并处理拓扑变化。

生产中不要使用 `KEYS *` 扫描大型节点。

Redis 8.0 起，某些明确包含单槽 Hash Tag 的 glob pattern 可以只扫描对应槽位，但仍需以客户端和服务端实际版本行为为准。

### 27.3 Keyspace Notification

keyspace notification 是节点本地事件，不会自动汇总整个 Cluster。监听随机单节点会漏掉其他 shard 的事件。

需要全集群事件时：

- 在所有 master 上建立订阅。
- 处理故障转移和拓扑刷新。
- 或使用更适合可靠事件传递的 Stream / 消息队列方案。

### 27.4 Pub/Sub

传统 Pub/Sub 和分片 Pub/Sub 的传播范围及路由不同。高规模 Cluster 应根据 Redis 版本评估 Sharded Pub/Sub：

```redis
SSUBSCRIBE channel
SPUBLISH channel message
```

不要把普通 Pub/Sub 当作可靠消息队列。

---

## 28. 常用运维命令

### 集群状态

```redis
CLUSTER INFO
CLUSTER NODES
CLUSTER SHARDS
CLUSTER LINKS
CLUSTER MYID
```

### 槽位与 key

```redis
CLUSTER KEYSLOT <key>
CLUSTER COUNTKEYSINSLOT <slot>
CLUSTER GETKEYSINSLOT <slot> <count>
```

### 节点与复制

```redis
CLUSTER REPLICAS <master-node-id>
CLUSTER REPLICATE <master-node-id>
ROLE
INFO REPLICATION
```

### redis-cli 集群管理

```bash
redis-cli --cluster help
redis-cli --cluster check <host:port>
redis-cli --cluster info <host:port>
redis-cli --cluster add-node <new> <existing>
redis-cli --cluster del-node <existing> <node-id>
redis-cli --cluster reshard <host:port>
redis-cli --cluster rebalance <host:port>
redis-cli --cluster fix <host:port>
```

`--cluster fix` 可能修改槽位状态和数据位置，执行前必须：

- 备份。
- 明确故障原因。
- 保存 `CLUSTER NODES`、`CLUSTER INFO` 和日志。
- 在可控窗口操作。

---

## 29. 常见故障排查

| 现象 | 常见原因 | 排查方向 |
|---|---|---|
| `MOVED` 被直接返回给应用 | 客户端不支持 Cluster 或未开启重定向 | 使用 Cluster-aware 客户端；命令行加 `-c` |
| `CROSSSLOT` | 多个 key 不在同一 slot | 用 `CLUSTER KEYSLOT` 检查，设计 Hash Tag |
| `CLUSTERDOWN Hash slot not served` | 槽位无 owner 或关联节点故障 | `CLUSTER INFO`、`CLUSTER NODES`、迁槽状态 |
| `CLUSTERDOWN The cluster is down` | 丢失多数 master、全覆盖失败或 Bus 异常 | 检查 master 多数派、槽位覆盖和 Bus 端口 |
| `TRYAGAIN` | 迁槽中的多 key 请求部分 key 已移动 | 等待迁移完成并重试 |
| 客户端能连 seed 但其他命令失败 | 节点通告了客户端不可达地址 | 检查 `cluster-announce-*`、NAT 和 DNS |
| 节点都能连接但不能组成集群 | Bus 端口被拦截或 Node ID/配置冲突 | 检查 Bus、防火墙和 `nodes.conf` |
| 新 master 加入后没有流量 | 新节点没有 slot | 执行 reshard/rebalance |
| 无法删除 master | master 仍持有槽位或 key | 先迁空所有 slot |
| master 故障但 replica 未提升 | 无多数派、replica 过旧或被禁止 failover | 查看 flags、复制状态、有效性配置 |
| 故障转移后客户端仍连接旧节点 | 拓扑刷新未生效 | 检查 `MOVED` 处理和 topology refresh |
| 各节点内存严重不均 | 槽位 key 分布不均、big key 或 Hash Tag 热点 | 比较 key/内存/QPS，不只看 slot 数 |
| 迁槽速度很慢 | big key、网络慢、目标内存压力 | 检查 key 大小、延迟和资源峰值 |
| 节点重启后变成陌生节点 | `nodes.conf` 丢失或复用了错误文件 | 恢复正确集群配置文件，检查 Node ID |

---

## 参考资料

- [Redis 官方文档：Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- [Redis 官方文档：Scale with Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/)
- [Redis 官方文档：CLUSTER FAILOVER](https://redis.io/docs/latest/commands/cluster-failover/)
- [Redis 官方文档：CLUSTER SETSLOT](https://redis.io/docs/latest/commands/cluster-setslot/)
- [Redis 官方文档：CLUSTER KEYSLOT](https://redis.io/docs/latest/commands/cluster-keyslot/)
- [Redis 官方文档：Multi-key operations](https://redis.io/docs/latest/develop/using-commands/multi-key-operations/)
- [Redis 官方配置示例：redis.conf](https://github.com/redis/redis/blob/unstable/redis.conf)
- [Spring Boot 官方文档：Common Application Properties](https://docs.spring.io/spring-boot/appendix/application-properties/)
- [Spring Data Redis 官方文档：Redis Cluster](https://docs.spring.io/spring-data/redis/reference/redis/cluster.html)
