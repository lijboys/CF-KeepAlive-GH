# 🤖 GitHub Action 保活助手 (Cloudflare Worker 版)
一款部署在 **Cloudflare Workers** 上的轻量脚本，专门解决 GitHub Action 定时任务因**60天无活动**被自动暂停的问题，全程利用免费资源，无需额外服务器。

## ✨ 核心特性
- 🛡 **精准防暂停**：调用 GitHub 官方 API 手动触发 Workflow，模拟真实活跃行为，合规有效
- 🎲 **随机触发间隔**：支持自定义天数区间（默认40-60天），避免固定规律触发，更贴近真人操作
- 📱 **Telegram 实时通知**：推送脚本运行报告、保活结果及下一次预计运行时间，状态一手掌握
- 💰 **零成本运行**：完全消耗 Cloudflare 免费额度（每日10万次请求），无任何费用支出
- 📝 **轻量低耗**：仅在触发时间执行真实请求，其余时间仅做轻量时间检查，资源占用可忽略

## 🛠 第一步：准备 GitHub 核心信息
部署前需获取2个关键信息，用于脚本鉴权和指定保活项目。

### 1. 获取 GitHub 个人访问令牌（Token）
脚本需通过该 Token 获取触发 Workflow 的权限，步骤如下：
1. 登录 GitHub，点击头像 → **Settings**
2. 左侧菜单栏最下方 → **Developer settings**
3. 选择 **Personal access tokens** → **Tokens (classic)**
4. 点击 **Generate new token (classic)**
5. **Note**：自定义名称（例：`CF-KeepAlive`），便于识别
6. **Expiration**：建议选择 **No expiration**（永不过期），避免后续重复配置
7. **Select scopes**（权限勾选，二选一）：
   - 公开仓库：勾选 `public_repo` + `workflow`
   - 私有仓库：勾选 `repo`（包含所有仓库权限） + `workflow`
8. 点击 **Generate token**，复制生成的**ghp_开头**字符串，妥善保存（仅显示一次）

### 2. 整理保活项目 JSON 列表
将需要保活的 GitHub 项目按指定格式整理为 JSON 数组，**需保证格式合法**。
#### 格式说明
| 字段     | 说明                     | 示例       |
|----------|--------------------------|------------|
| `owner`  | GitHub 用户名/组织名     | `testUser` |
| `repo`   | 仓库名称                 | `my-project` |
| `workflow` | Workflow 配置文件名    | `main.yml` |
| `ref`    | 分支名称（通常main/master） | `main` |

#### JSON 模板（直接复制修改）
```json
[
  {
    "owner": "主账号用户名",
    "repo": "主账号仓库A",
    "workflow": "main.yml",
    "ref": "main"
  },
  {
    "owner": "小号用户名",
    "repo": "小号仓库B",
    "workflow": "daily.yml",
    "ref": "master",
    "token": "ghp_这里填小号的专属Token..."
  }
]
```
```json
[{"owner":"用户名","repo":"仓库名","workflow":"main.yml","ref":"main","token": "ghp_这里填专属Token..."}]
```

#### Q2: 它是如何在 GitHub 保活的？
**原理很简单，就是“假装你在手动点击运行按钮”。**

1.  **GitHub 的规则**：如果一个定时任务（Cron）在 60 天内没有任何人去碰它（没有代码提交，也没有手动运行），GitHub 就会觉得这个项目“凉了”，为了节省服务器资源，它会把这个定时任务**停掉**。
2.  **这个脚本的作用**：它利用 GitHub 官方提供的 API（叫 `workflow_dispatch`），每隔一段时间（由你在 CF 设置的 Cron 决定，比如每月一次）给 GitHub 发个指令。
3.  **效果**：这个指令等同于你亲自登录网页，点了一下 Actions 页面上的 **"Run workflow"** 按钮。
4.  **结论**：GitHub 收到指令后，会运行一次 Action，并认为“哦，这个项目还有人在用”，于是 60 天的倒计时就会被**重置**，从而实现“保活”。

> 💡 提示：建议在本地整理好后**压缩为一行**，方便后续粘贴到环境变量中。

## ☁️ 第二步：部署 Cloudflare Worker
完成基础信息准备后，开始在 Cloudflare 平台部署 Worker 脚本。

### 1. 创建并编写 Worker 代码
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧菜单 → **Workers & Pages**
3. 点击 **Create Application** → **Create Worker** → 先点击**Deploy**创建默认Worker
4. 进入 Worker 编辑页，点击 **Edit code**
5. 将提供的 `worker.js` 代码**全量复制**，覆盖编辑器中的默认代码
6. 点击右上角 **Deploy** 保存代码

### 2. 创建 KV 存储（用于记忆随机运行时间）
为实现「指定区间随机运行」，需通过 KV 存储持久化「下一次运行时间戳」，步骤如下：
1. 回到 Cloudflare 主面板，左侧菜单 → **Storage & Databases** → **KV**
2. 点击 **Create Namespace**
3. 自定义命名空间名称（例：`KEEP_ALIVE_DB`），点击 **Add** 完成创建

### 3. 配置 Worker 绑定与环境变量（关键步骤）
回到你的 Worker 页面，点击 **Settings** → **Variables**，分两步配置：

#### A. 绑定 KV 命名空间（必须配置）
1. 找到 **KV Namespace Bindings** 区域，点击 **Add Binding**
2. **Variable name**：**必须填写 `kv`**（小写，不可修改，与脚本内变量对应）
3. **KV Namespace**：选择上一步创建的 KV 命名空间（例：`KEEP_ALIVE_DB`）
4. 点击 **Deploy** 保存绑定

#### B. 添加环境变量
点击 **Add Variable**，按以下表格添加变量，**必填项必须填写**，选填项按需配置：

| 变量名   | 是否必填 | 示例值                | 说明                                                                 |
|----------|----------|-----------------------|----------------------------------------------------------------------|
| `TOKEN`  | ✅ 是    | `ghp_xxxxxxxxx`       | 第一步获取的 GitHub 个人访问令牌                                     |
| `REPOS`  | ✅ 是    | `[{"owner":"test",...}]` | 第一步整理的保活项目 JSON 字符串（**需压缩为一行，保证格式合法**） |
| `TIME`   | ❌ 否    | `40-60`               | 随机触发的天数区间，默认值 `40-60`，可自定义（例：`30-50`）|
| `TG_TOKEN` | ❌ 否  | `123456:ABCdefxxxx`   | Telegram 机器人 Token（需要TG通知时填写）|
| `WX_URL` | ❌ 否  | `[123456:ABCdefxxxx](https://域名.workers.dev/密码)`   |  你的自定义微信通知 API，直接填完整链接即可|
| `TG_ID`  | ❌ 否    | `12345678`            | Telegram 聊天ID（需要TG通知时填写，与TG_TOKEN配套使用）|

> 💡 重要提示：`REPOS` 为核心变量，**必须是合法的 JSON 字符串**，格式错误会导致脚本运行失败。

## ⏰ 第三步：设置 Worker 定时触发器（Triggers）
脚本需每日检查「是否到达运行时间」，因此需配置 Cron 触发器实现定时执行，步骤如下：
1. 回到 Worker 页面，点击 **Triggers** 选项卡
2. 找到 **Cron Triggers** 区域，点击 **Add Cron Trigger**
3. **Cron Expression**：建议设置**每天一次**，示例（可自定义时区）：
   ```bash
   0 9 * * *  # 每天上午9点执行（Cloudflare 默认 UTC 时区，需注意本地时间转换）
   ```
4. 点击 **Add Trigger** 完成配置

## ❓ 常见问题
### Q：为什么 Cron 设置每天运行，会不会占用太多 Cloudflare 免费配额？
A：完全不会。Cloudflare Worker 提供**每日10万次免费请求额度**，脚本执行逻辑为：
每日仅轻量读取 KV 中的时间戳（耗时几毫秒，无实际资源消耗），**仅当到达随机生成的运行日期**（如第50天），才会调用 GitHub API 执行保活操作。绝大部分时间脚本都是「检查时间 → 继续休眠」，资源消耗几乎为0。

### Q：如何获取 Telegram Bot Token 和 Chat ID？
A：两步即可获取，全程免费：
1. **TG_TOKEN**：在 Telegram 搜索 **@BotFather**，发送 `/newbot` 按提示创建机器人，创建成功后会返回机器人 Token
2. **TG_ID**：在 Telegram 搜索 **@userinfobot**，点击 **Start**，机器人会直接返回你的个人 Chat ID

### Q：第一次部署后脚本没反应，如何测试？
A：首次运行时，因 KV 中无任何时间记录，脚本会**默认立即执行一次保活任务**，并生成下一次随机运行时间。手动测试方法：
进入 Worker 界面 → 右上角 **Deploy** 旁的下拉菜单 → **Triggers** → 复制 Worker 访问 URL → 在浏览器中直接访问该 URL，即可触发一次脚本运行。

---
> 📌 小提示：可在 Cloudflare Worker 日志中查看脚本运行状态，排查执行异常问题。
