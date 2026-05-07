# 蓝禾技能库配置说明

## 仓库信息

- **仓库地址**：https://github.com/Marerlee/lanhe-skills
- **分支**：main
- **Raw 地址前缀**：https://raw.githubusercontent.com/Marerlee/lanhe-skills/main

## 配置文件

`github-config.json` 字段说明：

| 字段 | 说明 |
|------|------|
| `repo` | GitHub 仓库全名（owner/repo） |
| `branch` | 默认分支 |
| `raw_base` | raw 文件下载前缀 |
| `api_base` | GitHub API 前缀 |
| `token` | GitHub Personal Access Token（⚠️ 敏感信息，勿泄露） |
| `fallback_mirror` | Gitee 等备用镜像地址（暂未配置） |

## 切换到 Gitee 镜像

如果 GitHub 不稳定，修改 `github-config.json`：

```json
{
  "raw_base": "https://gitee.com/{owner}/lanhe-skills/raw/main",
  "api_base": "https://gitee.com/api/v5/repos/{owner}/lanhe-skills",
  "token": "gitee 的 access token"
}
```

## Token 安全

- Token 仅存储在本地 `references/github-config.json`
- 不会被推送到任何公开仓库
- 建议定期更换（每 90 天）
