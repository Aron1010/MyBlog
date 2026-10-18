---
title: MySQL 基础（一）：数据库概念、SQL 分类与 DDL
published: 2026-08-07
description: 从 DB、DBMS 与 SQL 的基本概念入门，介绍 MySQL 服务启动、命令行连接和环境检查，梳理 SQL
  分类，并详解数据库与表的创建、数据类型、结构修改及删除操作。
tags:
  - MySQL
  - MySQL入门
  - SQL
  - DDL
  - 数据类型
category: MySQL
draft: false
pinned: false
comments: true
id: mysql-ddl
permalink: /posts/mysql/01-概述与ddl/
image: rooftop
author: Aron
---

## 1. 数据库与 MySQL 基本概念

### 1.1 DB、DBMS 与 SQL

| 概念 | 全称 | 含义 |
| --- | --- | --- |
| DB | Database | 按一定结构组织、长期存储的数据集合 |
| DBMS | Database Management System | 创建、管理和操作数据库的软件，如 MySQL |
| SQL | Structured Query Language | 操作关系型数据库的标准语言 |

MySQL 是关系型数据库管理系统。关系型数据库以二维表组织数据：

- 一行称为一条记录。
- 一列称为一个字段。
- 表之间可以通过主键、外键建立关系。
- 一个 MySQL 服务实例可以管理多个数据库，一个数据库可以包含多张表。

### 1.2 MySQL 版本

MySQL 常见版本包括社区版和企业版。本文MySQL 8.0.26 社区版，本文 SQL 以 MySQL 8.0 语法为主。

### 1.3 关系型数据库的核心特点

- 数据结构统一，便于查询和维护。
- 支持约束，以保证数据的正确性、有效性和完整性。
- 支持事务，以保证一组操作要么全部成功，要么全部失败。
- 使用 SQL 作为主要操作语言。

---

## 2. MySQL 的启动、连接与基本操作

### 2.1 Windows 服务启动与停止

以管理员身份打开命令行：

```bat
net start mysql80
net stop mysql80
```

`mysql80` 是资料安装示例中的服务名，实际名称取决于安装配置。

### 2.2 命令行连接

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p
```

参数说明：

| 参数 | 作用 |
| --- | --- |
| `-h` | MySQL 服务所在主机；本机连接时可以省略 |
| `-P` | 端口，默认是 `3306`；注意为大写 `P` |
| `-u` | 用户名 |
| `-p` | 提示输入密码；不要直接把密码写在命令中 |

常用退出命令：

```sql
EXIT;
-- 或
QUIT;
```

### 2.3 连接后先检查环境

```sql
SELECT VERSION();
SELECT DATABASE();
SHOW DATABASES;
SHOW VARIABLES LIKE 'character_set_server';
SHOW VARIABLES LIKE 'collation_server';
```

---

## 3. SQL 通用语法与分类

### 3.1 通用语法

- SQL 可以写成一行或多行，通常以分号 `;` 结束。
- SQL 关键字不区分大小写，但推荐关键字大写、对象名小写。
- 使用空格和缩进提高可读性。
- 字符串和日期通常使用单引号，例如 `'张三'`、`'2026-08-07'`。
- 标识符与字符串含义不同。必要时可用反引号包围表名或字段名，例如 `` `order` ``。

注释：

```sql
-- 单行注释：双横线后应有空格
# MySQL 风格单行注释
/* 多行注释 */
```

### 3.2 SQL 分类

| 分类 | 全称 | 用途 | 常见关键字 |
| --- | --- | --- | --- |
| DDL | Data Definition Language | 定义数据库对象 | `CREATE`、`ALTER`、`DROP`、`TRUNCATE` |
| DML | Data Manipulation Language | 对表中数据增删改 | `INSERT`、`UPDATE`、`DELETE` |
| DQL | Data Query Language | 查询数据 | `SELECT` |
| DCL | Data Control Language | 用户和权限控制 | `CREATE USER`、`GRANT`、`REVOKE` |
| TCL | Transaction Control Language | 控制事务 | `COMMIT`、`ROLLBACK`、`SAVEPOINT` |

---

## 4. DDL：数据库和表结构

### 4.1 数据库操作

```sql
-- 查看所有数据库
SHOW DATABASES;

-- 创建数据库；不存在时才创建
CREATE DATABASE IF NOT EXISTS mysql_learn
    DEFAULT CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

-- 使用数据库
USE mysql_learn;

-- 查看当前数据库
SELECT DATABASE();

-- 查看建库语句
SHOW CREATE DATABASE mysql_learn;

-- 删除数据库；谨慎执行
DROP DATABASE IF EXISTS mysql_learn;
```

`utf8mb4` 可以完整保存 Unicode 字符。排序规则决定字符串的比较和排序方式，实际项目应按业务要求统一选择。

### 4.2 表的创建与查看

```sql
CREATE TABLE employee (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT COMMENT '主键',
    work_no VARCHAR(10) NOT NULL UNIQUE COMMENT '工号',
    name VARCHAR(50) NOT NULL COMMENT '姓名',
    gender CHAR(1) COMMENT '性别',
    age TINYINT UNSIGNED COMMENT '年龄',
    id_card CHAR(18) UNIQUE COMMENT '身份证号',
    salary DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT '薪资',
    entry_date DATE COMMENT '入职日期',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    CONSTRAINT chk_employee_age CHECK (age IS NULL OR age <= 120)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COMMENT = '员工表';
```

```sql
SHOW TABLES;
DESC employee;
SHOW CREATE TABLE employee;
```

### 4.3 常用数据类型

#### 4.3.1 整数类型

| 类型 | 字节 | 有符号范围 | 无符号范围 | 常见用途 |
| --- | ---: | --- | --- | --- |
| `TINYINT` | 1 | -128 ～ 127 | 0 ～ 255 | 状态、小范围整数、年龄 |
| `SMALLINT` | 2 | -32768 ～ 32767 | 0 ～ 65535 | 较小计数 |
| `MEDIUMINT` | 3 | -8388608 ～ 8388607 | 0 ～ 16777215 | 中等范围整数 |
| `INT` / `INTEGER` | 4 | -2³¹ ～ 2³¹-1 | 0 ～ 2³²-1 | 常规整数、编号 |
| `BIGINT` | 8 | -2⁶³ ～ 2⁶³-1 | 0 ～ 2⁶⁴-1 | 大型系统主键、超大计数 |

`UNSIGNED` 表示不允许负数，可扩大正数范围：

```sql
age TINYINT UNSIGNED
```

#### 4.3.2 小数类型

| 类型 | 特点 | 适用场景 |
| --- | --- | --- |
| `FLOAT` | 单精度近似值 | 对精度要求不高的测量值 |
| `DOUBLE` | 双精度近似值 | 更大范围的近似计算 |
| `DECIMAL(M,D)` | 精确定点数 | 金额、财务数据、需要精确小数的场景 |

`M` 是总有效数字位数，`D` 是小数位数：

```sql
price DECIMAL(10, 2)
```

金额不要优先使用 `FLOAT` 或 `DOUBLE`，因为二进制浮点数可能产生精度误差。

#### 4.3.3 字符串与二进制类型

| 类型 | 特点 | 适用场景 |
| --- | --- | --- |
| `CHAR(n)` | 定长；不足长度时内部按定长处理 | 性别码、固定长度编号 |
| `VARCHAR(n)` | 变长；`n` 表示最大字符数 | 姓名、地址、可变长度文本 |
| `TINYTEXT` / `TEXT` / `MEDIUMTEXT` / `LONGTEXT` | 不同容量的长文本 | 文章、备注、长描述 |
| `TINYBLOB` / `BLOB` / `MEDIUMBLOB` / `LONGBLOB` | 不同容量的二进制数据 | 二进制内容 |

选择建议：

- 手机号、身份证号、工号不是用于算术运算的数字，应使用字符类型。
- `CHAR(11)` 适合固定长度手机号；姓名通常使用 `VARCHAR`。
- 大型图片、视频通常保存到对象存储或文件系统，数据库保存路径和元数据。
- `VARCHAR` 能保存的实际字节数受字符集和行大小限制，不能只看声明的最大字符数。

#### 4.3.4 日期时间类型

| 类型 | 常用格式 | 说明 |
| --- | --- | --- |
| `DATE` | `YYYY-MM-DD` | 日期 |
| `TIME` | `HH:MM:SS` | 时间或持续时间 |
| `YEAR` | `YYYY` | 年份 |
| `DATETIME` | `YYYY-MM-DD HH:MM:SS` | 日期和时间，适合业务时间 |
| `TIMESTAMP` | `YYYY-MM-DD HH:MM:SS` | 时间戳，常用于记录创建/更新时间 |

`TIMESTAMP` 的显示会受会话时区影响；`DATETIME` 保存的是给定的日期时间值。跨时区系统应明确统一的时区策略。

### 4.4 修改表结构

```sql
-- 添加字段
ALTER TABLE employee
    ADD COLUMN nickname VARCHAR(30) COMMENT '昵称';

-- 修改字段类型或约束
ALTER TABLE employee
    MODIFY COLUMN nickname VARCHAR(50) NOT NULL COMMENT '昵称';

-- 同时修改字段名与定义
ALTER TABLE employee
    CHANGE COLUMN nickname display_name VARCHAR(50) COMMENT '显示名';

-- 删除字段
ALTER TABLE employee
    DROP COLUMN display_name;

-- 修改表名
ALTER TABLE employee
    RENAME TO emp;
```

### 4.5 删除、清空与区别

```sql
-- 删除表结构和数据
DROP TABLE IF EXISTS emp;

-- 保留表结构，快速清空全表数据
TRUNCATE TABLE emp;

-- 保留表结构，按条件删除数据
DELETE FROM emp WHERE id = 10;
```

| 操作 | 删除结构 | 支持 `WHERE` | 事务与回滚特征 | 常见用途 |
| --- | --- | --- | --- | --- |
| `DROP TABLE` | 是 | 否 | DDL，通常隐式提交 | 不再需要该表 |
| `TRUNCATE TABLE` | 否 | 否 | DDL，通常隐式提交 | 快速清空整表 |
| `DELETE` | 否 | 是 | DML，可在事务中回滚 | 按条件删除记录 |

执行 `DROP`、`TRUNCATE` 或无 `WHERE` 的 `DELETE` 前，应先确认数据库、表名和数据备份。

---
