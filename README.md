# 律析 LawFlow

律析 LawFlow 是一个本地优先的法律材料工作台。它将复杂 DOCX、TXT 或 Markdown 材料转换为可确认的章节方案、可审阅初稿、关键主张依据和待核验任务。

首版不替代律师作出法律意见。所有生成内容均应经过律师审核后使用。

## 已实现能力

- 本地项目空间：按专题、客户或案件归档材料和输出物；
- DOCX、TXT、Markdown 解析：保留标题路径、段落顺序和稳定材料块编号；
- 材料地图：目录、主题信号、规范名称与待核验候选项；
- 章节方案：先生成、编辑并确认，后生成正文；
- 三种交付模板：合伙人十分钟速览、客户法律简报、法声 LexCast 解读稿；
- 关键主张级材料回链：区分原文直接支持与综合归纳；
- 待核验任务：与材料块关联，可更新状态、负责人和截止时间；
- 成果包导出：Markdown、任务表、证据映射和审计摘要；
- 本机模型服务配置：可记录 DeepSeek、OpenAI 或兼容 OpenAI 协议的服务配置。当前版本的初稿生成使用可审阅的本地模板，外部模型调用为下一小版本能力。

## 本地启动

使用当前 Python 环境：

```bash
cd /Users/hanyudong/Projects/lawflow
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8080
```

浏览器打开：

```text
http://127.0.0.1:8080
```

也可以使用 Docker：

```bash
docker compose up --build
```

## 测试

```bash
cd /Users/hanyudong/Projects/lawflow
python3 -m unittest tests.test_api -v
```

## 本地数据位置

运行产生的材料、SQLite 数据库和导出成果均保存在 `data/` 下，并已被 `.gitignore` 排除：

```text
data/
├── app.db
├── projects/
├── exports/
├── temp/
└── logs/
```

详细产品与技术设计见 [`产品与技术方案.md`](产品与技术方案.md)。
