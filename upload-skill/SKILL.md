# 上传蓝禾技能

> 当用户发送「上传蓝禾技能」时执行此技能。

## 技能信息

- **skill_id**: lanhe-upload-skill
- **version**: 3.0
- **updated_at**: 2026-03-25

## 触发条件

用户发送：`上传蓝禾技能`

## 前置条件

用户应该已经在对话中描述并确认了一个技能的 SKILL.md 内容。

## 执行流程

### 第 1 步：定位 SKILL.md

从对话历史中分析，找出用户刚才确认的技能。

可能情况：
- **情况 A**：用户在对话中刚刚确认了技能，SKILL.md 存在于本地 skills/ 目录下
- **情况 B**：用户提供技能名称，从本地 skills/ 目录查找
- **情况 C**：用户提供技能内容（粘贴），直接使用

**询问用户**：

```
🔍 正在查找你确认的技能...

请确认你要上传的技能是哪一个？
1️⃣ 在对话中刚刚确认的技能（根据上下文判断）
2️⃣ 我来指定技能名称
3️⃣ 我直接粘贴技能内容

请回复序号或技能名称。
```

---

### 第 2 步：读取并分析 SKILL.md

读取用户选定的 SKILL.md 文件，提取以下信息：

- skill_id
- 技能名称
- 触发条件
- 语义关键词（从内容中分析提取）
- 能力边界
- 执行需要
- 输出格式

---

### 第 3 步：生成 SUMMARY.md 初稿

根据分析结果，生成标准格式的 SUMMARY.md。

---

### 第 4 步：展示摘要给用户确认

```
━━━━━━━━━━━━━━━━━━━━
📋 SUMMARY.md 草稿
━━━━━━━━━━━━━━━━━━━━

【技能名称】xxx
【skill_id】xxx
【触发条件】
• xxx
• xxx
• xxx

【语义关键词】
xxx, xxx, xxx, xxx, xxx

【能力边界】
✅ xxx
❌ xxx

【执行需要】xxx, xxx

【输出格式】xxx

━━━━━━━━━━━━━━━━━━━━

请确认摘要内容：
1️⃣ 确认无误，开始上传
2️⃣ 有小问题，我来调整
3️⃣ 重新生成

格式检查：⏳ 检查中...
```

---

### 第 5 步：检查摘要格式

自动检查以下项目：

| 检查项 | 要求 | 状态 |
|--------|------|------|
| skill_id | 非空，英文+连字符 | ✅/❌ |
| 触发条件 | 至少 3 条 | ✅/❌ |
| 语义关键词 | 至少 5 个 | ✅/❌ |
| 能力边界 | 至少 1 条 ✅ 和 1 条 ❌ | ✅/❌ |
| 执行需要 | 非空 | ✅/❌ |
| 输出格式 | 非空 | ✅/❌ |

**如果检查不通过**：修正 → 再次展示 → 再次检查（循环）

---

### 第 6 步：写入 SUMMARY.md

用户确认后，写入 `skills/{技能名称}/SUMMARY.md`

---

### 第 7 步：更新 manifest.json

读取现有的 `manifest.json`，添加或更新该技能的条目：

```json
{
  "skill_id": "xxx",
  "name": "xxx",
  "path": "skills/xxx/",
  "triggers": ["..."],
  "keywords": ["..."],
  "capabilities": "✅ ...\n❌ ...",
  "output_format": "..."
}
```

同时更新 manifest.json 的 `version` 和 `updated_at`。

---

### 第 8 步：推送到 GitHub

依次推送以下文件到 GitHub：

1. `skills/{技能名称}/SKILL.md`
2. `skills/{技能名称}/SUMMARY.md`
3. `manifest.json`

```
⏳ 正在推送 GitHub...
```

使用 GitHub API 逐个上传：

```bash
# 获取文件 SHA（如果已存在）
# 编码内容为 Base64
# PUT 到对应路径
```

---

### 第 9 步：完成确认

成功：
```
✅ 上传完成！

【技能】{技能名称}
【路径】skills/{技能名称}/
【文件】
• SKILL.md
• SUMMARY.md
• manifest.json（已更新）

🌐 https://github.com/Marerlee/lanhe-skills
```

失败：
```
❌ 上传失败

【错误原因】
xxx

请手动处理或联系管理员。
```

---

## 循环检查机制

如果用户选择继续调整或检查不通过，流程回到第 4 步：
```
展示摘要 → 用户调整 → 检查格式 → 
  ↓ 不通过
修改 → 展示 → 检查 → ...（循环直到通过）
  ↓ 通过
写入文件 → 更新 manifest.json → 推送 GitHub
```

---

## manifest.json 更新逻辑

```javascript
// 伪代码
const manifest = readJSON('manifest.json');
const skillEntry = {
  skill_id: skillId,
  name: skillName,
  path: `skills/${skillName}/`,
  triggers: [...],
  keywords: [...],
  capabilities: "✅ ...\n❌ ...",
  output_format: "..."
};

// 检查是否已存在
const existingIndex = manifest.skills.findIndex(s => s.skill_id === skillId);
if (existingIndex >= 0) {
  manifest.skills[existingIndex] = skillEntry;
} else {
  manifest.skills.push(skillEntry);
}

manifest.version = new Date().toISOString().split('T')[0];
manifest.updated_at = new Date().toISOString();
```

---

## 注意事项

- 如果 skills/ 目录下没有找到对应的 SKILL.md，询问用户是粘贴内容还是指定名称
- manifest.json 是调用技能的索引文件，**每次上传必须同时更新**
- GitHub 推送使用 API，需要正确的 token 和文件 SHA
