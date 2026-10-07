---
name: mj-prompt
description: 把创作者的中文想法翻译成可直接粘贴的 AI 绘画提示词：Midjourney 英文提示词（含 --ar、--stylize、--chaos、--no、--v 等参数）和即梦的中文自然语言提示词，并给出变体与调参建议；风格一律用特征描述，不直接套用在世画家的名字。当创作者说「写提示词」「出图咒语」「Midjourney 怎么写」「即梦提示词」「翻译成英文 prompt」「想要某种风格的图」「出图总是不对味」时使用。English keywords Midjourney prompt, Jimeng prompt, AI art prompt, text to image, aspect ratio.
---

# 出图咒语大全

把一句中文想法拆成要素，写成 Midjourney 英文提示词和即梦中文提示词，再给变体和调参建议。

## 什么时候用
- 有画面想法，但不知道怎么写成 AI 绘画工具能听懂的话。
- 出图总是不对味：风格跑偏、构图乱、多了文字或多余的手脚。
- 想把同一个想法同时用在 Midjourney 和即梦上。
- 不适合：要精确复刻某个真实人物、品牌 Logo 或受版权保护的角色。这类需求有肖像和版权风险，改成原创设定更稳妥。

## 先问清楚
信息够就直接做。只有缺下面两项、又无法推断时才问，最多 2 个问题：
1. 用途和画幅是什么：头像、竖版封面、横版插画还是海报？（决定 --ar 和构图）
2. 用 Midjourney 还是即梦？没说就两个都给。

Midjourney 的版本没说就按 `--v 7` 写，并提醒用户改成自己在用的版本。

## 怎么做
1. 拆 7 个要素：主体、动作与场景、风格与媒介、构图与镜头、光线、色彩与情绪、画质细节。缺的要素按用途补上，并写明补了什么。
2. 写 Midjourney 英文提示词：短语式、逗号分隔，主体放最前面，整体 25–60 个词。具体名词比形容词有效，一条提示词只放一种主风格。
3. 风格用特征描述，不写在世画家或摄影师的名字。想要某位画家的感觉，就拆成笔触、配色、构图、年代感、媒介等特征，对照表见 [references/style-traits.md](references/style-traits.md)。
4. 加参数，放在句末，空格分隔，每个以 `--` 开头：
   - `--ar 3:4`：画幅，宽:高。竖版封面 3:4，头像 1:1，横版插画 16:9。
   - `--stylize 150`：风格化强度。低更贴字面，高更有 Midjourney 自己的审美，常用 50–250。
   - `--chaos 10`：变化程度，0–100。找灵感时 20–50，定稿时 0–10。
   - `--no text, watermark`：排除不想要的元素，多个用逗号隔开。
   - `--v 7`：模型版本，按用户在用的版本写，没说就写 7。报错时可以先删掉这个参数，用默认版本。
5. 写即梦中文提示词：用完整的自然语言，按「主体 + 场景 + 风格 + 光线 + 构图 + 画质」写，不加 `--` 参数，画幅和分辨率在界面里选。想在图里出现文字，就用引号写出具体文字并说明位置。
6. 给 2 个变体（换风格、换构图或光线）和 2–3 条调参提示。

## 输出格式
```text
需求理解：{主体｜场景｜风格｜构图｜光线｜用途与画幅}（补充的要素：{…}）
【Midjourney】
主推：{英文提示词} --ar {w:h} --stylize {n} --chaos {n} --no {…} --v {版本}
变体 A（换风格）：{完整提示词}
变体 B（换构图或光线）：{完整提示词}
【即梦】
主推：{中文自然语言提示词}
变体：{完整提示词}
调参提示：
- {现象 → 怎么改}
风格说明：{把哪些风格词换成了特征描述}
```

## 质量标准 / 避坑
- 每条提示词都要能直接复制使用，变体也写完整，不用省略号。参数拼写正确，并放在句末。
- 不写在世艺术家的名字，也不写「某某风格的米老鼠」这类受版权保护的角色。
- 一次只改一两个变量再看效果，不要同时改风格、构图和光线。
- 手、文字、多人场景是常见弱项，用 `--no`、简化构图或后期修补来应对。
- Midjourney 和即梦会更新版本，参数范围和写法可能变化。出现报错或效果不对时，以官方文档和界面为准，不确定的参数宁可省略。
- 发布到平台时，AI 生成的图片请按平台要求做标注。
- 我看不到出图结果，调参建议基于常见规律，需要你把结果反馈给我再迭代。

## 示例
**你说**：一只在便利店打工的猫（竖版封面，两个工具都要）

**需求理解**：主体是穿围裙的猫；场景是深夜便利店收银台；风格是柔和的动画电影质感；3:4 竖版中景；光线是霓虹加窗外雨夜；情绪温馨安静。（补充的要素：围裙、雨夜、收银台。）

**【Midjourney】**

主推：
```text
a tabby cat in a striped apron working at the cash register of a convenience store at night, warm neon glow, rainy street outside the window, soft anime film look, cinematic lighting, shallow depth of field, cozy and quiet mood --ar 3:4 --stylize 150 --chaos 10 --no text, watermark, humans --v 7
```
变体 A（换风格）：
```text
a tabby cat in a striped apron working at the cash register of a convenience store at night, flat gouache illustration, limited warm palette of orange and teal, bold simple shapes, matte paper texture, cozy and quiet mood --ar 3:4 --stylize 200 --no text, watermark, humans --v 7
```
变体 B（换构图）：
```text
low angle view from the floor, a tabby cat in a striped apron sitting on a stool behind the counter of a convenience store at night, rows of colorful snacks in the foreground, warm neon glow, rainy window, soft anime film look, shallow depth of field --ar 3:4 --stylize 150 --chaos 20 --no text, watermark, humans --v 7
```

**【即梦】**

主推：一只穿条纹围裙的虎斑猫，在深夜的便利店里站在收银台后打工，窗外是下雨的街道，暖色霓虹灯光透进来，柔和的动画电影质感，电影感光影，浅景深，温馨安静的氛围，竖构图，细节丰富。
变体：一只穿条纹围裙的虎斑猫坐在深夜便利店的收银台后，扁平水粉插画风格，橙色和青色的有限配色，造型简洁，带纸张质感，温馨安静，竖构图。

**调参提示**
- 画面太乱：去掉 `--chaos`，把 `--stylize` 降到 100 以内，背景物品减到 2–3 样。
- 太像照片、不像插画：在风格里明确写 illustration、gouache 等媒介词，再把 `--stylize` 提到 200–250。
- 猫变成了人形：写清「一只猫」和它的姿势（坐在凳子上），并在 `--no` 里加 humans。
- 即梦里的文字是乱码：只写 6 个字以内的短文字，或者先出图，再用设计软件加字。

**风格说明**：你没有指定风格，我用特征描述补全了（柔和的动画电影质感、霓虹光晕、浅景深），没有使用在世画家的名字。想要某位画家的感觉，告诉我，我会把它拆成特征词。
