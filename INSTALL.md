# 蓝禾技能库 - 安装指南

## 安装方式

由于技能库托管在 GitHub，需要手动安装到本地。

---

## 步骤

### 1. 克隆仓库到本地

```bash
git clone https://github.com/Marerlee/lanhe-skills.git ~/.openclaw/workspace/lanhe-skills
```

### 2. 确认文件结构

```
~/.openclaw/workspace/lanhe-skills/
├── SKILL.md                    # 主入口技能
├── manifest.json               # 技能索引
├── upload-skill/              # 上传技能
│   └── SKILL.md
├── skills/                    # 子技能目录（空）
└── README.md
```

### 3. 告诉 AI 技能位置

安装完成后，AI 会自动读取 `~/.openclaw/workspace/lanhe-skills/SKILL.md` 和 `~/.openclaw/workspace/lanhe-skills/upload-skill/SKILL.md`

---

## 技能触发方式

### 调用技能

发送：`蓝禾技能 查询 xxx`

示例：
- `蓝禾技能 查询 标题怎么写`
- `蓝禾技能 查询 设备故障`

### 上传新技能

发送：`上传蓝禾技能`

---

## 手动更新技能库

如果技能库有更新，可以拉取最新代码：

```bash
cd ~/.openclaw/workspace/lanhe-skills
git pull origin main
```

---

## 故障排除

### AI 没有识别到技能

确保仓库路径是：
```
~/.openclaw/workspace/lanhe-skills/
```

### GitHub 连接失败

检查网络连接，或使用代理。

---

## 仓库地址

https://github.com/Marerlee/lanhe-skills
