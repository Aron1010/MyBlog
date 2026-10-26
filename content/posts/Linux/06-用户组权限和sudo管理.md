---
title: Linux 入门（六）：用户、用户组与权限管理
published: 2026-07-09
updated: 2026-10-26
description: 从用户身份和文件访问规则出发，整理账号与用户组管理、rwx、chmod、chown、umask、SGID、粘滞位、ACL 与 sudo，并给出权限不足的排查顺序。
tags:
  - Linux
  - Linux入门
  - 用户管理
  - 权限管理
  - sudo
category: Linux
draft: false
pinned: false
comments: true
id: post-a7c3fcbbe8
permalink: /posts/linux/06-用户组权限和sudo管理/
image: evening
author: Aron
---

Linux 权限管理围绕三个问题展开：**谁在操作、操作哪个对象、允许进行什么操作。** 用户和用户组描述身份，所有权与权限控制文件访问，`sudo` 则决定某个用户能否以其他身份执行特定命令。

本篇以本地账号和常见 Linux 文件系统为例。创建用户、修改组和所有权等管理操作通常需要管理员权限，因此示例明确写出 `sudo`。`testuser`、`dev`、`project` 等均为示例名称。

## 一、用户、用户组和进程身份

系统用 UID 标识用户，用 GID 标识用户组。用户名和组名是便于阅读的名称，底层文件所有权主要记录对应的数字 ID。

一个用户通常具有一个主组，并且可以属于多个附加组：

| 概念 | 作用 |
| --- | --- |
| UID | 标识用户 |
| 主组 | 账号的基本组，新文件通常使用进程的有效组，SGID 等规则可能改变结果 |
| 附加组 | 让用户获得其他组对应的访问资格 |
| 进程身份 | 程序执行时实际使用的用户和组身份，决定访问检查结果 |

查看当前身份与指定用户的信息：

```bash
whoami
id
id testuser
getent passwd testuser
getent group dev
```

不指定名称时，`getent passwd` 和 `getent group` 可列出账号与组信息。`getent` 会按系统配置查询，信息不一定只来自 `/etc/passwd` 和 `/etc/group`，也可能来自集中身份服务。

向账号追加用户组后，已有会话和进程通常不会自动刷新附加组列表。重新登录并运行 `id`，确认新会话已经获得对应身份。

## 二、创建用户与管理密码

### useradd：明确家目录和登录 Shell

```bash
sudo useradd -m -s /bin/bash testuser
sudo passwd testuser
```

`-m` 显式创建家目录，`-s` 指定登录 Shell。不同发行版的默认配置可能不同，显式指定关键选项更容易确认结果。

| 选项 | 用途 |
| --- | --- |
| `-c` | 设置描述信息 |
| `-u` | 指定 UID |
| `-d` | 指定家目录路径 |
| `-m` | 创建家目录 |
| `-M` | 不创建家目录 |
| `-g` | 指定主组，组必须已存在 |
| `-G` | 指定附加组，组必须已存在 |
| `-s` | 指定登录 Shell |

普通用户通常可以通过不带用户名的 `passwd` 修改自己的密码。为其他用户设置密码需要相应管理权限。

### passwd 与 chage：密码状态和期限

```bash
sudo passwd -S testuser
sudo chage -l testuser
sudo chage -d 0 testuser
```

分别查看密码状态、查看密码期限，以及要求用户下次进行相应密码认证登录时修改密码。具体登录行为取决于认证配置。

锁定与解锁密码：

```bash
sudo passwd -l testuser
sudo passwd -u testuser
```

**锁定密码不等于完全禁用账号。** SSH 公钥、其他认证方式或已有会话可能仍然有效；完整停用账号需要结合账号期限、登录方式和现有进程处理。

## 三、修改用户、管理组与删除账号

### usermod：修改已有账号

向附加组追加用户：

```bash
sudo usermod -aG dev testuser
```

`-aG` 表示追加。只使用 `-G dev` 会用指定列表替换原有附加组集合，可能意外取消已有组资格。

| 选项 | 用途 |
| --- | --- |
| `-c` | 修改描述信息 |
| `-g` | 修改主组 |
| `-aG` | 追加附加组 |
| `-d` | 修改家目录路径配置 |
| `-m` | 配合 `-d` 移动家目录内容 |
| `-s` | 修改登录 Shell |
| `-l` | 修改登录名，不自动同步修改家目录名 |
| `-u` | 修改 UID，需要同步检查旧 UID 的文件归属 |
| `-e` | 设置账号过期日期 |
| `-L`、`-U` | 锁定、解锁密码 |

例如，移动家目录的格式为：

```bash
sudo usermod -d /home/testuser-new -m testuser
```

修改登录名、UID 或家目录前，应确认用户没有正在使用该账号的任务，并检查服务配置、计划任务和文件路径中的引用。

### 用户组管理

```bash
sudo groupadd dev
sudo gpasswd -a testuser dev
getent group dev
sudo gpasswd -d testuser dev
```

指定 GID 时可以使用 `sudo groupadd -g 1001 dev`，但需要先确认该编号没有被占用。

删除组：

```bash
sudo groupdel dev
```

作为现有用户主组的组通常不能直接删除；删除前也要检查相关文件的数字 GID 与业务依赖。

### userdel：区分账号与文件

```bash
sudo userdel testuser
```

默认删除账号记录，通常保留家目录。需要一并删除家目录和邮件文件时：

```bash
sudo userdel -r testuser
```

`-r` 不代表清理所有磁盘上的该用户文件。删除前应确认运行进程、家目录、业务数据、计划任务和服务引用；删除后残留文件仍可能保留原 UID，后续复用相同 UID 也会影响所有权判断。

## 四、读懂文件权限

查看文件和目录本身：

```bash
ls -l report.txt
ls -ld project/
```

示例输出：

```text
-rw-r----- 1 aron dev 1024 Jul 9 10:00 report.txt
```

权限部分可以拆成：

```text
-      rw-      r--      ---
类型   所有者   所属组   其他用户
```

| 类型标记 | 对象 |
| --- | --- |
| `-` | 普通文件 |
| `d` | 目录 |
| `l` | 软链接 |

### rwx 对文件和目录的意义不同

| 权限 | 普通文件 | 目录 |
| --- | --- | --- |
| `r` | 读取内容 | 列出目录中的名称 |
| `w` | 修改内容 | 增删、重命名目录项，通常还需要 `x` |
| `x` | 按可执行程序的方式执行，还受格式和挂载选项等约束 | 搜索、穿过目录并访问内部条目 |

访问 `/data/project/report.txt` 时，需要对路径上的每一级目录具有搜索权限。只有文件本身可读，不足以保证能打开它。

**删除文件主要由父目录的权限决定，不能只看文件是否可写。** 如果父目录允许相应的增删操作，一个只读文件也可能被删除；粘滞位、ACL 和其他机制还会进一步影响结果。

传统权限并不是把三组权限相加：文件所有者先适用所有者权限；非所有者再判断所属组资格；均不匹配时才适用其他用户权限。有 ACL 时，判断规则会进一步细化。

## 五、修改权限与所有权

### chmod：符号方式

```bash
chmod u+x start.sh
chmod g-w report.txt
chmod o-rwx private.txt
chmod u=rw,g=r,o= report.txt
```

| 符号 | 含义 |
| --- | --- |
| `u`、`g`、`o` | 所有者、所属组、其他用户 |
| `a` | 上述三类全部 |
| `+`、`-`、`=` | 增加、移除、明确设置 |

文件所有者通常可以修改自己的文件权限；修改不属于自己的文件需要相应权限。

### chmod：数字方式

每组权限按 `r=4`、`w=2`、`x=1` 相加，三位数字依次描述所有者、所属组和其他用户。

| 数字模式 | 权限 | 常见用途 |
| --- | --- | --- |
| `600` | `rw-------` | 仅所有者读写的文件 |
| `644` | `rw-r--r--` | 所有人可读、所有者可写的普通文件 |
| `700` | `rwx------` | 仅所有者访问的目录或程序 |
| `750` | `rwxr-x---` | 所有者完整访问，组成员读与执行 |
| `755` | `rwxr-xr-x` | 允许其他用户读取和执行的目录或程序 |

```bash
chmod 600 private.txt
chmod 644 report.txt
chmod 750 start.sh
```

`chmod -R` 会递归修改目录及内容。直接对整棵目录执行 `chmod -R 755`，会把普通文件也设为可执行；应根据文件和目录的实际用途分别设置。

权限不足时先定位具体对象，不要把 `777` 当作通用修复方式。它会让所有用户都获得相应读、写、执行权限，也不能解决所有挂载或安全策略问题。

### chown 与 chgrp：修改归属

```bash
sudo chown testuser report.txt
sudo chown testuser:dev report.txt
chgrp dev report.txt
```

改变文件所有者通常需要管理员权限。文件所有者修改所属组时，通常只能改到自己所属的组。

递归修改的格式为：

```text
sudo chown -R 用户:组 目标目录
```

这会影响目录下所有可处理的对象。应先确认整个目录都应该归属于目标用户，尤其不要对混合所有权的系统目录或共享目录直接递归修改。

## 六、新建文件的默认权限：umask

查看当前 Shell 的权限掩码：

```bash
umask
umask -S
```

在不涉及默认 ACL、且程序按常见方式请求创建权限的情况下，普通文件通常从 `666`、目录从 `777` 开始，再由 `umask` 清除对应权限位：

| umask | 普通文件常见结果 | 目录常见结果 |
| --- | --- | --- |
| `022` | `644` | `755` |
| `027` | `640` | `750` |
| `077` | `600` | `700` |

这是按位屏蔽，不是普通十进制减法。应用可以主动请求更严格的权限，目录默认 ACL 也可能改变规则。

```bash
umask 027
```

这会影响当前 Shell 及后续子进程创建的对象，不会回头修改已有文件。普通文件通常不会因为掩码放宽而自动获得执行权限。

## 七、共享目录：SGID 与粘滞位

### SGID：让新对象继承目录所属组

对一个已经存在的共享目录配置：

```bash
sudo chown root:dev /srv/project
sudo chmod 2770 /srv/project
```

前提是 `dev` 组已存在，并且参与协作的用户属于该组。`2770` 中开头的 `2` 表示 SGID，后面的 `770` 描述普通权限。

在 SGID 目录中新建的文件通常继承该目录的所属组，新建子目录也会继承 SGID。**继承组不等于自动获得组写权限**，新对象的权限仍受创建程序、`umask` 或默认 ACL 影响。

### 粘滞位：限制共享目录中的删除和改名

```bash
chmod +t shared-dir
```

设置粘滞位的目录中，即使其他用户有目录写权限，删除或重命名某个条目通常仍要求操作者是文件所有者、目录所有者，或具有相应特权。

`/tmp` 是常见例子。粘滞位限制的是目录项删除和重命名，不能代替文件本身的读写权限控制。

取消粘滞位：

```bash
chmod -t shared-dir
```

## 八、ACL：给指定用户或组授权

当“所有者、所属组、其他用户”不足以表达需求时，可以使用 ACL。相关命令通常由 `acl` 软件包提供，文件系统也需要支持它。

### 增加、查看与移除条目

```bash
setfacl -m u:alice:rw- report.txt
setfacl -m g:reviewers:r-- report.txt
getfacl report.txt
```

前提是对应用户和组存在，且当前操作者有权修改该文件的 ACL。

```bash
setfacl -x u:alice report.txt
setfacl -x g:reviewers report.txt
```

分别移除指定用户或指定组的 ACL 条目。

`setfacl -b report.txt` 删除扩展访问 ACL 条目，保留所有者、所属组和其他用户的基础条目。目录的默认 ACL 可以用 `setfacl -k 目录` 单独移除。

### mask：授权条目还受到有效权限上限约束

ACL 的 `mask` 限制命名用户、所属组和命名组条目的有效权限，不限制文件所有者和 `other`。

例如，某用户条目为 `rw-`，但 mask 为 `r--`，该用户的实际有效权限只有读取。`getfacl` 会在需要时显示 `effective` 提示。

存在扩展 ACL 时，`ls -l` 显示的组权限位通常对应 ACL mask。此时执行 `chmod g-w` 等操作可能改变有效权限上限，应再次用 `getfacl` 核对结果。

### 默认 ACL：影响后续新建对象

给一个已有目录设置指定用户的默认 ACL：

```bash
setfacl -m d:u:alice:rwx project/
```

默认 ACL 用于后续创建对象的继承，不会自动修改已有文件，也不等于赋予该用户访问目录本身的权限。目录本身的访问 ACL 与默认 ACL 需要分别确认。

继承后的最终权限还受程序请求的创建模式约束，普通文件不会因此无条件变成可执行文件。

## 九、su 与 sudo：以什么身份执行命令

### su：切换用户会话

```bash
su - testuser
```

`-` 表示使用登录 Shell 的方式切换，更接近重新登录目标用户；实际环境还受 PAM 和 Shell 配置影响。执行 `su -` 而不指定用户名时，目标通常为 root。

普通用户使用 `su` 通常需要目标用户的密码。按 `exit` 退出切换后的 Shell。

### sudo：按授权规则执行命令

```bash
sudo systemctl restart nginx.service
sudo -u testuser whoami
sudo -l
```

`sudo` 默认以 root 身份执行，也能通过 `-u` 指定其他用户；是否允许由策略决定。常见配置下，它验证的是当前用户的密码，但规则也可以改变这一行为。

`sudo -l` 查看当前用户被允许执行的命令，比直接尝试获取 root Shell 更便于确认已有授权。

### 使用 visudo 维护授权规则

```bash
sudo visudo
sudo visudo -c
```

`visudo` 在编辑时提供锁和语法检查，`-c` 用于检查配置。若系统已启用 `/etc/sudoers.d/`，也可通过 `sudo visudo -f /etc/sudoers.d/example-app` 编辑独立规则，再检查整体配置。

下面只展示限定命令的授权格式，命令路径需要先用 `command -v systemctl` 确认：

```sudoers
testuser ALL=(root) /usr/bin/systemctl restart nginx.service
```

这允许 `testuser` 按 sudo 认证规则以 root 执行指定的重启命令。服务单元、程序和配置本身也需要由可信管理员控制，避免通过可修改内容扩大权限。

`NOPASSWD: ALL` 表示无需密码执行所有被该规则允许的命令，授权范围很大。日常配置应围绕具体工作需求限定目标身份、命令和参数。

## 十、权限不足时的排查顺序

| 步骤 | 命令或检查 | 要确认的内容 |
| --- | --- | --- |
| 1 | `whoami`、`id` | 当前进程到底使用哪个用户和组？ |
| 2 | `ls -l 目标` | 文件类型、所有者和基础权限是否符合预期？ |
| 3 | `ls -ld 上级目录` | 路径上每一层是否允许搜索和访问？ |
| 4 | `getfacl 目标` | 是否存在额外授权或 mask 限制？ |
| 5 | 查看挂载与安全日志 | 是否只读挂载，或受 SELinux、AppArmor 等策略限制？ |
| 6 | `sudo -l` | 当前任务是否应通过已有授权执行？ |

以 `/data/project/app.log` 为例：

```bash
whoami
id
ls -ld / /data /data/project
ls -l /data/project/app.log
getfacl /data/project
getfacl /data/project/app.log
```

文件可读但上级目录缺少 `x`、新组身份尚未进入当前会话、ACL 被 mask 限制，都是常见原因。先找到具体限制点，再修改与需求对应的权限。

## 十一、命令速查

| 命令 | 用途 |
| --- | --- |
| `id 用户` | 查看 UID、主组与附加组 |
| `getent passwd 用户` | 查询账号信息 |
| `sudo useradd -m -s /bin/bash 用户` | 创建带家目录的 Bash 用户 |
| `sudo passwd 用户` | 设置用户密码 |
| `sudo chage -l 用户` | 查看密码期限 |
| `sudo usermod -aG 组 用户` | 追加附加组 |
| `sudo groupadd 组` | 创建组 |
| `ls -ld 目录` | 查看目录本身的权限 |
| `chmod u+x 脚本` | 增加所有者执行权限 |
| `sudo chown 用户:组 文件` | 修改文件归属 |
| `umask` | 查看新建权限掩码 |
| `getfacl 文件` | 查看 ACL 与有效权限 |
| `su - 用户` | 切换到目标用户的登录 Shell |
| `sudo -l` | 查看当前 sudo 授权 |
| `sudo visudo -c` | 检查 sudoers 配置 |

---

上一篇：[网络、进程与系统资源排查](./05-网络进程和系统资源排查.md) · 返回系列起点：[目录结构、路径与命令帮助](./01-Linux目录结构与路径基础.md)。
