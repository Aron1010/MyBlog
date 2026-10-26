---
title: MySQL 入门（六）：视图、CTE 与窗口函数
published: 2026-10-26
updated: 2026-10-26
description: 使用视图复用查询接口，用普通和递归 CTE 拆解复杂查询，理解窗口分区、排序、排名和累计计算，并区分窗口函数与分组聚合。
tags: [MySQL, MySQL入门, 视图, CTE, 窗口函数]
category: MySQL
draft: false
pinned: false
comments: true
id: mysql-views-cte-window
permalink: /posts/mysql/06-views-cte-window/
image: anna-hydrangea
author: Aron
---

> [MySQL 入门指南](./00-MySQL入门指南.md) · 第六章：把复杂查询分成清楚的层次。

查询逐渐变复杂时，需要分清三个需求：复用一个查询接口、在一条语句中命名中间结果、在保留明细行的同时进行组内计算。它们分别对应视图、CTE 和窗口函数。

本章使用前面初始化的 `dept`、`emp`。CTE 和窗口函数属于 MySQL 8 系列的重要能力，旧版服务端不能直接照搬。

## 一、视图：保存查询定义

创建一个在职员工视图，执行一次即可：

```sql
CREATE SQL SECURITY INVOKER VIEW v_active_emp AS
SELECT id, work_no, name, salary, dept_id, manager_id, entry_date
FROM emp
WHERE status = 1;
```

像查询表一样读取：

```sql
SELECT id, name, salary
FROM v_active_emp
ORDER BY salary DESC, id;

SHOW CREATE VIEW v_active_emp;
```

普通 MySQL 视图保存的是查询定义，不是一份定期刷新、独立持久化的结果。底层数据变化后，后续查询按相应会话与事务规则看到数据。

### 权限和可更新性

`SQL SECURITY INVOKER` 表示按调用者权限检查相关访问。`DEFINER` 方式会涉及定义者安全上下文，应清楚其授权范围和账号生命周期。

不是所有视图都能更新。包含聚合、分组或其他复杂结构时通常受到限制；即便可以更新，也要考虑过滤条件和 `WITH CHECK OPTION` 等规则。入门阶段先把视图当作明确的读取接口。

删除视图使用 `DROP VIEW 视图名;`，不会因此删除底层表中的数据。视图不适合用来隐藏一个本来就没有被限制的底层表授权。

## 二、CTE：在一条语句里命名中间结果

公共表表达式以 `WITH` 定义，作用于当前语句：

```sql
WITH dept_salary AS (
    SELECT dept_id, AVG(salary) AS average_salary
    FROM emp
    WHERE status = 1 AND dept_id IS NOT NULL
    GROUP BY dept_id
)
SELECT e.id, e.name, e.salary, s.average_salary
FROM emp AS e
JOIN dept_salary AS s ON s.dept_id = e.dept_id
WHERE e.status = 1 AND e.salary > s.average_salary
ORDER BY e.id;
```

固定数据中，林舟高于研发部在职员工平均薪资；市场部两人同薪，不会被严格大于条件选中。

CTE 让“先统计部门平均值，再比较明细”更容易阅读。它不保证一定先生成独立物理表，也不保证比等价子查询更快；优化器可能合并或物化相应结果。

| 工具 | 生命周期 | 典型用途 |
| --- | --- | --- |
| 视图 | 持久对象定义，直到修改或删除 | 复用查询接口 |
| CTE | 当前一条语句 | 命名中间结果、拆分逻辑 |
| 派生表 | 当前查询中的子查询结果 | 局部组合与计算 |
| 临时表 | 取决于会话和显式删除 | 需要跨语句保存中间数据时使用 |

CTE 的名字在下一条独立语句中不可直接使用。

## 三、递归 CTE：沿管理关系逐层展开

递归查询包含起始部分和引用自身的递归部分。下面从没有上级的员工开始，向下展开管理关系：

```sql
WITH RECURSIVE org AS (
    SELECT id, name, manager_id, 0 AS depth,
           CAST(CONCAT('/', id, '/') AS CHAR(500)) AS id_path
    FROM emp
    WHERE manager_id IS NULL

    UNION ALL

    SELECT e.id, e.name, e.manager_id, o.depth + 1,
           CONCAT(o.id_path, e.id, '/')
    FROM emp AS e
    JOIN org AS o ON e.manager_id = o.id
    WHERE o.depth < 20
      AND LOCATE(CONCAT('/', e.id, '/'), o.id_path) = 0
)
SELECT id, name, manager_id, depth, id_path
FROM org
ORDER BY id_path;
```

起始员工深度为 0，子员工逐层加一。路径记录用于避免在当前遍历路径上重复访问同一 id，深度条件限制本次查询展开范围。

递归结果列的类型会受到起始部分影响，因此路径列预先扩展为足够宽的字符类型。实际数据范围更大时，还需要重新评估宽度、深度和执行成本。

如果数据形成一个完全没有根节点的环，这段“从根向下”的查询并不会自动把它检测出来；查询没有返回某行，不能作为整体关系无环的证明。

服务端还有递归深度等限制。复杂关系应从数据建模时就限制环路，不能只靠不断提高递归上限。

## 四、窗口函数与 GROUP BY 的区别

普通分组聚合会把多行收缩成每组一行；窗口函数通常保留明细行，再附加组内计算结果。

```sql
SELECT id, name, dept_id, salary,
       AVG(salary) OVER (PARTITION BY dept_id) AS department_average
FROM emp
WHERE status = 1
ORDER BY dept_id, id;
```

每位在职员工仍然保留一行，同时看到所在分区的平均薪资。`dept_id IS NULL` 的行会被放在同一个分区，这是一种 SQL 分组规则，是否符合业务含义需要单独确认。

窗口计算通常在 WHERE 和分组之后进行，针对的是经过前面逻辑得到的行，不一定是整张原始表。

## 五、分区、窗口排序与最终排序

```sql
SELECT id, name, dept_id, salary,
       ROW_NUMBER() OVER (
           PARTITION BY dept_id
           ORDER BY salary DESC, id ASC
       ) AS salary_position
FROM emp
WHERE status = 1
ORDER BY dept_id, salary_position;
```

| 部分 | 作用 |
| --- | --- |
| `PARTITION BY` | 为窗口计算分区，不会像 GROUP BY 一样直接折叠明细 |
| 窗口内 `ORDER BY` | 决定函数在分区内如何计算顺序 |
| 最外层 `ORDER BY` | 决定结果最终如何展示 |

窗口里的排序不自动保证最终返回顺序。ROW_NUMBER 的排序键不唯一时，同值行之间的编号可能不稳定，所以需要 id 等确定性键。

## 六、ROW_NUMBER、RANK 与 DENSE_RANK

```sql
SELECT id, name, salary,
       ROW_NUMBER() OVER (ORDER BY salary DESC, id) AS row_no,
       RANK() OVER (ORDER BY salary DESC) AS salary_rank,
       DENSE_RANK() OVER (ORDER BY salary DESC) AS dense_salary_rank
FROM emp
WHERE status = 1
ORDER BY salary DESC, id;
```

| 薪资 | ROW_NUMBER | RANK | DENSE_RANK |
| ---: | ---: | ---: | ---: |
| 15000 | 1 | 1 | 1 |
| 10000 | 2 | 2 | 2 |
| 9000 | 3 | 3 | 3 |
| 9000 | 4 | 3 | 3 |
| 7500 | 5 | 5 | 4 |

如果在 RANK 的排序里也加入唯一 id，就不再按“同薪”形成并列。要先明确业务需要的是行号、带空档排名，还是连续档位。

### 过滤每组前几名

同一层 WHERE 不能直接过滤刚计算的窗口别名，可以再套一层 CTE：

```sql
WITH ranked AS (
    SELECT id, name, dept_id, salary,
           ROW_NUMBER() OVER (
               PARTITION BY dept_id
               ORDER BY salary DESC, id
           ) AS rn
    FROM emp
    WHERE status = 1
)
SELECT id, name, dept_id, salary
FROM ranked
WHERE rn <= 2
ORDER BY dept_id, rn;
```

这表示每组最多两行。若业务要求“前两个薪资档位，并列全部保留”，应改用 DENSE_RANK，并只按薪资排名。

## 七、累计值与前后行比较

### 显式指定累计范围

```sql
SELECT id, name, entry_date, salary,
       SUM(salary) OVER (
           ORDER BY entry_date, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS running_salary_total
FROM emp
WHERE status = 1
ORDER BY entry_date, id;
```

上例按入职顺序对当前在职员工的当前薪资做累计，不是历史工资流水。函数算出的数值正确，也需要名称准确表达业务含义。

`ROWS` 按排序后实际行的位置定义范围；`RANGE` 按排序值及其同值组等规则定义范围。存在并列排序值时，两者可能产生不同结果，不要依赖默认框架猜测累计边界。

### LAG 与 LEAD

```sql
SELECT id, name, entry_date,
       LAG(entry_date) OVER (ORDER BY entry_date, id) AS previous_entry_date,
       LEAD(entry_date) OVER (ORDER BY entry_date, id) AS next_entry_date
FROM emp
WHERE status = 1
ORDER BY entry_date, id;
```

它们访问同一窗口排序中的前后行，适合比较相邻事件。开头或结尾没有对应行时，通常返回 NULL，或按函数参数使用指定默认值。

## 八、选择合适的查询层次

| 需求 | 优先考虑 |
| --- | --- |
| 固定、可复用的查询接口 | 视图，并明确权限上下文 |
| 一条语句中的命名中间结果 | CTE |
| 逐层展开树形关系 | 递归 CTE，配合终止与环路设计 |
| 每组一行统计 | GROUP BY |
| 明细附带排名或组内统计 | 窗口函数 |
| 按窗口结果再筛选 | CTE 或派生表再包一层 |

这些工具主要改善表达能力，不自动保证高效。需要处理较大数据时，仍应检查过滤范围、排序成本、临时结果与执行计划。

---

上一篇：[索引与执行计划](./05-索引与执行计划.md) · 下一篇：[应用连接与 SQL 安全](./07-应用连接与SQL安全.md) · [指南目录](./00-MySQL入门指南.md)。
