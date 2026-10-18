---
# 文章标题
title: Redis 持久化完全指南：RDB、AOF 与混合持久化
# 文章发布日期
published: 2026-07-28
# 文章简介
description: 深入解析 Redis RDB 快照、AOF 写入与重写、Copy-on-Write 和混合持久化机制，对比数据安全、恢复速度与性能成本，并给出生产选型、监控和故障处理建议。
# 文章标签
tags: [Redis, Redis持久化, RDB, AOF, 混合持久化]
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

> 适用范围：Redis Open Source 7.x/8.x。旧版本的 AOF 文件结构与 Redis 7+ 存在明显差异。

## 1. 先理解持久化要解决什么

Redis 的主要数据在内存中。持久化用于把可恢复的数据写入磁盘，以便进程重启、机器故障或数据迁移后恢复。

设计持久化方案前先明确两个指标：

- **RPO（Recovery Point Objective）**：最多允许丢失多长时间的数据。
- **RTO（Recovery Time Objective）**：故障后允许多长时间恢复服务。

Redis 提供四种常见选择：

1. 不持久化：适合可完全重建的纯缓存。
2. 只使用 RDB：周期性保存数据快照。
3. 只使用 AOF：持续记录写命令。
4. 同时使用 RDB 与 AOF：兼顾备份、恢复速度和较小的数据丢失窗口。

> 持久化不等于备份，也不等于高可用。误执行 `FLUSHALL`、磁盘损坏或整机丢失都可能同时影响在线数据和本地持久化文件，因此仍需要异机备份、复制、哨兵或集群以及恢复演练。

---

## 2. RDB：某一时刻的数据集快照

RDB 把当前内存数据保存为紧凑的二进制快照，默认文件名通常为 `dump.rdb`。

### 2.1 执行方式

#### SAVE

```bash
SAVE
```

- 由 Redis 主线程同步执行。
- 生成快照期间会阻塞其他请求。
- 在线生产实例通常不应主动使用。

#### BGSAVE

```bash
BGSAVE
```

- Redis 先 `fork` 子进程。
- 子进程在后台生成 RDB。
- 父进程继续处理客户端请求。
- 新快照完成后通过原子替换取代旧 RDB 文件。

两种命令对比：

| 命令 | 执行进程 | 是否阻塞客户端请求 | 典型用途 |
|---|---|---|---|
| `SAVE` | Redis 主线程 | 是 | 极少使用，通常仅限特殊维护场景 |
| `BGSAVE` | `fork` 出的子进程 | `fork` 阶段可能短暂停顿，写文件期间不持续阻塞 | 生产环境生成 RDB 的常用方式 |

#### 自动快照规则

```conf
# 示例：60 秒内至少发生 1000 次数据变更，则触发后台快照
save 60 1000

# 禁用自动快照
save ""
```

`save N M` 表示：在 N 秒内至少发生 M 次会改变数据集的操作后，触发一次后台保存。

不要依赖“Redis 正常停机一定会保存 RDB”这一假设。停机参数、当前持久化配置和进程退出方式都会影响结果，恢复能力必须通过实际配置和演练验证。

### 2.2 核心配置

```conf
# RDB 所在目录
dir /var/lib/redis

# RDB 文件名
dbfilename dump.rdb

# 是否压缩 RDB
rdbcompression yes

# 是否写入并检查校验和
rdbchecksum yes

# 最近一次后台保存失败后是否拒绝继续写入
stop-writes-on-bgsave-error yes
```

不应简单地认为“磁盘便宜，所以一定关闭压缩”。是否压缩需要结合 CPU、磁盘吞吐、快照耗时和文件大小进行压测。

### 2.3 BGSAVE 与 Copy-on-Write

执行 `BGSAVE` 时：

1. 父进程执行 `fork`，创建子进程。
2. 父子进程最初共享相同的物理内存页。
3. 子进程读取快照时刻的数据并写入临时 RDB。
4. 父进程继续处理请求。
5. 父进程修改某个共享页时，操作系统复制该页，这就是 Copy-on-Write。
6. 子进程完成写入后，Redis 原子替换旧 RDB。

需要注意的开销：

- 大数据集会增加 `fork` 和页表复制时间，造成短暂停顿。
- 快照期间写入越多，COW 复制的内存页越多，峰值内存越高。
- 快照写盘可能与业务 I/O、AOF 重写或主从全量同步争抢资源。
- 内存不足时可能发生 OOM，不能只按 `used_memory` 配置机器容量。

### 2.4 RDB 的优缺点

优点：

- 文件紧凑，适合归档和异地备份。
- 大数据集下，启动恢复通常快于回放 AOF。
- 生成完成的 RDB 文件不会被继续修改，便于复制。
- 对正常请求的持续写盘影响较小。

缺点：

- RPO 取决于快照间隔，故障时可能丢失最近数分钟数据。
- `fork`、COW 和磁盘写入可能造成延迟和内存放大。
- 快照只能表示某个时间点，不能反映之后的增量写入。

---

## 3. AOF：记录写命令并在启动时回放

AOF（Append Only File）记录所有会改变数据集的写命令。Redis 重启时按顺序回放这些命令，重新构造内存状态。

### 3.1 写入路径

一次写命令大致经过：

```text
客户端写命令
    ↓
Redis 执行命令并修改内存
    ↓
AOF 缓冲区
    ↓ write
操作系统页缓存
    ↓ fsync
稳定存储
```

`write` 成功不代表数据已经进入稳定存储；真正的耐久性主要由 `fsync` 策略决定。

### 3.2 基础配置

```conf
appendonly yes
appendfilename "appendonly.aof"

# Redis 7+ 的多文件 AOF 目录
appenddirname "appendonlydir"

# AOF 重写时允许 base 文件采用 RDB 前导
aof-use-rdb-preamble yes
```

### 3.3 appendfsync 三种策略

```conf
# 每批写命令都执行 fsync
appendfsync always

# 大约每秒执行一次 fsync，常用且推荐的折中方案
appendfsync everysec

# 不主动执行 fsync，由操作系统决定刷盘时间
appendfsync no
```

| 策略 | 刷盘方式 | 典型数据丢失窗口 | 性能与适用场景 |
|---|---|---:|---|
| `always` | 每批写命令执行 `fsync` | 极低 | 耐久性最强，但写延迟和吞吐压力最大 |
| `everysec` | 后台线程约每秒 `fsync` | 通常约 1 秒 | 性能与安全性的常用平衡 |
| `no` | 交给操作系统 | 不确定 | 性能优先，故障时可能丢失更多数据 |

“`always` 完全不丢数据”也不是绝对保证。磁盘控制器缓存、虚拟化存储、文件系统和硬件故障仍可能影响最终耐久性。

### 3.4 AOF 重写

AOF 会不断增长。例如某个计数器执行 100 次 `INCR`，恢复当前状态可能并不需要保留全部 100 条历史命令。

手工重写：

```bash
BGREWRITEAOF
```

自动重写阈值：

```conf
# 当前 AOF 相比上次重写后的基准大小增长 100%
auto-aof-rewrite-percentage 100

# 文件达到该大小后才考虑自动重写
auto-aof-rewrite-min-size 64mb
```

重写不是在原 AOF 上删除命令，而是根据当前内存状态生成一套能够恢复相同数据集的最小表示。新文件准备完成前，旧 AOF 仍保持有效。

例如，原 AOF 中依次存在：

```redis
SET num 123
SET name jack
SET num 666
```

最终有效状态只有 `name=jack`、`num=666`。重写后可以用更短的等价命令表示：

```redis
MSET name jack num 666
```

| 重写前 | 状态影响 | 重写时是否需要保留 |
|---|---|---|
| `SET num 123` | 后续被 `SET num 666` 覆盖 | 不需要 |
| `SET name jack` | 决定最终的 `name` | 需要以等价形式保留 |
| `SET num 666` | 决定最终的 `num` | 需要以等价形式保留 |

Redis 会避免同时执行高开销的 RDB 后台保存和 AOF 重写。若 `BGSAVE` 正在执行，`BGREWRITEAOF` 可能进入排队状态。

### 3.5 Redis 7+ 的多文件 AOF

Redis 7.0 起，AOF 不再只是一个不断追加的单文件，而是由以下部分组成：

- **base AOF**：最多一个，表示最近一次重写时的数据基线；可以是 AOF 格式，也可以是 RDB 格式。
- **incremental AOF**：一个或多个，记录 base 生成之后的增量写入。
- **manifest**：记录当前有效的 base 和 incremental 文件组合。

这些文件存放在 `appenddirname` 指定的目录中。重写时，父进程会继续向新的增量文件写入；重写完成后通过原子替换 manifest 切换到新文件集合。

因此，Redis 7+ 备份 AOF 时不能只复制某一个 `appendonly.aof` 文件，而要复制整个 AOF 目录，并避免在重写过程中取得不一致的文件组合。

### 3.6 AOF 的优缺点

优点：

- 使用 `everysec` 时，通常最多丢失约 1 秒数据。
- 追加写为主，日志尾部截断时可进行恢复。
- 可自动后台重写，控制文件膨胀。
- 命令日志相对容易理解和审计。

缺点：

- 文件通常比等价 RDB 更大。
- 持续写入和 `fsync` 会增加磁盘压力。
- 重写仍需要 `fork`，存在 COW 和额外 I/O 开销。
- 大 AOF 启动时需要回放，恢复速度通常慢于 RDB。

---

## 4. 混合持久化与恢复优先级

### 4.1 同时开启 RDB 和 AOF

同时开启两种持久化时：

- RDB 可用于周期性快照、归档和较快恢复。
- AOF 用于缩小故障时的数据丢失窗口。
- Redis 重启时会优先使用 AOF 恢复数据，因为 AOF 通常更完整。

### 4.2 AOF 的 RDB 前导

```conf
aof-use-rdb-preamble yes
```

开启后，AOF 重写生成的 base 部分可使用 RDB 格式，后续增量仍以 AOF 命令日志记录：

```text
RDB 格式的 base + incremental AOF + manifest
```

收益：

- base 更紧凑。
- 重写速度和启动加载速度通常更好。
- 增量 AOF 继续提供较小的数据丢失窗口。

需要区分：

- **RDB + AOF**：同时开启两套持久化机制。
- **RDB 前导 AOF**：AOF 重写后的 base 使用 RDB 格式，是 AOF 的内部文件结构。

---

## 5. RDB 与 AOF 对比

| 维度 | RDB | AOF |
|---|---|---|
| 记录方式 | 某个时间点的数据集快照 | 会改变数据集的写命令 |
| 典型 RPO | 取决于快照间隔，通常为分钟级 | `everysec` 通常约 1 秒 |
| 启动恢复 | 通常更快 | 需要加载 base 并回放增量日志 |
| 文件体积 | 紧凑，适合归档 | 通常更大 |
| 正常运行开销 | 周期性 `fork` 和集中写盘 | 持续追加、`fsync` 和周期重写 |
| 主要风险 | 快照间隔丢数据、fork/COW 峰值 | 磁盘延迟、文件膨胀、重写和回放时间 |
| 备份方式 | 复制完整 RDB 文件 | Redis 7+ 复制整个 `appenddirname` |
| 典型用途 | 快照备份、灾难恢复、快速重启 | 较强耐久性、缩小数据丢失窗口 |

---

## 6. 生产环境选型建议

### 6.1 纯缓存，可从数据库重建

- 可以关闭持久化，降低 I/O 和 `fork` 影响。
- 若希望重启后快速预热，可保留低频 RDB。
- 必须确认缓存重建不会压垮下游数据库。

### 6.2 可以容忍数分钟数据丢失

- 可只使用 RDB。
- 设置与业务 RPO 对齐的快照规则。
- 定期把 RDB 复制到异机或对象存储。

### 6.3 数据较重要，希望最多丢失约 1 秒

- 开启 AOF。
- 通常选择 `appendfsync everysec`。
- 保留周期性 RDB，便于归档、恢复和应对 AOF 故障。

### 6.4 极强耐久性要求

- 可以评估 `appendfsync always`，但必须压测写延迟和吞吐。
- 结合主从复制、高可用、可靠存储和异地备份。
- 如果业务要求严格事务耐久性，需要评估 Redis 是否适合作为唯一事实数据源。

---

## 7. 监控与故障处理

### 7.1 查看持久化状态

```bash
redis-cli INFO persistence
```

重点关注：

RDB：

- `rdb_bgsave_in_progress`
- `rdb_last_bgsave_status`
- `rdb_last_bgsave_time_sec`
- `rdb_last_cow_size`
- `rdb_changes_since_last_save`

AOF：

- `aof_enabled`
- `aof_rewrite_in_progress`
- `aof_rewrite_scheduled`
- `aof_last_bgrewrite_status`
- `aof_last_write_status`
- `aof_current_size`
- `aof_base_size`
- `aof_pending_bio_fsync`
- `aof_delayed_fsync`
- `aof_last_cow_size`

还应同时监控：

- `latest_fork_usec`
- 磁盘使用率、写延迟、I/O 等待
- Redis 主进程 RSS 与可用内存
- 持久化文件更新时间
- 备份任务成功率和恢复演练结果

### 7.2 AOF 尾部截断或损坏

处理原则：**先停止写入并复制原文件，再尝试修复。**

```bash
# 先检查
redis-check-aof <aof-file-or-manifest>

# 确认可接受丢弃损坏部分后再修复
redis-check-aof --fix <aof-file-or-manifest>
```

如果是中间区域损坏，修复工具可能丢弃损坏位置之后的内容，因此不能不做备份就直接使用 `--fix`。

RDB 可使用：

```bash
redis-check-rdb dump.rdb
```

### 7.3 在线开启 AOF

在已有 RDB 数据的运行实例上切换为 AOF 时，不要只修改配置文件后直接重启。可按以下思路操作：

```bash
redis-cli CONFIG SET appendonly yes
redis-cli INFO persistence
redis-cli CONFIG REWRITE
```

等待 AOF 重写完成，并确认：

- `aof_rewrite_in_progress:0`
- `aof_rewrite_scheduled:0`
- `aof_last_bgrewrite_status:ok`
- AOF 持续增长且重启后 key 数量符合预期

`CONFIG SET` 只修改运行时配置；若不修改配置文件或执行 `CONFIG REWRITE`，重启后可能恢复旧配置。

---

## 参考资料

- [Redis 官方：Persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- [Redis 官方：BGREWRITEAOF](https://redis.io/docs/latest/commands/bgrewriteaof/)
- [Redis 官方：INFO](https://redis.io/docs/latest/commands/info/)
- [Redis 官方：Configuration](https://redis.io/docs/latest/operate/oss_and_stack/management/config/)
