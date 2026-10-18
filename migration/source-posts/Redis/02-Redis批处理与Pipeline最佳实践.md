---
# 文章标题
title: Redis 最佳实践（二）：批处理、Pipeline 与 Cluster 跨槽处理
# 文章发布日期
published: 2026-08-04
# 文章简介
description: 对比 Redis 原生批量命令、Pipeline、事务与 Lua 的性能和原子性，讲解批次大小、失败语义与幂等设计，并解决 Cluster 环境中的 CROSSSLOT、按槽分组和 Hash Tag 问题。
# 文章标签
tags: [Redis, Pipeline, 批处理, Redis Cluster, Lua脚本]
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



## 1. 为什么批处理能提速

Redis 单条简单命令很快，但一次请求还包含网络往返时间（RTT）：

```text
逐条发送 N 条命令的总耗时
≈ N × RTT + Redis 执行时间 + 序列化/排队时间

批量或 Pipeline 的总耗时
≈ 少量 RTT + Redis 执行时间 + 序列化/排队时间
```

当客户端与 Redis 跨机房、跨可用区或经过代理时，RTT 的影响尤其明显。批处理的核心价值是减少“发送一条、等待一条”的往返等待，而不是让每条命令本身变成 O(1)。

## 2. 四种组合方式

| 方式 | 目的 | 原子性 | Cluster 限制 | 适用场景 |
| --- | --- | --- | --- | --- |
| `MGET`/`MSET` 等批量命令 | 一条命令操作多个值 | 命令自身是原子执行 | 多 Key 通常需同槽 | String 同类批量读写 |
| Pipeline | 一次发送多条命令 | 无 | 应按节点/槽路由 | 各类独立命令批处理 |
| `MULTI/EXEC` | 一组命令不被其他客户端插入 | 有执行隔离，但无传统回滚 | 所有 Key 通常需同槽 | 简单事务组合 |
| Lua/Function | 服务端执行组合逻辑 | 脚本执行期间原子 | 涉及 Key 需满足槽约束 | 条件更新、读改写 |

首先根据业务语义选工具，再优化 RTT。不能为了性能把本来需要原子的操作改成不原子的 Pipeline。

## 3. 原生批量命令

### 3.1 MGET 与 MSET

```redis
MSET user:1:name Alice user:2:name Bob
MGET user:1:name user:2:name
```

特点：

- 只适用于 String；
- `MSET` 作为单条命令执行，不会出现只写入其中一半的可见状态；
- 参数或响应仍会随 Key 数增长，不能无限扩大；
- Redis Cluster 中，多 Key 必须由目标部署支持；Redis Open Source Cluster 的常规要求是同一槽。

### 3.2 Hash 批量读写

```redis
HSET user:10086 name Alice age 28 city Beijing
HMGET user:10086 name city
```

`HMSET` 自 Redis 4.0 起已废弃。现代代码应使用可一次接收多个 field-value 的 `HSET`。

### 3.3 其他批量能力

| 需求 | 示例 |
| --- | --- |
| Set 添加多个成员 | `SADD key m1 m2 m3` |
| ZSet 添加多个成员 | `ZADD key 10 m1 20 m2` |
| List 推入多个元素 | `RPUSH key v1 v2 v3` |
| 批量检查 Set 成员 | `SMISMEMBER key m1 m2` |
| 批量读取 ZSet score | `ZMSCORE key m1 m2` |

优先使用语义准确的原生批量命令，因为它通常比“多条命令 + Pipeline”更紧凑。但仍要检查时间复杂度和最大响应。

## 4. Pipeline

### 4.1 工作过程

```text
普通模式：
client --cmd1--> Redis --reply1--> client --cmd2--> Redis --reply2--> client

Pipeline：
client --cmd1, cmd2, ... cmdN--> Redis
client <--reply1, reply2, ... replyN-- Redis
```

Redis 仍按顺序处理各条命令并生成每条回复。Pipeline 只改变客户端发送和读取回复的节奏。

### 4.2 Pipeline 不是什么

- 不是事务：其他客户端命令可以在 Pipeline 命令之间被执行；
- 不会自动回滚：第 5 条失败时，前 4 条可能已经成功；
- 不降低命令复杂度：把 100 个慢命令放进 Pipeline 仍然很慢；
- 不等于无限批量：服务端必须暂存回复，客户端也要持有请求和结果；
- 不能绕过 Cluster 路由：命令仍要送到正确节点。

### 4.3 批次大小

批次应同时设置“命令数”和“字节数”上限：

```text
建议从较小批次起压测，例如：
- 每批 100~1000 条简单小命令
- 请求或预估响应不超过数百 KB 到数 MB

上述不是标准答案，应以：
P99 延迟、客户端内存、Redis 输出缓冲、网络 MTU/带宽、失败重试成本为准。
```

批次过小：RTT 降低不明显。批次过大：

- 客户端堆内存和 GC 压力上升；
- Redis 客户端输入/输出缓冲增长；
- 单连接被长批次占用，尾延迟升高；
- 部分失败后的确认和重试更复杂；
- 大响应可能触发输出缓冲限制而断连。

### 4.4 Java 风格伪代码

不同客户端 API 不同，下面强调的是控制批次、完整消费回复和处理单项错误：

```java
int maxCommands = 500;

for (List<Command> batch : partition(commands, maxCommands)) {
    Pipeline p = client.pipelined();
    List<Response<?>> replies = new ArrayList<>();

    for (Command c : batch) {
        replies.add(enqueue(p, c));
    }

    p.sync();

    for (int i = 0; i < replies.size(); i++) {
        try {
            Object value = replies.get(i).get();
            handleSuccess(batch.get(i), value);
        } catch (Exception ex) {
            handleFailure(batch.get(i), ex);
        }
    }
}
```

不要在入队每条命令后立即 `sync`，否则会退化为逐条 RTT。也不要忽略回复；协议层必须读取回复，业务层至少要记录错误和执行状态。

### 4.5 失败语义与幂等

Pipeline 可能出现三类状态：

| 状态 | 含义 | 处理策略 |
| --- | --- | --- |
| 明确成功/失败 | 已收到对应回复 | 按单项结果处理 |
| 连接在发送前失败 | 通常未执行，但客户端未必能绝对确认 | 可安全重试幂等操作 |
| 发送后、收回复前断开 | 命令可能执行，也可能未执行 | 不能盲目重试非幂等写 |

幂等设计示例：

- `SET key value` 通常可重复；
- `SADD` 同一成员通常可重复；
- `INCR`、`LPUSH`、扣库存不是天然幂等；
- 非幂等写可携带业务 requestId，并在同槽脚本中去重。

## 5. 事务与 Lua

### 5.1 MULTI/EXEC

```redis
MULTI
DECRBY stock:{sku-1} 1
HSET order:{sku-1}:1001 status created
EXEC
```

关键语义：

- `MULTI` 后的命令先排队，`EXEC` 时顺序执行；
- Redis 不提供传统数据库那样的自动回滚；
- 入队时能发现的语法错误可能让事务不执行，运行时类型错误不会撤销其他命令；
- 乐观锁用 `WATCH`，但高冲突下重试会放大负载；
- Cluster 中涉及的 Key 必须满足同槽要求。

### 5.2 Lua/Function

条件扣减示意：

```lua
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])

if stock < amount then
    return 0
end

redis.call('DECRBY', KEYS[1], amount)
return 1
```

使用原则：

- 需要访问的 Key 通过 `KEYS` 显式传入，不在脚本里动态拼接任意 Key；
- 脚本保持短小、确定、可重入，避免长循环和大结果；
- 预加载脚本并处理缓存丢失；新项目可评估 Redis Functions；
- 脚本执行会阻塞其他命令，不能把复杂业务逻辑搬到 Redis；
- Cluster 中所有相关 Key 通常必须同槽。

## 6. Redis Cluster 中的批处理

### 6.1 为什么会 CROSSSLOT

Redis Cluster 将 Key 映射到 16384 个槽：

```text
slot = CRC16(key) mod 16384
```

多 Key 命令要求 Key 位于同一槽，否则常见错误是：

```text
CROSSSLOT Keys in request don't hash to the same slot
```

### 6.2 四种策略

| 策略 | RTT | 并行度 | 语义 | 评价 |
| --- | --- | --- | --- | --- |
| 逐 Key 串行 | 高 | 低 | 简单 | 仅适合很小批量 |
| 按槽分组后串行 | 中 | 低 | 每槽独立 | 实现简单，节点多时仍慢 |
| 按槽/节点分组后并行 | 低 | 高 | 每组独立，非全局原子 | 通用推荐方案 |
| Hash Tag 强制同槽 | 低 | 单槽 | 可使用同槽多 Key 命令/事务 | 只用于确实相关的数据，防止热点 |

### 6.3 按槽分组并行

```text
输入 keys
  → 计算每个 key 的 slot
  → 根据 slot/目标节点分组
  → 每组使用 MGET/MSET 或有限 Pipeline
  → 控制最大并发数
  → 按原输入顺序重组结果
```

Java 风格伪代码：

```java
Map<Integer, List<IndexedKey>> groups = new HashMap<>();

for (int i = 0; i < keys.size(); i++) {
    String key = keys.get(i);
    int slot = clusterSlot(key);
    groups.computeIfAbsent(slot, ignored -> new ArrayList<>())
          .add(new IndexedKey(i, key));
}

Object[] result = new Object[keys.size()];
Semaphore concurrency = new Semaphore(8);

parallelForEach(groups.values(), group -> {
    concurrency.acquire();
    try {
        List<String> values = clusterMget(groupKeys(group));
        for (int i = 0; i < group.size(); i++) {
            result[group.get(i).index()] = values.get(i);
        }
    } finally {
        concurrency.release();
    }
});
```

原讲义示例中类似 `list.get(0)` 固定取首项、用位移计算 Key/Value 配对下标的写法容易造成数据错位。正确实现必须保留原始索引并逐项对应。

### 6.4 Hash Tag

只有第一对有效非空花括号中的内容参与槽计算：

```text
cart:{10086}:items
cart:{10086}:meta
```

这两个 Key 同槽，可以参与同槽多 Key 操作。设计禁忌：

```text
# 不推荐：把整个大租户全部压到一个槽
tenant:{tenant-1}:user:1
tenant:{tenant-1}:user:2
tenant:{tenant-1}:order:1
```

Hash Tag 是原子边界工具，不是“让所有批量命令成功”的补丁。共槽范围越大，容量和吞吐越难横向扩展。

### 6.5 跨槽批量写不再全局原子

把一个逻辑 `MSET` 拆成 3 个槽组后：

```text
slot A：成功
slot B：超时，状态未知
slot C：失败
```

此时不存在 Redis 原生的跨槽回滚。业务必须选择：

- 接受最终一致，记录任务并补偿；
- 把真正需要原子的 Key 重新设计为同槽；
- 把一致性事务放在权威数据库，Redis 只做派生缓存；
- 使用带幂等键的消息/任务驱动更新。
