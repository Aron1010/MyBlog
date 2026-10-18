---
title: Redis HyperLogLog 完全指南：UV 统计、基数估算与实践
published: 2026-07-27
description: 从 PV、UV 与基数概念出发，讲解 HyperLogLog 的估算原理、误差和存储表示，详解
  PFADD、PFCOUNT、PFMERGE，并实践日、周、月 UV 统计与数据结构选型。
tags:
  - Redis
  - HyperLogLog
  - UV统计
  - 基数统计
  - 数据去重
category: Redis
draft: false
pinned: false
comments: true
id: post-6effc04a8d
permalink: /posts/redis/redis-hyperloglog知识整理/
image: station
author: Aron
---

> 适用范围：Redis Open Source 2.8.9+。

## 1. 从 PV、UV 和基数说起

### 1.1 PV

PV（Page View）通常表示页面浏览量或事件发生次数。一次访问记一次，同一用户访问 10 次通常产生 10 个 PV。

PV 不需要去重，可以直接使用计数器：

```redis
INCR metrics:{shop}:pv:2026-07-27
```

### 1.2 UV

UV（Unique Visitor）表示某个统计窗口内去重后的访问者数量。同一个用户在一天内访问多次，在日 UV 中只算一次。

```text
访问事件：A A B C A B
PV：6
UV：3
```

严格来说，UV 不一定等于“自然人数”。它取决于业务选择的身份标识：

- 登录用户 ID；
- Cookie ID；
- 设备 ID；
- 经过隐私评审的匿名标识；
- IP 地址与其他特征的组合。

标识不稳定会把同一个人算成多人；多人共用一个标识又会被算成一人。因此定义 UV 时，必须同时说明身份标识和时间窗口。

### 1.3 基数

基数（Cardinality）是集合中不重复元素的数量：

```text
集合 {A, A, B, C, C} 的基数 = 3
```

HyperLogLog（简称 HLL）解决的正是“大规模数据的近似基数统计”问题。

## 2. HyperLogLog 是什么

HyperLogLog 是一种概率数据结构：

- 输入可以不断重复；
- 不保存完整元素集合；
- 只维护一份很小的统计摘要；
- 最终返回去重数量的近似值；
- 内存基本不随已观察元素数量线性增长。

Redis 的实现：

- 最坏情况下约使用 12 KB 数据空间；
- 标准误差约为 0.81%；
- 最多可估计约 `2^64` 个不同元素；
- 核心命令是 `PFADD`、`PFCOUNT`、`PFMERGE`。

它适合流量趋势、独立访客、独立搜索词、独立设备、独立视频观众等“允许近似”的大规模统计。

## 3. 为什么不用普通 Set

使用 Set 可以得到精确 UV：

```redis
SADD uv:exact user:1 user:2 user:3
SCARD uv:exact
```

但 Set 必须保存每一个唯一成员，内存复杂度为 `O(N)`。随着访问者数量增长，成员数据、哈希表节点和分配器开销都会持续增加。

HLL 不保存成员本身，只保存统计摘要。无论观察几万、几百万还是更多不同元素，密集表示的数据部分都约为 12 KB。代价是：

- 结果不是精确值；
- 无法取回成员；
- 无法判断某个成员是否存在；
- 无法删除某一个已加入元素。

## 4. 核心原理

HyperLogLog 利用了这样一个概率现象：

> 在均匀随机的二进制序列中，连续出现很多个前导 0 很少见；观察到的最大前导 0 数越大，通常意味着观察过的不同元素越多。

简化流程：

1. 对输入元素做均匀哈希，得到固定长度的二进制值；
2. 用哈希值的一部分选择一个寄存器；
3. 用剩余部分计算“第一个 1 出现前有多少个 0”；
4. 该寄存器只保留它见过的最大值；
5. 综合所有寄存器，通过调和平均和偏差修正估计基数。

Redis 使用：

```text
16384 个寄存器 × 每个寄存器 6 bit = 98304 bit = 12288 byte
```

再加上 16 字节头部等内部信息。

同一个元素经过相同哈希后总会定位到同一寄存器、得到相同观测值，因此重复加入不会不断增加估算值。

### 4.1 为什么需要很多寄存器

只记录一个“最大前导 0 数”波动太大。HLL 将输入分散到大量寄存器中，再综合所有观测值，使估计更稳定。

标准误差可近似理解为：

```text
1.04 / sqrt(m)
```

当 `m = 16384` 时：

```text
1.04 / sqrt(16384) ≈ 0.8125%
```

### 4.2 0.81% 不是最大误差保证

Redis 文档中的 0.81% 是 **标准误差**，不是“每次结果与真实值的误差一定小于 0.81%”。

例如真实基数为 100 万时，0.81% 对应的标准误差量级约为 8100，但某一次估算的偏差可能更大或更小。若业务要求计费、结算、配额、审计等严格精确结果，应使用精确数据结构或数据库统计。

## 5. Redis 中的存储表示

Redis HLL 在内部编码为 String：

```redis
PFADD hll:demo a b c
TYPE hll:demo
```

返回：

```text
string
```

HLL 有两种内部表示：

- **稀疏表示**：初期大量寄存器为 0，使用游程编码，内存可显著低于 12 KB；
- **密集表示**：数据增多后自动转换，使用 16384 个 6-bit 寄存器，数据部分为 12288 字节。

它可以用 `GET` 序列化、用 `SET` 恢复，但不应使用普通 String 命令随意修改其中的字节，否则会破坏 HLL 编码或得到无意义结果。

## 6. 命令总览

| 命令 | 作用 | 时间复杂度 | 返回值 |
| --- | --- | --- | --- |
| `PFADD` | 将一个或多个元素加入 HLL | 每个元素 `O(1)` | 寄存器是否发生变化 |
| `PFCOUNT` | 返回一个 HLL或多个 HLL 并集的估计基数 | 单 key 平均 `O(1)`；多 key 为 `O(N)` | 估计基数 |
| `PFMERGE` | 将多个 HLL 的并集保存到目标 key | 合并 N 个 HLL 为 `O(N)`，常数较高 | `OK` |

`PFDEBUG`、`PFSELFTEST` 是内部调试/测试命令，带有危险或管理属性，不属于普通业务 API。

## 7. 命令详解

### 7.1 PFADD：加入观测元素

```redis
PFADD key [element [element ...]]
```

添加单个用户：

```redis
PFADD metrics:{shop}:uv:2026-07-27 user:1001
```

批量添加：

```redis
PFADD metrics:{shop}:uv:2026-07-27 \
  user:1001 user:1002 user:1003
```

返回值：

- `1`：至少一个内部寄存器发生变化；
- `0`：没有寄存器发生变化。

需要特别注意：

```text
PFADD 返回 1 ≠ 一定加入了一个从未出现的新元素
PFADD 返回 0 ≠ 这个元素一定曾经出现过
```

原因是 HLL 不保存成员集合。不同元素可能对现有寄存器状态没有进一步贡献。因此不能用 `PFADD` 的返回值实现精确的“首次访问”“用户是否存在”判断。

同一个元素重复执行 `PFADD` 对最终摘要是幂等的，适合处理可能重试的事件。

不传元素也是合法的：

```redis
PFADD hll:empty
```

key 不存在时会创建一个空 HLL；存在时不做实际修改。

### 7.2 PFCOUNT：估计基数

单 key：

```redis
PFCOUNT metrics:{shop}:uv:2026-07-27
```

返回该日的估计 UV。key 不存在时返回 0。

多 key：

```redis
PFCOUNT \
  metrics:{shop}:uv:2026-07-21 \
  metrics:{shop}:uv:2026-07-22 \
  metrics:{shop}:uv:2026-07-23
```

返回三个 HLL **并集** 的估计基数。重复出现在多天中的同一用户只近似计算一次。

因此：

```text
周 UV ≠ 每日 UV 直接相加
```

每日 UV 相加会重复计算跨天访问者，周 UV 应通过多 key `PFCOUNT` 或 `PFMERGE` 后再统计。

性能区别：

- 单 key `PFCOUNT` 会使用内部缓存，平均开销很小；
- 多 key `PFCOUNT` 会临时合并所有 HLL，不能复用并集缓存，调用频繁时成本明显更高。

一个较少见但重要的内部细节是：`PFCOUNT` 可能更新 HLL 头部中的基数缓存。因此从底层实现看，它可能修改最后几个缓存字节，即使业务语义上它是读取统计值。

### 7.3 PFMERGE：合并并保存

```redis
PFMERGE destination [source [source ...]]
```

示例：

```redis
PFMERGE metrics:{shop}:uv:2026-W31 \
  metrics:{shop}:uv:2026-07-27 \
  metrics:{shop}:uv:2026-07-28 \
  metrics:{shop}:uv:2026-07-29

PFCOUNT metrics:{shop}:uv:2026-W31
```

`PFMERGE` 保存的是可继续合并和计数的 HLL 摘要，不是普通整数。

合并的底层含义可以简化为：对每个寄存器取所有源 HLL 中的最大值。因此 HLL 合并具有：

- 可交换性；
- 可结合性；
- 幂等性。

这让它适合分片统计后汇总。

#### 目标 key 的累积语义

如果 destination 已存在，Redis 会把 destination 本身也当作一个源 HLL：

```redis
PFMERGE total old-part
PFMERGE total new-part
```

第二次结果包含原有 `total` 与 `new-part` 的并集，而不是单纯用 `new-part` 覆盖。

如果要从头重新计算某个固定名称的汇总 key，需要先明确删除旧目标，或者更稳妥地写入一个新的版本化 key，再切换引用：

```text
metrics:{shop}:uv:2026-W31:v2
```

## 8. 完整案例：同时统计 PV 和 UV

假设用户 1001 当天访问三次，用户 1002 访问两次。

每次访问都增加 PV：

```redis
INCR metrics:{shop}:pv:2026-07-27
```

每次访问也将稳定用户标识加入 HLL：

```redis
PFADD metrics:{shop}:uv:2026-07-27 user:1001
PFADD metrics:{shop}:uv:2026-07-27 user:1001
PFADD metrics:{shop}:uv:2026-07-27 user:1001
PFADD metrics:{shop}:uv:2026-07-27 user:1002
PFADD metrics:{shop}:uv:2026-07-27 user:1002
```

查询：

```redis
GET metrics:{shop}:pv:2026-07-27
PFCOUNT metrics:{shop}:uv:2026-07-27
```

小样本中通常会得到类似：

```text
PV = 5
UV ≈ 2
```

PV 是精确计数，UV 是近似基数。不要使用 HLL 统计 PV，因为 HLL 会自动弱化重复元素的贡献。

## 9. 日 UV、周 UV、月 UV

### 9.1 每天一个 HLL

```text
metrics:{shop}:uv:2026-07-27
metrics:{shop}:uv:2026-07-28
metrics:{shop}:uv:2026-07-29
```

这样可以：

- 独立查询每天 UV；
- 灵活合并周/月 UV；
- 按保留周期设置 TTL；
- 避免永久 HLL 无法删除历史元素的问题。

### 9.2 临时查询周 UV

```redis
PFCOUNT \
  metrics:{shop}:uv:2026-07-27 \
  metrics:{shop}:uv:2026-07-28 \
  metrics:{shop}:uv:2026-07-29 \
  metrics:{shop}:uv:2026-07-30 \
  metrics:{shop}:uv:2026-07-31
```

适合低频临时查询。

### 9.3 预聚合周 UV

```redis
PFMERGE metrics:{shop}:uv:2026-W31 \
  metrics:{shop}:uv:2026-07-27 \
  metrics:{shop}:uv:2026-07-28 \
  metrics:{shop}:uv:2026-07-29 \
  metrics:{shop}:uv:2026-07-30 \
  metrics:{shop}:uv:2026-07-31

PFCOUNT metrics:{shop}:uv:2026-W31
```

适合频繁查询报表。汇总 key 可设置比日 key 更长的 TTL。

### 9.4 时间窗口必须统一

业务应明确：

- 使用 UTC 还是业务时区；
- 按事件发生时间还是服务器接收时间；
- 日界线如何定义；
- 迟到事件如何补录；
- 夏令时地区如何处理。

否则同一事件可能被放入不同日期的 HLL，导致跨系统统计不一致。

## 10. HLL 能做什么、不能做什么

### 10.1 能做

- 近似统计去重数量；
- 合并多个统计窗口或分片的并集；
- 用固定小内存持续接收大量重复事件；
- 序列化摘要并在其他 Redis 实例恢复。

### 10.2 不能做

- 判断用户 1001 是否访问过；
- 列出所有访问用户；
- 返回某个用户出现次数；
- 删除单个用户的贡献；
- 精确计算基数；
- 直接计算交集、差集；
- 替代审计明细或原始事件存储。

如果必须支持成员查询、删除、枚举或精确集合运算，应使用 Set、Bitmap、数据库或其他合适结构。

## 11. 交集与留存为什么要谨慎

数学上可以用容斥关系估算两个集合的交集：

```text
|A ∩ B| ≈ PFCOUNT(A) + PFCOUNT(B) - PFCOUNT(A, B)
```

但三次 HLL 估计都有误差，做减法时误差会叠加。如果真实交集远小于 A、B 的规模，相对误差可能非常大，甚至可能出现不合理结果。

因此：

- HLL 很适合估计并集 UV；
- 不适合要求稳定精度的留存、交集、流失用户统计；
- 精确或小交集场景优先使用 Bitmap、Set 或离线明细计算。

## 12. HLL、Set、Bitmap、Bloom Filter 的选择

| 结构 | 主要问题 | 结果 | 成员查询 | 枚举/删除 | 集合运算 | 内存特点 |
| --- | --- | --- | --- | --- | --- | --- |
| HyperLogLog | 有多少个不同元素 | 近似 | 不支持 | 不支持 | 主要支持并集合并 | 最高约 12 KB |
| Set | 有哪些不同元素 | 精确 | 支持 | 支持 | 交并差集 | 随成员数增长 |
| Bitmap | 哪些紧凑整数 ID 为真 | 精确 | 支持 | 可清 bit | 快速交并差 | 取决于最大 offset |
| Bloom Filter | 某元素是否可能存在 | 概率 | 支持概率判断 | 通常不能枚举 | 不是普通集合统计 | 小内存，可能假阳性 |

快速选择：

- 只要近似 UV，数据量很大：HLL；
- 要精确人数并保留成员：Set；
- 用户 ID 紧凑且需要精确交并集：Bitmap；
- 只要快速判断“可能存在/一定不存在”：Bloom Filter。s

## 13. 官方资料

- [Redis HyperLogLog 数据类型](https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/)
- [PFADD](https://redis.io/docs/latest/commands/pfadd/)
- [PFCOUNT](https://redis.io/docs/latest/commands/pfcount/)
- [PFMERGE](https://redis.io/docs/latest/commands/pfmerge/)
- [Redis 概率数据结构总览](https://redis.io/docs/latest/develop/data-types/probabilistic/)
