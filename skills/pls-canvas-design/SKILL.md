---
name: canvas-design
description: 通过表达设计哲学来生成视觉海报和设计资产（PNG/PDF）。先有主张，再有视觉。支持通用设计风格，并内置 TORRAS图拉斯品牌VIS规范。使用场景：(1) 创作有态度的设计海报，(2) 制作品牌物料，(3) 输出设计概念图，(4) 生成 TORRAS 品牌相关设计。
---

# Canvas Design — 中文视觉设计技能

默认输出中文内容。生成图片后通过飞书 API 发送给用户。

---

## 一、设计风格体系

### 1. 极简主义 Minimalism
- **理念**：删繁就简，留白即力量
- **表达**：克制的配色、充足负空间、细线装饰

### 2. 撞色构成 Brutalism
- **理念**：原始、直接、强对比
- **表达**：大面积色块、粗体字、高饱和碰撞色

### 3. 玻璃拟态 Glassmorphism
- **理念**：磨砂玻璃的通透感
- **表达**：半透明图层、模糊背景、细白描边

### 4. 新拟物 Neumorphism
- **理念**：柔软挤压的塑料质感
- **表达**：内外阴影叠加、低对比度

### 5. 国际排版 Swiss/International
- **理念**：网格对齐、逻辑清晰
- **表达**：严格网格系统、无衬线字体、黑白红配色

---

## 二、TORRAS图拉斯 品牌VIS规范

> 当设计内容涉及 TORRAS / 图拉斯品牌时，严格遵守以下规范。

### 品牌字体（已安装，直接可用）
字体目录：`C:/Users/doris/.openclaw/workspace/torras_fonts/`

| 用途       | 字体文件              | 变量名建议  |
|------------|-----------------------|-------------|
| 中文 Heavy | FZYJHK_H.TTF          | CN_H        |
| 中文 Bold  | FZYJHK_B.TTF          | CN_B        |
| 中文 DB    | FZYJHK_DB.TTF         | CN_DB       |
| 中文 Medium| FZYJHK_M.TTF          | CN_M        |
| 中文 Light | FZYJHK_L.TTF          | CN_L        |
| 英文 EB    | FTTerra-ExtraBold.ttf | EN_EB       |
| 英文 Bold  | FTTerra-Bold.ttf      | EN_BD       |
| 英文 Medium| FTTerra-Medium.ttf    | EN_MD       |
| 英文 Regular| FTTerra-Regular.ttf  | EN_REG      |
| 英文 Light | FTTerra-Light.ttf     | EN_L        |

> ✅ 官方授权字体，已从飞书文档下载。

### 品牌字重规则
- **标题**：FZYJHK_B.TTF（Bold）及以上（可用 B / DB / EB / H）
- **副标题**：FZYJHK_DB.TTF（DemiBold）
- **正文**：FZYJHK_M.TTF / FZYJHK_L.TTF（Medium / Light）
- **严禁使用**：未购买字重

### 品牌色彩（来源：TORRAS_品牌VIS视觉指导手册2.0.pdf）
```python
# TORRAS 官方品牌色
TORRAS_ORANGE  = '#FF5B00'   # 品牌橙 Pantone 1655C | RGB 255,91,0 | CMYK 0,78,93,0
TORRAS_WHITE   = '#FFFFFF'   # 中性白
TORRAS_BLACK   = '#000004'   # 品牌黑（近纯黑）
TORRAS_GREEN   = '#E6FA6E'   # 跃动绿 Pantone 2296C
TORRAS_BLUE    = '#41A0FF'   # 极光蓝 Pantone 2382C
TORRAS_GRAY    = '#888888'   # 辅助灰

# 色彩使用场景（VIS p.51）
# 广告/营销：       橙 + 白 + 灰黑
# 品牌KV/数字媒体：  橙 + 灰 + 黑 + 辅助色
# 官网/社交媒体：    橙 + 黑白 + 辅助色
# 小红书/包装：      大面积橙 + 灰 + 黑
# 品牌橙适用比例：   10%～80%

# 标识色彩规则（VIS p.16-17）
# 浅色背景：        用橙色或黑色标识（禁止白色）
# 深色背景：        用橙色或白色标识（禁止黑色）
# 只允许橙色或白色标识，禁止其他颜色
```

### 品牌标识安全距离规范（VIS p.15/20/22）
```python
# T形图形标识
# 安全距离：1x（x = 标识高度）
# 最小印刷尺寸：高度 3mm
# 最小屏幕尺寸：高度 7.5px

# 字体标识（TORRAS）
# 安全距离：1个"O"高度
# 最小印刷尺寸：高度 2mm
# 最小屏幕尺寸：高度 5px

# 中英字标组合（简体）
# 最小印刷：高度 2.6mm / 最大：6mm
# 最小屏幕：8px / 最大：18px

# 中英字标组合（繁体）
# 最小印刷：高度 4mm / 最大：9mm
# 最小屏幕：12px / 最大：44px
```

### 标识使用禁区（VIS p.19）
- ❌ 禁止扭曲、倾斜、镜像、拉伸标识
- ❌ 禁止调整字距
- ❌ 禁止在浅色背景使用白色标识
- ❌ 禁止将品牌标识与产品图案混合使用
- ❌ 禁止在深色背景使用黑色标识
- ❌ 严禁使用非购买字重

### 标语组合规范（VIS p.37-43）
```python
# 竖向组合：标识在上，标语在下
# 最小垂直间距：≥ ½ 个"O"高度
# 推荐以标识中心线对齐标语文字

# 横向组合：标识在左，标语在右
# 最小水平间距：≥ 3个"O"宽度
# 适用：网站页头、产品包装、视频画面

# 中英文标语横向组合
# 最小水平间距：≥ 1个"O"宽度
```

### 字体排版规范（VIS p.55-63）

**字号层级系统（英文）**
```python
# 标题   100% → 84pt  FTTerra ExtraBold
# 副标题  50% → 42pt  FTTerra ExtraBold
# 正文    25% → 20pt  FTTerra Regular
```

**字号层级系统（中文简体）**
```python
# 标题   100% → FZYJHK_EB.TTF   84pt
# 副标题  50% → FZYJHK_EB.TTF   42pt
# 正文    25% → FZYJHK_M.TTF     20pt
```

> ⚠️ VIS 手册中"方正悦驾黑 EB"即 FZYJHK_EB.TTF（ExtraBold，非"Bold"文件名），名称对应关系以字体文件名为准。

**混排规则（中英混排）**
```python
# 行高 = 当前字号 × 1.2
# 字间距 = 20pt（固定）
# 英文字号 = 中文字号 × 1.1
# 示例：中文80pt → 英文 80×1.1 = 88pt（等宽混排）
```

**排版层级三档（所有语言通用）**
| 层级   | 比例 | 用途              |
|--------|------|-------------------|
| 标题   | 100% | 主标题、大字主视觉 |
| 副标题 |  50% | 副标题、分节标题   |
| 正文   |  25% | 正文、说明文字     |


### 设计原则
1. **科技感优先**：线条精准，避免随意装饰
2. **留白充足**：高端感来自克制
3. **层级清晰**：标题 > 副标题 > 正文，对比度明确
4. **中英双语**：品牌传播物料需中英兼顾

---

## 三、代码模板（Windows 环境）

### 字体路径（TORRAS 官方字体）
```python
FONT_DIR = "C:/Users/doris/.openclaw/workspace/torras_fonts/"

CN_H   = FONT_DIR + "FZYJHK_H.TTF"            # 方正悦驾黑 Heavy — 大标题
CN_B   = FONT_DIR + "FZYJHK_B.TTF"            # 方正悦驾黑 Bold  — 副标题
CN_M   = FONT_DIR + "FZYJHK_M.TTF"            # 方正悦驾黑 Medium — 正文
EN_EB  = FONT_DIR + "FTTerra-ExtraBold.ttf"   # FTTerra ExtraBold — 英文大字
EN_BD  = FONT_DIR + "FTTerra-Bold.ttf"        # FTTerra Bold — 英文标题
EN_REG = FONT_DIR + "FTTerra-Regular.ttf"     # FTTerra Regular — 英文正文
```

### 生成 PNG（标准模板）
```python
from PIL import Image, ImageDraw, ImageFont

# 尺寸：竖版 800×1100，横版 1920×1080
W, H = 800, 1100
FONT_DIR = "C:/Users/doris/.openclaw/workspace/torras_fonts/"

CN_EB  = FONT_DIR + "FZYJHK_EB.TTF"   # 中文字体
CN_B   = FONT_DIR + "FZYJHK_B.TTF"
CN_M   = FONT_DIR + "FZYJHK_M.TTF"
EN_EB  = FONT_DIR + "FTTerra-ExtraBold.ttf"  # 英文字体
EN_BD  = FONT_DIR + "FTTerra-Bold.ttf"
EN_REG = FONT_DIR + "FTTerra-Regular.ttf"
EN_LT  = FONT_DIR + "FTTerra-Light.ttf"

ORANGE = '#FF5B00'; WHITE = '#FFFFFF'; BLACK = '#000004'; GRAY = '#888888'; BG = '#FAFAFA'

img = Image.new('RGB', (W, H), color=BG)
d = ImageDraw.Draw(img)

def txt(x, y, s, fill, font, size):
    ImageDraw.Draw(img).text((x, y), s, fill=fill, font=ImageFont.truetype(font, size))

# 示例：极简主义海报布局
d.rectangle([(0, 0), (W, 60)], fill=ORANGE)
txt(40, 20, "TORRAS", WHITE, EN_BD, 14)

txt(40, 100, "设计主张", BLACK, CN_EB, 80)
txt(40, 200, "副标题说明", GRAY, CN_M, 22)   # 中文用 CN_M，不要用 EN_REG

img.save("C:/Users/doris/.openclaw/workspace/output.png")
print("Done!")
```

> ⚠️ **字体混用规则：**
> - **中文文本**（ TORRAS / 图拉斯 / 任何汉字）→ 必须使用 CN_* 字体
> - **纯英文/数字文本** → 使用 EN_* 字体
> - `EN_REG`（FTTerra-Regular）是**纯拉丁字体**，不支持中日韩字符（CJK），用错会显示空白方块
> - 怀疑文字显示为空白方块/乱码时，优先检查该行字体是否用错

### 生成 PDF
```python
from fpdf import FPDF

FONT_DIR = "C:/Users/doris/.openclaw/workspace/torras_fonts/"

pdf = FPDF()
pdf.add_page()
pdf.add_font("CN_B", "", FONT_DIR + "FZYJHK_B.TTF", uni=True)
pdf.add_font("CN_M", "", FONT_DIR + "FZYJHK_M.TTF", uni=True)
pdf.set_font("CN_B", size=24)
pdf.cell(0, 20, txt="TORRAS DESIGN", ln=True, align="C")
pdf.set_font("CN_M", size=12)
pdf.cell(0, 10, txt="品牌视觉设计文档", ln=True, align="C")
pdf.output("C:/Users/doris/.openclaw/workspace/output.pdf")
```

> ⚠️ fpdf2 生成中文 PDF 必须加载中文字体（`uni=True`），否则中文显示为空。

### 发送图片到飞书（标准函数）
```javascript
// send_to_feishu.js
const fs = require('fs');
const https = require('https');
const path = require('path');

const APP_ID     = 'cli_a93d6c8cd5badcc9';
const APP_SECRET = 'VDF08JjttozxVcwxLIuSUfiNsaeAgmyK';
const USER_ID    = 'ou_63fc512ada9e80c2f375210214794ec3';

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function postMultipart(url, token, filePath) {
  return new Promise((resolve, reject) => {
    const fileData = fs.readFileSync(filePath);
    const boundary = '----FormBoundary' + Date.now();
    const header = Buffer.from([
      `--${boundary}`, `Content-Disposition: form-data; name="image_type"`, '', 'message',
      `--${boundary}`, `Content-Disposition: form-data; name="image"; filename="${path.basename(filePath)}"`,
      'Content-Type: image/png', '', ''
    ].join('\r\n'));
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileData, footer]);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendImage(imagePath) {
  const tokenRes = await post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { 'Content-Type': 'application/json' }, JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }));
  const token = tokenRes.tenant_access_token;
  const imgRes = await postMultipart('https://open.feishu.cn/open-apis/im/v1/images', token, imagePath);
  if (imgRes.code !== 0) throw new Error('Upload failed: ' + JSON.stringify(imgRes));
  const msgRes = await post('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
    { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    JSON.stringify({ receive_id: USER_ID, msg_type: 'image', content: JSON.stringify({ image_key: imgRes.data.image_key }) }));
  if (msgRes.code !== 0) throw new Error('Send failed: ' + JSON.stringify(msgRes));
  console.log('✓ 图片已发送到飞书，message_id:', msgRes.data.message_id);
}

sendImage(process.argv[2]).catch(err => { console.error(err.message); process.exit(1); });
```

用法：`node send_to_feishu.js /path/to/image.png`

---

## 四、常见问题与排查

| 问题 | 根因 | 解决方案 |
|------|------|---------|
| 文字显示为空心方块 | 该字体不支持 CJK 字符 | 中文文本必须用 `CN_*` 字体 |
| 长句被截断/消失 | 文本超出画布宽度 | 长句拆成多行，控制 x 坐标 |
| 颜色和品牌规范不符 | 用猜测的颜色值 | 查 VIS 手册，官方色 `#FF5B00` |
| 字体视觉感不对 | 用了 Windows 替代字体 | 用 `torras_fonts/` 下的官方字体 |
| 整体失去设计感 | 堆砌产品功能清单 | 回归"先有主张再有视觉"原则 |
| 分辨率不适合场景 | 竖版做了横版尺寸 | 竖版 800×1100，横版 1920×1080 |

> ⚠️ **发出前必查：**
> 图片生成后、发送前，必须打开检查是否有以下问题：
> - 文字是否为方块/乱码（优先检查是否字体用错）
> - 是否有文字被截断（长行是否超出画布）
> - 整体文字内容是否完整
> 发现问题立即修复，再发送。

## 六、标准工作流

> ⚠️ **核心原则：先有主张，再有视觉。**
> 设计不是堆信息，是用视觉语言表达一个态度或哲学。
> 产品信息（功能点、价格等）是内容素材之一，不是主角。

1. **明确主张**：这张海报想表达什么**态度/哲学**？（例："好的设计不需要解释"、"简约是最大的勇气"）
2. **选择风格**：结合主张选择设计风格（极简 / 撞色 / 参数化等）
3. **视觉演绎**：围绕主张构建画面，不要堆砌产品卖点清单
4. **编写 Python 脚本**：基于上方代码模板修改
5. **保存至 workspace**：输出路径 `C:/Users/doris/.openclaw/workspace/`
6. **自检**：打开图片检查文字是否完整、有无乱码/截断
7. **发送飞书**：用 `send_to_feishu.js` 发送给用户
8. **清理临时文件**：删除 `.py` 和 `.js` 临时脚本

---

## 七、注意事项

- 所有面向豪（用户）的设计内容默认使用**中文**
- 字体使用 TORRAS 官方字体（路径 `workspace/torras_fonts/`），严禁使用非购买字重
- TORRAS 品牌物料严格遵守 VIS 规范，避免随意改动字体/色彩
- 输出分辨率建议 800×1100px（竖版）或 1920×1080px（横版 16:9）
