---
title: Redis GEO 完全指南：位置存储、距离计算与范围搜索
published: 2026-07-27
description: 介绍 Redis GEO 的底层结构、坐标规则与工程边界，详解 GEOADD、GEOPOS、GEODIST、GEOSEARCH
  等命令，掌握地理位置存储、距离计算和附近位置查询。
tags:
  - Redis
  - GEO
  - 地理位置
  - 距离计算
  - 附近位置
category: Redis
draft: false
pinned: false
comments: true
id: post-130d4a0f29
permalink: /posts/redis/redis-geo知识整理/
image: anna-hydrangea
author: Aron
---

> 适用范围：Redis Open Source 3.2+；新项目优先采用 Redis 6.2 引入的 `GEOSEARCH` 和 `GEOSEARCHSTORE`。

## 1. GEO 是什么

Redis GEO（Geospatial，地理空间索引）用于保存“成员—经纬度”的对应关系，并完成：

- 坐标写入和更新；
- 查询成员坐标；
- 计算两个成员间的直线球面距离；
- 按圆形半径或矩形范围搜索附近成员；
- 按距离排序、限制数量或保存查询结果。

它适合“附近门店、车辆、骑手、充电桩、车站”等简单邻近搜索。它不是完整的 GIS：不支持道路距离、导航路径、行政区或任意多边形判断。

## 2. 底层数据结构与原理

GEO 底层就是一个 **Sorted Set（有序集合）**：

- `member` 是成员名，例如 `北京站`；
- `score` 是经纬度经过 Geohash 思路编码得到的 52 位整数；
- 经纬度的二进制位交错排列，使空间上相近的点大概率拥有相近的 score；
- 范围搜索先按网格/包围盒筛选候选点，再计算实际球面距离并剔除范围外的点。

因此可以对 GEO key 使用部分 Sorted Set 命令：

```redis
TYPE geo:stations                 # zset
ZCARD geo:stations                # 成员数量
ZREM geo:stations 北京西站        # 删除成员；没有 GEODEL 命令
```

不要随意用 `ZADD` 修改 GEO 成员的 score，否则会破坏地理编码。需要修改坐标时重新执行 `GEOADD`。

## 3. 坐标规则

`GEOADD` 的坐标顺序固定为：

```text
经度 longitude（x）在前，纬度 latitude（y）在后
```

有效范围：

- 经度：`-180` 到 `180`；
- 纬度：`-85.05112878` 到 `85.05112878`。

纬度不能到达南北极，因为 Redis 采用的投影/编码范围不覆盖极区。

### 国内坐标系注意事项

Redis 只存数字，不识别或转换坐标系。WGS‑84、GCJ‑02（高德/腾讯常见）和 BD‑09（百度常见）不可混用，否则会产生数百米甚至更大的偏移。写入、搜索中心和业务展示应统一使用同一种坐标系。

## 4. 常用命令总览

| 命令 | 作用 | 版本与建议 |
| --- | --- | --- |
| `GEOADD` | 添加或更新成员坐标 | 3.2+ |
| `GEOPOS` | 返回成员经纬度 | 3.2+ |
| `GEODIST` | 计算两个已存在成员的距离 | 3.2+ |
| `GEOHASH` | 返回成员的标准 Geohash 字符串 | 3.2+ |
| `GEOSEARCH` | 按圆形或矩形范围搜索 | 6.2+，推荐 |
| `GEOSEARCHSTORE` | 搜索并把结果保存为新 key | 6.2+，推荐 |
| `GEORADIUS` | 以给定坐标为圆心搜索 | 6.2 起 deprecated |
| `GEORADIUSBYMEMBER` | 以已有成员为圆心搜索 | 6.2 起 deprecated |

“Deprecated”表示不建议新代码继续使用，并不等同于 Redis 6.2 立即删除了旧命令。迁移关系是：

```text
GEORADIUS / GEORADIUSBYMEMBER
              ↓
GEOSEARCH（只返回）/ GEOSEARCHSTORE（保存结果）
```

## 5. 命令详解

### 5.1 GEOADD：添加或更新位置

```redis
GEOADD key [NX | XX] [CH] longitude latitude member [longitude latitude member ...]
```

- 默认：不存在则新增，存在则更新坐标；
- `NX`：只新增，不更新已有成员；
- `XX`：只更新已有成员，不新增；
- `CH`：返回新增或坐标发生变化的成员数；不加时只统计新增数；
- `NX` 与 `XX` 互斥。

单次可以批量写入多个成员：

```redis
GEOADD geo:stations \
  116.378248 39.865275 北京南站 \
  116.428030 39.903738 北京站 \
  116.322287 39.893729 北京西站
```

每个元素写入的时间复杂度为 `O(log N)`。

### 5.2 GEOPOS：查询坐标

```redis
GEOPOS key member [member ...]
```

示例：

```redis
GEOPOS geo:stations 北京站 北京西站 不存在的站
```

返回顺序仍是“经度、纬度”；不存在的成员返回 `nil/null`。由于坐标会先编码成 52 位值，再解码返回，所以结果可能与写入值存在很小差异。

### 5.3 GEODIST：计算两个成员的距离

```redis
GEODIST key member1 member2 [M | KM | FT | MI]
```

单位：

- `M`：米，默认；
- `KM`：千米；
- `MI`：英里；
- `FT`：英尺。

示例：

```redis
GEODIST geo:stations 北京西站 北京站 KM
```

结果约为：

```text
9.0915 km
```

如果任一成员不存在，返回 `nil/null`。`GEODIST` 只能接受已经存入同一个 GEO key 的成员，不能直接传两个临时坐标。

Redis 使用 Haversine 公式，并把地球视为球体；极端情况下误差可能达到约 0.5%，因此不适合测绘、计费等高精度场景。这里得到的是球面直线距离，不是驾车或步行路线距离。

### 5.4 GEOHASH：查询 Geohash 字符串

```redis
GEOHASH key member [member ...]
```

返回 11 个字符的标准 Geohash。可以从右侧截短以降低精度、扩大表示区域。

注意：

- 前缀相同通常说明位置相近；
- 位置相近不保证前缀一定相同，尤其在网格边界两侧；
- GEO 内部使用的是 52 位整数变体，`GEOHASH` 返回的是便于外部使用的标准字符串。

### 5.5 GEOSEARCH：推荐的范围查询

```redis
GEOSEARCH key
  <FROMMEMBER member | FROMLONLAT longitude latitude>
  <BYRADIUS radius M|KM|FT|MI | BYBOX width height M|KM|FT|MI>
  [ASC | DESC]
  [COUNT count [ANY]]
  [WITHCOORD] [WITHDIST] [WITHHASH]
```

搜索中心二选一：

- `FROMMEMBER member`：以已有成员为中心；
- `FROMLONLAT longitude latitude`：以临时坐标为中心。

搜索形状二选一：

- `BYRADIUS`：圆形范围；
- `BYBOX`：以中心为中心点、宽度和高度给定的轴对齐矩形。

常用选项：

- `ASC`：从近到远；
- `DESC`：从远到近；
- `COUNT n`：最多返回 n 条；
- `COUNT n ANY`：找到足够数量就尽早停止，可能更快，但不保证拿到真正最近的 n 条；
- `WITHDIST`：附带到中心的距离；
- `WITHCOORD`：附带坐标；
- `WITHHASH`：附带内部 52 位 Geohash 值，通常只用于调试。

### 5.6 GEOSEARCHSTORE：保存搜索结果

```redis
GEOSEARCHSTORE destination source
  <FROMMEMBER member | FROMLONLAT longitude latitude>
  <BYRADIUS radius M|KM|FT|MI | BYBOX width height M|KM|FT|MI>
  [ASC | DESC]
  [COUNT count [ANY]]
  [STOREDIST]
```

- 不加 `STOREDIST`：目标 Sorted Set 的 score 仍是地理编码，可继续做 GEO 查询；
- 加 `STOREDIST`：目标 Sorted Set 的 score 是到中心的距离，适合再用 `ZRANGE ... WITHSCORES` 排名，但目标 key 不再是可直接查询的地理索引；
- 命令返回写入目标 key 的元素数量；
- 如果目标 key 已存在，会被结果集替换。

示例：

```redis
GEOSEARCHSTORE geo:nearby:distance geo:stations \
  FROMLONLAT 116.397904 39.909005 \
  BYRADIUS 10 KM ASC STOREDIST

ZRANGE geo:nearby:distance 0 -1 WITHSCORES
```

在 Redis Cluster 中，这是一个涉及源 key 和目标 key 的多 key 命令。可用相同 hash tag 让它们落到同一 slot，例如：

```text
geo:{beijing}:stations
geo:{beijing}:nearby
```

## 6. 性能与工程建议

### 6.1 复杂度

- `GEOADD`：每个成员 `O(log N)`；
- `GEODIST`：`O(1)`；
- `GEOPOS`、`GEOHASH`：每个成员 `O(1)`；
- `GEOSEARCH` / `GEOSEARCHSTORE`：官方标注为 `O(N + log M)`，其中 N 是形状外接网格范围内的候选元素数，M 是索引总元素数。

查询成本取决于范围内的候选密度，而不只是最终返回数量。超大半径、热点区域和无上限返回都可能带来较高延迟。

### 6.2 建议

- 按城市、区域或业务类型拆分 key，避免一个 GEO key 无限制膨胀；
- 查询时尽量设置合理半径和 `COUNT`；
- 只追求低延迟且能接受近似结果时，考虑 `COUNT n ANY`；
- 成员只保存稳定 ID，例如 `station:123`，名称、地址等详情放在 Hash/JSON；
- GEO key 和详情 key 分开设置容量治理与 TTL；过期是 key 级别，不能直接只给某个 GEO member 设置 TTL；
- 动态对象离线时用 `ZREM` 移除，或另外维护心跳时间并定期清理；
- 道路距离、路径规划、复杂多边形、跨坐标系转换应交给地图/GIS 服务；
- 如果还要按名称、标签、价格等条件联合过滤，可考虑 Redis Search 的 GEO/GEOSHAPE 能力，而不是只用基础 GEO 命令。

## 7. 官方资料

- [Redis geospatial 数据类型](https://redis.io/docs/latest/develop/data-types/geospatial/)
- [GEOADD](https://redis.io/docs/latest/commands/geoadd/)
- [GEODIST](https://redis.io/docs/latest/commands/geodist/)
- [GEOHASH](https://redis.io/docs/latest/commands/geohash/)
- [GEOPOS](https://redis.io/docs/latest/commands/geopos/)
- [GEOSEARCH](https://redis.io/docs/latest/commands/geosearch/)
- [GEOSEARCHSTORE](https://redis.io/docs/latest/commands/geosearchstore/)
- [GEORADIUS（deprecated）](https://redis.io/docs/latest/commands/georadius/)
