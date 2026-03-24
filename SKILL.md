# 蓝禾技能库 - 主入口技能

> 当用户发送「蓝禾技能：xxx」时，执行此技能。

## 技能信息

- **skill_id**: lanhe-skill-router
- **version**: 4.0
- **updated_at**: 2026-03-25

## 触发条件

用户消息以 `蓝禾技能：` 开头

## 核心改变

**直接读取 manifest.json**，不再扫描各个 SUMMARY.md 文件。

manifest.json 是上传技能在每次上传时维护的索引文件，包含所有技能的摘要信息。

---

## 执行流程

### 第 1 步：解析用户问题

提取 `蓝禾技能：` 后面的内容作为搜索词：

```
用户: "蓝禾技能：标题怎么写"
→ 搜索词: "标题怎么写"
```

---

### 第 2 步：获取 manifest.json

使用 GitHub API 直接获取 manifest.json：

```
API: GET /repos/Marerlee/lanhe-skills/contents/manifest.json
```

返回的 content 是 Base64 编码的，解码后得到 JSON。

---

### 第 3 步：计算匹配度

对 manifest.json 中的每个技能计算匹配得分：

```
匹配得分 = 
  (触发条件包含搜索词 ? 40分 : 0)
  + (语义关键词与搜索词重叠数 × 6分，最高 60分)
  + (skill_id 精确匹配 ? 20分 : 0)
```

---

### 第 4 步：返回结果

**匹配度 > 85%**：
直接执行最佳匹配的技能

**匹配度 60-85%**：
显示 Top 2 技能，请用户确认：

```
🔍 找到相关技能，请确认：

1️⃣ 【技能名称】
   匹配度：XX%
   [一句话描述]
   
2️⃣ 【技能名称】
   匹配度：XX%
   [一句话描述]

请回复序号，或描述更具体的问题。
```

**匹配度 < 60%**：
询问更具体的问题：

```
🤔 没有找到完全匹配的结果。请更具体地描述你的问题，例如：
• "亚马逊 listing 标题优化"
• "工厂设备异响怎么处理"
• "客户投诉退款怎么回复"
```

---

### 第 5 步：执行选中的技能

根据 manifest.json 中的 `path` 字段，读取对应技能的 SKILL.md 并执行。

**获取 SKILL.md**：
```
API: GET /repos/Marerlee/lanhe-skills/contents/{path}/SKILL.md
```

---

### 第 6 步：执行后确认

```
✅ 已执行 【技能名称】

[输出内容...]

👆 满意吗？
• "满意" → 结束
• "不是这个" → 返回下一个最佳匹配
• "换一批" → 显示其他候选技能
```

---

## 纠错机制

- 用户说"不对"、"不是这个"、"换一批" → 返回下一个最佳匹配
- 连续 3 次匹配失败 → 引导用户细化问题

---

## GitHub API 调用示例

```bash
# 获取 manifest.json（单次调用）
curl -s "https://api.github.com/repos/Marerlee/lanhe-skills/contents/manifest.json" \
  -H "Accept: application/vnd.github.v3+json"

# 响应示例
{
  "content": "eyJ2ZXJzaW9uIjoiMjAyNi0wMy0yNSIsICJza2lsbHMiOiBbXX0=",  // Base64 encoded
  "sha": "xxx",
  ...
}

# 解码后
{
  "version": "2026-03-25",
  "updated_at": "2026-03-25T16:16:00Z",
  "skills": [...]
}
```

---

## 检索算法

| 项目 | 最高分 | 说明 |
|------|--------|------|
| 触发条件匹配 | 40 | 完全包含搜索词得 40，部分得 20 |
| 语义关键词重叠 | 60 | 每个重叠关键词得 6 分 |
| skill_id 精确匹配 | 20 | 用户直接提到 skill_id 时加分 |

---

## manifest.json 结构

```json
{
  "version": "2026-03-25",
  "updated_at": "2026-03-25T16:16:00Z",
  "skills": [
    {
      "skill_id": "amazon-title-optimization",
      "name": "亚马逊标题优化",
      "path": "skills/亚马逊标题优化/",
      "triggers": ["标题怎么写", "优化 listing", ...],
      "keywords": ["亚马逊", "标题", "listing", ...],
      "capabilities": "✅ 能：...\n❌ 不能：...",
      "output_format": "Markdown 清单"
    }
  ]
}
```

---

## 注意事项

- **只需调用 1 次 GitHub API** 获取 manifest.json
- manifest.json 由上传技能维护，每次上传新技能时自动更新
- 不再需要扫描各个 SUMMARY.md 文件
- 始终使用最新的 manifest.json（包含所有技能的索引）
