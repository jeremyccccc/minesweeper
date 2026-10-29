# 在线扫雷

支持跨设备账户、每周最佳、历史最佳和排行榜的网页版扫雷。

## 部署到 Vercel

1. 将本目录提交到 GitHub 仓库。
2. 在 Vercel 中选择 **Add New → Project**，导入该仓库并部署。
3. 打开项目的 **Storage / Marketplace**，添加 **Neon Postgres** 集成并连接到此项目。
4. 在 Vercel 项目的环境变量中确认存在 `DATABASE_URL`（部分旧集成可能显示为 `POSTGRES_URL`）。
5. 重新部署一次。

无需手动创建数据表；首次访问 API 时会自动初始化账户、会话和成绩表。

## 本地开发

复制线上数据库连接地址到本地 `.env.local`：

```text
DATABASE_URL=你的数据库连接地址
```

然后运行：

```bash
npm install
npm run dev
```

不要将 `.env.local` 提交到 GitHub。
