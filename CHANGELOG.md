# CHANGELOG

> 记录每次有意义的产品修改与迭代
> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)

---

## [Unreleased]

### 计划中
- v0.2.0：核心代码 MVP
  - wrangler 项目脚手架
  - D1 schema 初始化
  - 钉钉 access_token 缓存 + 通讯录分批同步
  - 短链生成 / 跳转 / 埋点
  - 二维码生成 + R2 存储
  - 任务创建 / 发布 / 软删 / 归档
  - 管理员登录 + 仪表盘

---

## [0.1.0] - 2026-06-08

### Added
- 项目立项 / 业务对齐
- 数据库表结构设计（10 张表）
- 技术选型（Cloudflare 生态 + 必要 npm 包）
- API 路由清单
- 项目文档（项目说明 / 项目进度 / 业务模型 / 数据库设计 / 技术选型 / API 路由）
- Git 仓库初始化 + GitHub 推送
- 项目管理规则写入娜娜子长期记忆（MEMORY.md）

### Notes
- 业务对齐用 4 轮对话完成
- 钉钉"待办"接口核对后决定砍掉 OAuth 流程，简化平台
- 架构按 CF Worker 一体化思路（非传统前后端分离）

---

_格式说明：_
- `Added` 新增功能
- `Changed` 功能变更
- `Deprecated` 即将废弃
- `Removed` 移除功能
- `Fixed` 修复 Bug
- `Security` 安全相关
- `Notes` 备注 / 决策记录
