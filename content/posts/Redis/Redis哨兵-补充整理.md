---
title: Redis Sentinel 完全指南：高可用原理、部署与故障转移
published: 2026-07-30
description: 系统讲解 Redis Sentinel 的拓扑发现、SDOWN 与
  ODOWN、quorum、领导者选举和自动故障转移，覆盖部署配置、客户端接入、数据一致性与常见故障排查。
tags:
  - Redis
  - Redis Sentinel
  - Redis哨兵
  - 高可用
  - 故障转移
category: Redis
draft: false
pinned: false
comments: true
id: post-717e4e58af
permalink: /posts/redis/redis哨兵-补充整理/
image: evening
author: Aron
---

## 1. Sentinel 解决什么问题

Redis 主从复制可以提供数据副本，但单纯的主从复制不能自动处理 master 故障：

1. 客户端通常只向 master 写入。
2. master 宕机后，replica 不会仅凭普通主从配置自动成为 master。
3. 运维人员需要判断故障、选择 replica、提升节点并通知客户端。
4. 整个过程如果依靠人工处理，恢复时间长且容易配置错误。

Redis Sentinel 在主从复制之上增加高可用能力，主要提供四项功能：

| 功能 | 说明 |
|---|---|
| 监控 Monitoring | 持续检查 master、replica 和其他 Sentinel 是否可达 |
| 通知 Notification | 通过日志、Pub/Sub 事件或脚本报告实例状态变化 |
| 自动故障转移 Automatic failover | master 故障后选择一个合适的 replica，将其提升为新 master |
| 配置提供 Configuration provider | 向客户端提供当前 master 的地址，实现服务发现 |

一句话概括：

> 主从复制负责复制数据，Sentinel 负责监控主从拓扑并在 master 故障时完成自动切换。

Sentinel 本身：

- 不保存业务数据。
- 不代理业务读写流量。
- 不能代替 RDB、AOF 和独立备份。
- 不提供数据分片。
- 不能把异步主从复制变成强一致复制。

---

## 2. Sentinel、主从复制、持久化与 Cluster 的区别

| 能力 | 主要目标 | 是否自动切换 master | 是否分片 | 是否保证零丢失 |
|---|---|---:|---:|---:|
| RDB/AOF | 单节点重启后的数据恢复 | 否 | 否 | 取决于持久化策略，仍需备份 |
| 主从复制 | 在线数据副本、读扩展 | 否 | 否 | 否，默认异步复制 |
| Sentinel | 非分片主从架构的高可用 | 是 | 否 | 否 |
| Redis Cluster | 分片、扩容和分片级高可用 | 是 | 是 | 否，仍存在异步复制窗口 |

适合 Sentinel 的场景：

- 数据量可以由单个 master 承载。
- 需要一个写主节点和若干只读副本。
- 需要 master 故障后的自动切换。
- 客户端支持 Sentinel 服务发现。

不适合仅使用 Sentinel 的场景：

- 数据量或写吞吐已经超过单个 master 的容量。
- 需要多个节点共同承担读流量和写流量。
- 需要跨分片水平扩容。

这些场景通常应考虑 Redis Cluster 或托管 Redis 服务。

---

## 3. 推荐架构

生产环境通常至少部署：

- 1 个 master。
- 2 个或更多 replica。
- 3 个或更多 Sentinel，数量一般使用奇数。
- 支持 Sentinel 的客户端。

```text
                        业务写入
                           │
                           ↓
                  ┌────────────────┐
                  │ Redis Master M │
                  └───────┬────────┘
                          │ 异步复制
                 ┌────────┴────────┐
                 ↓                 ↓
        ┌────────────────┐ ┌────────────────┐
        │ Redis Replica 1│ │ Redis Replica 2│
        └────────────────┘ └────────────────┘

        ┌────────────┐ ┌────────────┐ ┌────────────┐
        │ Sentinel S1│ │ Sentinel S2│ │ Sentinel S3│
        └────────────┘ └────────────┘ └────────────┘
               \             |             /
                \──监控所有 Redis 节点────/

客户端：
1. 连接多个 Sentinel 地址。
2. 询问逻辑主节点 mymaster 当前对应的 IP 和端口。
3. 连接返回的 master 执行业务写入。
4. 故障转移后重新发现并连接新 master。
```

### 3.1 为什么至少部署三个 Sentinel

Sentinel 是分布式系统。多个 Sentinel 共同判断故障，可以降低单点故障和误判风险。

两个 Sentinel 并不是稳健部署：

- 若一台机器同时运行 master 和 Sentinel，机器故障后只剩一个 Sentinel。
- 执行故障转移需要 Sentinel 多数派授权。
- 两个 Sentinel 的多数派是两个，剩余一个 Sentinel 无法授权切换。

三个 Sentinel 的多数派是两个，只要仍有两个 Sentinel 互相通信，就有机会完成故障转移。

### 3.2 Sentinel 应放在不同故障域

把三个 Sentinel 全部运行在同一台主机，只适合本地实验，不能消除单点故障。

生产建议：

- 分散在不同物理机、虚拟机或可用区。
- 不共用同一个电源、宿主机和网络故障点。
- Sentinel 的网络视角尽量接近业务客户端。
- Sentinel 与 Redis 数据节点之间、Sentinel 彼此之间都要能双向通信。

---

## 4. Sentinel 如何发现拓扑

每个 Sentinel 初始只需要配置要监控的 master：

```conf
sentinel monitor mymaster 192.168.150.101 7001 2
```

不需要在每个 `sentinel.conf` 中手动列出所有 replica 和其他 Sentinel。

### 4.1 发现 replica

Sentinel 定期向 master 获取复制信息，从 master 报告的拓扑中发现 replica，并继续监控这些 replica。

因此必须保证：

- replica 已正确执行 `replicaof`。
- master 能报告 replica 的可访问地址。
- Sentinel 能访问 replica 对外通告的 IP 和端口。

### 4.2 发现其他 Sentinel

监控同一 master 的 Sentinel 会通过 Redis 实例的 Pub/Sub 频道交换 hello 消息：

```text
__sentinel__:hello
```

hello 消息包含 Sentinel 的地址、端口、运行 ID 和已知 master 配置版本等信息。

这使 Sentinel 能够：

- 自动发现监控同一 master 的其他 Sentinel。
- 交换主节点配置和版本信息。
- 在故障时询问其他 Sentinel 对 master 状态的判断。

### 4.3 自动改写配置

Sentinel 会把发现的拓扑、运行 ID、配置纪元和故障转移结果写回 `sentinel.conf`。

因此：

- 启动 Sentinel 必须提供配置文件。
- Sentinel 对配置文件所在路径必须具有写权限。
- 不应把 `sentinel.conf` 挂载为只读文件。
- 配置管理系统不应持续用旧模板覆盖 Sentinel 自动写入的运行状态。
- 可以用 `SENTINEL FLUSHCONFIG` 强制写回当前状态。

---

## 5. 健康监控：PING、SDOWN 与 ODOWN

Sentinel 会周期性向 master、replica 和其他 Sentinel 发送命令并检查响应。

### 5.1 主观下线 SDOWN

SDOWN 是 Subjectively Down，表示：

> 某一个 Sentinel 根据自己的观察，认为目标实例不可达。

配置：

```conf
sentinel down-after-milliseconds mymaster 5000
```

如果某 Sentinel 在完整的 `down-after-milliseconds` 时间内没有收到可接受的 PING 响应，就会把目标标记为 SDOWN。

可接受的 PING 响应包括：

- `+PONG`
- `-LOADING`
- `-MASTERDOWN`

SDOWN 是单个 Sentinel 的本地判断，可能由以下问题引发：

- Redis 进程真的宕机。
- Sentinel 到 Redis 的网络中断。
- Redis 阻塞或负载过高，无法及时响应。
- DNS、NAT、防火墙或路由配置错误。

单个 Sentinel 的 SDOWN 不足以触发自动故障转移。

### 5.2 客观下线 ODOWN

ODOWN 是 Objectively Down，表示：

> 至少达到配置的 quorum 数量的 Sentinel 都认为 master 已经下线。

Sentinel 之间会使用内部询问命令交换对 master 的判断。当达到 quorum 后，master 从 SDOWN 进入 ODOWN。

需要注意：

- ODOWN 只针对 master。
- replica 和其他 Sentinel 只会被标记为 SDOWN，不会进入 ODOWN。
- replica 处于 SDOWN 时不会被选为新 master。

### 5.3 状态变化流程

```text
Redis 正常
   │
   │ 某 Sentinel 在 down-after-milliseconds 内
   │ 没有收到有效响应
   ↓
该 Sentinel 判定 SDOWN
   │
   │ 询问其他 Sentinel
   │ 达到 quorum 个 Sentinel 同意
   ↓
Master 被判定 ODOWN
   │
   │ 获得多数派授权并选出故障转移领导者
   ↓
开始自动故障转移
```

---

## 6. quorum 与多数派：最容易混淆的概念

配置示例：

```conf
sentinel monitor mymaster 192.168.150.101 7001 2
```

最后一个参数 `2` 是 quorum。

### 6.1 quorum 的作用

quorum 表示：

> 至少多少个 Sentinel 同意 master 不可达，才能将 master 标记为 ODOWN。

它用于故障检测，不是 replica 竞选新 master 的票数。

### 6.2 多数派的作用

进入 ODOWN 后，还需要选出一个负责本次故障转移的 Sentinel 领导者。真正执行故障转移必须获得 Sentinel 多数派授权。

```text
Sentinel 总数 N
多数派 = floor(N / 2) + 1
```

| Sentinel 总数 | 多数派 |
|---:|---:|
| 3 | 2 |
| 5 | 3 |
| 7 | 4 |

执行故障转移需要同时满足：

1. 达到 quorum，master 被判定为 ODOWN。
2. 某 Sentinel 获得执行故障转移所需的多数派授权；如果 quorum 高于多数派，还必须满足更高的 quorum。

### 6.3 五个 Sentinel、quorum 为 2 的例子

```text
Sentinel 总数：5
quorum：2
多数派：3
```

- 只要 2 个 Sentinel 认为 master 下线，就可触发 ODOWN。
- 但实际执行故障转移时，领导者仍至少需要 3 个 Sentinel 的授权。
- 如果只有 2 个 Sentinel 能相互通信，可能判定 ODOWN，但不能真正完成自动切换。

### 6.4 quorum 如何选择

三个 Sentinel 常用：

```conf
sentinel monitor mymaster 192.168.150.101 7001 2
```

建议原则：

- 通常使用奇数个 Sentinel。
- 三个 Sentinel 常将 quorum 设为 2。
- quorum 越小，故障检测越敏感，也越容易受局部网络问题影响。
- quorum 越大，误切换概率较低，但自动切换所需的可达 Sentinel 更多。
- 上线前应运行 `SENTINEL CKQUORUM` 检查 quorum 和多数派条件。

---

## 7. Sentinel 领导者选举

ODOWN 只说明多个 Sentinel 同意 master 下线。为了避免多个 Sentinel 同时发起相互冲突的切换，每次故障转移还要选出一个领导者。

简化过程：

1. Sentinel 发现 master 进入 ODOWN。
2. 发起一次新的故障转移尝试，并为本次尝试使用新的配置纪元。
3. 向其他 Sentinel 请求授权。
4. 每个 Sentinel 在一个配置纪元中只会投出符合协议的一票。
5. 获得所需授权的 Sentinel 成为本次故障转移领导者。
6. 只有该领导者负责选择 replica 和执行切换。

配置纪元可以理解为 Sentinel 配置的递增版本号：

- 每次有效故障转移都拥有唯一的配置纪元。
- 其他 Sentinel 收到更新的配置后采用较新的版本。
- 网络恢复后，不同分区中的 Sentinel 最终会收敛到最新逻辑配置。

---

## 8. 如何选择新的 master

领导者会从可用 replica 中选择一个提升为新 master。

选择前先排除不合格 replica，例如：

- 已被 Sentinel 判定 SDOWN。
- 长时间与原 master 断开。
- `replica-priority` 配置为 `0`。
- 状态异常或当前不适合提升。

### 8.1 断线时间筛选

如果 replica 与 master 断开的时间超过以下范围，会被认为不可靠：

```text
(down-after-milliseconds × 10)
+ 当前 master 已处于 SDOWN 的持续时间
```

讲义中常简写成 `down-after-milliseconds × 10`，完整判断还包含 master 已处于 SDOWN 的时间。

### 8.2 候选 replica 排序规则

合格候选者按照以下顺序比较：

1. `replica-priority`：数值越小，优先级越高。
2. 复制 offset：越大说明接收的数据通常越新，优先级越高。
3. run ID：前两项相同则选择字典序更小的 run ID，用于得到确定性结果。

| 比较项 | 优先规则 | 目的 |
|---|---|---|
| 与 master 的断线时间 | 过长直接排除 | 避免提升严重落后的副本 |
| `replica-priority` | 数值越小越优先 | 人工控制提升偏好 |
| 复制 offset | 越大越优先 | 尽量选择数据更新的副本 |
| run ID | 字典序更小优先 | 在其他条件相同时稳定决策 |

### 8.3 replica-priority

Redis 节点配置：

```conf
replica-priority 100
```

特殊值：

```conf
replica-priority 0
```

表示该 replica 永远不被 Sentinel 提升为 master，但它仍会继续作为 replica 接收数据，并可在故障转移后改为复制新的 master。

常见使用场景：

- 专门承担备份任务、性能较差的 replica 设置为 `0`。
- 同机房副本优先级设为 `10`。
- 异地灾备副本优先级设为 `100`。

如果一个节点未来可能从 master 变为 replica，建议所有 Redis 实例都配置符合其故障域定位的 `replica-priority`。

---

## 9. 自动故障转移完整流程

假设原拓扑：

```text
Master M1
├── Replica R1
└── Replica R2
```

完整流程如下：

1. 一个或多个 Sentinel 发现 M1 无法正常响应，分别将其标记为 SDOWN。
2. 达到 quorum 后，M1 被标记为 ODOWN。
3. Sentinel 通过投票选出本次故障转移的领导者。
4. 领导者筛选合格 replica。
5. 按优先级、复制 offset 和 run ID 选择 R1。
6. 领导者向 R1 发送：

   ```redis
   REPLICAOF NO ONE
   ```

7. Sentinel 通过 `INFO` 观察到 R1 已成为 master。
8. Sentinel 发布新的主节点配置，其他 Sentinel 和客户端开始获知 R1 的地址。
9. Sentinel 向 R2 发送：

   ```redis
   REPLICAOF <R1-IP> <R1-PORT>
   ```

10. R2 开始复制新 master R1。
11. 原 master M1 恢复后，Sentinel 将其改为 R1 的 replica。

角色变化：

```text
故障前：

M1：Master
R1：Replica of M1
R2：Replica of M1

M1 故障后：

M1：不可用
R1：New Master
R2：Replica of R1

M1 恢复后：

R1：Master
R2：Replica of R1
M1：Replica of R1
```

注意：

- 原 master 恢复并不自动夺回 master 身份。
- Sentinel 会持续把最新逻辑配置施加到恢复或重新连通的节点。
- 故障转移成功的关键点是候选 replica 已收到 `REPLICAOF NO ONE`，且 Sentinel 从 `INFO` 中确认它已经切换为 master。

---

## 10. Sentinel 核心配置

### 10.1 最小配置示例

```conf
port 26379
bind 0.0.0.0
protected-mode yes

dir "/var/lib/redis-sentinel"

sentinel monitor mymaster 192.168.150.101 7001 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 180000
sentinel parallel-syncs mymaster 1
```

### 10.2 配置项说明

| 配置项 | 含义 | 调整影响 |
|---|---|---|
| `port` | Sentinel 监听端口，默认 26379 | 每个实例必须可被其他 Sentinel 和客户端访问 |
| `dir` | 工作目录 | 必须可写 |
| `sentinel monitor` | 逻辑 master 名称、初始地址和 quorum | master 名称必须与客户端配置一致 |
| `down-after-milliseconds` | 判定 SDOWN 所需的连续无有效响应时间 | 太小容易误判，太大则恢复较慢 |
| `failover-timeout` | 控制故障转移超时、重试与部分重配置节奏 | 不是简单的“宕机检测时间” |
| `parallel-syncs` | 故障转移后允许同时改为复制新 master 的 replica 数量 | 数值越大恢复快，但同步压力和同时不可读副本数可能增加 |

### 10.3 parallel-syncs

```conf
sentinel parallel-syncs mymaster 1
```

设置为 `1`：

- 每次只让一个 replica 与新 master 重新同步。
- 减少多个 replica 同时加载全量数据造成的服务影响。
- 整体完成时间可能更长。

设置为较大值：

- 可以更快完成所有 replica 的重新配置。
- 可能同时触发多个复制同步，增加 CPU、内存、磁盘和网络压力。
- 如果 replica 在同步加载数据时暂时不可读，可用读副本数量会同时减少。

### 10.4 failover-timeout

`failover-timeout` 参与多种故障转移内部时间控制，包括：

- 一次故障转移尝试的时间边界。
- 失败后再次尝试故障转移的间隔。
- replica 改为复制新 master 时的重配置节奏。

不应把它误解为 master 多久没有响应后才判定故障；后者由 `down-after-milliseconds` 控制。

---

## 11. 示例：三节点 Sentinel 实验环境

讲义中的实验结构：

| Sentinel | IP | 端口 | 工作目录 |
|---|---|---:|---|
| S1 | 192.168.150.101 | 27001 | `/tmp/s1` |
| S2 | 192.168.150.101 | 27002 | `/tmp/s2` |
| S3 | 192.168.150.101 | 27003 | `/tmp/s3` |

S1：

```conf
port 27001
sentinel announce-ip 192.168.150.101
sentinel monitor mymaster 192.168.150.101 7001 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
sentinel parallel-syncs mymaster 1
dir "/tmp/s1"
```

S2、S3 分别使用不同端口和目录：

```text
S2：port 27002，dir "/tmp/s2"
S3：port 27003，dir "/tmp/s3"
```

启动方式一：

```bash
redis-sentinel /tmp/s1/sentinel.conf
redis-sentinel /tmp/s2/sentinel.conf
redis-sentinel /tmp/s3/sentinel.conf
```

启动方式二：

```bash
redis-server /tmp/s1/sentinel.conf --sentinel
```

说明：

- 同一台机器运行三个 Sentinel 只能验证功能。
- 生产环境必须将 Sentinel 分散到独立故障域。
- 启动前应确保端口、防火墙、配置文件写权限和数据节点认证正确。

---

## 12. 认证与安全

Sentinel 环境包含三类连接：

1. Sentinel 连接 Redis master 和 replica。
2. Sentinel 连接其他 Sentinel。
3. 业务客户端连接 Sentinel，并连接 Redis 数据节点。

三类连接的认证不能混为一谈。

### 12.1 Redis 数据节点要求密码

密码模式：

```conf
sentinel auth-pass mymaster redis-data-password
```

ACL 模式：

```conf
sentinel auth-user mymaster sentinel-monitor
sentinel auth-pass mymaster redis-data-password
```

这个凭证供 Sentinel 访问 `mymaster` 对应的 master 和 replica。该组 Redis 数据节点应使用兼容的认证配置。

replica 自己连接 master 时也需要配置：

```conf
masteruser replication-user
masterauth replication-password
```

### 12.2 保护 Sentinel 自身

Sentinel 本身也暴露 Redis 协议端口，不能直接暴露到不可信网络。

密码模式：

```conf
requirepass "sentinel-password"
```

使用密码模式时，各 Sentinel 通常要使用相同密码，以便彼此认证。还要确认客户端库支持连接 Sentinel 时发送认证信息。

ACL 模式可以分别配置：

```conf
sentinel sentinel-user sentinel-admin
sentinel sentinel-pass sentinel-admin-password
```

这组凭证用于 Sentinel 之间的连接。业务客户端访问 Sentinel 时也应使用权限受限的专用用户。

### 12.3 安全建议

- 使用 ACL 创建最小权限用户，避免业务客户端使用默认超级用户。
- Sentinel 端口只允许应用服务器、运维网络和其他 Sentinel 访问。
- Redis 数据端口只允许应用、Sentinel 和复制节点访问。
- 跨主机或跨可用区连接考虑启用 TLS。
- 密码不要直接硬编码在代码仓库和公开配置模板中。
- 定期轮换凭证，并验证所有 Sentinel、replica 和客户端均已同步更新。

---

## 13. NAT、Docker、主机名与地址通告

Sentinel 自动发现依赖节点通告的 IP 和端口。容器端口映射或 NAT 可能导致节点通告内部地址，使其他 Sentinel 或客户端无法访问。

### 13.1 Sentinel 地址通告

```conf
sentinel announce-ip 192.168.150.101
sentinel announce-port 27001
```

每个 Sentinel 都应通告其他 Sentinel 和客户端实际可达的地址。

### 13.2 Redis replica 地址通告

```conf
replica-announce-ip 192.168.150.102
replica-announce-port 7002
```

否则 master 报告给 Sentinel 的 replica 地址可能是容器内部地址。

### 13.3 使用主机名

较新 Redis 版本可以配置 Sentinel 解析和通告主机名：

```conf
sentinel resolve-hostnames yes
sentinel announce-hostnames yes
```

注意：

- DNS 必须稳定且解析迅速。
- 应统一使用主机名或统一使用 IP，避免混用。
- 部分旧客户端可能只接受 IP 地址。
- TLS 证书校验依赖主机名时，通告主机名通常更合适。

---

## 14. 客户端如何接入 Sentinel

Sentinel 不代理业务命令。客户端必须显式支持 Sentinel。

典型写连接流程：

```text
客户端启动
   │
   ├─连接任意可用 Sentinel
   │
   ├─执行 SENTINEL GET-MASTER-ADDR-BY-NAME mymaster
   │
   ├─获得当前 master 地址
   │
   ├─连接 master 并验证其角色
   │
   └─连接断开或发生切换后，再次进行服务发现
```

客户端配置应包含：

- 逻辑 master 名称，例如 `mymaster`。
- 多个 Sentinel 地址，而不是只配置一个。
- Sentinel 的认证信息。
- Redis 数据节点的认证信息。
- 连接、命令和重连超时。
- 拓扑切换后的重试与连接池更新策略。

不要：

- 在业务代码中永久写死原 master 的 IP。
- 只配置一个 Sentinel 地址。
- 把 Sentinel 地址当成 Redis 数据地址直接执行 `GET`、`SET`。
- 在非幂等写入上进行无边界自动重试。

### 14.1 常用服务发现命令

```redis
SENTINEL GET-MASTER-ADDR-BY-NAME mymaster
```

返回当前 master 的 IP 和端口。

```redis
SENTINEL REPLICAS mymaster
```

查看 Sentinel 已知的 replica。

```redis
SENTINEL SENTINELS mymaster
```

查看 Sentinel 已知的其他 Sentinel。

---

## 15. Spring Boot 与 RedisTemplate

Spring Boot 3.x 使用 `spring.data.redis` 配置前缀：

```yaml
spring:
  data:
    redis:
      username: app-user
      password: app-password
      sentinel:
        master: mymaster
        nodes:
          - 192.168.150.101:27001
          - 192.168.150.102:27002
          - 192.168.150.103:27003
        username: sentinel-client
        password: sentinel-client-password
      connect-timeout: 2s
      timeout: 2s
```

较早的 Spring Boot 版本常使用：

```yaml
spring:
  redis:
    sentinel:
      master: mymaster
      nodes:
        - 192.168.150.101:27001
        - 192.168.150.102:27002
        - 192.168.150.103:27003
```

具体前缀和认证属性应以项目实际 Spring Boot / Spring Data Redis 版本为准。

### 15.1 Lettuce 读策略

现代 Spring Boot 可使用属性控制 Lettuce 读来源，具体可用值取决于当前版本：

```yaml
spring:
  data:
    redis:
      lettuce:
        read-from: replica-preferred
```

也可以通过代码定制：

```java
@Bean
LettuceClientConfigurationBuilderCustomizer redisReadFromCustomizer() {
    return builder -> builder.readFrom(ReadFrom.REPLICA_PREFERRED);
}
```

常见策略含义：

| 策略 | 读取位置 | 特点 |
|---|---|---|
| `MASTER` | 只读 master | 一致性相对更好，读压力集中 |
| `MASTER_PREFERRED` | 优先 master | master 不可用时尝试 replica |
| `REPLICA` | 只读 replica | 可能读到旧数据，副本不可用时可能失败 |
| `REPLICA_PREFERRED` | 优先 replica | 适合允许短暂陈旧读的业务 |

主从复制是异步的。即使写入 master 已返回成功，立即从 replica 读取也可能读取不到新值。

以下场景通常应从 master 读取：

- 写后立即读。
- 分布式锁状态判断。
- 库存、余额、订单状态等强时效数据。
- 依赖最新数据进行后续写入的逻辑。

---

## 16. Sentinel 与数据一致性

### 16.1 为什么故障转移仍可能丢数据

Redis 主从复制默认异步：

```text
客户端 ──写入──→ 旧 Master
客户端 ←─OK──── 旧 Master
                    │
                    │ 写命令尚未复制到 Replica
                    × 旧 Master 故障

Replica 被提升为新 Master，但缺少刚才的写入。
```

因此 Sentinel 可以缩短故障恢复时间，但不能保证已确认写入一定保留。

### 16.2 网络分区与旧 master

网络分区时可能出现：

1. 旧 master 与多数 Sentinel、replica 失联。
2. 多数派一侧把 replica 提升为新 master。
3. 旧 master 所在分区仍可能被部分旧客户端访问并接受写入。
4. 网络恢复后，旧 master 被改为新 master 的 replica。
5. 旧 master 分区期间独有的写入会被新主线覆盖。

### 16.3 限制旧 master 的孤立写入

在所有可能成为 master 的 Redis 节点配置：

```conf
min-replicas-to-write 1
min-replicas-max-lag 10
```

含义：

- master 至少要有 1 个延迟不超过要求的 replica。
- 如果在 10 秒内无法获得足够 replica 的进度确认，master 停止接受写入。

作用：

- 缩短网络分区中旧 master 继续产生孤立写入的时间窗口。
- 降低故障恢复后被覆盖的数据量。

代价：

- replica 故障或网络抖动时，master 可能拒绝写入。
- 系统可用性下降。
- 仍然不是严格同步复制，也不是绝对零丢失保证。

### 16.4 关键写入使用 WAIT

```redis
SET order:1001 paid
WAIT 1 1000
```

表示最多等待 1000 毫秒，希望至少一个 replica 确认已接收到当前连接之前的写入。

应用必须检查 `WAIT` 的返回值。`WAIT` 可以提高写入到达 replica 的概率，但：

- 不能把 Redis 变为强一致系统。
- 不等于写入已按业务要求持久化到磁盘。
- 不能替代 AOF、RDB 和独立备份。
- 不能消除客户端重试造成的重复写风险。

---

## 17. Sentinel 与持久化

Sentinel 依赖 replica 提升为新 master，因此所有可能被提升的节点都应有适当的持久化配置。

建议：

```conf
appendonly yes
appendfsync everysec
```

并根据恢复目标配置 RDB 快照和独立备份。

### 17.1 危险组合

以下组合风险极高：

```text
Master 关闭 RDB
+ Master 关闭 AOF
+ 进程崩溃后自动重启
```

可能过程：

1. master 崩溃。
2. 进程管理器迅速把它自动重启。
3. 因无持久化文件，master 以空数据集启动。
4. Sentinel 可能尚未完成故障转移。
5. replica 继续把空 master 当作复制源。
6. 空数据集被同步给 replica，整个复制组的数据一起丢失。

因此：

- 不要把 Sentinel 当作持久化和备份。
- master 关闭持久化时，不应允许它在故障后未经控制地空数据自动重启。
- 所有可能成为 master 的节点都应具备符合业务 RPO 的恢复能力。
- 备份应放在复制组之外，防止误删命令和逻辑错误同步到所有副本。

---

## 18. 常用运维命令

连接 Sentinel：

```bash
redis-cli -h 192.168.150.101 -p 27001
```

若需要认证：

```bash
redis-cli -h 192.168.150.101 -p 27001 --user sentinel-client --pass 'password'
```

### 18.1 查询状态

```redis
PING
INFO sentinel
ROLE
SENTINEL MASTERS
SENTINEL MASTER mymaster
SENTINEL REPLICAS mymaster
SENTINEL SENTINELS mymaster
SENTINEL GET-MASTER-ADDR-BY-NAME mymaster
SENTINEL CKQUORUM mymaster
```

### 18.2 动态配置

修改 master 专属配置：

```redis
SENTINEL SET mymaster down-after-milliseconds 10000
SENTINEL SET mymaster parallel-syncs 1
```

修改 Sentinel 全局配置：

```redis
SENTINEL CONFIG GET *
SENTINEL CONFIG SET resolve-hostnames yes
```

动态修改应在所有 Sentinel 上保持一致。只修改一个 Sentinel，不会自动把该项运行时配置传播给所有 Sentinel。

### 18.3 手动触发故障转移

```redis
SENTINEL FAILOVER mymaster
```

该命令会强制 Sentinel 为指定 master 发起故障转移，不需要先把 master 判定为 ODOWN。

使用前必须确认：

- 存在健康且复制进度合适的 replica。
- 客户端具备重连能力。
- 监控和回滚方案已经准备。
- 不会与正在进行的自动故障转移冲突。

### 18.4 订阅事件

```redis
PSUBSCRIBE *
```

常见 Sentinel 日志和 Pub/Sub 事件：

| 事件 | 含义 |
|:--|---|
| `+sdown` | 实例进入主观下线 |
| `-sdown` | 实例退出主观下线 |
| `+odown` | master 进入客观下线 |
| `-odown` | master 退出客观下线 |
| `+try-failover` | 开始尝试故障转移 |
| `+elected-leader` | 当前 Sentinel 当选故障转移领导者 |
| `+selected-slave` | 已选中待提升 replica |
| `+failover-state-send-slaveof-noone` | 正在提升 replica |
| `+slave-reconf-sent` | 已发送重新复制新 master 的命令 |
| `+slave-reconf-done` | replica 已完成对新 master 的同步 |
| `+switch-master` | master 地址已经切换 |
| `+failover-end` | 故障转移结束 |
| `+tilt` / `-tilt` | 进入或退出 TILT 保护模式 |

---

## 19. 故障排查表

| 现象 | 常见原因 | 排查方向 |
|---|---|---|
| master 已宕机但未自动切换 | 未达到 quorum 或多数派；无合格 replica | `SENTINEL CKQUORUM`、`SENTINEL REPLICAS`、Sentinel 日志 |
| 只有 SDOWN，没有 ODOWN | 其他 Sentinel 不同意或彼此无法通信 | 检查 Sentinel 数量、端口、防火墙、认证 |
| 达到 ODOWN 但不切换 | 无法获得多数派授权 | 检查 Sentinel 网络分区和已知 Sentinel 数量 |
| 日志出现 `no-good-slave` | replica 断线过久、SDOWN、优先级为 0 或状态异常 | 检查 `INFO replication` 和 `replica-priority` |
| 新 master 已产生但客户端仍报错 | 客户端不支持 Sentinel、只配置一个 Sentinel 或连接池未刷新 | 检查客户端服务发现和重连日志 |
| Sentinel 无法启动 | 未提供配置文件或文件不可写 | 检查启动参数、目录和文件权限 |
| Sentinel 发现错误 IP | Docker/NAT/主机名通告错误 | 配置 announce IP/port 和 replica announce |
| Sentinel 无法认证 Redis | `auth-user`/`auth-pass` 错误或 ACL 权限不足 | 分别检查数据节点和 Sentinel 的认证 |
| 故障转移后多个 replica 同时卡顿 | `parallel-syncs` 过大或触发全量同步 | 调低并发同步，检查 backlog 与资源 |
| 读到旧数据 | 从 replica 读取且复制存在延迟 | 强时效读走 master，监控复制延迟 |
| 旧 master 恢复后变成 replica | Sentinel 的正常行为 | 确认新拓扑，不要手工抢回角色 |
| 发生切换但丢失最近写入 | 异步复制窗口 | 评估 `WAIT`、min-replicas、持久化和业务补偿 |

---

## 参考资料

- [Redis 官方文档：High availability with Redis Sentinel](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
- [Redis 官方文档：Replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/)
- [Redis 官方文档：INFO](https://redis.io/docs/latest/commands/info/)
- [Redis 官方文档：WAIT](https://redis.io/docs/latest/commands/wait/)
- [Redis 官方配置示例：redis.conf](https://github.com/redis/redis/blob/unstable/redis.conf)
- [Spring Boot 官方文档：Common Application Properties](https://docs.spring.io/spring-boot/appendix/application-properties/)
- [Spring Data Redis 官方文档：Connection Modes](https://docs.spring.io/spring-data/redis/reference/redis/connection-modes.html)
