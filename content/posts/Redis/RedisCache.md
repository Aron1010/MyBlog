---
title: Redis 缓存入门：缓存更新策略与一致性设计
published: 2026-07-07
description: 介绍应用接入 Redis 缓存的基本流程，对比内存淘汰、超时剔除、主动更新以及 Cache Aside、Read/Write
  Through、Write Behind，并分析缓存更新顺序与一致性问题。
tags:
  - Redis
  - 缓存
  - 缓存更新
  - Cache Aside
  - 缓存一致性
category: Redis
draft: false
pinned: false
comments: true
id: post-6959affe74
permalink: /posts/redis/rediscache/
image: rooftop
author: Aron
---

缓存是数据交换的缓冲区，用来临时存储热点数据。相比数据库，缓存通常具备更高的读写性能。

常见缓存层级：

- 浏览器缓存
- 应用层缓存，例如 Tomcat、本地缓存
- 分布式缓存，例如 Redis
- 数据库缓存
- 操作系统缓存、CPU 缓存、磁盘缓存

缓存的主要作用：

- 降低后端数据库压力
- 提高读写效率
- 降低接口响应时间
- 提升系统吞吐量

缓存带来的成本：

- 数据一致性成本
- 代码维护成本
- 运维成本
- 缓存异常场景处理成本

## 添加 Redis 缓存

常见的查询模型是 Cache Aside Pattern，也叫旁路缓存模式。

查询流程：

1. 客户端提交查询请求。
2. 服务端先根据 key 查询 Redis。
3. 如果缓存命中，直接返回缓存数据。
4. 如果缓存未命中，查询数据库。
5. 如果数据库存在数据，将数据写入 Redis，并返回结果。
6. 如果数据库不存在数据，返回错误或空结果。

示例：

```java
public Result queryById(Long id) {
    String key = "cache:shop:" + id;

    String shopJson = stringRedisTemplate.opsForValue().get(key);
    if (StrUtil.isNotEmpty(shopJson)) {
        Shop shop = JSONUtil.toBean(shopJson, Shop.class);
        return Result.ok(shop);
    }

    Shop shop = getById(id);
    if (shop == null) {
        return Result.fail("商铺不存在");
    }

    stringRedisTemplate.opsForValue().set(
            key,
            JSONUtil.toJsonStr(shop),
            30L,
            TimeUnit.MINUTES
    );

    return Result.ok(shop);
}
```

## 缓存更新策略

常见缓存更新策略有三种。

| 策略 | 说明 | 一致性 | 维护成本 |
| --- | --- | --- | --- |
| 内存淘汰 | 依赖 Redis 内存淘汰机制，内存不足时自动淘汰部分数据 | 差 | 无 |
| 超时剔除 | 给缓存设置 TTL，到期后自动删除，下次查询时重新加载 | 一般 | 低 |
| 主动更新 | 修改数据库时，同时更新或删除缓存 | 好 | 高 |

业务选择建议：

- 低一致性需求：使用 Redis 自带的内存淘汰机制，例如店铺类型、排行榜等不敏感数据。
- 高一致性需求：使用主动更新，并结合超时剔除作为兜底方案，例如店铺详情、商品详情等核心数据。

## 主动更新模式

主动更新有三种常见模式：

### Cache Aside Pattern

由业务代码维护缓存和数据库。

读操作：

1. 先查缓存。
2. 命中则直接返回。
3. 未命中则查数据库。
4. 数据库存在则写入缓存。
5. 数据库不存在则返回空结果。

写操作：

1. 先更新数据库。
2. 再删除缓存。

这是业务系统中最常见的方案。

### Read/Write Through Pattern

缓存与数据库被整合成一个服务，调用者只访问这个服务，不直接感知缓存一致性问题。

优点是调用方简单，缺点是实现复杂，需要专门维护缓存服务。

### Write Behind Caching Pattern

调用者只操作缓存，由缓存异步把数据持久化到数据库，保证最终一致。

优点是写性能好，缺点是数据可靠性和一致性风险更高，常用于对一致性要求不强、写入压力很高的场景。

## Cache Aside 的关键问题

### 删除缓存还是更新缓存

推荐删除缓存。

更新缓存的问题是：每次数据库更新后都要重新写缓存，如果该数据后续没有被读取，就产生了无效写操作。

删除缓存的好处是：缓存失效后，等下一次查询时再重新构建，避免无效写。

### 先操作数据库还是先操作缓存

推荐：

1. 先更新数据库。
2. 再删除缓存。

原因是这个顺序出现数据不一致的概率更低。

### 如何保证数据库和缓存同时成功或失败

单体系统中，可以把数据库操作和缓存操作放在一个事务流程中。

分布式系统中，可以考虑：

- TCC
- 可靠消息
- Canal 监听 binlog
- 延迟双删
- 重试补偿机制

示例：

```java
@Transactional
public Result update(Shop shop) {
    Long id = shop.getId();
    if (id == null) {
        return Result.fail("店铺id不能为空");
    }

    updateById(shop);

    stringRedisTemplate.delete("cache:shop:" + id);

    return Result.ok();
}
```
