---
title: MySQL 入门（七）：应用连接与 SQL 安全
published: 2026-10-26
updated: 2026-10-26
description: 从驱动和连接参数出发，讲解参数化查询、动态标识符、事务清理、连接池、超时、字符集、时区与 TLS，并提供最小 Python 查询示例。
tags: [MySQL, MySQL入门, 参数化查询, 连接池, SQL安全]
category: MySQL
draft: false
pinned: false
comments: true
id: mysql-app-connections
permalink: /posts/mysql/07-application-connections/
image: rooftop
author: Aron
---

> [MySQL 入门指南](./00-MySQL入门指南.md) · 第七章：让程序正确地建立连接、传入参数并管理状态。

应用通过驱动与 MySQL 通信。能在命令行里执行 SQL，并不意味着把字符串拼接进程序就完成了数据库访问：账号、参数绑定、事务边界、连接释放与超时都需要明确处理。

本章以 MySQL Connector/Python 演示接口。其他语言的驱动可能使用不同占位符和默认设置，不能照搬参数形式。

## 一、连接需要哪些信息

| 信息 | 含义 |
| --- | --- |
| 主机与端口 | 目标实例的网络入口，不一定与本机相同 |
| 用户名与认证信息 | 已经创建、且来源和权限匹配的数据库账号 |
| 数据库 | 连接后使用的默认数据库 |
| 字符集 | 客户端与服务端如何解释传输的文本 |
| TLS 配置 | 是否要求加密、信任哪个 CA、如何校验服务器身份 |
| 超时 | 连接、读取、写入等阶段各自的时间限制 |

命令行能够连接而程序失败时，先比较两者是否使用相同的协议、地址、账号、数据库和证书。图形工具可能通过 SSH 隧道连接，程序直连时并不会自动复用隧道。

配置可以由环境或配置服务提供，但不要把明文密码写入仓库、日志和报错页面。环境变量只是传递方式，不会自动解决权限、泄露和轮换问题。

## 二、参数化查询：SQL 结构与数据分离

MySQL Connector/Python 的普通 cursor 使用 `%s` 或命名占位符绑定值。`%s` 不是让 Python 自行执行字符串格式化：

```python
sql = "SELECT id, name, salary FROM emp WHERE work_no = %s"
cursor.execute(sql, ("E0002",))
```

第二个参数是元组；只有一个元素时仍需要逗号。不要在 SQL 的占位符外手动加引号，驱动负责将值按其接口规则发送或处理。

| 方式 | 问题或用途 |
| --- | --- |
| 将用户输入直接拼进 SQL | 输入可能改变语句结构，产生注入风险 |
| 自行替换单引号 | 容易遗漏编码、模式和上下文差异 |
| 驱动参数绑定 | 把数据值按驱动契约作为参数处理 |
| 服务端预处理 | 另一层准备与执行机制，具体使用由驱动配置决定 |

参数化可以处理恶意引号和分隔符，但不能替代业务授权，也不能让任何查询都变得低成本。

### SQL 层的预处理格式

下面在同一 SQL 会话中执行，展示问号参数与值绑定：

```sql
PREPARE emp_by_no FROM
    'SELECT id, name, salary FROM emp WHERE work_no = ?';
SET @work_no = 'E0002';
EXECUTE emp_by_no USING @work_no;
DEALLOCATE PREPARE emp_by_no;
```

这里的问号属于 SQL PREPARE 语法，与上面 Python cursor 使用的 `%s` 不是可以任意交换的写法。

## 三、动态排序和 IN 列表

占位符通常只能表示数据值，不能代替表名、列名、关键字或排序方向。

需要允许用户选择排序字段时，用程序内定义的白名单映射：

```python
allowed_columns = {"name": "name", "salary": "salary", "joined": "entry_date"}
column = allowed_columns.get(requested_sort)
if column is None:
    raise ValueError("不支持的排序字段")

sql = f"SELECT id, name, salary FROM emp ORDER BY {column}, id LIMIT %s"
cursor.execute(sql, (20,))
```

被拼入结构的是程序里预先定义的列名，不是原始输入。方向同样需要白名单，不能认为加上反引号就解决了所有动态 SQL 问题。

动态 IN 列表通常需要为每个值生成一个占位符，再绑定对应值；同时限制列表长度，并明确空列表时返回空结果还是跳过筛选。不能把一个逗号字符串绑定到单个占位符，就期待它成为多个 SQL 值。

LIKE 的 `%` 和 `_` 仍有模式意义。参数绑定防止结构注入，却不会自动把用户输入变成纯字面搜索，是否转义应按查询需求决定。

## 四、最小可读的 Python 查询示例

使用独立 Python 环境安装 `mysql-connector-python`。下面程序查询固定工号，不修改数据；依赖前面章节已经建立的表、数据和可读账号。

```python
import os
import mysql.connector

connection = mysql.connector.connect(
    host=os.environ.get("DB_HOST", "127.0.0.1"),
    port=int(os.environ.get("DB_PORT", "3306")),
    user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    database="mysql_learn",
    charset="utf8mb4",
    connection_timeout=5,
    autocommit=True,
)

try:
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id, name, salary FROM emp WHERE work_no = %s",
            ("E0002",),
        )
        for row in cursor.fetchall():
            print(row["id"], row["name"], row["salary"])
    finally:
        cursor.close()
finally:
    connection.close()
```

运行环境需要提供 `DB_USER` 和 `DB_PASSWORD`；未配置时程序会明确报错，而不是回退到内置密码。远程连接还要按证书条件补充 TLS 身份验证设置，本例只展示本机开发连接的基本结构。

### 这些设置解决什么

| 设置或结构 | 作用 |
| --- | --- |
| 显式 `autocommit=True` | 说明这个独立读取示例的提交方式，不依赖驱动默认值 |
| `connection_timeout=5` | 限制连接阶段，不等于所有 SQL 最多运行五秒 |
| 参数绑定 | 不把工号拼成 SQL 代码 |
| `finally` 关闭 cursor 和连接 | 在正常或异常路径释放资源 |
| `fetchall` | 一次读取本次小结果；大结果不应无界读入内存 |

驱动常将 DECIMAL 返回为十进制类型，应用应保留这种精度，再按接口需求序列化。不要为了方便输出就先转换为浮点数。

## 五、程序中的事务边界

事务应绑定同一条连接。把两条更新分别交给连接池的不同连接，不能自动形成一个事务。

```text
从连接池取得连接
确认连接处于可用且干净的状态
显式开始事务
执行并检查每一步数据库操作
成功则提交
失败则回滚；连接不可用时按策略丢弃
最后归还或关闭连接
```

驱动可能默认关闭自动提交，不能用命令行客户端的默认值推断程序行为。需要明确设置，并检查连接池是否在复用时重置了相应状态。

提交期间断线时，客户端可能不知道服务端最终是否提交。对写操作进行自动重试，必须结合幂等标识和状态查询，不能简单重新执行全部语句。

数据库事务不会把支付接口、邮件或消息发送自动纳入同一个原子边界。跨系统操作需要额外的流程设计，例如可追踪的业务状态和可靠事件处理。

## 六、连接池与会话状态

连接池复用已建立的连接，减少反复认证和建立连接的成本，但会把会话状态也带入复用问题。

| 可能残留的状态 | 为什么需要处理 |
| --- | --- |
| 未结束事务 | 下一次使用可能继承锁或未提交修改 |
| autocommit 与隔离级别 | 新请求可能按错误语义执行 |
| 会话时区、sql_mode | 时间与输入校验行为变化 |
| 临时表、用户变量 | 请求之间可能产生数据和逻辑污染 |
| 未读完结果集 | 下一条命令可能无法按预期执行 |

确认驱动和连接池的重置行为，不能假定“close 方法”总是物理断开连接。对池连接而言，它可能只是归还。

连接池大小应结合实例连接容量、查询耗时和应用并发调整。一个慢 SQL 占住连接很久时，盲目增加连接数可能把等待放大到数据库端。

## 七、字符集、时区与 TLS

### 字符集要贯穿整个链路

应用字符串、驱动连接、数据库列和导入文件需要使用兼容编码。表使用 utf8mb4，不代表连接中发送的字节就一定按 utf8mb4 解释。

```sql
SHOW VARIABLES LIKE 'character_set_%';
SELECT @@session.time_zone;
```

已经错误转码后写入的数据，不能只通过更改连接字符集自动修复。

### 明确时间含义

TIMESTAMP 按会话时区进行转换，DATETIME 不会自动知道某个值来自哪个时区。应用、连接和存储字段应有统一约定，例如按 UTC 处理时间点，再在展示层转换。

把会话时区设为 `'+00:00'` 与使用命名时区规则是不同做法；命名时区还依赖服务器相关时区数据。日期型业务，如生日和账期，未必应该当作可转换的时间点。

### 加密与身份验证是两层要求

命令行连接格式示例：

```bash
mysql -h db.example.test -P 3306 -u app_user -p \
  --ssl-mode=VERIFY_IDENTITY \
  --ssl-ca=/path/to/ca.pem \
  mysql_learn
```

地址和证书路径需要替换，证书中的服务器名称需要与连接名匹配。仅要求加密，与同时验证 CA 和服务器名称，提供的保证不同。

认证失败时，先检查客户端版本、认证插件支持与 TLS 条件，不要直接关闭校验或切换已弃用的认证方式。

## 八、常见问题与速查

| 问题 | 优先检查 |
| --- | --- |
| Access denied | 匹配账号、来源、密码、账号状态和认证方式 |
| 连接超时 | 地址、端口、网络、监听与连接阶段设置 |
| 连接成功但表不存在 | 当前数据库、对象名大小写和初始化状态 |
| 修改后其他连接看不到 | 是否提交、是否在同一事务快照、是否连接到同一实例 |
| 连接池耗尽 | 慢 SQL、未释放连接、长事务和池容量 |
| 重试后重复数据 | 唯一业务键、幂等和提交结果不确定性 |
| 大查询内存升高 | 返回列、行数、批量读取与处理方式 |

记录问题时可以保留 SQL 模板、错误码、耗时、连接目标和请求标识，但避免把密码、令牌和完整敏感参数写入日志。

---

上一篇：[视图、CTE 与窗口函数](./06-视图CTE与窗口函数.md) · 下一篇：[备份恢复与日常维护](./08-备份恢复与日常维护.md) · [指南目录](./00-MySQL入门指南.md)。
