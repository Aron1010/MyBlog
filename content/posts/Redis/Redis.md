---
title: Redis 入门指南：NoSQL 基础、数据类型与常用命令
published: 2026-07-06
description: 从 NoSQL 与 Redis 的核心特性入门，整理基础配置、通用 Key 操作及
  String、Hash、List、Set、Sorted Set 等常用命令，并介绍 Redis Key 的层级设计。
tags:
  - Redis
  - NoSQL
  - Redis入门
  - Redis命令
  - 数据结构
category: Redis
draft: false
pinned: false
comments: true
id: post-2bf0368967
permalink: /posts/redis/redis/
image: summer
author: Aron
---

## 一 认识 NoSQL  
**1. SQL与NoSQL对比**
| 对比项  | SQL                   | NoSQL                       |
| ---- | --------------------- | --------------------------- |
| 数据结构 | 结构化 Structured        | 非结构化                        |
| 数据关联 | 关联的 Relational        | 无关联的                        |
| 查询方式 | SQL 查询                | 非 SQL                       |
| 事务特性 | ACID                  | BASE                        |
| 存储方式 | 磁盘                    | 内存                          |
| 扩展性  | 垂直扩展                  | 水平扩展                        |
| 使用场景 | 数据结构固定；对数据安全性、一致性要求较高 | 数据结构不固定；对一致性、安全性要求不高；对性能要求高 |
  
**2. NoSQL 类型**  
1. **键值类型**：Redis  
2. **文档类型**：MongoDB  
3. **列类型**：HBase  
4. **Graph 图类型**：Neo4j  
  
## 二 认识 Redis  
**1. 定义**
   Redis 远程字典服务器 基于内存的键值型 NoSQL 数据库

**2. 常用于：**
* 缓存  
* 登录验证码  
* Session 共享  
* 排行榜  
* 计数器  
* 分布式锁  
* 消息队列  
* 热点数据存储  
  
**3. Redis特征**
* 键值 key-value 类型  
    * Redis 以 key-value 的形式存储数据。  
    * value 支持多种数据结构，功能丰富。  
* 单线程  
    * Redis 主要命令执行是单线程的。  
    * 每个命令具备原子性。  
* 低延迟、速度快
    * Redis 基于内存操作。  
    * 使用 IO 多路复用。  
    * 编码设计良好，所以读写速度快。  
* 支持数据持久化
    * Redis 虽然主要基于内存，但可以把数据保存到磁盘。  
    * 防止服务器重启后数据全部丢失。  
* 支持主从集群、分片集群
    * 可以通过主从复制提高读能力和可用性。  
    * 可以通过分片集群提升容量和并发能力。  
* 支持多语言客户端
    * Java、Python、PHP、Go、Node.js 等语言都可以连接 Redis。 
 
**4. Redis 常见数据类型**
| 数据类型   | 说明                  | 常见用途       |
| ------ | ------------------- | ---------- |
| String | 字符串类型，最基础类型         | 缓存、验证码、计数器 |
| Hash   | 哈希类型，类似 Java 中的 Map | 存储对象信息     |
| List   | 列表类型，有序可重复          | 消息队列、任务列表  |
| Set    | 集合类型，无序不重复          | 去重、共同好友    |
| ZSet   | 有序集合，带分数排序          | 排行榜、积分排名   |

**5. Redis 和 MySQL 的区别**
| 对比项   | Redis     | MySQL   |
| ----- | --------- | ------- |
| 数据库类型 | NoSQL 数据库 | 关系型数据库  |
| 数据结构  | key-value | 表结构     |
| 存储位置  | 主要在内存     | 主要在磁盘   |
| 查询方式  | Redis 命令  | SQL 语句  |
| 速度    | 快         | 相对较慢    |
| 事务特性  | 较弱        | 支持 ACID |
| 常见用途  | 缓存、高并发读写  | 持久化业务数据 |

**6. Redis 的持久化方式**  
Redis 支持把内存中的数据保存到磁盘，常见方式有：
* RDB
    * 定时生成数据快照。  
    * 优点：恢复速度快，文件小。  
    * 缺点：可能丢失最近一段时间的数据。  
* AOF
    * 记录每一次写操作命令。  
    * 优点：数据更安全。  
    * 缺点：文件可能较大，恢复速度相对慢。  

## 三 Redis配置内容 
**1. 网络与后台运行配置**  
```
# 监听的地址，默认是127.0.0.1，会导致只能在本地访问
# 修改为0.0.0.0则可以在任意IP访问，生产环境不要设置为0.0.0.0
bind 0.0.0.0 

# 守护进程，修改为yes后即可后台运行
daemonize yes

# 密码，设置后访问Redis必须输入密码
requirepass 123321
```
**2. 端口、目录、数据库、内存和日志配置**  
```
# 监听的端口,Redis 默认端口号是6379
port 6379

# 工作目录，默认是当前目录，也就是运行redis-server时的命令
# 日志、持久化等文件会保存在这个目录
dir .

# 数据库数量，设置为1，代表只使用1个库
# 默认有16个库，编号0~15
databases 1

# 设置redis能够使用的最大内存
maxmemory 512mb

# 日志文件，默认为空，不记录日志，可以指定日志文件名
logfile "redis.log"
```  

  
  
## 四 Redis相关命令  
**1. 通用命令**
| 命令                   | 作用          |
| -------------------- | ----------- |
| keys *               | 查看所有 key    |
| keys user:*          | 按规则查看 key   |
| scan 0               | 渐进式扫描 key   |
| exists key           | 判断 key 是否存在 |
| del key              | 删除 key      |
| type key             | 查看 key 类型   |
| expire key 秒数        | 设置过期时间      |
| ttl key              | 查看剩余过期时间    |
| persist key          | 取消过期时间      |
| rename oldkey newkey | 修改 key 名称   |
| randomkey            | 随机返回一个 key  |
| select 0             | 切换数据库       |
| flushdb              | 清空当前数据库     |
| flushall             | 清空所有数据库     |
  
  
**2. String类型**
* **介绍**

| 内容       | 示例                                  |
| -------- | ----------------------------------- |
| 普通字符串    | name = zhangsan                     |
| 数字       | age = 18                            |
| JSON 字符串 | user = {"name":"zhangsan","age":18} |
| 验证码      | code = 123456                       |
| token    | token = xxxxxx                      |

* **命令**

| 命令                           | 作用           |
| ---------------------------- | ------------ |
| set key value                | 设置值          |
| get key                      | 获取值          |
| mset key1 value1 key2 value2 | 设置多个值        |
| mget key1 key2               | 获取多个值        |
| incr key                     | 自增 1         |
| decr key                     | 自减 1         |
| incrby key 数字                | 增加指定整数       |
| decrby key 数字                | 减少指定整数       |
| incrbyfloat key 数字           | 增加小数         |
| setex key 秒 value            | 设置值并指定秒级过期时间 |
| setnx key value              | key 不存在时才设置  |
| append key value             | 追加字符串        |
| strlen key                   | 获取字符串长度      |
| getrange key start end       | 截取字符串        |
| setrange key offset value    | 修改指定位置内容     |
| getset key value             | 获取旧值并设置新值    |
  
* **场景**

| 场景       | 示例                             |
| -------- | ------------------------------ |
| 缓存数据     | set user:1 "张三"                |
| 验证码      | setex code:1001 60 123456      |
| 计数器      | incr article:readcount:1       |
| 登录 token | setex token:user:1 3600 abc123 |
| 分布式锁     | set lock:order 1 nx ex 10      |
  
**3. Hash类型**
* **介绍**

| key    | field  | value    |
| ------ | ------ | -------- |
| user:1 | name   | zhangsan |
| user:1 | age    | 18       |
| user:1 | gender | male     |
  
* **命令**

| 命令                        | 作用        |
| ------------------------- | --------- |
| hset key field value      | 设置字段值     |
| hget key field            | 获取字段值     |
| hmget key field1 field2   | 获取多个字段值   |
| hgetall key               | 获取所有字段和值  |
| hdel key field            | 删除字段      |
| hexists key field         | 判断字段是否存在  |
| hkeys key                 | 获取所有字段名   |
| hvals key                 | 获取所有字段值   |
| hlen key                  | 获取字段数量    |
| hincrby key field 数字      | 字段整数自增    |
| hincrbyfloat key field 数字 | 字段小数自增    |
| hsetnx key field value    | 字段不存在时才设置 |
  
* **场景**

| 场景   | 示例           |
| ---- | ------------ |
| 用户信息 | user:1       |
| 商品信息 | product:1001 |
| 购物车  | cart:user:1  |
| 订单信息 | order:1001   |
| 店铺信息 | shop:1       |
  
  
**4. List类型**
* **介绍**

| 特点       | 说明            |
| -------- | ------------- |
| 有序       | 按插入顺序保存       |
| 可重复      | 相同元素可以出现多次    |
| 可从两端操作   | 可以从左边或右边插入、删除 |
| 底层类似双端队列 | 适合做队列、栈       |
  
* **命令**

| 命令                              | 作用        |
| ------------------------------- | --------- |
| lpush key value                 | 从左侧添加元素   |
| rpush key value                 | 从右侧添加元素   |
| lrange key start stop           | 查看指定范围元素  |
| lindex key index                | 根据下标获取元素  |
| llen key                        | 获取列表长度    |
| lpop key                        | 从左侧弹出元素   |
| rpop key                        | 从右侧弹出元素   |
| lrem key count value            | 删除指定元素    |
| lset key index value            | 根据下标修改元素  |
| ltrim key start stop            | 截取列表      |
| linsert key before/after 元素 新元素 | 在指定元素前后插入 |
| blpop key timeout               | 阻塞式左侧弹出   |
| brpop key timeout               | 阻塞式右侧弹出   |
  
* **场景**

| 场景   | 说明        |
| ---- | --------- |
| 消息队列 | 一边插入，一边取出 |
| 任务队列 | 保存待处理任务   |
| 最新评论 | 保存最新几条评论  |
| 浏览记录 | 保存用户浏览顺序  |
| 栈结构  | 后进先出      |
| 队列结构 | 先进先出      |
  
  
**5. Set类型**
* **介绍**

| 特点     | 说明          |
| ------ | ----------- |
| 无序     | 元素没有固定顺序    |
| 不重复    | 相同元素只能保存一次  |
| 支持集合运算 | 可以求交集、并集、差集 |
  
* **命令**

| 命令                              | 作用         |
| ------------------------------- | ---------- |
| sadd key member                 | 添加元素       |
| smembers key                    | 查看所有元素     |
| sismember key member            | 判断元素是否存在   |
| scard key                       | 获取集合元素数量   |
| srem key member                 | 删除指定元素     |
| spop key                        | 随机删除并返回元素  |
| srandmember key                 | 随机返回元素，不删除 |
| smove source destination member | 移动元素       |
| sinter key1 key2                | 求交集        |
| sunion key1 key2                | 求并集        |
| sdiff key1 key2                 | 求差集        |
| sinterstore result key1 key2    | 保存交集结果     |
| sunionstore result key1 key2    | 保存并集结果     |
| sdiffstore result key1 key2     | 保存差集结果     |
  
* **场景**

| 场景   | 说明           | 示例                                   |
| ---- | ------------ | ------------------------------------ |
| 去重   | 利用 Set 不重复特点 | 用户签到、访问 IP                           |
| 共同好友 | 使用交集         | sinter user:1:friends user:2:friends |
| 共同关注 | 使用交集         | 两个用户都关注了谁                            |
| 推荐好友 | 使用差集         | A 关注但 B 未关注                          |
| 标签系统 | 保存用户标签       | user:1:tags                          |
| 抽奖   | 随机获取元素       | srandmember users 1                  |
| 点赞   | 保存点赞用户 ID    | article:1:likes                      |
  
  
**6. ZSet/SortedSet**
* **介绍**

| 特点      | 说明                   |
| ------- | -------------------- |
| 元素不重复   | member 不能重复          |
| 每个元素有分数 | 每个 member 都有一个 score |
| 按分数排序   | Redis 根据 score 进行排序  |
| 适合排行榜   | 比如积分榜、热度榜、成绩排名       |
  
* **命令**

| 命令                               | 作用          |
| -------------------------------- | ----------- |
| zadd key score member            | 添加元素        |
| zrange key start stop            | 按分数从小到大查询   |
| zrevrange key start stop         | 按分数从大到小查询   |
| zrange key start stop withscores | 查询时带分数      |
| zscore key member                | 获取元素分数      |
| zrank key member                 | 获取从小到大排名    |
| zrevrank key member              | 获取从大到小排名    |
| zrangebyscore key min max        | 按分数范围查询     |
| zrevrangebyscore key max min     | 按分数范围倒序查询   |
| zrem key member                  | 删除元素        |
| zincrby key increment member     | 增加元素分数      |
| zcard key                        | 获取元素总数      |
| zcount key min max               | 获取分数范围内元素数量 |
| zremrangebyrank key start stop   | 按排名范围删除     |
| zremrangebyscore key min max     | 按分数范围删除     |
  
* **场景**

| 场景    | 说明           |
| ----- | ------------ |
| 排行榜   | 按分数排名        |
| 成绩排名  | 按成绩高低排序      |
| 热度榜   | 按点赞数、浏览量排序   |
| 积分榜   | 按用户积分排序      |
| 延迟队列  | score 可以存时间戳 |
| 商品销量榜 | 按销量排序        |
  

## 五 Key 的层级结构
Redis 中常用 : 来分隔 key 的层级。  
格式一般是：项目名:业务名: id:字段名  
  
  
**Key 层级结构示例**  
假设有一个用户模块，可以这样设计：  
```

user:1:name
user:1:age
user:1:gender
user:2:name
user:2:age
user:2:gender
```

查看所有用户相关 key。
```
keys user:*

```
 
查看用户 1 的所有信息。 
```
keys user:1:*
```
 
**常见业务场景写法**

| 场景       | Key 示例             | 类型     |
| -------- | ------------------ | ------ |
| 用户对象     | user:1             | Hash   |
| 商品对象     | product:1001       | Hash   |
| 验证码      | login:code:手机号     | String |
| 登录 token | login:token:user:1 | String |
| 购物车      | cart:user:1        | Hash   |
| 商品库存     | stock:product:1001 | String |
| 文章点赞数    | article:1001:like  | String |
| 排行榜      | rank:score         | ZSet   |
| 用户关注列表   | follow:user:1      | Set    |
