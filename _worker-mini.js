/**
 * GitHub Action 保活助手 (极简版 + TG/微信通知)
 * * 功能：定时触发 GitHub Workflow，防止 60 天暂停
 * * 部署：Cloudflare Workers
 * * 配置：通过 Settings -> Variables 配置 TOKEN, REPOS, TG_TOKEN, TG_ID, WX_URL
 * * 定时设置：在 Triggers -> Cron Triggers 中设置 (例如每月25号: 0 0 25 * *)
 */

export default {
  async scheduled(event, env, ctx) {
    console.log(`[Start] 开始执行保活任务...`);

    // ================= 配置解析 =================
    // 1. 获取全局 GitHub Token (作为兜底，如果项目自带token则优先用自带的)
    const globalToken = env.TOKEN;

    // 2. 获取 Telegram 配置 (可选)
    const tgToken = env.TG_TOKEN;
    const tgChatId = env.TG_ID;
    
    // 3. 获取微信通知配置 (可选，直接填入 域名/密码)
    const wxUrl = env.WX_URL;

    // 4. 获取项目列表
    let targets = [];
    if (env.REPOS) {
      try {
        targets = JSON.parse(env.REPOS);
      } catch (err) {
        console.error("❌ 环境变量 REPOS JSON 格式错误", err);
        return;
      }
    } else {
      console.warn("⚠️ 未配置 REPOS 环境变量，无任务可执行");
      return;
    }

    // ================= 执行保活逻辑 =================
    const report = [];
    let successCount = 0;

    for (const target of targets) {
      try {
        // 核心逻辑：优先使用项目专属 Token，没有则使用全局 Token
        const currentToken = target.token || globalToken;
        
        if (!currentToken) {
          report.push(`❌ <b>${target.repo}</b>: 失败 (未配置 Token)`);
          console.error(`❌ ${target.repo} 缺少 Token，跳过执行`);
          continue; // 如果既没有专属token，也没有全局token，就跳过这个项目
        }

        const url = `https://api.github.com/repos/${target.owner}/${target.repo}/actions/workflows/${target.workflow}/dispatches`;
        
        console.log(`正在触发: ${target.repo}`);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${currentToken}`,
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "CF-Worker-KeepAlive"
          },
          body: JSON.stringify({
            ref: target.ref
          })
        });

        if (response.status === 204) {
          successCount++;
          // 修改这里：改成 target.owner - target.repo
          report.push(`✅ <b>${target.owner} - ${target.repo}</b>: 成功`);
        } else {
          const errorText = await response.text();
          // 修改这里：改成 target.owner - target.repo
          report.push(`❌ <b>${target.owner} - ${target.repo}</b>: 失败 (${response.status})`);
          console.error(`失败详情: ${errorText}`);
        }
      } catch (err) {
        // 修改这里：改成 target.owner - target.repo
        report.push(`❌ <b>${target.owner} - ${target.repo}</b>: 错误 - ${err.message}`);
      }
    }

    // 打印日志
    console.log(report.join("\n").replace(/<[^>]+>/g, '')); // 打印时去掉HTML标签

    // ================= 发送 Telegram 通知 =================
    if (tgToken && tgChatId) {
      const nowStr = new Date().toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"});
      
      const message = [
        `🤖 <b>GitHub 保活任务报告</b>`,
        `-----------------------------`,
        ...report,
        `-----------------------------`,
        `📊 <b>统计:</b> 成功 ${successCount} / 总计 ${targets.length}`,
        `🕒 <b>时间:</b> ${nowStr}`
      ].join("\n");

      await sendTelegramMessage(tgToken, tgChatId, message);
    }

    // ================= 发送微信通知 =================
    if (wxUrl) {
      const nowStr = new Date().toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"});
      
      // 优化1 (微信卡片外面看)：把成功数量直接写进标题，不点开也能一眼把握全局！
      const title = `🤖 Github保活完毕: 成功 ${successCount}/${targets.length} 个`;
      
      // 优化2 (微信详情里面看)：用双换行拉开间距，去除多余符号，排版更通透
      const content = [
        `🕒 时间: ${nowStr}`,
        `---------- 执行明细 ----------`,
        ...report.map(line => line.replace(/<[^>]+>/g, '')), // 去掉TG用的加粗HTML标签
        `------------------------------`,
        `💡 你的项目正在被安全守护中`
      ].join("\n\n"); // 注意这里改成了 \n\n，让每行之间有空隙，没那么挤

      await sendWechatMessage(wxUrl, title, content);
    }
  },

  // 支持浏览器直接访问测试
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 加一把“锁”：只有访问 /run 路径时才触发，防止 CF 编辑器部署预览时误触
    if (url.pathname === '/run') {
      await this.scheduled(null, env, ctx);
      return new Response("手动触发运行完成，请查看通知或 Worker 日志。", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    
    // 普通访问只显示状态，不执行保活
    return new Response("🤖 GitHub 保活 Worker 运行正常 🟢\n\n如果需要手动触发测试，请在当前网址末尾加上 /run 并回车访问。", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
};

/**
 * 发送 Telegram 消息 (HTML 模式)
 */
async function sendTelegramMessage(token, chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML", // 启用 HTML 格式以支持加粗
        disable_web_page_preview: true
      })
    });
    if (res.ok) {
        console.log("✅ TG 通知发送成功");
    } else {
        const errText = await res.text();
        console.error("❌ TG 通知失败:", errText);
    }
  } catch (e) {
    console.error("❌ TG 发送异常:", e);
  }
}

/**
 * 发送微信通知 (针对你的专属 Push 代码适配)
 */
async function sendWechatMessage(targetUrl, title, content) {
  try {
    // 智能解析用户填写的 WX_URL (例如 https://域名.workers.dev/超复杂密码)
    const urlObj = new URL(targetUrl);
    // 从路径中提取出第一段作为密钥
    const authKey = urlObj.pathname.split('/').filter(Boolean)[0] || '';

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json; charset=utf-8" 
      },
      // 完美契合你的 JSON 解析逻辑：包含 key, title, content
      body: JSON.stringify({
        key: authKey,      // 核心修复点：把提取出来的密码传给你的后端
        title: title,
        content: content   // 你的代码明确通过 body.content 接收正文
      })
    });
    
    // 获取对方服务器的真实返回信息，方便调试
    const resText = await res.text();
    
    if (res.ok) {
      console.log("✅ 微信通知发送成功，对方返回:", resText);
    } else {
      console.error(`❌ 微信通知失败! 状态码: ${res.status}, 对方报错信息: ${resText}`);
    }
  } catch (e) {
    console.error("❌ 微信通知请求发生网络错误:", e);
  }
}
