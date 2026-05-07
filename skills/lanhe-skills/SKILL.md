---
name: lanhe-skills
description: 蓝禾技能库：团队专业技能工具箱。触发词：蓝禾技能、蓝禾技能库。当用户说"蓝禾技能 xxx"、"用蓝禾技能"时触发。覆盖产品设计、品质保障、元器件选型、线材设计等蓝禾工程场景。
---

# 蓝禾技能库

团队级专业技能索引。当用户提到"蓝禾技能"时触发。

## 执行流程

### 1. 解析用户意图

从用户消息中提取技能关键词。示例：
- "帮我用蓝禾技能研究线材设计" → 关键词："线材设计"
- "蓝禾技能 查询 标题怎么写" → 关键词："标题怎么写"

### 2. 查找匹配技能

读取 `references/manifest.json` 获取技能列表，按关键词匹配：
- **匹配度 > 85%** → 直接执行
- **匹配度 60-85%** → 列出候选，让用户选
- **匹配度 < 60%** → 请用户说得更具体

匹配时同时检查 `name` 和 `summary` 字段。

### 3. 获取并执行技能

从 GitHub 拉取对应 SKILL.md 并执行：

```powershell
# 读取配置
$config = Get-Content "skills/lanhe-skills/references/github-config.json" | ConvertFrom-Json

# 拉取 SKILL.md（示例：skills/cable-design/SKILL.md）
$url = "$($config.raw_base)/skills/cable-design/SKILL.md"
$skill = Invoke-RestMethod -Uri $url -Headers @{ Authorization = "token $($config.token)" }
```

执行技能中的指令，返回结果给用户。

### 4. 离线兜底

如果 GitHub 不可用：
1. 检查 `references/cache/` 下是否有对应技能的缓存
2. 有缓存 → 用缓存执行，提示用户"当前使用缓存版本"
3. 无缓存 → 告知用户网络问题，建议稍后重试

### 5. 纠错机制

- 用户说"不是这个" → 返回下一个候选
- 用户说"换一批" → 显示其他候选
- 连续 3 次不匹配 → 请用户换个说法

## 上传新技能

当用户说"上传蓝禾技能"时，读取 `references/upload-guide.md` 执行上传流程。

## 配置说明

- 仓库地址、token 等配置在 `references/github-config.json`
- manifest 缓存在 `references/manifest.json`
- 详细配置说明见 `references/github-config.md`
