---
title: MySQL 基础（一）：数据库概念、SQL 分类与 DDL
published: 2026-08-07
updated: 2026-10-26
description: 从 MySQL 服务与会话入门，理解数据库、表和 SQL 分类，使用统一的部门员工模型讲解类型选择、字符集、建表、结构查看与 DDL 变更。
tags: [MySQL, MySQL入门, SQL, DDL, 数据类型]
category: MySQL
draft: false
pinned: false
comments: true
id: mysql-ddl
permalink: /posts/mysql/01-概述与ddl/
image: rooftop
author: Aron
---

> [MySQL 入门指南](./00-MySQL入门指南.md) · 第一章：建立数据库与核心表结构。

本章先分清数据库、管理系统和 SQL，再创建后续章节共同使用的 `mysql_learn` 数据库、`dept` 部门表和 `emp` 员工表。示例以 MySQL 8.4、InnoDB 为主。

## 一、数据库与关系模型

| 概念 | 含义 | 示例 |
| --- | --- | --- |
| DB | 按结构组织和保存的数据集合 | `mysql_learn` 数据库 |
| DBMS | 管理数据库的软件 | MySQL |
| SQL | 定义、查询和修改关系数据的语言 | `SELECT`、`CREATE TABLE` |

表由行与列组成：一行描述一个对象或一次事件，一列描述一种属性。主键用于唯一标识行，外键用于表达并约束引用关系。

一个实例可以管理多个数据库，一个数据库可以包含多张表。表的逻辑结构不等于底层文件布局，普通 SQL 操作应通过服务端完成，不直接编辑数据文件。

## 二、启动服务与连接实例

服务名取决于安装方式。Linux 的 systemd 环境中，常见名称是 `mysql.service` 或 `mysqld.service`，先确认再操作：

```bash
systemctl status mysql.service
```

Windows 中可能使用安装时指定的服务名，例如：

```bat
net start MySQL84
```

`MySQL84` 只是名称示例。macOS 官方安装包、软件包管理器或容器也各有启动方式，不要把一种环境的服务命令当作通用入口。

连接本机 TCP 服务：

```bash
mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root -p
```

| 参数 | 用途 |
| --- | --- |
| `--protocol=TCP` | 明确使用 TCP |
| `-h` | 服务端地址 |
| `-P` | 端口，大写 `P`，常见默认值为 3306 |
| `-u` | 数据库用户名，不是操作系统用户名的自动映射 |
| `-p` | 提示输入密码，不在命令行附加明文密码 |

使用实际被授权的账号连接。进入后可以检查：

```sql
SELECT VERSION(), DATABASE(), CURRENT_USER();
SHOW DATABASES;
SHOW VARIABLES LIKE 'character_set_server';
SHOW VARIABLES LIKE 'collation_server';
```

`DATABASE()` 返回 `NULL`，通常只是尚未选择默认数据库。退出使用 `EXIT;` 或 `QUIT;`，退出前确认未完成的事务如何处理。

## 三、SQL 分类与书写方式

| 类别 | 主要用途 | 常见语句 |
| --- | --- | --- |
| DDL | 定义对象结构 | `CREATE`、`ALTER`、`DROP`、`TRUNCATE` |
| DML | 插入、修改、删除数据 | `INSERT`、`UPDATE`、`DELETE` |
| 查询，常单列为 DQL | 从数据中获得结果 | `SELECT` |
| 权限控制，常称 DCL | 管理账号与授权 | `CREATE USER`、`GRANT`、`REVOKE` |
| 事务控制，常称 TCL | 确定提交和撤销边界 | `START TRANSACTION`、`COMMIT`、`ROLLBACK` |

这些分类用于组织知识，不代表每一类都有完全相同的事务行为。尤其是 DDL，不能按普通数据修改的方式期待回滚。

字符串和日期使用单引号，标识符需要引用时使用反引号。SQL 关键字一般不区分大小写，表名的行为则受平台与配置影响，建议统一小写。

## 四、先选择合适的数据类型

### 整数与金额

| 类型 | 字节数 | 有符号范围 | 常见用途 |
| --- | ---: | --- | --- |
| `TINYINT` | 1 | -128～127 | 状态、小范围计数 |
| `SMALLINT` | 2 | -32768～32767 | 小范围整数 |
| `MEDIUMINT` | 3 | -8388608～8388607 | 中等范围整数 |
| `INT` | 4 | -2³¹～2³¹-1 | 一般计数和编号 |
| `BIGINT` | 8 | -2⁶³～2⁶³-1 | 较大范围编号与计数 |

`UNSIGNED` 禁止负数，并扩大正数范围。例如 `TINYINT UNSIGNED` 为 0～255。类型范围与业务范围是两件事，年龄仍可以通过约束限制为不超过 120。

| 小数类型 | 特点 | 适合场景 |
| --- | --- | --- |
| `FLOAT`、`DOUBLE` | 近似值 | 测量、统计等允许误差的计算 |
| `DECIMAL(M,D)` | 精确定点数 | 金额等需要十进制精度的值 |

`DECIMAL(10,2)` 总计最多 10 位数字，其中 2 位小数、8 位整数。应用侧也需要使用合适的十进制类型，不能在传入数据库前就先丢失精度。

### 字符串、二进制与 JSON

| 类型 | 主要特点 | 选择时关注 |
| --- | --- | --- |
| `CHAR(n)` | 定长字符类型 | 固定长度代码，填充与比较受规则影响 |
| `VARCHAR(n)` | 变长字符串，n 是最大字符数 | 字符集、行大小与索引长度 |
| `TEXT` 系列 | 长文本 | 不同类型有不同字节容量 |
| `BINARY`、`VARBINARY`、`BLOB` 系列 | 二进制数据 | 按字节保存和比较 |
| `JSON` | 验证并保存 JSON 文档 | 适合扩展属性，不能代替所有关系建模 |

工号、手机号等即使由数字构成，也可能有前导零或格式规则，通常应使用字符类型。电话号码不一定固定为 11 位，长度应按实际业务和国际号码需求确定。

### 日期与时间

| 类型 | 含义 | 注意点 |
| --- | --- | --- |
| `DATE` | 日期 | 例如入职日期 |
| `TIME` | 时间或持续时间 | 取值范围不限于一天中的时刻 |
| `DATETIME` | 不自动按会话时区转换的日期时间值 | 必须在业务上约定时区含义 |
| `TIMESTAMP` | 写入和读取时受会话时区转换影响的时间值 | 范围与 `DATETIME` 不同 |
| `YEAR` | 年份 | 用于只保存年份的场景 |

`DATETIME(6)`、`TIMESTAMP(6)` 可以保存微秒精度。跨时区系统应统一存储、连接和展示策略，不能仅靠字段名称叫“时间戳”就假定所有转换已正确完成。

## 五、创建数据库与核心表

下面的结构供后续章节使用。需要具备相应建库建表权限，且不要在已包含业务数据的同名数据库中重复初始化。

```sql
CREATE DATABASE mysql_learn
    DEFAULT CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

USE mysql_learn;

CREATE TABLE dept (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_dept_name (name)
) ENGINE = InnoDB;

CREATE TABLE emp (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    work_no VARCHAR(10) NOT NULL,
    name VARCHAR(50) NOT NULL,
    nickname VARCHAR(50) NULL,
    gender VARCHAR(10) NULL,
    age TINYINT UNSIGNED NULL,
    email VARCHAR(100) NULL,
    salary DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    entry_date DATE NOT NULL,
    status TINYINT NOT NULL DEFAULT 1,
    work_address VARCHAR(100) NULL,
    dept_id BIGINT UNSIGNED NULL,
    manager_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_emp_work_no (work_no),
    UNIQUE KEY uk_emp_email (email),
    CONSTRAINT chk_emp_age CHECK (age IS NULL OR age <= 120),
    CONSTRAINT chk_emp_salary CHECK (salary >= 0),
    CONSTRAINT chk_emp_status CHECK (status IN (0,1)),
    CONSTRAINT fk_emp_dept FOREIGN KEY (dept_id)
        REFERENCES dept(id) ON DELETE SET NULL,
    CONSTRAINT fk_emp_manager FOREIGN KEY (manager_id)
        REFERENCES emp(id) ON DELETE SET NULL
) ENGINE = InnoDB;
```

这里不使用 `IF NOT EXISTS` 掩盖已有对象：数据库或表已经存在时，先查看定义，确认是否确实是本套示例结构。

### 字符集与排序规则

`utf8mb4` 支持完整 Unicode 字符范围。排序规则控制比较与排序；`utf8mb4_0900_ai_ci` 中 `ai` 表示不区分重音，`ci` 表示不区分大小写，这也影响唯一键如何判断重复。

数据库默认规则通常由新建表继承，表默认规则通常由新建字符列继承。更改默认值不会自动把所有已有列和已有数据都转换过去。

### 为什么在结构里写约束

工号唯一、姓名必填、薪资非负和部门引用有效，都是数据规则。数据库约束可以阻止不符合规则的写入，但它不能替代业务对“这个人能否调薪”等操作权限的判断。

## 六、查看与修改结构

```sql
SHOW TABLES;
DESCRIBE emp;
SHOW CREATE TABLE emp;
SHOW CREATE DATABASE mysql_learn;
```

`SHOW CREATE TABLE` 能展示索引、约束和选项，比只看字段列表更完整。

下面的变更示例仅操作一个临时添加的备注列，不改变后续章节依赖的核心字段：

```sql
ALTER TABLE emp ADD COLUMN remark VARCHAR(100) NULL;
ALTER TABLE emp MODIFY COLUMN remark VARCHAR(200) NULL;
ALTER TABLE emp RENAME COLUMN remark TO note;
ALTER TABLE emp DROP COLUMN note;
```

`MODIFY`、`CHANGE` 需要正确重述所需的列属性，不能假定所有原属性都会自动保留。类型收窄、非空约束和默认值变更，要先检查已有数据是否满足要求。

结构变更可能持有元数据锁，也可能重建表。是否在线、是否立即完成取决于具体操作、版本和表条件，不能因为写法短就认定对业务没有影响。

## 七、删除、清空与事务边界

以下只展示语法，**不要对贯穿示例的表执行后再期待后续章节继续可用**：

```sql
DROP TABLE example_table;
TRUNCATE TABLE example_table;
DELETE FROM example_table WHERE id = 10;
```

| 操作 | 结构是否保留 | 是否能按 WHERE 过滤 | 事务特点 |
| --- | --- | --- | --- |
| `DROP TABLE` | 否 | 否 | 通常隐式提交，不能通过普通 ROLLBACK 恢复 |
| `TRUNCATE TABLE` | 是 | 否 | DDL，通常隐式提交，并重置自增计数 |
| `DELETE` | 是 | 是 | 对 InnoDB，未提交事务中的删除通常可回滚 |

MySQL 的原子 DDL 主要保证支持范围内的操作在崩溃恢复时保持一致，不代表用户可以把 DDL 与普通 DML 一起随意回滚。数据安全仍需要正确的变更流程和备份。

## 八、命令速查

| 语句 | 用途 |
| --- | --- |
| `SELECT VERSION()` | 查看服务端版本 |
| `SELECT DATABASE()` | 查看当前数据库 |
| `USE 数据库` | 切换当前数据库 |
| `SHOW TABLES` | 查看当前数据库的表 |
| `DESCRIBE 表` | 查看列结构 |
| `SHOW CREATE TABLE 表` | 查看完整建表定义 |
| `ALTER TABLE 表 ADD COLUMN ...` | 添加列 |
| `ALTER TABLE 表 RENAME COLUMN 旧列 TO 新列` | 重命名列 |

---

上一篇：[指南导读与环境准备](./00-MySQL入门指南.md) · 下一篇：[DML 数据操作与单表查询](./02-DML与DQL.md) · [指南目录](./00-MySQL入门指南.md)。
