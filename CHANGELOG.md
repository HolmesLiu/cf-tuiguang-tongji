# CHANGELOG

> 记录每次有意义的产品修改与迭代
> 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)

---

## [Unreleased]

### Fixed
- 后台仪表盘 JS 报错：解构后误用 `.tasks.filter`（应为 `.filter`）
- CSS 覆盖 HTML `hidden` 属性：后台管理页在未登录时也会显示

### Notes
- 修复由大宇在生产环境测试发现（v0.2.0 部署后）
- 本地 `wrangler dev --local` 模式 D1 是内存模拟（重启清空），与手动 init 的是不同实例
- 生产远程 D1 是持久化的，不受影响

---

## [Unreleased-old]

### 计划中
- v0.3.0
  - 任务调度 / 定时发布
  - 数据导出（CSV）
  - 推广人排行单独页面
  - 异常 IP 标记
  - 部署到生产 + 域名绑定

---

## [0.2.0] - 2026-06-08

### Added
- **完整 wrangler 项目脚手架**（package.json / tsconfig / wrangler.toml / .dev.vars.example）
- **D1 schema**（10 张表 + 完整索引）
- **数据库查询封装**（queries.ts，CRUD + 统计聚合）
- **钉钉模块**
  - access_token 缓存（KV + D1 双层）
  - 通讯录全量同步（分批 + 临时表切换）
  - 工作通知推送
  - 个人待办推送
- **短链服务**（8 位 base62 + 短码重试去重）
- **二维码生成 + R2 存储**（Workers Static Assets 公开）
- **点击埋点**（UA 解析、Referer 归一、IP / 设备 / 地域记录）
- **任务管理**
  - 创建（草稿）
  - 发布（展开接收方 + 短链 + 二维码 + 推钉钉）
  - 软删 + 归档
  - 还原 + 彻底删除
  - 统计聚合（独立 IP / 设备 / 地域 / 时段 / 推广人排行）
- **后台管理 API**（Cookie Session 鉴权）
  - 登录 / 登出 / 当前用户
  - 配置读写
  - 通讯录同步 + 状态查询
  - 任务 CRUD + 发布 + 统计
  - 推广人查询
  - 归档管理
  - API Key 管理
- **Agent API**（API Key 鉴权）
  - 任务创建 / 发布 / 查询
  - 推广人搜索 / 部门列表
- **后台管理前端**（原生 JS + CSS SPA）
  - 登录页
  - 仪表盘
  - 任务列表 / 详情 / 新建
  - 推广人列表 + 通讯录同步
  - 归档（回收站）
  - API Key 管理
  - 系统配置
- **默认管理员自动初始化**（admin / admin123，首次启动）
- **PBKDF2 密码哈希**（Web Crypto API，零依赖）
- **Workers Static Assets**（一体化部署）
- **部署文档**（docs/05-部署指南.md）

### Verified（自测通过）
- ✅ TypeScript 类型检查 0 错误
- ✅ wrangler dev 本地启动成功
- ✅ D1 schema 初始化（本地 + 远程）
- ✅ 后台登录流程（admin/admin123 自动建）
- ✅ Cookie Session 鉴权
- ✅ 创建任务 API
- ✅ 短链跳转 302 + 埋点
- ✅ UA 解析（iPhone WeChat / Mac Chrome）
- ✅ Referer 归一（mp.weixin.qq.com / www.douyin.com）
- ✅ 统计聚合（独立 IP / 设备 / 浏览器 / OS / 推广人排行）

### Notes
- 生产部署前必须修改默认 admin 密码
- 钉钉企业自建应用需开通：通讯录读、工作通知、待办 权限
- 部署后需在 Cloudflare Dashboard 绑定域名 `tuiguang.7kk.top`

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
- GitHub 仓库名用拼音 `cf-tuiguang-tongji`（GitHub 不支持中文仓库名）

---

_格式说明：_
- `Added` 新增功能
- `Changed` 功能变更
- `Deprecated` 即将废弃
- `Removed` 移除功能
- `Fixed` 修复 Bug
- `Security` 安全相关
- `Verified` 自测验证
- `Notes` 备注 / 决策记录
