<p align="center">
  <img src="./NodeWarden.svg" alt="NodeWarden Logo" />
</p>

<p align="center">
  运行在 Cloudflare Workers 上的 Bitwarden 兼容服务端
</p>

<p align="center">
  <a href="https://workers.cloudflare.com/"><img src="https://img.shields.io/badge/Powered%20by-Cloudflare-F38020?logo=cloudflare&logoColor=white" alt="Powered by Cloudflare" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-LGPL--3.0-2ea44f" alt="License: LGPL-3.0" /></a>
  <a href="https://github.com/00o-sh/nodewarden/actions/workflows/test.yml"><img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/00o-sh/nodewarden/badges/coverage.json" alt="Test Coverage" /></a>
  <a href="https://github.com/00o-sh/nodewarden/actions/workflows/test.yml"><img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/00o-sh/nodewarden/badges/i18n.json" alt="i18n Coverage" /></a>
  <a href="https://github.com/shuaiplus/NodeWarden/releases/latest"><img src="https://img.shields.io/github/v/release/shuaiplus/NodeWarden?display_name=tag" alt="Latest Release" /></a>
  <a href="https://github.com/shuaiplus/NodeWarden/actions/workflows/sync-upstream.yml"><img src="https://github.com/shuaiplus/NodeWarden/actions/workflows/sync-upstream.yml/badge.svg" alt="Sync Upstream" /></a>
</p>

<p align="center">
  <a href="https://t.me/NodeWarden_News">Telegram 频道</a> |
  <a href="https://t.me/NodeWarden_Official">Telegram 群组</a>
</p>

<p align="center">
  <a href="./README_EN.md">English</a> |
  <a href="./CONTRIBUTING.md">贡献指南</a>
</p>

> **免责声明**  
> 本项目仅供学习与交流使用，请定期备份你的密码库。  
> 本项目与 Bitwarden 官方无关，请不要向 Bitwarden 官方反馈 NodeWarden 的问题。

---

## 与 Bitwarden 官方服务端能力对比

| 能力 | Bitwarden | NodeWarden | 说明 |
|---|---|---|---|
| 网页密码库 | ✅ | ✅ | **原创Web Vault界面** |
| **PWA 支持** | ⚠️ 基础 | ✅ | **可安装、离线使用、App快捷方式** |
| **Web Vault 离线查看** | ❌ | ✅ | **网页端支持离线查看保险库** |
| **Passkey 登录** | ✅ | ✅ | **支持WebAuthn/FIDO2无密码登录** |
| 全量同步 `/api/sync` | ✅ | ✅ | 已针对官方客户端做兼容优化 |
| 附件上传 / 下载 | ✅ | ✅ | Cloudflare R2 或 KV |
| Send | ✅ | ✅ | 支持文本与文件 Send |
| 导入 / 导出 | ✅ | ✅ | 支持 Bitwarden JSON / CSV / **ZIP 导入（包括附件）** |
| **云端备份中心** | ❌ | ✅ | **支持 WebDAV / S3 定时备份（OneDrive/Google Drive等）** |
| 密码提示（网页端） | ⚠️ 有限 | ✅ | **无需发送邮件** |
| **邮箱别名（转发地址）生成器** | ⚠️ 仅依赖第三方 | ✅ | **基于 Cloudflare Email Routing 自托管；兼容 addy.io，官方客户端可直接使用；别名在服务端存储与管理** |
| TOTP / Steam TOTP | ✅ | ✅ | 含 `steam://` 支持 |
| 多用户 | ✅ | ✅ | 支持邀请码注册 |
| 组织 / 集合 / 成员权限 | ✅ | ❌ | 未实现 |
| 登录 2FA | ✅ | ⚠️ 部分支持 | 支持TOTP和Passkey（作为第二因素） |
| SSO / SCIM / 企业目录 | ✅ | ❌ | 未实现 |

---

## 已测试客户端

- ✅ Windows 桌面端
- ✅ 手机 App
- ✅ 浏览器扩展
- ✅ Linux 桌面端
- ⚠️ macOS 桌面端尚未完整验证

---

## 可视化快速部署

1. Fork NodeWarden 仓库到自己的 GitHub 账号
2. 进入 [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create)
3. 选择 Continue with GitHub 并选择你的仓库
4. 构建命令填 `npm run build`，部署命令填 `npm run deploy`
- 如果你打算用 KV 模式，把部署命令改成 `npm run deploy:kv`
5. 等部署完成后，打开生成的 Workers 域名

- Workers 默认域名在部分网络环境不可直连。如需自定义域名，到 [Workers 设置](https://dash.cloudflare.com/?to=/:account/workers/services/view/nodewarden/production/settings)里添加。

- 页面提示缺少 `JWT_SECRET` 时，到 Workers 设置里添加 Secret。正式环境至少使用 32 个字符以上的随机字符串，不要使用临时值或示例值。

- 这套流程里，用户实际做的是把代码交给 Cloudflare 构建并部署。代码里的 `wrangler.toml` 或 `wrangler.kv.toml` 决定绑定名，Worker 第一次处理请求时会自动初始化 D1 schema，不需要用户上传 SQL。


> [!TIP] 
> 默认R2与可选KV的区别：
>   | 储存 | 是否需绑卡 | 单个附件/Send文件上限 | 免费额度 |
>   |---|---|---|---|
>   | R2 | 需要 | 100 MB（软限制可更改） | 10 GB |
>   | KV | 不需要 | 25 MiB（Cloudflare限制） | 1 GB |


## 更新方法：
- 手动：打开你 Fork 的 GitHub 仓库，看到顶部同步提示后，点击 `Sync fork` ➜ `Update branch`
- 自动：进入你的 Fork 仓库 ➜ `Actions` ➜ `Sync upstream` ➜ `Enable workflow`，会在每天凌晨 3 点自动同步上游。



## CLI 部署

```powershell
git clone https://github.com/shuaiplus/NodeWarden.git
cd NodeWarden

npm install
npx wrangler login

# 默认：R2 模式
npm run deploy

# 可选：KV 模式
npm run deploy:kv

# 本地开发
npm run dev
npm run dev:kv
```

---

## 主要特性

### PWA 渐进式 Web 应用

- ✅ **可安装到桌面** - 像原生应用一样运行
- ✅ **离线使用** - Service Worker 缓存，离线也能查看密码
- ✅ **App 快捷方式** - 快速启动保险库、TOTP代码
- ✅ **后台解密** - Web Worker 处理解密，不阻塞UI

### Passkey 无密码登录

- ✅ **WebAuthn/FIDO2 支持** - 使用指纹、Face ID等登录
- ✅ **PRF 密钥解锁** - Passkey 可直接解锁保险库
- ✅ **官方客户端兼容** - Chromium系浏览器扩展可用Passkey登录
- ✅ **多设备同步** - 支持iCloud、Google Password Manager等

### 邮箱别名（转发地址）生成器

在你自己的域名上生成按站点区分的转发别名，底层由 **Cloudflare Email Routing** 提供，无需依赖第三方别名服务。

- ✅ **兼容官方 Bitwarden 客户端**：NodeWarden 提供 **addy.io 兼容** 接口。在客户端的“转发邮箱别名”生成器中选择 **addy.io**，将 **自托管服务器地址** 填为你的 NodeWarden 实例，粘贴在 NodeWarden 中生成的 **API 访问令牌**，并填写 **域名**。
- ✅ **服务端存储**：与 Bitwarden（仅委托第三方、自身不保存）不同，所有别名（包括从官方客户端创建的）都会保存在 NodeWarden，可集中查看、停用与删除。
- ✅ **默认走 Catch-all**：配置 Cloudflare catch-all 后，生成别名无需任何 API 调用，别名直接转发到默认地址。
- ✅ **高级覆盖**：可选择非默认的转发目标或停用某个别名，NodeWarden 会自动创建对应的 Email Routing 规则（转发/丢弃）。

配置步骤：

1. 在 Cloudflare 为你的域名启用 **Email Routing** 并验证一个目标地址（你的真实收件箱）；可选开启到该地址的 **catch-all**。
2. 创建一个受限 **API Token**（Zone → Email Routing：Edit），并设置 Worker 机密 `CF_API_TOKEN` 与 `CF_ZONE_ID`。*（仅高级别名规则需要；默认 catch-all 别名无需此项。）*
3. 以管理员身份通过 `PUT /api/email-aliases/settings` 配置别名域名与默认目标地址。
4. 生成 **API 访问令牌**，连同 NodeWarden 地址与域名一起填入客户端的 addy.io 转发器。

### 云端备份说明

- 远程备份支持 **WebDAV** 与 **S3**
- 支持 **OneDrive**（通过Koofr）、**Google Drive**（通过Koofr）、**Cloudflare R2**、**Backblaze B2** 等
- 勾选”包含附件”后：
  - ZIP 内仍只包含 `db.json` 与 `manifest.json`
  - 真实附件单独存放在 `attachments/`
  - 后续备份会按稳定 blob 名复用已有附件，不会每次全量重传
- 远程还原时：
  - 会从 `attachments/` 目录按需读取附件
  - 缺失的附件会被安全跳过
  - 被跳过的附件不会在恢复后的数据库中留下脏记录

---

## 导入 / 导出

当前支持的导入来源包括：

- Bitwarden JSON
- Bitwarden CSV
- Bitwarden 密码库 + 附件 ZIP
- NodeWarden JSON
- 网页导入器里可见的多种浏览器 / 密码管理器格式

当前支持的导出方式包括：

- Bitwarden JSON
- Bitwarden 加密 JSON
- 带附件的 ZIP 导出
- NodeWarden JSON 系列
- 备份中心中的实例级完整手动导出

---


## 开源协议

LGPL-3.0 License

---

## 致谢

- [Bitwarden](https://bitwarden.com/) - 原始设计与客户端
- [Vaultwarden](https://github.com/dani-garcia/vaultwarden) - 服务端实现参考
- [Cloudflare Workers](https://workers.cloudflare.com/) - 无服务器平台

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=shuaiplus/NodeWarden&type=timeline&legend=top-left)](https://www.star-history.com/#shuaiplus/NodeWarden&type=timeline&legend=top-left)
