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
    // 1. 获取 GitHub Token
    const ghToken = env.TOKEN;
    if (!ghToken) {
      console.error("❌ 未检测到 TOKEN 环境变量，请在 Settings -> Variables 中配置");
      return;
    }

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
        const url = `https://api.github.com/repos/${target.owner}/${target.repo}/actions/workflows/${target.workflow}/dispatches`;
        
        console.log(`正在触发: ${target.repo}`);

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${ghToken}`,
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "CF-Worker-KeepAlive"
          },
          body: JSON.stringify({
            ref: target.ref
          })
        });

        if (response.status === 204) {
          successCount++;
          report.push(`✅ <b>${target.repo}</b>: 成功`);
        } else {
          const errorText = await response.text();
          report.push(`❌ <b>${target.repo}</b>: 失败 (${response.status})`);
          console.error(`失败详情: ${errorText}`);
        }
      } catch (err) {
        report.push(`❌ <b>${target.repo}</b>: 错误 - ${err.message}`);
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
      const title = "🤖 GitHub 保活任务报告";
      
      // 微信通知通常不支持 HTML 加粗，所以我们过滤掉 HTML 标签让排版更干净
      const content = [
        ...report.map(line => line.replace(/<[^>]+>/g, '')), 
        `-----------------------------`,
        `📊 统计: 成功 ${successCount} / 总计 ${targets.length}`,
        `🕒 时间: ${nowStr}`
      ].join("\n");

      await sendWechatMessage(wxUrl, title, content);
    }
  },

  // 支持浏览器直接访问测试
  async fetch(request, env, ctx) {
    await this.scheduled(null, env, ctx);
    return new Response("手动运行完成，请查看通知或 Worker 日志。", { status: 200 });
  }
};

/**
 * 发送 Telegram 消息 (HTML 模式)
 */
async function sendTelegramMessage(token, chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML", // 启用 HTML 格式以支持加粗
        disable_web_page_preview: true
      })
    });
    console.log("✅ TG 通知发送成功");
  } catch (e) {
    console.error("❌ TG 发送失败:", e);
  }
}

/**
 * 发送微信通知 (调用自定义通知中心 JSON POST)
 */
async function sendWechatMessage(targetUrl, title, content) {
  try {
    await fetch(targetUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json; charset=utf-8" 
      },
      body: JSON.stringify({
        title: title,
        body: content
      })
    });
    console.log("✅ 微信通知发送请求已发出");
  } catch (e) {
    console.error("❌ 微信通知发送失败:", e);
  }
}
