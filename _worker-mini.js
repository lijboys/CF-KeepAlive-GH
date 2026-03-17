/**
 * GitHub Action 保活助手 (极简版 + TG/微信通知 + 专属网页详情)
 * * 功能：定时触发 GitHub Workflow，防止 60 天暂停
 * * 部署：Cloudflare Workers
 * * 配置：通过 Settings -> Variables 配置 TOKEN, REPOS, TG_TOKEN, TG_ID, WX_URL, MY_URL
 */

export default {
  async scheduled(event, env, ctx) {
    console.log(`[Start] 开始执行保活任务...`);

    // ================= 配置解析 =================
    const globalToken = env.TOKEN;
    const tgToken = env.TG_TOKEN;
    const tgChatId = env.TG_ID;
    const wxUrl = env.WX_URL;
    
    // 获取当前 Worker 的域名 (用于生成详情页链接)
    const myUrl = env.MY_URL; 

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
        const currentToken = target.token || globalToken;
        if (!currentToken) {
          report.push(`❌ ${target.owner} - ${target.repo}: 失败 (未配Token)`);
          continue;
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
          body: JSON.stringify({ ref: target.ref })
        });

        if (response.status === 204) {
          successCount++;
          report.push(`✅ ${target.owner} - ${target.repo}: 成功`);
        } else {
          const errorText = await response.text();
          report.push(`❌ ${target.owner} - ${target.repo}: 失败 (${response.status})`);
          console.error(`失败详情: ${errorText}`);
        }
      } catch (err) {
        report.push(`❌ ${target.owner} - ${target.repo}: 错误 - ${err.message}`);
      }
    }

    console.log(report.join("\n"));

    // ================= 发送 Telegram 通知 =================
    if (tgToken && tgChatId) {
      const nowStr = new Date().toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"});
      const message = [
        `🤖 <b>GitHub 保活任务报告</b>`,
        `-----------------------------`,
        ...report.map(line => line.replace('✅', '✅ <b>').replace('❌', '❌ <b>').replace(':', '</b>:')), // 简单加粗处理
        `-----------------------------`,
        `📊 <b>统计:</b> 成功 ${successCount} / 总计 ${targets.length}`,
        `🕒 <b>时间:</b> ${nowStr}`
      ].join("\n");
      await sendTelegramMessage(tgToken, tgChatId, message);
    }

    // ================= 发送微信通知 =================
    if (wxUrl) {
      const nowStr = new Date().toLocaleString("zh-CN", {timeZone: "Asia/Shanghai"});
      const title = `🤖 保活完毕: 成功 ${successCount}/${targets.length} 个`;
      
      const content = [
        `🕒 执行时间: ${nowStr}`,
        `------------------------------`,
        ...report,
        `------------------------------`,
        `💡 你的项目正在被安全守护中`
      ].join("\n\n");

      // 将 myUrl 传给微信发送函数，用于生成专属网页链接
      await sendWechatMessage(wxUrl, title, content, myUrl);
    }
  },

  // 支持浏览器直接访问测试 & 渲染详情页
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // === 新增：网页详情渲染路由 ===
    if (url.pathname === '/detail') {
      const title = url.searchParams.get('title') || '通知详情';
      const content = url.searchParams.get('content') || '暂无内容';
      
      // 内置一个精美的移动端适配网页
      const html = `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
          <title>${title}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; color: #333; margin: 0; padding: 20px; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; }
            .card { background: #ffffff; border-radius: 16px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
            .header { border-bottom: 1px solid #eee; padding-bottom: 16px; margin-bottom: 16px; }
            h2 { margin: 0; font-size: 20px; color: #173177; font-weight: 600; }
            pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; margin: 0; font-size: 15px; color: #444; }
            .footer { margin-top: 24px; text-align: center; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="card">
              <div class="header">
                <h2>${title}</h2>
              </div>
              <pre>${content}</pre>
            </div>
            <div class="footer">🚀 Powered by Cloudflare Workers</div>
          </div>
        </body>
        </html>
      `;
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    
    // === 原有的防误触手动触发锁 ===
    if (url.pathname === '/run') {
      // 修改这里：自动提取当前访问的域名 (例如 https://abc.com) 并传给 scheduled
      await this.scheduled(null, env, ctx, url.origin);
      return new Response("手动触发运行完成，请查看通知或 Worker 日志。", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    
    return new Response("🤖 GitHub 保活 Worker 运行正常 🟢\n\n测试运行请访问 /run", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
};

/**
 * 发送 Telegram 消息
 */
async function sendTelegramMessage(token, chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true })
    });
  } catch (e) {
    console.error("❌ TG 发送异常:", e);
  }
}

/**
 * 发送微信通知 (带详情页链接生成)
 */
async function sendWechatMessage(targetUrl, title, content, myUrl) {
  try {
    const urlObj = new URL(targetUrl);
    const authKey = urlObj.pathname.split('/').filter(Boolean)[0] || '';

    // 生成指向本 Worker 的详情页链接
    let clickUrl = "https://github.com";
    if (myUrl) {
      const cleanMyUrl = myUrl.replace(/\/$/, ''); // 去掉结尾可能多余的斜杠
      // 将内容编码后放入 URL 参数中，点开后由 /detail 路由渲染成网页
      clickUrl = `${cleanMyUrl}/detail?title=${encodeURIComponent(title)}&content=${encodeURIComponent(content)}`;
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        key: authKey,      
        title: title,
        content: content,
        url: clickUrl // 这里传入我们精心生成的详情网页链接！
      })
    });
    
    const resText = await res.text();
    if (res.ok) {
      console.log("✅ 微信通知发送成功");
    } else {
      console.error(`❌ 微信通知失败! 状态码: ${res.status}, 报错: ${resText}`);
    }
  } catch (e) {
    console.error("❌ 微信请求网络错误:", e);
  }
}
