---
# 文章标题
title: MySQL 基础（二）：DML 数据操作与 DQL 单表查询
# 文章发布日期
published: 2026-08-07
# 文章简介
description: 系统讲解 INSERT、UPDATE、DELETE 等 DML 操作，以及 SELECT 单表查询中的条件、聚合、分组、排序和分页，并分析 SQL 执行顺序与 NULL 判断规则。
# 文章标签
tags: [MySQL, MySQL入门, DML, DQL, SQL查询]
# 文章分类
category: MySQL
# 是否为草稿
draft: false
# 是否置顶
pinned: false
# 是否允许评论
comments: true
# 文章密码
# password: 
---


## 1. DML：数据增删改

### 1.1 INSERT：添加数据

推荐显式写出字段名：

```sql
INSERT INTO emp (work_no, name, gender, age, salary, entry_date)
VALUES ('00001', '张无忌', '男', 20, 12500.00, '2005-12-05');
```

批量插入：

```sql
INSERT INTO emp (work_no, name, gender, age, salary, entry_date)
VALUES
    ('00002', '杨逍', '男', 33, 8400.00, '2000-11-03'),
    ('00003', '赵敏', '女', 20, 12500.00, '2004-10-12');
```

注意：

- 字段顺序必须和值的顺序一一对应。
- 未列出的字段使用默认值；没有默认值且允许为空时为 `NULL`。
- 字符串、日期使用单引号。
- 推荐显式列名，避免表结构变化后插入错位。

### 1.2 UPDATE：修改数据

```sql
UPDATE emp
SET salary = salary + 1000,
    updated_at = NOW()
WHERE id = 2;
```

安全步骤：先用相同条件查询，再修改。

```sql
SELECT * FROM emp WHERE id = 2;

UPDATE emp
SET salary = salary + 1000
WHERE id = 2;
```

不写 `WHERE` 会更新所有记录：

```sql
UPDATE emp SET entry_date = '2026-01-01';
```

### 1.3 DELETE：删除数据

```sql
DELETE FROM emp WHERE id = 17;
```

不写 `WHERE` 会删除表内全部记录：

```sql
DELETE FROM emp;
```

`DELETE` 删除的是行，不能用它删除某个字段的值；清空单个字段应使用 `UPDATE ... SET column = NULL`，且该字段必须允许 `NULL`。

### 1.4 `NULL`、空字符串与数字 0

三者含义不同：

- `NULL`：未知、缺失或不适用。
- `''`：已知是长度为 0 的字符串。
- `0`：明确的数值零。

判断空值必须使用：

```sql
WHERE id_card IS NULL
WHERE id_card IS NOT NULL
```

不要写 `id_card = NULL`，其结果不会为真。

---

## 2. DQL：单表查询

### 2.1 完整语法

```sql
SELECT [DISTINCT] 字段或表达式
FROM 表名
[WHERE 行过滤条件]
[GROUP BY 分组字段]
[HAVING 分组后过滤条件]
[ORDER BY 排序字段 ASC | DESC]
[LIMIT 偏移量, 返回行数];
```

### 2.2 基础查询、别名与去重

```sql
-- 指定字段
SELECT id, name, age FROM emp;

-- 全部字段；临时排查可以使用，业务代码中建议显式列名
SELECT * FROM emp;

-- 字段别名；AS 可以省略
SELECT name AS employee_name, salary monthly_salary
FROM emp;

-- 去重
SELECT DISTINCT work_address
FROM emp;
```

表别名：

```sql
SELECT e.id, e.name
FROM emp AS e;
```

一旦定义了表别名，本查询块中应通过别名引用该表。

### 2.3 条件查询

#### 2.3.1 比较和逻辑运算符

| 类型 | 运算符 |
| --- | --- |
| 比较 | `=`、`<>`、`!=`、`>`、`>=`、`<`、`<=` |
| 范围 | `BETWEEN ... AND ...`、`NOT BETWEEN ... AND ...` |
| 集合 | `IN (...)`、`NOT IN (...)` |
| 空值 | `IS NULL`、`IS NOT NULL` |
| 模糊匹配 | `LIKE`、`NOT LIKE` |
| 逻辑 | `AND`、`OR`、`NOT` |

```sql
SELECT id, name, age
FROM emp
WHERE gender = '女'
  AND age BETWEEN 18 AND 30;
```

`BETWEEN 18 AND 30` 包含两个边界。

当 `AND` 和 `OR` 同时出现时，使用括号明确含义：

```sql
SELECT *
FROM emp
WHERE gender = '男'
  AND (age < 20 OR age > 60);
```

#### 2.3.2 LIKE 通配符

- `%`：匹配任意数量的字符，包括 0 个。
- `_`：匹配恰好 1 个字符。

```sql
-- 姓张
SELECT * FROM emp WHERE name LIKE '张%';

-- 两个字符的姓名
SELECT * FROM emp WHERE name LIKE '__';

-- 身份证号以 X 结尾
SELECT * FROM emp WHERE id_card LIKE '%X';
```

如果需要把 `%` 或 `_` 当成普通字符，应使用转义规则。

### 2.4 聚合函数

| 函数 | 用途 |
| --- | --- |
| `COUNT()` | 统计数量 |
| `SUM()` | 求和 |
| `AVG()` | 平均值 |
| `MAX()` | 最大值 |
| `MIN()` | 最小值 |

```sql
SELECT
    COUNT(*) AS total_rows,
    COUNT(id_card) AS rows_with_id_card,
    AVG(age) AS avg_age,
    MAX(salary) AS max_salary,
    MIN(salary) AS min_salary,
    SUM(salary) AS salary_total
FROM emp;
```

要点：

- `COUNT(*)` 统计行数。
- `COUNT(column)` 只统计该字段非 `NULL` 的行。
- 除 `COUNT(*)` 外，聚合函数一般忽略 `NULL`。
- `COUNT(DISTINCT column)` 可以统计不同非空值的数量。

### 2.5 GROUP BY 与 HAVING

```sql
SELECT
    dept_id,
    COUNT(*) AS employee_count,
    AVG(salary) AS avg_salary
FROM emp
WHERE status = 1
GROUP BY dept_id
HAVING COUNT(*) >= 3;
```

`WHERE` 与 `HAVING` 的区别：

| 对比 | `WHERE` | `HAVING` |
| --- | --- | --- |
| 过滤对象 | 原始行 | 分组后的结果 |
| 执行阶段 | 分组前 | 分组后 |
| 聚合条件 | 不能直接判断聚合结果 | 可以判断聚合结果 |

分组查询的 `SELECT` 列表通常只放：

- 分组字段。
- 聚合函数。
- 由上述字段确定的表达式。

### 2.6 ORDER BY

```sql
SELECT id, name, age, entry_date
FROM emp
ORDER BY age ASC, entry_date DESC;
```

- `ASC` 为升序，也是默认值。
- `DESC` 为降序。
- 多字段排序时，只有前一个字段值相同，才比较下一个字段。
- 若用于分页，应增加唯一、稳定的排序字段，例如最后追加 `id ASC`。

### 2.7 LIMIT 分页

```sql
-- 第一页，每页 10 条
SELECT id, name FROM emp ORDER BY id LIMIT 0, 10;

-- 第二页，每页 10 条
SELECT id, name FROM emp ORDER BY id LIMIT 10, 10;

-- 另一种写法
SELECT id, name FROM emp ORDER BY id LIMIT 10 OFFSET 10;
```

计算公式：

```text
offset = (page_number - 1) * page_size
```

没有 `ORDER BY` 的分页结果顺序不稳定。偏移量很大时，`LIMIT offset, size` 需要跳过大量记录；进阶阶段可学习基于上一页末尾主键的游标分页。

### 2.8 SQL 编写顺序与逻辑执行顺序

编写顺序：

```text
SELECT -> FROM -> WHERE -> GROUP BY -> HAVING -> ORDER BY -> LIMIT
```

常用的逻辑执行顺序：

```text
FROM -> WHERE -> GROUP BY -> HAVING -> SELECT -> DISTINCT -> ORDER BY -> LIMIT
```

因此：

- `WHERE` 中通常不能引用同一层 `SELECT` 刚定义的别名。
- `ORDER BY` 通常可以引用 `SELECT` 别名。

```sql
-- 正确
SELECT salary * 12 AS annual_salary
FROM emp
WHERE salary > 10000
ORDER BY annual_salary DESC;
```

### 2.9 条件表达式中的 `NULL`

SQL 使用三值逻辑：真、假、未知。任何值与 `NULL` 直接比较，通常得到“未知”。特别注意：

```sql
-- 如果子查询结果中可能出现 NULL，NOT IN 可能得不到预期结果
SELECT d.id
FROM dept AS d
WHERE d.id NOT IN (SELECT e.dept_id FROM emp AS e);
```

更稳妥的写法是 `NOT EXISTS`：

```sql
SELECT d.id, d.name
FROM dept AS d
WHERE NOT EXISTS (
    SELECT 1
    FROM emp AS e
    WHERE e.dept_id = d.id
);
```

---
