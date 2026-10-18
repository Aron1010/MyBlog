---
title: Linux 入门（六）：用户、用户组与权限管理
published: 2026-07-09
description: 系统讲解 Linux 用户和用户组管理、密码状态、文件权限、chmod、chown、SGID、粘滞位与 ACL，并梳理 su、sudo
  的使用方式和权限排查思路。
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

## 用户和用户组的关系

Linux 中每个用户都有一个 UID，每个用户组都有一个 GID。

用户可以属于：

- 一个主组，也叫基本组。
- 多个附加组。

查看用户身份信息：

```bash
id 用户名
```

查看当前用户：

```bash
whoami
```

查看系统用户信息：

```bash
getent passwd
```

查看系统用户组信息：

```bash
getent group
```

## 创建用户：useradd

创建用户：

```bash
useradd 用户名
```

常用选项：

| 选项 | 作用 |
| --- | --- |
| `-c` | 指定描述信息 |
| `-u` | 指定 UID |
| `-d` | 指定用户家目录 |
| `-m` | 创建家目录 |
| `-g` | 指定主组 |
| `-G` | 指定附加组 |
| `-M` | 不创建家目录 |
| `-s` | 指定登录 Shell |

示例：

```bash
useradd -m -d /home/testuser -s /bin/bash testuser
```

创建用户后设置密码：

```bash
passwd testuser
```

## 管理密码状态：passwd 和 chage

修改用户密码：

```bash
passwd 用户名
```

查看密码过期信息：

```bash
chage -l 用户名
```

强制用户下次登录修改密码：

```bash
chage -d 0 用户名
```

锁定用户密码：

```bash
passwd -l 用户名
```

解锁用户密码：

```bash
passwd -u 用户名
```

## 删除用户：userdel

删除用户：

```bash
userdel 用户名
```

删除用户并删除家目录：

```bash
userdel -r 用户名
```

删除用户是高风险操作，尤其是带 `-r` 时会删除家目录。执行前建议确认该用户是否仍有业务文件或运行中的进程。

## 修改用户：usermod

`usermod` 用来修改已有用户。

常用选项：

| 选项 | 作用 |
| --- | --- |
| `-c` | 修改描述信息 |
| `-u` | 修改 UID |
| `-d` | 修改家目录 |
| `-m` | 移动家目录内容到新位置 |
| `-g` | 修改主组 |
| `-G` | 修改附加组 |
| `-aG` | 追加附加组，常用 |
| `-s` | 修改登录 Shell |
| `-e` | 设置账号过期时间 |
| `-l` | 修改账号名称 |
| `-L` | 锁定用户 |
| `-U` | 解锁用户 |

把用户加入附加组：

```bash
usermod -aG docker testuser
```

这里推荐使用 `-aG`，表示追加附加组。如果只用 `-G`，可能会覆盖用户原有附加组。

## 用户组管理

创建用户组：

```bash
groupadd 组名
```

指定 GID：

```bash
groupadd -g 1001 dev
```

删除用户组：

```bash
groupdel 组名
```

把用户加入组：

```bash
gpasswd -a 用户名 组名
```

从组中移除用户：

```bash
gpasswd -d 用户名 组名
```

查看某个组：

```bash
getent group 组名
```

## 文件权限怎么看

使用 `ls -l` 查看文件权限：

```bash
ls -l file.txt
```

示例：

```text
-rw-r--r-- 1 aron dev 1024 Jul 9 10:00 file.txt
```

第一段 `-rw-r--r--` 表示权限：

```text
-   rw-   r--   r--
类型 所有者 所属组 其他人
```

文件类型常见含义：

| 标记 | 含义 |
| --- | --- |
| `-` | 普通文件 |
| `d` | 目录 |
| `l` | 软链接 |

权限含义：

| 权限 | 对文件 | 对目录 |
| --- | --- | --- |
| `r` | 读取文件内容 | 列出目录内容 |
| `w` | 修改文件内容 | 在目录中创建、删除、改名 |
| `x` | 执行文件 | 进入目录 |

目录的 `x` 权限很重要。没有 `x`，即使有 `r`，也可能无法进入目录。

## chmod：修改权限

符号方式：

```bash
chmod u+x script.sh
chmod g-w file.txt
chmod o+r file.txt
chmod a+r file.txt
```

含义：

| 符号 | 含义 |
| --- | --- |
| `u` | 所有者 |
| `g` | 所属组 |
| `o` | 其他人 |
| `a` | 所有人 |
| `+` | 增加权限 |
| `-` | 删除权限 |
| `=` | 设置为指定权限 |

数字方式：

| 权限 | 数值 |
| --- | --- |
| `r` | 4 |
| `w` | 2 |
| `x` | 1 |

常见权限：

```bash
chmod 755 script.sh
chmod 644 file.txt
chmod 700 private-dir
```

解释：

| 权限 | 含义 |
| --- | --- |
| `755` | 所有者可读写执行，组和其他人可读执行 |
| `644` | 所有者可读写，组和其他人只读 |
| `700` | 只有所有者可读写执行 |

递归修改目录及其内容：

```bash
chmod -R 755 目录
```

递归操作要谨慎，不建议随意对系统目录执行 `chmod -R`。

## chown：修改所有者和所属组

修改文件所有者：

```bash
chown 用户 文件
```

修改所有者和所属组：

```bash
chown 用户:用户组 文件
```

递归修改目录：

```bash
chown -R 用户:用户组 目录
```

示例：

```bash
chown -R nginx:nginx /var/www/html
```

## 特殊权限：SGID 和粘滞位

SGID 常用于共享目录。对目录设置 SGID 后，用户在该目录中新建的文件会继承目录的所属组。

```bash
chmod g+s 目录
```

适合多人协作目录，例如：

```bash
chmod g+s /data/project
```

粘滞位常用于公共可写目录。即使用户对目录有写权限，也不能删除其他用户的文件。

```bash
chmod o+t 目录
```

取消粘滞位：

```bash
chmod o-t 目录
```

典型例子是 `/tmp` 目录。

## ACL：更细粒度的权限控制

传统权限只能控制所有者、所属组、其他人。ACL 可以针对指定用户或指定组设置额外权限。

给用户设置 ACL：

```bash
setfacl -m u:用户名:权限 文件或目录
```

给用户组设置 ACL：

```bash
setfacl -m g:组名:权限 文件或目录
```

删除某个 ACL：

```bash
setfacl -x u:用户名 文件或目录
setfacl -x g:组名 文件或目录
```

删除全部 ACL：

```bash
setfacl -b 文件或目录
```

查看 ACL：

```bash
getfacl 文件或目录
```

示例：

```bash
setfacl -m u:alice:rw file.txt
getfacl file.txt
```

## su 和 sudo

`su` 用于切换用户：

```bash
su - 用户名
```

切换到 root：

```bash
su -
```

`-` 表示同时切换用户环境，更接近完整登录该用户。

`sudo` 用于以管理员权限执行单条命令：

```bash
sudo systemctl restart nginx
```

配置 sudo 权限建议使用：

```bash
visudo
```

示例：

```sudoers
testuser ALL=(ALL) NOPASSWD: ALL
```

这表示 `testuser` 可以免密执行所有 sudo 命令。生产环境中不建议随意给 `NOPASSWD: ALL`，应按最小权限原则授权。

## 权限排查思路

遇到权限不足时，可以按这个顺序排查：

1. 当前用户是谁：`whoami`
2. 当前用户属于哪些组：`id`
3. 文件或目录权限是什么：`ls -l`
4. 上级目录是否有执行权限：逐级检查目录权限
5. 是否存在 ACL：`getfacl`
6. 是否需要 sudo 或切换用户

例如：

```bash
whoami
id
ls -ld /data
ls -ld /data/project
ls -l /data/project/app.log
getfacl /data/project/app.log
```

很多权限问题并不是文件本身没权限，而是上级目录缺少 `x` 权限。

## 本篇命令速查

| 命令 | 作用 |
| --- | --- |
| `id 用户名` | 查看用户 UID、GID 和所属组 |
| `whoami` | 查看当前用户 |
| `getent passwd` | 查看系统用户 |
| `getent group` | 查看系统用户组 |
| `useradd 用户` | 创建用户 |
| `passwd 用户` | 设置用户密码 |
| `userdel -r 用户` | 删除用户及家目录 |
| `usermod -aG 组 用户` | 追加附加组 |
| `groupadd 组` | 创建用户组 |
| `gpasswd -a 用户 组` | 添加用户到组 |
| `ls -l` | 查看权限 |
| `chmod 755 文件` | 修改权限 |
| `chown 用户:组 文件` | 修改所有者和所属组 |
| `setfacl -m` | 设置 ACL |
| `getfacl` | 查看 ACL |
| `su - 用户` | 切换用户 |
| `sudo 命令` | 以管理员权限执行命令 |
