---
title: Linux 入门（八）：Shell 脚本与定时任务
published: 2026-02-25
description: 从 Bash 的变量、引号和退出状态开始，介绍条件、循环、函数与参数处理，通过系统报告脚本说明错误处理、日志和 cron 定时运行的基本方法。
tags: [Linux, Linux入门, Bash, Shell脚本, 定时任务]
category: Linux
draft: false
pinned: false
comments: true
id: linux-shell
permalink: /posts/linux/08-shell-and-scheduling/
image: rooftop
author: Aron
---

> [Linux 入门指南](./00-Linux入门指南.md) · 第八章：把重复操作整理为可读、可检查的脚本。

Shell 脚本把命令按顺序组织起来，再用变量、条件和循环处理不同输入。入门时先掌握两件事：**参数如何传入，失败如何被发现。** 能在终端中运行的一串命令，还需要补上环境、路径和错误处理，才适合交给定时任务。

本章明确使用 Bash。`/bin/sh` 在许多系统中不是 Bash，不能假定它支持相同语法。

## 一、脚本由哪个解释器执行

一个 Bash 脚本通常以解释器声明开头：

```bash
#!/usr/bin/env bash
printf 'hello linux\n'
```

把内容保存为 `hello.sh` 后，可以显式选择解释器：

```bash
bash hello.sh
```

也可以增加执行权限后直接运行：

```bash
chmod u+x hello.sh
./hello.sh
```

| 写法 | 实际含义 |
| --- | --- |
| `bash hello.sh` | 使用指定的 Bash 读取脚本，不要求脚本本身有执行权限 |
| `./hello.sh` | 按可执行文件启动，通常根据首行选择解释器 |
| `sh hello.sh` | 交给 `sh`，不会因为首行写了 Bash 就自动切换 |
| `source hello.sh` | 在当前 Bash 中执行，会影响当前环境 |

`#!/usr/bin/env bash` 通过 `PATH` 查找 Bash，适合常见交互环境；固定系统任务也可以在确认路径后使用 `#!/bin/bash`。

从其他系统拷贝脚本时，还要检查换行格式。Windows 风格的 CRLF 可能让解释器路径出现额外的回车字符，表现为 `bad interpreter` 或 `bash\r` 等错误。

## 二、变量、参数与引号

### 赋值与读取

```bash
project_name='demo'
project_dir="$HOME/projects/$project_name"
printf '%s\n' "$project_dir"
```

赋值号两侧不加空格。变量名后的字符可能产生歧义时，用花括号界定：

```bash
printf '%s\n' "${project_name}_backup"
```

普通变量属于当前 Shell；需要由之后启动的程序继承时，使用 `export`。

### 单引号与双引号

| 写法 | 行为 |
| --- | --- |
| `'内容'` | 保留字面内容，不展开变量与命令替换 |
| `"内容"` | 可以展开变量与命令替换，抑制通常的分词和文件名展开 |
| 未加引号的变量 | 可能发生分词与文件名展开，取决于语法位置 |

```bash
message='hello linux'
printf '%s\n' '$message'
printf '%s\n' "$message"
```

输出分别是字面文本 `$message` 和变量内容 `hello linux`。处理路径和来自参数的内容时，通常使用 `"$变量"`。

### 脚本参数

| 写法 | 含义 |
| --- | --- |
| `$0` | 脚本被调用时使用的名称或路径 |
| `$1`、`$2` | 第一个、第二个参数 |
| `${10}` | 第十个参数 |
| `$#` | 参数数量 |
| `"$@"` | 保留每个参数的边界，逐个传递 |
| `${1:-默认值}` | 第一个参数未设置或为空时使用默认值 |

例如，下面片段设置输出目录，但不会因为赋值就自动创建目录：

```bash
report_dir=${1:-"$HOME/linux-reports"}
printf '输出目录：%s\n' "$report_dir"
```

默认值是脚本的设计选择，应在说明中写清楚。涉及删除、覆盖或修改配置的参数，不应靠随意的默认路径来补齐。

## 三、退出状态与命令之间的关系

```bash
mkdir -p reports
result=$?
printf '创建目录的状态：%s\n' "$result"
```

`$?` 表示上一条命令的退出状态，应立即保存。多数命令以 `0` 表示成功，但非零状态的具体含义需要查命令约定。

例如，`grep` 的 `1` 表示没有匹配，`2` 通常表示发生错误。不能把“未匹配到日志”直接理解为“日志读取失败”。

### `&&`、`||` 与 `;`

| 连接方式 | 何时执行右侧命令 |
| --- | --- |
| `命令A && 命令B` | A 成功时 |
| `命令A \|\| 命令B` | A 失败时 |
| `命令A; 命令B` | A 结束后继续，不以其状态决定 |

```bash
mkdir -p reports && printf '目录已就绪\n'
```

`A && B || C` 不是完整的条件分支替代：如果 A 成功而 B 失败，C 也会执行。复杂逻辑直接使用 `if` 更清楚。

### 管道中的失败

默认情况下，Bash 通常使用管道最后一个命令的状态作为整条管道的状态。若前面的命令失败，最后的命令仍可能成功。

```bash
set -o pipefail
```

启用后，只要管道中有失败，管道就会返回最右侧失败命令的状态。它改变的是状态传播，不会自动替你决定每种失败应该如何处理。

`set -e` 存在条件判断、逻辑列表和管道等例外，不能简单理解为“任何错误都立即退出”。入门脚本优先明确处理关键步骤，而不是仅加一行选项就认为错误处理完整。

## 四、条件、循环与函数

### if：按结果分支

以下是独立的 Bash 语法示例：

```bash
target="$HOME/notes.txt"

if [[ -f "$target" && -r "$target" ]]; then
    head -n 10 -- "$target"
else
    printf '目标不是可读的普通文件：%s\n' "$target" >&2
fi
```

| 条件 | 用途 |
| --- | --- |
| `-f 路径` | 是否为普通文件，通常跟随软链接 |
| `-d 路径` | 是否为目录 |
| `-r 路径` | 按当前身份判断是否可读 |
| `-z 字符串` | 是否为空字符串 |
| `-n 字符串` | 是否为非空字符串 |

`[[ ... ]]` 是 Bash 语法。条件判断之后，目标仍可能被其他进程改变，因此真正的读写命令也需要检查结果。

### for：逐项处理

```bash
files=("notes.txt" "meeting notes.txt")

for file in "${files[@]}"; do
    printf '文件：%s\n' "$file"
done
```

Bash 数组能够保留带空格的文件名边界。遍历脚本参数时，使用：

```bash
for file in "$@"; do
    printf '%s\n' "$file"
done
```

不要使用 `for file in $(ls)` 来处理文件名，空格、换行和通配符都会让结果变得不可靠。

### while：逐行读取文本

下面的片段要求当前目录已经有可读的 `paths.txt`：

```bash
while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line"
done < paths.txt
```

`IFS=` 保留行首尾空白，`-r` 避免把反斜杠当转义符，末尾条件用于处理最后一行没有换行符的情况。

这是逐行文本处理，不是对任意文件名都通用的序列化方式，因为文件名本身也可以包含换行符。

### 函数：组织重复逻辑

```bash
show_identity() {
    printf '当前用户：'
    whoami
}

show_identity
```

函数默认返回最后一条命令的状态；也可以使用 `return 数字` 明确返回。函数中的 `local` 可以限制变量作用域，减少变量互相覆盖。

## 五、完整示例：生成系统状态报告

下面的脚本读取系统信息，保存到指定目录中的一个新文件。它不修改系统配置；每次使用独立文件名，并保留失败时已收集的输出。

脚本依赖 Bash、GNU 常用工具以及 `uptime`、`free` 等 Linux 工具。保存为 `system-report.sh`：

```bash
#!/usr/bin/env bash

umask 077

if (( $# > 1 )); then
    printf '用法：%s [输出目录]\n' "$0" >&2
    exit 2
fi

report_dir=${1:-"$HOME/linux-reports"}

if ! mkdir -p -- "$report_dir"; then
    printf '无法创建输出目录：%s\n' "$report_dir" >&2
    exit 1
fi

if report_file=$(mktemp "$report_dir/report-XXXXXXXX"); then
    :
else
    printf '无法创建报告文件：%s\n' "$report_dir" >&2
    exit 1
fi

write_report() {
    printf '=== 采集时间 ===\n' || return
    date -Is || return
    printf '\n=== 内核 ===\n' || return
    uname -sr || return
    printf '\n=== 运行时间与负载 ===\n' || return
    uptime || return
    printf '\n=== 文件系统空间 ===\n' || return
    df -h || return
    printf '\n=== 内存 ===\n' || return
    free -h || return
}

if write_report > "$report_file" 2>&1; then
    printf '报告已保存：%s\n' "$report_file"
else
    printf '报告未完整生成，已有输出保存在：%s\n' "$report_file" >&2
    exit 1
fi
```

脚本中的关键设计：

| 设计 | 作用 |
| --- | --- |
| `umask 077` | 让后续新建对象默认尽量只供当前用户访问 |
| 参数数量检查 | 对明显误用给出说明和非零状态 |
| `mkdir -p` 结果检查 | 目录准备失败时停止 |
| `mktemp` | 创建不与已有文件重名的新报告 |
| `命令 \|\| return` | 任一步收集失败时结束函数并传播失败状态 |
| 合并输出到文件 | 保留诊断信息，避免无日志地失败 |

按下面的方式检查语法并运行：

```bash
bash -n system-report.sh
bash system-report.sh "$HOME/linux-reports"
```

`bash -n` 只检查语法，不执行脚本，也不能证明命令存在、目录可写或业务结果正确。

这个脚本生成的是某一时刻的状态快照，不是完整监控系统。持续运行会积累报告，需要根据保存需求另行安排保留策略。

## 六、定时任务：使用用户 crontab

cron 在预定时间以指定用户身份执行命令。它需要对应服务已安装且运行；服务名和默认配置随发行版变化。

查看和编辑当前用户任务：

```bash
crontab -l
crontab -e
```

没有配置任务时，`crontab -l` 可能提示不存在。普通用户的任务使用自己的身份运行；`sudo crontab -e` 编辑的是 root 的任务，二者不能混为一谈。

### 时间字段

```text
分  时  日  月  星期  命令
```

| 表达式 | 含义 |
| --- | --- |
| `15 2 * * *` | 每天 02:15 |
| `*/10 * * * *` | 每个小时的 0、10、20、30、40、50 分 |
| `0 9 * * 1-5` | 周一至周五 09:00 |

时间通常按 cron 守护进程的时区解释，一些实现支持额外的时区设置。先确认服务器时区和使用的实现，不能直接套用本机电脑时间。涉及夏令时的地区，还需了解任务在时间跳变时的行为。

“日”和“星期”都填写受限条件时，常见 cron 实现采用“任一匹配即可”的规则，不能一律当作同时满足。

### 给系统报告安排运行时间

假设脚本已经放到 `/home/aron/.local/bin/system-report.sh`，Bash 的路径为 `/bin/bash`，且 `/home/aron/linux-reports` 已经存在，用户 crontab 可以写成：

```cron
SHELL=/bin/sh
PATH=/usr/local/bin:/usr/bin:/bin

15 2 * * * /bin/bash /home/aron/.local/bin/system-report.sh /home/aron/linux-reports >> /home/aron/linux-reports/cron.log 2>&1
```

用户名、路径和时间需要按实际环境替换。示例显式用 Bash 执行脚本；cron 用什么 Shell 解析这一行，与脚本使用什么解释器是两个层面。

这是用户 crontab 格式。`/etc/crontab` 和常见 `/etc/cron.d/` 文件通常还需要额外的用户名字段，不能原样混用。

### 为什么手动正常，定时运行却失败

| 差异 | 处理方式 |
| --- | --- |
| PATH 较短 | 显式设置 PATH 或使用确认过的绝对路径 |
| 工作目录不同 | 使用绝对路径，或在脚本中检查 `cd` 结果 |
| 没有交互式配置 | 不依赖 `.bashrc` 中才有的变量或别名 |
| 没有终端输入 | 不让任务等待密码或人工确认 |
| 输出文件目录不存在 | 在调度前创建，重定向发生在脚本启动之前 |
| 上一次还没完成 | 按需要增加锁或选择支持相应并发控制的管理方式 |

crontab 命令中的 `%` 在常见实现中有特殊含义。日期格式等复杂内容放到脚本中，通常比直接写进定时表达式更清楚。

传统 cron 通常不会补跑关机期间错过的普通任务。需要补跑策略、依赖管理或更完整的状态查询时，可以考虑 systemd timer 等机制，并按对应文档确认语义。

## 七、脚本的可维护性

一个日常脚本，至少应让阅读者能确认输入、输出、执行身份、依赖与失败方式。路径优先使用参数或明确的配置，不把个人终端里的偶然状态当作默认前提。

对删除、覆盖和权限变更等操作，先限制目标范围，再保留日志。接收文件路径时使用引号；工具支持时可以用 `--` 结束选项解析。不要把外部输入拼成代码再交给 `eval` 执行。

脚本的注释应解释用途、前提和关键选择。逐行重复命令字面含义，反而会让真正需要维护的信息难以查找。

## 八、命令与语法速查

| 写法 | 用途 |
| --- | --- |
| `bash -n 脚本` | 只检查 Bash 语法 |
| `bash 脚本 参数` | 使用 Bash 执行脚本 |
| `"$@"` | 保留全部参数边界 |
| `${1:-默认值}` | 读取参数并设置空值默认行为 |
| `$?` | 上一条命令的退出状态 |
| `if 命令; then ...; fi` | 按命令结果分支 |
| `命令 \|\| return` | 在函数中传播失败状态 |
| `set -o pipefail` | 使管道中的失败影响整体状态 |
| `crontab -l` | 查看当前用户任务 |
| `crontab -e` | 编辑当前用户任务 |

---

上一篇：[SSH 远程连接与文件传输](./07-SSH远程连接与文件传输.md) · 下一篇：[磁盘挂载与备份恢复](./09-磁盘挂载与备份恢复.md) · [指南目录](./00-Linux入门指南.md)。
