---
title: Redis 缓存异常治理：穿透、击穿、雪崩与工具封装
published: 2026-07-07
description: 系统分析 Redis 缓存穿透、击穿与雪崩的成因和解决方案，实践缓存空对象、互斥锁、逻辑过期与随机 TTL，并封装可复用的缓存查询工具。
tags:
  - Redis
  - 缓存穿透
  - 缓存击穿
  - 缓存雪崩
  - 缓存工具
category: Redis
draft: false
pinned: false
comments: true
id: post-630852fc14
permalink: /posts/redis/rediscachepassthrough/
image: soda
author: Aron
---

## 缓存穿透

缓存穿透是指客户端请求的数据在缓存和数据库中都不存在，导致每次请求都会打到数据库。

典型场景：

- 恶意请求不存在的 id
- 随机请求大量非法 key
- 数据库中确实没有对应数据

解决方案：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 缓存空对象 | 实现简单，维护方便 | 占用额外内存，可能造成短期不一致 |
| 布隆过滤器 | 内存占用低，不会产生大量空 key | 实现复杂，存在误判，不支持天然删除 |

### 缓存空对象

核心逻辑：

1. 查询 Redis。
2. 如果 Redis 返回正常 JSON，说明缓存命中，直接返回。
3. 如果 Redis 返回空字符串，说明之前查库不存在，直接返回不存在。
4. 如果 Redis 返回 null，说明缓存未命中，查询数据库。
5. 数据库不存在时，将空字符串写入 Redis，并设置较短 TTL。

```java
public Shop queryWithPassThrough(Long id) {
    String key = "cache:shop:" + id;

    String shopJson = stringRedisTemplate.opsForValue().get(key);

    if (StrUtil.isNotEmpty(shopJson)) {
        return JSONUtil.toBean(shopJson, Shop.class);
    }

    if (shopJson != null) {
        return null;
    }

    Shop shop = getById(id);
    if (shop == null) {
        stringRedisTemplate.opsForValue().set(
                key,
                "",
                2L,
                TimeUnit.MINUTES
        );
        return null;
    }

    stringRedisTemplate.opsForValue().set(
            key,
            JSONUtil.toJsonStr(shop),
            30L,
            TimeUnit.MINUTES
    );

    return shop;
}
```

注意：

- 空值缓存的 TTL 要短一些。
- 数据库新增该数据时，需要主动删除对应空值缓存。
- 空字符串和 null 的语义不同：空字符串表示缓存命中但业务数据不存在，null 表示缓存未命中。

### 布隆过滤器

布隆过滤器可以在访问 Redis 前判断 key 是否可能存在。

流程：

1. 请求进来后，先经过布隆过滤器。
2. 如果布隆过滤器判断不存在，直接拒绝。
3. 如果判断可能存在，再继续访问 Redis。
4. Redis 未命中时再查数据库并写缓存。

特点：

- 布隆过滤器判断不存在，一定不存在。
- 布隆过滤器判断存在，可能存在，也可能误判。
- 适合数据量大、非法请求多的场景。

## 缓存雪崩

缓存雪崩是指同一时间大量缓存 key 同时失效，或者 Redis 服务宕机，导致大量请求直接访问数据库，数据库压力瞬间升高。

常见原因：

- 大量 key 设置了相同 TTL
- Redis 宕机
- 缓存服务不可用
- 热点数据集中失效

解决方案：

- 给不同 key 的 TTL 添加随机值，避免同时过期。
- 搭建 Redis 主从、哨兵或集群，提高可用性。
- 给缓存业务添加限流、熔断、降级。
- 使用多级缓存，例如本地缓存 + Redis。
- 核心热点数据可以提前预热。

示例：

```java
long ttl = 30L + RandomUtil.randomLong(1, 10);
stringRedisTemplate.opsForValue().set(
        key,
        JSONUtil.toJsonStr(shop),
        ttl,
        TimeUnit.MINUTES
);
```

## 缓存击穿

缓存击穿也叫热点 key 问题。

它指的是某个被高并发访问的热点 key 突然失效，导致大量请求同时发现缓存未命中，并发查询数据库、重建缓存，给数据库造成瞬时冲击。

缓存击穿和缓存雪崩的区别：

- 缓存击穿：一个热点 key 失效。
- 缓存雪崩：大量 key 同时失效，或 Redis 整体不可用。

解决方案：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 互斥锁 | 没有额外内存消耗，一致性较好，实现简单 | 线程需要等待，性能受影响，存在死锁风险 |
| 逻辑过期 | 线程无需等待，性能较好 | 不保证强一致性，有额外内存消耗，实现更复杂 |

## 互斥锁解决缓存击穿

核心思想：

1. 查询缓存。
2. 命中则返回。
3. 未命中时尝试获取互斥锁。
4. 获取锁成功的线程查询数据库并重建缓存。
5. 获取锁失败的线程休眠一小段时间后重试。
6. 重建完成后释放锁。

```java
public Shop queryWithMutex(Long id) {
    String key = "cache:shop:" + id;

    String shopJson = stringRedisTemplate.opsForValue().get(key);

    if (StrUtil.isNotEmpty(shopJson)) {
        return JSONUtil.toBean(shopJson, Shop.class);
    }

    if (shopJson != null) {
        return null;
    }

    String lockKey = "lock:shop:" + id;
    Shop shop = null;

    try {
        boolean isLock = tryLock(lockKey);
        if (!isLock) {
            Thread.sleep(50);
            return queryWithMutex(id);
        }

        shop = getById(id);
        if (shop == null) {
            stringRedisTemplate.opsForValue().set(
                    key,
                    "",
                    2L,
                    TimeUnit.MINUTES
            );
            return null;
        }

        stringRedisTemplate.opsForValue().set(
                key,
                JSONUtil.toJsonStr(shop),
                30L,
                TimeUnit.MINUTES
        );
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new RuntimeException(e);
    } finally {
        unLock(lockKey);
    }

    return shop;
}

private boolean tryLock(String key) {
    Boolean flag = stringRedisTemplate.opsForValue()
            .setIfAbsent(key, "1", 10, TimeUnit.SECONDS);
    return BooleanUtil.isTrue(flag);
}

private void unLock(String key) {
    stringRedisTemplate.delete(key);
}
```

注意：

- 加锁需要设置过期时间，避免业务异常导致锁永远不释放。
- 获取锁失败后应短暂休眠再重试，避免 CPU 空转。
- 释放锁最好校验锁标识，避免误删其他线程的锁。生产环境建议使用 Redisson。

## 逻辑过期解决缓存击穿

逻辑过期不是依赖 Redis TTL 删除 key，而是在 value 中额外保存一个过期时间字段。

数据结构示例：

```json
{
  "data": {
    "id": 1,
    "name": "Jack"
  },
  "expireTime": "2026-07-06T20:00:00"
}
```

核心思想：

1. 热点数据提前写入 Redis，不设置 Redis TTL。
2. 查询时先读取缓存。
3. 如果逻辑时间未过期，直接返回。
4. 如果逻辑时间已过期，尝试获取互斥锁。
5. 获取锁成功，则开启独立线程异步重建缓存。
6. 当前请求先返回旧数据。
7. 获取锁失败，也直接返回旧数据。

适用场景：

- 热点数据
- 允许短暂返回旧数据
- 更关注可用性和响应速度，而不是强一致性

```java
@Data
public class RedisData {
    private LocalDateTime expireTime;
    private Object data;
}
```

预热热点数据：

```java
public void saveShop2Redis(Long id, Long expireSeconds) {
    Shop shop = getById(id);

    RedisData redisData = new RedisData();
    redisData.setData(shop);
    redisData.setExpireTime(LocalDateTime.now().plusSeconds(expireSeconds));

    stringRedisTemplate.opsForValue().set(
            "cache:shop:" + id,
            JSONUtil.toJsonStr(redisData)
    );
}
```

查询逻辑：

```java
private static final ExecutorService CACHE_REBUILD_EXECUTOR =
        Executors.newFixedThreadPool(10);

public Shop queryWithLogicalExpire(Long id) {
    String key = "cache:shop:" + id;

    String shopJson = stringRedisTemplate.opsForValue().get(key);

    if (StrUtil.isEmpty(shopJson)) {
        return null;
    }

    RedisData redisData = JSONUtil.toBean(shopJson, RedisData.class);
    JSONObject data = (JSONObject) redisData.getData();
    Shop shop = JSONUtil.toBean(data, Shop.class);

    LocalDateTime expireTime = redisData.getExpireTime();
    if (expireTime.isAfter(LocalDateTime.now())) {
        return shop;
    }

    String lockKey = "lock:shop:" + id;
    boolean isLock = tryLock(lockKey);

    if (isLock) {
        CACHE_REBUILD_EXECUTOR.execute(() -> {
            try {
                saveShop2Redis(id, 30L);
            } finally {
                unLock(lockKey);
            }
        });
    }

    return shop;
}
```

逻辑过期的特点：

- 不会因为热点 key 失效导致请求全部打到数据库。
- 请求线程不等待缓存重建，响应速度快。
- 可能短暂返回旧数据，因此不适合强一致性场景。

## 缓存工具封装

可以基于 `StringRedisTemplate` 封装一个通用缓存工具类，统一处理：

1. 普通缓存写入，并设置 TTL。
2. 逻辑过期缓存写入。
3. 缓存穿透查询。
4. 逻辑过期查询。

```java
@Component
@Slf4j
public class CacheClient {

    private final StringRedisTemplate stringRedisTemplate;

    private static final ExecutorService CACHE_REBUILD_EXECUTOR =
            Executors.newFixedThreadPool(10);

    public CacheClient(StringRedisTemplate stringRedisTemplate) {
        this.stringRedisTemplate = stringRedisTemplate;
    }

    public void set(String key, Object value, Long time, TimeUnit timeUnit) {
        stringRedisTemplate.opsForValue().set(
                key,
                JSONUtil.toJsonStr(value),
                time,
                timeUnit
        );
    }

    public void setWithLogicalExpire(
            String key,
            Object value,
            Long time,
            TimeUnit timeUnit
    ) {
        RedisData redisData = new RedisData();
        redisData.setData(value);
        redisData.setExpireTime(LocalDateTime.now().plusSeconds(timeUnit.toSeconds(time)));

        stringRedisTemplate.opsForValue().set(
                key,
                JSONUtil.toJsonStr(redisData)
        );
    }

    public <R, ID> R queryWithPassThrough(
            String keyPrefix,
            ID id,
            Class<R> type,
            Function<ID, R> dbFallback,
            Long time,
            TimeUnit timeUnit
    ) {
        String key = keyPrefix + id;

        String json = stringRedisTemplate.opsForValue().get(key);

        if (StrUtil.isNotEmpty(json)) {
            return JSONUtil.toBean(json, type);
        }

        if (json != null) {
            return null;
        }

        R r = dbFallback.apply(id);

        if (r == null) {
            stringRedisTemplate.opsForValue().set(
                    key,
                    "",
                    2L,
                    TimeUnit.MINUTES
            );
            return null;
        }

        this.set(key, r, time, timeUnit);

        return r;
    }

    public <R, ID> R queryWithLogicalExpire(
            String keyPrefix,
            ID id,
            Class<R> type,
            Function<ID, R> dbFallback,
            Long time,
            TimeUnit timeUnit
    ) {
        String key = keyPrefix + id;

        String json = stringRedisTemplate.opsForValue().get(key);

        if (StrUtil.isEmpty(json)) {
            return null;
        }

        RedisData redisData = JSONUtil.toBean(json, RedisData.class);
        R r = JSONUtil.toBean((JSONObject) redisData.getData(), type);

        LocalDateTime expireTime = redisData.getExpireTime();
        if (expireTime.isAfter(LocalDateTime.now())) {
            return r;
        }

        String lockKey = "lock:" + key;
        boolean isLock = tryLock(lockKey);

        if (isLock) {
            CACHE_REBUILD_EXECUTOR.execute(() -> {
                try {
                    R freshData = dbFallback.apply(id);
                    this.setWithLogicalExpire(key, freshData, time, timeUnit);
                } finally {
                    unLock(lockKey);
                }
            });
        }

        return r;
    }

    private boolean tryLock(String key) {
        Boolean flag = stringRedisTemplate.opsForValue()
                .setIfAbsent(key, "1", 10, TimeUnit.SECONDS);
        return BooleanUtil.isTrue(flag);
    }

    private void unLock(String key) {
        stringRedisTemplate.delete(key);
    }
}
```

## 业务调用示例

```java
@Override
public Result queryById(Long id) {
    Shop shop = cacheClient.queryWithLogicalExpire(
            RedisConstants.CACHE_SHOP_KEY,
            id,
            Shop.class,
            this::getById,
            RedisConstants.CACHE_SHOP_TTL,
            TimeUnit.MINUTES
    );

    if (shop == null) {
        return Result.fail("店铺不存在");
    }

    return Result.ok(shop);
}
```

测试预热逻辑过期缓存：

```java
@SpringBootTest
class HmDianPingApplicationTests {

    @Resource
    private ShopServiceImpl shopService;

    @Resource
    private CacheClient cacheClient;

    @Test
    void testSaveShop() {
        Shop shop = shopService.getById(1L);
        cacheClient.setWithLogicalExpire(
                RedisConstants.CACHE_SHOP_KEY + 1L,
                shop,
                10L,
                TimeUnit.SECONDS
        );
    }
}
```
