---
# 文章标题
title: Redis Bitmap 完全指南：位操作、用户签到与活跃统计
# 文章发布日期
published: 2026-07-27
# 文章简介
description: 系统讲解 Redis Bitmap 的存储原理、偏移量与内存计算，以及 SETBIT、BITCOUNT、BITOP、BITFIELD 等命令，并通过用户签到、活跃与留存统计说明适用场景和选型边界。
# 文章标签
tags: [Redis, Bitmap, 位图, 用户签到, 活跃用户统计]
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

> 适用范围：Redis Open Source 2.2+。文中会特别标注 Redis 7.0 和 8.2 引入的新语法。

## 1. Bitmap 是什么

Bitmap（位图）使用一个二进制位表示一个对象的某种布尔状态：

- `1`：是、存在、已发生；
- `0`：否、不存在、未发生。

例如，可以让 offset 等于用户 ID：

```text
offset:  0 1 2 3 4 5 6 7 ...
状态:    0 1 0 0 1 0 1 0 ...
含义:      ↑     ↑   ↑
          用户1  用户4 用户6 活跃
```

常见用途：

- 用户签到；
- 日活、周活和留存统计；
- 是否在线、是否完成任务；
- 权限或功能开关；
- 标签人群交集、并集和差集；
- 大量小整数计数器（使用 `BITFIELD`）。

## 2. Bitmap 不是独立数据类型

Redis Bitmap 底层是二进制安全的 **String**。Bitmap 只是 Redis 提供的一组按位操作：

```redis
SETBIT bitmap:key 10 1
TYPE bitmap:key
```

返回：

```text
string
```

所以 Bitmap key 也可以使用部分 String 命令，例如：

```redis
STRLEN bitmap:key       # String 占用的字节数
GETRANGE bitmap:key 0 9 # 读取前 10 个字节
EXPIRE bitmap:key 86400 # 设置整个 Bitmap key 的 TTL
DEL bitmap:key
```

直接 `GET` 得到的是二进制字节流，不一定是可读文本。

## 3. bit、byte 与 offset

### 3.1 基本换算

```text
1 byte = 8 bit
```

Redis 的 offset 从 `0` 开始：

- 第 1 个字节保存 offset `0～7`；
- 第 2 个字节保存 offset `8～15`；
- 第 n 个 bit 所在字节是 `floor(offset / 8)`。

一个字节内按“从最高有效位到最低有效位”编号：

```text
字节内容： 1 0 1 0 0 0 0 1
offset：   0 1 2 3 4 5 6 7
```

因此：

```redis
SETBIT demo 0 1
```

会把第一个字节的最高位设置为 1，而不是最低位。

### 3.2 最大容量

String 的最大长度是 512 MiB，因此单个 Bitmap 最多可以寻址：

```text
512 MiB × 8 = 2^32 bit
```

offset 的有效范围是：

```text
0 ～ 2^32 - 1
```

也就是最多约 42.95 亿个位。

### 3.3 内存估算

如果最大 offset 为 `m`，数据部分至少需要：

```text
floor(m / 8) + 1 字节
```

常见规模：

| 最大编号规模 | 位图数据大小（约） |
| ---: | ---: |
| 100 万 | 122 KiB |
| 1,000 万 | 1.19 MiB |
| 1 亿 | 11.92 MiB |
| 10 亿 | 119.21 MiB |
| `2^32` 个 bit | 512 MiB |

这些数字不包含 Redis 对象、key、内存分配器等额外开销。

Bitmap 并不是稀疏压缩结构。即使只执行：

```redis
SETBIT users 1000000000 1
```

Redis 也必须分配能够覆盖 offset 10 亿的连续 String，约占 119 MiB。对很短的 key 突然设置极远 offset，扩容和补零还可能阻塞 Redis 主线程。

## 4. 适合与不适合的场景

### 4.1 适合

- 对象可以映射为较连续、较紧凑的非负整数；
- 每个对象只需表示 0/1；
- 经常需要计数、交集、并集或差集；
- 不要求直接从 Bitmap 中列出完整业务对象。

### 4.2 不适合

- ID 极度稀疏，例如只有少量用户但 ID 接近十亿；
- 需要保存名称、时间、次数等附加信息；
- 经常需要遍历并返回所有成员；
- 单个对象不只是布尔状态；
- 需要给每个 bit 单独设置 TTL。

Bitmap 的 TTL 是 key 级别的，不能给单独一个 bit 设置过期时间。

## 5. 命令总览

| 命令 | 作用 | 版本 | 时间复杂度 |
| --- | --- | ---: | --- |
| `SETBIT` | 设置指定 offset 的值 | 2.2+ | `O(1)`，扩容除外 |
| `GETBIT` | 获取指定 offset 的值 | 2.2+ | `O(1)` |
| `BITCOUNT` | 统计值为 1 的 bit 数 | 2.6+ | `O(N)` |
| `BITOP` | 多个 String/Bitmap 做位运算并保存结果 | 2.6+ | `O(N)` |
| `BITPOS` | 查找第一个 0 或 1 的位置 | 2.8.7+ | `O(N)` |
| `BITFIELD` | 原子读写、自增不同宽度的整数 | 3.2+ | 每个子命令 `O(1)` |
| `BITFIELD_RO` | 只读地获取 bitfield 整数 | 6.0+ | 每个子命令 `O(1)` |

其中 `N` 与扫描或参与运算的字节数有关。

## 6. 命令详解

### 6.1 SETBIT：设置 bit

```redis
SETBIT key offset value
```

- `offset` 从 0 开始；
- `value` 只能是 `0` 或 `1`；
- key 不存在时自动创建；
- 超出当前长度时自动扩容，中间部分补 0；
- 返回 **修改前的 bit 值**，不是修改后的值。

示例：

```redis
SETBIT active:2026-07-27 1001 1
```

第一次返回：

```text
(integer) 0
```

重复执行返回：

```text
(integer) 1
```

因此返回值可以用来判断“这是不是用户当天第一次活跃”，但业务端仍需考虑事件、网络重试和整体流程的幂等性。

清除状态：

```redis
SETBIT active:2026-07-27 1001 0
```

### 6.2 GETBIT：读取 bit

```redis
GETBIT key offset
```

示例：

```redis
GETBIT active:2026-07-27 1001
```

返回 `0` 或 `1`。key 不存在或 offset 超过当前 String 长度时返回 `0`。

### 6.3 BITCOUNT：统计 1 的数量

```redis
BITCOUNT key [start end [BYTE | BIT]]
```

统计整个 Bitmap：

```redis
BITCOUNT active:2026-07-27
```

如果“一名用户对应一个 offset”，结果就是当天去重活跃用户数。

范围查询默认按 **byte**，而且 `start`、`end` 都包含在内：

```redis
BITCOUNT key 0 0
```

表示统计第 1 个字节（offset 0～7），不是只统计 bit 0。

Redis 7.0+ 可以显式按 bit 范围统计：

```redis
BITCOUNT key 0 0 BIT
```

这才表示只统计 bit 0。`BYTE` 是默认模式。范围索引可以为负数，`-1` 表示最后一个 byte 或 bit，取决于指定的模式。

### 6.4 BITOP：位运算

当前语法：

```redis
BITOP operation destination source [source ...]
```

经典操作：

| 操作 | 含义 |
| --- | --- |
| `AND` | 交集：所有源 Bitmap 都为 1 |
| `OR` | 并集：至少一个源 Bitmap 为 1 |
| `XOR` | 异或：常用于两个 Bitmap 状态不同的成员 |
| `NOT` | 取反；只能有一个源 key |

Redis 8.2 新增：

| 操作 | 含义 |
| --- | --- |
| `DIFF dest X Y...` | 在 X 中但不在任何 Y 中 |
| `DIFF1 dest X Y...` | 在任一 Y 中但不在 X 中 |
| `ANDOR dest X Y...` | 在 X 中，并且至少在一个 Y 中 |
| `ONE dest X...` | 只在一个源 Bitmap 中出现 |

示例——连续两天都活跃：

```redis
BITOP AND active:{app}:both \
  active:{app}:2026-07-26 \
  active:{app}:2026-07-27

BITCOUNT active:{app}:both
```

示例——两天内至少活跃一次：

```redis
BITOP OR active:{app}:union \
  active:{app}:2026-07-26 \
  active:{app}:2026-07-27

BITCOUNT active:{app}:union
```

Redis 8.2+ 查询“昨天活跃、今天未活跃”：

```redis
BITOP DIFF active:{app}:lost \
  active:{app}:2026-07-26 \
  active:{app}:2026-07-27

BITCOUNT active:{app}:lost
```

需要注意：

- 运算结果总会写入 `destination`；
- 返回值是目标 String 的字节长度，不是 1 的数量；
- 要统计结果，继续使用 `BITCOUNT destination`；
- 较短或不存在的源 key 会按 0 补齐到最长源 key 的长度；
- `BITOP` 是 `O(N)`，大 Bitmap 运算可能阻塞；
- Redis 8.2 以前只有 `AND`、`OR`、`XOR`、`NOT`。

在 Redis Cluster 中，源 key 和目标 key 应位于同一个 slot。上例通过共同的 hash tag `{app}` 达到这一点。

### 6.5 BITPOS：寻找第一个 0 或 1

```redis
BITPOS key bit [start [end [BYTE | BIT]]]
```

示例：

```redis
BITPOS active:2026-07-27 1
```

返回第一个值为 1 的绝对 bit offset。

默认情况下，`start` 和 `end` 是 byte 范围；Redis 7.0+ 可使用 `BIT`：

```redis
BITPOS key 0 100 199 BIT
```

在 bit 100～199 中寻找第一个 0，但返回值仍是从整个 Bitmap offset 0 开始计算的绝对位置。

特殊返回语义：

- 查找 1，但 key 为空或全为 0：返回 `-1`；
- 不限定完整范围地查找 0 时，Redis 会把 String 右侧视作有无限个 0，因此全为 1 的三字节 String 会返回 `24`；
- 如果同时明确给出 `start` 和 `end`，而该范围内没有目标 bit，则返回 `-1`。

### 6.6 BITFIELD：把位数组当小整数数组

```redis
BITFIELD key
  [GET encoding offset |
   [OVERFLOW WRAP|SAT|FAIL]
   <SET encoding offset value |
    INCRBY encoding offset increment> ...]
```

`BITFIELD` 不只是操作单个 0/1，它可以将一段连续 bit 解释为整数。

编码格式：

- `uN`：N 位无符号整数，支持到 `u63`；
- `iN`：N 位有符号整数，支持到 `i64`；
- 例如 `u8` 的范围是 0～255，`i8` 的范围是 -128～127。

三种主要操作：

- `GET`：读取整数；
- `SET`：写入整数，返回旧值；
- `INCRBY`：原子增减，返回新值。

普通 offset 表示 bit offset：

```redis
BITFIELD stats SET u8 0 100 SET u8 8 20
```

带 `#` 的 offset 表示“第几个同宽整数”，Redis 会自动乘以字段宽度：

```redis
BITFIELD stats SET u8 #0 100 SET u8 #1 20
BITFIELD stats GET u8 #0 GET u8 #1
```

这两组写法等价。

溢出策略：

| 策略 | 行为 |
| --- | --- |
| `WRAP` | 默认，环绕；例如 `u8` 的 255 加 1 变为 0 |
| `SAT` | 饱和，超过范围后停在最大值或最小值 |
| `FAIL` | 不修改，并为该子操作返回 `nil/null` |

示例：

```redis
BITFIELD counters \
  SET u8 #0 254 \
  OVERFLOW SAT INCRBY u8 #0 10 \
  GET u8 #0
```

对应返回值依次是：

```text
0
255
255
```

一条 `BITFIELD` 可以包含多个子操作，它们会按顺序原子执行，返回数组与子操作一一对应。

### 6.7 BITFIELD_RO：只读查询

```redis
BITFIELD_RO key GET encoding offset [GET encoding offset ...]
```

它只允许 `GET`，不能使用 `SET`、`INCRBY` 或 `OVERFLOW`，适合明确的只读访问和只读副本。

示例：

```redis
BITFIELD_RO stats GET u8 #0 GET u8 #1
```

## 7. 完整案例一：用户签到

设计：

```text
key    = signin:{userId}:2026-07
offset = 当月日期 - 1
value  = 是否签到
```

例如用户 1001 在 7 月 1、2、5、27 日签到：

```redis
SETBIT signin:{1001}:2026-07 0 1
SETBIT signin:{1001}:2026-07 1 1
SETBIT signin:{1001}:2026-07 4 1
SETBIT signin:{1001}:2026-07 26 1
```

查询 7 月 27 日是否签到：

```redis
GETBIT signin:{1001}:2026-07 26
```

统计本月签到天数：

```redis
BITCOUNT signin:{1001}:2026-07
```

结果：

```text
(integer) 4
```

Bitmap 能高效回答“是否签到”和“签到多少天”，但签到的具体时间、设备、奖励流水仍应保存在数据库、Hash、Stream 等其他结构中。

## 8. 完整案例二：活跃用户与留存

设计：

```text
key    = active:{app}:yyyy-MM-dd
offset = 紧凑的用户数字 ID
value  = 当天是否活跃
```

记录活跃：

```redis
SETBIT active:{app}:2026-07-27 1001 1
SETBIT active:{app}:2026-07-27 1002 1
SETBIT active:{app}:2026-07-27 2000 1
```

日活：

```redis
BITCOUNT active:{app}:2026-07-27
```

两日都活跃：

```redis
BITOP AND active:{app}:retained \
  active:{app}:2026-07-20 \
  active:{app}:2026-07-27

BITCOUNT active:{app}:retained
```

如果“7 月 20 日活跃用户”正是所定义的初始 cohort，上述交集数可作为 7 日回访人数。留存率应在业务端计算：

```text
7 日留存率 = 7 月 20 日与 7 月 27 日交集人数 ÷ 7 月 20 日 cohort 人数
```

真实留存通常还要限定“新增用户 cohort”等业务条件，不能把任意两个日活 Bitmap 的交集都直接称为标准留存。

## 9. Bitmap、Set、HyperLogLog、Bloom Filter 的选择

| 结构 | 成员判断 | 精确计数 | 集合运算 | 能否枚举成员 | 主要特点 |
| --- | --- | --- | --- | --- | --- |
| Bitmap | 精确 | 精确 | 很快 | 不方便 | 适合紧凑整数 ID 和布尔状态 |
| Set | 精确 | 精确 | 支持 | 支持 | 适合稀疏 ID，单成员开销较大 |
| HyperLogLog | 不支持 | 近似基数 | 不直接支持交集 | 不支持 | 固定小内存，适合只求 UV |
| Bloom Filter | 概率判断 | 不用于精确人数 | 不作为普通集合运算 | 不支持 | 可能假阳性，适合快速过滤不存在项 |

选择建议：

- ID 连续、需要交并集：Bitmap；
- ID 稀疏、需要列出成员：Set；
- 只关心近似 UV：HyperLogLog；
- 只需要低内存的“可能存在/一定不存在”判断：Bloom Filter。

## 10. 官方资料

- [Redis Bitmap 数据类型](https://redis.io/docs/latest/develop/data-types/bitmaps/)
- [Redis Bitfield 数据类型](https://redis.io/docs/latest/develop/data-types/bitfields/)
- [SETBIT](https://redis.io/docs/latest/commands/setbit/)
- [GETBIT](https://redis.io/docs/latest/commands/getbit/)
- [BITCOUNT](https://redis.io/docs/latest/commands/bitcount/)
- [BITOP](https://redis.io/docs/latest/commands/bitop/)
- [BITPOS](https://redis.io/docs/latest/commands/bitpos/)
- [BITFIELD](https://redis.io/docs/latest/commands/bitfield/)
- [BITFIELD_RO](https://redis.io/docs/latest/commands/bitfield_ro/)
