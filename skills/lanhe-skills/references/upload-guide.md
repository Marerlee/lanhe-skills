# 上传蓝禾技能

当用户说"上传蓝禾技能"时执行此流程。

## 前置条件

1. 用户已在对话中描述了技能需求
2. 已生成对应的 SKILL.md 内容
3. 用户确认内容无误

## 上传流程

### 第 1 步：确认技能

从对话中找到要上传的技能，确认名称和内容。

### 第 2 步：生成摘要

从 SKILL.md 提取：
- 技能名称（name）
- 技能 ID（skill_id，英文小写+连字符）
- 一句话摘要（summary）

### 第 3 步：格式检查

检查 SKILL.md 是否包含必要字段：
- 触发条件 / 用户可能的问法
- 执行所需信息
- 执行步骤
- 输出格式

如有缺失，自动补充后给用户确认。

### 第 4 步：推送到 GitHub

读取 `references/github-config.json` 获取 token 和仓库信息。

```powershell
$config = Get-Content "skills/lanhe-skills/references/github-config.json" | ConvertFrom-Json
$headers = @{
    Authorization = "token $($config.token)"
    Accept = "application/vnd.github.v3+json"
}

# 1. 创建/更新 SKILL.md
$skillContent = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($skillMd))
$body = @{ message = "添加技能: $skillName"; content = $skillContent } | ConvertTo-Json
Invoke-RestMethod -Uri "$($config.api_base)/contents/skills/$skillId/SKILL.md" -Method Put -Headers $headers -Body $body

# 2. 更新 manifest.json
$manifest = Invoke-RestMethod -Uri "$($config.raw_base)/manifest.json"
$manifest.skills += @{ name = $skillName; skill_id = $skillId; version = "1.0"; summary = $summary; path = "skills/$skillId" }
$manifestContent = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($manifest | ConvertTo-Json -Depth 5)))
$sha = (Invoke-RestMethod -Uri "$($config.api_base)/contents/manifest.json").sha
$body = @{ message = "更新 manifest: $skillName"; content = $manifestContent; sha = $sha } | ConvertTo-Json
Invoke-RestMethod -Uri "$($config.api_base)/contents/manifest.json" -Method Put -Headers $headers -Body $body
```

### 第 5 步：更新本地缓存

上传成功后，同步更新 `references/manifest.json` 本地缓存。

### 第 6 步：反馈

告知用户：
- ✅ 上传成功
- 技能名称和文件路径
- 仓库地址
