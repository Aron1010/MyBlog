---
title: MySQL 基础（二）：DML 数据操作与 DQL 单表查询
published: 2026-08-07
updated: 2026-10-26
description: 用统一的部门员工数据讲解插入、更新、删除、NULL 与三值逻辑，掌握条件、聚合、分组、排序和分页，并理解查询的逻辑处理顺序。
tags: [MySQL, MySQL入门, DML, DQL, SQL查询]
category: MySQL
draft: false
pinned: false
comments: true
id: post-bd1667f899
permalink: /posts/mysql/02-dml与dql/
image: anna-hydrangea
author: Aron
---

> [MySQL 入门指南](./00-MySQL入门指南.md) · 第二章：写入数据并得到正确的单表查询结果。

本章使用第一章创建的 `dept` 和 `emp`。先写入固定示例数据，再说明增删改查。示例中的姓名、邮箱和金额用于说明数据行为，不代表真实人员信息。

## 一、准备各章共同使用的数据

下面是一次性的初始化语句，要求第一章的两张表已经创建且为空。重复执行会触发主键或唯一键冲突，不要通过忽略错误掩盖重复初始化。

```sql
USE mysql_learn;

INSERT INTO dept (id, name)
VALUES (1, '研发部'), (2, '市场部'), (3, '设计部');

INSERT INTO emp
    (id, work_no, name, age, email, salary, entry_date,
     status, work_address, dept_id, manager_id)
VALUES
    (1, 'E0001', '林舟', 34, 'lin@example.test', 15000.00,
     '2020-03-01', 1, '北京', 1, NULL),
    (3, 'E0003', '张宁', 30, 'zhang@example.test', 9000.00,
     '2021-06-15', 1, '北京', 2, NULL);

INSERT INTO emp
    (id, work_no, name, nickname, age, email, salary, entry_date,
     status, work_address, dept_id, manager_id)
VALUES
    (2, 'E0002', '陈雨', '小雨', 26, 'chen@example.test', 10000.00,
     '2023-04-10', 1, '上海', 1, 1),
    (4, 'E0004', '李悦', NULL, 28, 'li@example.test', 9000.00,
     '2022-09-01', 1, '杭州', 2, 3),
    (5, 'E0005', '周然', NULL, NULL, NULL, 7500.00,
     '2024-02-20', 1, NULL, NULL, NULL),
    (6, 'E0006', '王川', NULL, 35, NULL, 8000.00,
     '2019-11-11', 0, '深圳', 1, 1);
```

固定数据概览：

| id | 姓名 | 薪资 | 部门 | 状态 | 上级 |
| --- | --- | ---: | --- | --- | --- |
| 1 | 林舟 | 15000.00 | 研发部 | 在职 | 无 |
| 2 | 陈雨 | 10000.00 | 研发部 | 在职 | 林舟 |
| 3 | 张宁 | 9000.00 | 市场部 | 在职 | 无 |
| 4 | 李悦 | 9000.00 | 市场部 | 在职 | 张宁 |
| 5 | 周然 | 7500.00 | 未分配 | 在职 | 无 |
| 6 | 王川 | 8000.00 | 研发部 | 非在职 | 林舟 |

数据特意包含未分配部门、没有员工的部门、并列薪资和缺失字段，用于解释后续查询的边界。

## 二、INSERT：让列和值一一对应

基本形式：

```text
INSERT INTO 表名 (列1, 列2, ...) VALUES (值1, 值2, ...);
```

显式列名可以避免列顺序改变时插入错位。每一行提供的值数量与顺序，都必须与列列表对应。

| 列的情况 | 未提供值时通常如何处理 |
| --- | --- |
| 有默认值 | 使用默认值 |
| 允许 NULL，且无其他默认规则 | 通常使用 NULL |
| 自增列 | 通常由服务端分配编号 |
| NOT NULL 且没有默认值 | 严格模式下通常报错，不能依赖隐式补值 |

`AUTO_INCREMENT` 不保证连续无间断，失败或回滚等情况可能留下编号空隙。它适合提供标识，不适合用来计算累计业务数量。

`INSERT IGNORE` 和 `REPLACE` 有各自的错误处理或替换语义，不应作为所有插入失败的通用处理。应用应区分重复键、类型错误、约束失败等原因。

## 三、UPDATE 与 DELETE：明确修改范围

下面的示例使用 InnoDB 显式事务，在查看效果后回滚，以免改变后续章节的固定数据。

### 更新字段

```sql
START TRANSACTION;

SELECT id, name, salary FROM emp WHERE id = 2;

UPDATE emp
SET salary = salary + 1000.00
WHERE id = 2;

SELECT id, name, salary FROM emp WHERE id = 2;
ROLLBACK;
```

第一章的 `updated_at` 配置会在符合自动更新条件时刷新，不需要在每个示例里引用一个未定义的更新时间字段。

不写 `WHERE` 会对所有符合语句语义的行进行更新。先查询相同条件有助于核对范围，但不能防止查询与更新之间发生并发变化；需要原子条件或事务锁时，见第四章。

### 删除行与清空字段

```sql
START TRANSACTION;
DELETE FROM emp WHERE id = 6;
SELECT id, name FROM emp ORDER BY id;
ROLLBACK;
```

`DELETE` 删除行。要清空一个允许为空的字段，应使用 `UPDATE ... SET 字段 = NULL`，不是删除字段。

执行修改后要理解影响行数。更新的“匹配行数”和“实际改变行数”可能不同，客户端选项也会影响返回约定。不能仅凭影响行数为 0，就判断数据库中一定没有这条记录。

## 四、SELECT：列、表达式、别名与去重

```sql
SELECT id, name, salary FROM emp;

SELECT id, name, salary * 12 AS annual_salary
FROM emp;

SELECT DISTINCT work_address
FROM emp;
```

`DISTINCT` 对整个选择列表去重。`SELECT DISTINCT dept_id, status` 表示去掉重复的“部门、状态组合”，不是分别对两列各自去重。

业务查询优先列出实际需要的字段，减少无用传输，也避免新增敏感列后被 `SELECT *` 自动带出。

## 五、条件查询与 NULL

### 常见运算符

| 类别 | 写法 | 说明 |
| --- | --- | --- |
| 比较 | `=`、`<>`、`>`、`>=`、`<`、`<=` | 比较值 |
| 范围 | `BETWEEN ... AND ...` | 包含两个边界 |
| 集合 | `IN (...)`、`NOT IN (...)` | 检查是否属于集合 |
| 空值 | `IS NULL`、`IS NOT NULL` | 判断缺失值 |
| 模糊匹配 | `LIKE` | `%` 任意数量字符，`_` 恰好一个字符 |
| 逻辑 | `AND`、`OR`、`NOT` | 组合条件 |

```sql
SELECT id, name, age
FROM emp
WHERE status = 1
  AND age BETWEEN 25 AND 30;

SELECT id, name
FROM emp
WHERE status = 1
  AND (dept_id = 1 OR dept_id IS NULL);

SELECT id, name FROM emp WHERE name LIKE '陈%';
```

当逻辑条件混用时，用括号明确分组。`LIKE` 的大小写与字符比较行为受排序规则影响，字面 `%`、`_` 则需要按明确的转义规则处理。

### NULL、空字符串和 0 是不同值

`NULL` 表示缺失、未知或不适用；`''` 是长度为零的字符串；`0` 是确定的数值。

```sql
SELECT id, name FROM emp WHERE email IS NULL;
SELECT NULL = NULL AS ordinary_comparison,
       NULL <=> NULL AS null_safe_comparison;
```

普通比较中涉及 `NULL` 通常得到未知；`WHERE` 只保留条件为真的行。MySQL 的 `<=>` 是 NULL 安全等值比较，可以将两个 NULL 视为相等。

`WHERE email = NULL` 不会按“邮箱缺失”得到预期结果。

### NOT IN 的空值陷阱

```sql
SELECT id, name
FROM dept
WHERE id NOT IN (SELECT dept_id FROM emp);
```

示例数据里存在 `dept_id IS NULL`。当无法确认一个值不属于含未知元素的集合时，条件可能变成未知，因此上面的查询不能可靠表示“没有员工的部门”。

使用相关 `NOT EXISTS` 更直接：

```sql
SELECT d.id, d.name
FROM dept AS d
WHERE NOT EXISTS (
    SELECT 1 FROM emp AS e WHERE e.dept_id = d.id
);
```

固定数据中返回设计部。这里检查的是有没有任意员工，与员工是否在职是另一个条件。

## 六、聚合、分组与分组后过滤

### 聚合函数

```sql
SELECT COUNT(*) AS employee_count,
       COUNT(email) AS email_count,
       AVG(age) AS average_age,
       MIN(salary) AS minimum_salary,
       MAX(salary) AS maximum_salary,
       SUM(salary) AS total_salary
FROM emp;
```

固定数据中共有 6 行，非空邮箱 4 个，总薪资为 `58500.00`。

| 表达式 | 统计规则 |
| --- | --- |
| `COUNT(*)` | 统计结果行 |
| `COUNT(列)` | 统计该列非 NULL 的行 |
| `COUNT(DISTINCT 列)` | 统计该列不同的非 NULL 值 |
| `SUM`、`AVG`、`MIN`、`MAX` | 通常忽略输入 NULL；没有有效值时返回 NULL |

`COUNT` 在没有匹配行时返回 0；`SUM` 不一定返回 0。业务需要零值时，可以明确写 `COALESCE(SUM(salary), 0)`。

### GROUP BY 与 HAVING

```sql
SELECT dept_id,
       COUNT(*) AS employee_count,
       AVG(salary) AS average_salary
FROM emp
WHERE status = 1
GROUP BY dept_id
HAVING COUNT(*) >= 2
ORDER BY dept_id;
```

`WHERE` 先过滤在职员工，`GROUP BY` 按部门分组，`HAVING` 再保留至少两人的分组。固定数据返回研发部与市场部对应的编号。

分组结果通常应只选择分组列、聚合值，或符合功能依赖规则的列。默认常见的 `ONLY_FULL_GROUP_BY` 会拒绝不确定的选择列表；不要关闭它来掩盖分组逻辑不清楚的问题。

## 七、排序与分页

```sql
SELECT id, name, salary
FROM emp
ORDER BY salary DESC, id ASC
LIMIT 3;
```

`ASC` 升序，`DESC` 降序。薪资相同时再按唯一 `id` 排序，让分页的顺序更明确。没有 `ORDER BY`，就不能依赖返回顺序。

偏移分页：

```sql
SELECT id, name
FROM emp
ORDER BY id
LIMIT 3 OFFSET 3;
```

偏移量为 `(页码 - 1) × 每页条数`。深分页可能需要扫描并跳过很多记录，可以改用基于上一页末尾值的游标条件：

```sql
SELECT id, name
FROM emp
WHERE id > 3
ORDER BY id
LIMIT 3;
```

这里的 3 是上一页最后一个 id，不是页码。多列排序时，游标也要包含相应排序键；并发插入、删除仍可能影响跨请求看到的数据范围。

## 八、查询的逻辑处理顺序

```text
FROM / JOIN → WHERE → GROUP BY → HAVING
                                  ↓
                 SELECT → DISTINCT → ORDER BY → LIMIT
```

这是帮助理解结果语义的逻辑顺序，不等于优化器实际逐步执行的物理顺序。

同一查询块的 `WHERE` 通常不能使用刚在 `SELECT` 中定义的别名，而 `ORDER BY` 可以：

```sql
SELECT id, name, salary * 12 AS annual_salary
FROM emp
WHERE salary >= 10000
ORDER BY annual_salary DESC, id;
```

窗口函数等扩展处理会在第六章说明。编写复杂查询前，先确定每一行的粒度和每一层条件过滤什么对象。

## 九、语句速查

| 任务 | 关键写法 |
| --- | --- |
| 插入 | `INSERT INTO 表 (列...) VALUES (...)` |
| 修改 | `UPDATE 表 SET 列 = 值 WHERE 条件` |
| 删除 | `DELETE FROM 表 WHERE 条件` |
| 缺失值 | `IS NULL`、`IS NOT NULL` |
| 分组 | `GROUP BY 列` |
| 聚合后筛选 | `HAVING 聚合条件` |
| 稳定排序 | `ORDER BY 业务排序列, 唯一键` |
| 偏移分页 | `LIMIT 条数 OFFSET 偏移量` |
| 判断不存在 | `NOT EXISTS (子查询)` |

---

上一篇：[数据库概念、SQL 分类与 DDL](./01-概述与DDL.md) · 下一篇：[函数、约束、表关系与多表查询](./03-函数约束表关系与多表查询.md) · [指南目录](./00-MySQL入门指南.md)。
