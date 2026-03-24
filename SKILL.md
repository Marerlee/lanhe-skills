# 蓝禾技能库 - 主入口技能

> 当用户发送「蓝禾技能：xxx」时，执行此技能。

## 技能信息

- **skill_id**: lanhe-skill-router
- **version**: 3.0
- **updated_at**: 2026-03-25

## 触发条件

用户消息以 `蓝禾技能：` 开头

## 执行流程

### 第 1 步：解析用户问题

提取 `蓝禾技能：` 后面的内容作为搜索词：

```
用户: "蓝禾技能：标题怎么写"
→ 搜索词: "标题怎么写"
```

---

### 第 2 步：直接扫描 GitHub 仓库

使用 GitHub API 列出 skills/ 目录下的所有 SUMMARY.md：

```
API: GET /repos/Marerlee/lanhe-skills/contents/skills
```

递归获取所有 SUMMARY.md 文件路径。

---

### 第 3 步：获取并解析每个 SUMMARY.md

对每个 SUMMARY.md 文件：
```
API: GET /repos/Marerlee/lanhe-skills/contents/{path}
```

解析内容，提取：
- skill_id
- 触发条件
- 语义关键词
- 能力边界描述

---

### 第 4 步：计算匹配度

```
匹配得分 = 
  (触发条件包含搜索词 ? 40分 : 0)
  + (语义关键词与搜索词重叠数 × 6分，最高 60分)
  + (skill_id 精确匹配 ? 20分 : 0)
```

---

### 第 5 步：返回结果

**匹配度 > 85%**：
直接执行最佳匹配的 SKILL.md

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

### 第 6 步：执行选中的技能

读取对应技能的 SKILL.md 并执行。

**获取 SKILL.md**：
```
API: GET /repos/Marerlee/lanhe-skills/contents/{skill_path}/SKILL.md
```

---

### 第 7 步：执行后确认

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
# 1. 获取 skills 目录结构
curl -s "https://api.github.com/repos/Marerlee/lanhe-skills/contents/skills" \
  -H "Accept: application/vnd.github.v3+json"

# 2. 获取单个文件内容
curl -s "https://api.github.com/repos/Marerlee/lanhe-skills/contents/skills/%E4%BA%9A%E9%A9%AC%E9%80%8A%E6%A0%87%E9%A2%98%E4%BC%98%E5%8C%96/SUMMARY.md" \
  -H "Accept: application/vnd.github.v3+json"
```

返回的 content 字段是 Base64 编码的。

---

## 检索算法

| 项目 | 最高分 | 说明 |
|------|--------|------|
| 触发条件匹配 | 40 | 完全包含搜索词得 40，部分得 20 |
| 语义关键词重叠 | 60 | 每个重叠关键词得 6 分 |
| skill_id 精确匹配 | 20 | 用户直接提到 skill_id 时加分 |

---

## 注意事项

- **直接调用 GitHub API**，不需要 clone 到本地
- 始终获取最新版本
- API 返回的 content 是 Base64 编码，需要解码
- 不检索 SKILL.md，只检索 SUMMARY.md
