---
title: Redis 全局唯一 ID 实战：秒杀下单、超卖与一人一单
published: 2026-07-11
description: 基于 Redis 自增与时间戳设计全局唯一 ID 生成器，并以优惠券秒杀为例处理库存超卖、乐观锁、一人一单，以及单机锁在集群环境中的失效问题。
tags:
  - Redis
  - 全局唯一ID
  - 秒杀系统
  - 乐观锁
  - 超卖问题
category: Redis
draft: false
pinned: false
comments: true
id: post-851c2b442f
permalink: /posts/redis/全局唯一id/
image: station
author: Aron
---

## 全局ID生成器

订单表使用数据库自增ID存在一些问题：

- ID的规律性太明显，容易暴露业务数据量
- 分库分表后，不同表可能生成重复ID
- 受单表数据量和单库写入能力的限制

全局ID生成器，是一种在分布式系统下用来生成全局唯一ID的工具，一般要满足下列特性：

- 唯一性
- 高可用
- 高性能
- 递增性
- 安全性

为了增加ID的安全性，不直接使用Redis自增的数值，而是拼接时间戳等其它信息。

### ID的组成

64位long类型表示：

- 符号位：1 bit，固定为0
- 时间戳：31 bit，以秒为单位，大约可以使用68年
- 序列号：32 bit，使用Redis自增值生成

```text
0 | 31位时间戳 | 32位序列号
```

生成公式：

```java
return timestamp << COUNT_BITS | count;
```

使用相对时间戳而不是完整时间戳，可以减少时间戳占用的位数。

### Redis自增策略

Redis Key按照“业务类型+日期”划分：

```text
icr:order:2026:07:09
icr:order:2026:07:10
```

这样可以让不同业务使用不同计数器，并且能够按天统计订单量。

Redis的INCR命令是原子操作，多线程并发执行时不会生成重复序号。

代码中的计数器实际上是按天递增，因此同一个Key在一天内不能超过2^32 - 1。
### RedisIdWorker.java

```java
@Component
public class RedisIdWorker {

    // 开始时间戳
    private static final long BEGIN_TIMESTAMP = 1783555200L;
    // 序列号的位数
    private static final int COUNT_BITS = 32;

    private StringRedisTemplate stringRedisTemplate;

    public RedisIdWorker(StringRedisTemplate stringRedisTemplate) {
        this.stringRedisTemplate = stringRedisTemplate;
    }

    public long nextId(String keyPrefix) {
        // 1.生成时间戳
        LocalDateTime now = LocalDateTime.now();
        long nowSecond = now.toEpochSecond(ZoneOffset.UTC);
        long timestamp  = nowSecond - BEGIN_TIMESTAMP;
        // 2.生成序列号
        // 2.1获取当前日期，精确到日
        String date = now.format(DateTimeFormatter.ofPattern("yyyy:MM:dd"));
        long count = stringRedisTemplate.opsForValue().increment("icr:" + keyPrefix + ":" + date);
        // 3.拼接并返回
        return timestamp << COUNT_BITS | count;
    }
    public static void main(String[] args) {
        LocalDateTime time = LocalDateTime.of(2026, 7, 9, 0, 0, 0);
        long second = time.toEpochSecond(ZoneOffset.UTC);
        System.out.println(second);
    }
}
```

### HmDianPingApplicationTests.java

```java
@Resource
private RedisIdWorker redisIdWorker;

private ExecutorService es = Executors.newFixedThreadPool(500);

@Test
void testIDWorker() throws InterruptedException {
    CountDownLatch latch = new CountDownLatch(300);

    Runnable task = () -> {
        try {
            for (int i = 0; i < 100; i++) {
                long id = redisIdWorker.nextId("order");
                System.out.println("id= " + id);
            }
        } finally {
            latch.countDown();
        }
    };

    long begin = System.currentTimeMillis();

    for (int i = 0; i < 300; i++) {
        es.submit(task);
    }

    latch.await();

    long end = System.currentTimeMillis();

    System.out.println("time = " + (end - begin));

    es.shutdown();
}
```

全局ID常见实现还有：

- UUID
- 数据库自增
- Redis自增
- Snowflake雪花算法

## 优惠券添加

数据库使用两张表保存优惠券信息：

`tb_voucher`保存优惠券基本信息，例如优惠金额、使用规则、折扣信息和店铺ID。

`tb_seckill_voucher`保存秒杀库存、秒杀开始时间和秒杀结束时间。只有秒杀优惠券才需要保存这些信息。

### VoucherController.java

```java
@RestController
@RequestMapping("/voucher")
public class VoucherController {

    @Resource
    private IVoucherService voucherService;

    /**
     * 新增秒杀券
     * @param voucher 优惠券信息，包含秒杀信息
     * @return 优惠券id
     */
    @PostMapping("seckill")
    public Result addSeckillVoucher(@RequestBody Voucher voucher) {
        voucherService.addSeckillVoucher(voucher);
        return Result.ok(voucher.getId());
    }
}
```

### VoucherOrderServiceImpl.java

```java
@Override
@Transactional
public Result seckillVoucher(Long voucherId) {
    // 1.查询优惠卷
    SeckillVoucher voucher = seckillVoucherService.getById(voucherId);
    // 2.判断秒杀是否开始
    if (voucher.getBeginTime().isAfter(LocalDateTime.now())) {
        // 尚未开始
        return Result.fail("秒杀尚未开始:");
    }
    // 3.判断秒杀时候已经结束
    if (voucher.getEndTime().isBefore(LocalDateTime.now())) {
        return Result.fail("秒杀已经结束:");
    }
    // 4.判断库存是否充足
    if (voucher.getStock()<1) {
        // 库存不足
        return Result.fail("库存不足");
    }
    // 5.扣减库存
    boolean success = seckillVoucherService.update()
            .setSql("stock = stock - 1")
            .eq("voucher_id", voucherId)
            .update();
    if(!success) {
        // 扣减失败
        return Result.fail("库存不足");
    }
    // 6.创建订单
    VoucherOrder voucherOrder = new VoucherOrder();
    // 6.1 订单id
    long orderId = redisIdWorker.nextId("order");
    voucherOrder.setId(orderId);
    // 6.2 用户id
    Long userId = UserHolder.getUser().getId();
    voucherOrder.setUserId(userId);
    // 6.3 代金劵id
    voucherOrder.setVoucherId(voucherId);
    save(voucherOrder);
    // 7 返回订单
    return Result.ok(orderId);
}
```


## 商品超卖


原因是查询库存、判断库存和扣减库存不是一个不可分割的原子操作。

### 悲观锁

悲观锁认为线程安全问题一定会发生，因此操作共享数据前先获取锁，使线程串行执行。

常见实现：

- synchronized
- Lock
- 数据库排他锁

优点是实现简单、安全性直观；缺点是线程需要等待，并发性能相对较低。

### 乐观锁

乐观锁不直接加锁，而是在更新数据时判断数据是否已经被其他线程修改。

常见方式：

- 版本号法
- CAS法
- 使用库存本身作为判断条件

版本号法：

```sql
UPDATE tb_seckill_voucher
SET stock = stock - 1,
    version = version + 1
WHERE voucher_id = ?
  AND version = ?;
```

秒杀库存只需要保证库存不小于0，可以使用stock > 0作为更新条件：

### VoucherOrderServiceImpl.java
```java
// 5.扣减库存
boolean success = seckillVoucherService.update()
        .setSql("stock = stock - 1")
        .eq("voucher_id", voucherId).gt("stock",0)
        .update();
if(!success) {
    // 扣减失败
    return Result.fail("库存不足");
}
```

## 一人一单

需求：同一个用户只能购买同一种优惠券一次。

### 单机环境加锁

### VoucherOrderServiceImpl.java
```java
Long userId = UserHolder.getUser().getId();
synchronized(userId.toString().intern()) {
    // 获取代理对象(事物)
    IVoucherOrderService proxy = (IVoucherOrderService) AopContext.currentProxy();
    return proxy.createVoucherOrder(voucherId);
}
```

锁对象使用用户ID，能够使同一用户的请求互斥，同时允许不同用户并发下单。

### 创建订单

### VoucherOrderServiceImpl.java

```java
@Transactional
public Result createVoucherOrder(Long voucherId) {
    // 一人一单
    Long userId = UserHolder.getUser().getId();
    // 查询订单
    int count = query().eq("user_id", userId).eq("voucher_id", voucherId).count();
    // 判断是否存在
    if (count > 0) {
        // 用户已经购买过了
        return Result.fail("用户已经购买一次");
    }

    // 5.扣减库存
    boolean success = seckillVoucherService.update()
            .setSql("stock = stock - 1") // set stock = stock - 1
            .eq("voucher_id", voucherId).gt("stock",0) // where id = ? and stock = ?
            .update();
    if(!success) {
        // 扣减失败
        return Result.fail("库存不足");
    }

    // 6.创建订单
    VoucherOrder voucherOrder = new VoucherOrder();
    // 6.1 订单id
    long orderId = redisIdWorker.nextId("order");
    voucherOrder.setId(orderId);
    // 6.2 用户id
    voucherOrder.setUserId(userId);
    // 6.3 代金劵id
    voucherOrder.setVoucherId(voucherId);
    save(voucherOrder);
    // 7 返回订单
    return Result.ok(orderId);
}
```

### HmDianPingApplication.java

```java
// 启动类
@EnableAspectJAutoProxy(exposeProxy = true)
@MapperScan("com.hmdp.mapper")
@SpringBootApplication
public class HmDianPingApplication {

    public static void main(String[] args) {
        SpringApplication.run(HmDianPingApplication.class, args);
    }
}
```
### xml

```xml
<dependency>
    <groupId>org.aspectj</groupId>
    <artifactId>aspectjweaver</artifactId>
</dependency>
```

### 数据库唯一索引兜底

即使业务代码已经加锁，也建议在数据库中增加唯一索引：

```sql
ALTER TABLE tb_voucher_order
ADD CONSTRAINT uk_user_voucher
UNIQUE (user_id, voucher_id);
```

唯一索引是“一人一单”的最后一道防线，可以防止程序异常、锁失效或重复消息造成重复订单。

## 集群环境中的锁失效问题


集群环境下，请求可能分别进入JVM1和JVM2。每个JVM都有自己的锁监视器，因此两个线程都可能获得各自JVM中的锁。

`synchronized`只能保证单个JVM内部互斥，不能解决集群环境中的并发问题。
