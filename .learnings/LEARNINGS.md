# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260418-001] correction

**Logged**: 2026-04-18T12:20:00+08:00
**Priority**: high
**Status**: pending
**Area**: workflow

### Summary
简报生成时未读取 MEMORY.md 历史改善记录，导致遗漏遗留待办

### Details
用户反馈："你selfimproving的技能怎么不用了"、"之前优化的东西你是一点没记住啊"

问题：
1. 生成简报时只读取了 HEARTBEAT.md 获取格式，未读取 MEMORY.md 获取历史改善
2. 导致遗漏了 4月16日会议的遗留待办（3项）
3. 改善措施虽已写入 MEMORY.md，但未被实际使用

### Suggested Action
1. 简报生成前必须读取 MEMORY.md 获取"定时任务改善记录"
2. 简报中"我需要改善什么"板块要包含历史改善状态
3. "遗留待办"要汇总历史待办，不只是昨天

### Metadata
- Source: user_feedback
- Related Files: MEMORY.md, HEARTBEAT.md
- Tags: memory, daily-report, improvement
- Pattern-Key: workflow.read-memory-before-report

---
