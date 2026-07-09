# 读书笔记同步工具

这是一个适合部署到 Vercel 的电子书读书笔记工具首版，已经支持：

- 导入 `EPUB`、`PDF`、`TXT`、`MD`、`DOCX`
- 在阅读界面中划线
- 给划线写批注、记录临时感想
- 按书导出全部笔记为 `TXT` 或 `Word`
- 配置云端数据库后，在手机和电脑之间同步笔记

## 本地启动

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`

## 部署到 Vercel

1. 把项目上传到 Git 仓库。
2. 在 Vercel 中导入这个仓库。
3. 如果你需要跨设备同步，在 Vercel 项目中配置环境变量 `DATABASE_URL`。
4. 重新部署。

没有配置 `DATABASE_URL` 时，应用仍然可以正常使用，但笔记只会保存在当前设备浏览器里，不会跨设备同步。

## 环境变量

项目已经提供示例文件 [`.env.example`](C:/Users/Fangzhou/Documents/读书笔记工具/.env.example)。

需要同步功能时：

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

## 上线前清单

- 确认仓库里不要提交 `.env.local`
- 在 Vercel 里填好 `DATABASE_URL`
- 首次上线后导入一本测试书，确认本地笔记可保存
- 如果要多设备同步，用同一个同步口令在另一台设备上导入同一本书，再拉取云端笔记

## 当前版本的边界

- 同步的是“笔记”，不是整本书原文
- 换设备后仍需要重新导入同一本电子书文件
- `EPUB` 和 `PDF` 已经尽量保留结构与排版节奏，但还不是完全还原原始阅读器

## 数据表

应用第一次访问同步接口时，会自动创建 `reader_notes` 表，不需要手动建表。
