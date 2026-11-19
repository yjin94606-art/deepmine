# 本地图片主题识别

深矿在浏览器的 Worker 里比较图片和一组固定主题。分类用的权重、运行库、标签及向量都随应用提供。作品预览和模型由本机服务读取，识别过程中无需模型账号或外部请求。

## 图片怎样得到名字

浏览器把同一文件版本的预览在白底上居中裁成正方形，缩放至 224 × 224，按 CLIP 的通道均值与标准差归一化。视觉编码器生成 512 维向量，与候选主题的单位向量计算余弦相似度。排第一的具体主题需达到 0.22，且领先第二名至少 0.008。候选过于接近、最高分太低或 `unrelated` 排第一时，界面使用已有标题或通用名称。

本版共 **27 个候选，包含一个兜底项**。中、英、日文的名称及简短介绍和参与匹配的英文短句都以主题清单为准。相似度反映主题匹配程度。画面里人物的身份、创作者、作品故事和生成请求分别需要对应的记录。模型只能查看中央裁切区域，对拼图、复杂画面和类别以外的主题容易漏判。[主题清单](subjects.json) · [浏览器实现](../dist/vision-worker.mjs)

真实项目图片还会按完整画幅抽样颜色。如果一两种颜色覆盖了足够多的可见区域，已识别的主题介绍会附上一句主色说明。颜色取自实际像素，透明区域和局部小色块不会决定整张作品的主色。[颜色取样](../dist/image-palette.mjs)

## 文件来源

| 随附文件 | 来源 |
| --- | --- |
| `clip-vision.onnx` | OpenAI CLIP ViT-B/32 的 Xenova ONNX 转换，取自 `Xenova/clip-vit-base-patch32` 的 `onnx/vision_model_quantized.onnx`，固定版本 `6b7c523703ae26e39be4b03774966f8571c7f523`。权重采用 MIT 许可。[模型卡](https://huggingface.co/Xenova/clip-vit-base-patch32) · [固定版本](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/6b7c523703ae26e39be4b03774966f8571c7f523) · [OpenAI MIT 许可](CLIP-LICENSE.txt) |
| `ort.wasm.min.mjs`、`ort-wasm-simd-threaded.mjs`、`ort-wasm-simd-threaded.wasm` | 取自 Microsoft `onnxruntime-web@1.22.0` 发行包的 `dist/`。应用以单线程 WASM 执行。运行库采用 MIT 许可，并随附第三方声明。[Microsoft v1.22.0](https://github.com/microsoft/onnxruntime/tree/v1.22.0) · [MIT 许可](ORT-LICENSE.txt) · [第三方声明](ORT-ThirdPartyNotices.txt) |
| `subjects.json`、`subjects.f32` | 深矿的主题清单和预计算的文本向量。每个候选对应一行 512 个小端 float32，顺序与 JSON 一致。 |

## 重建主题向量

从上述固定版本下载 `onnx/text_model_quantized.onnx` 和根目录的 `tokenizer.json`。两者只在维护者重建向量时使用。在单独的 Python 环境中，从项目根目录运行以下命令。验证使用 Windows、Python 3.12.14、CPU 执行器。

```sh
python -m pip install numpy==2.5.5 onnxruntime==1.32.0 tokenizers==0.23.3
python scripts/build-visual-labels.py /path/to/text_model_quantized.onnx /path/to/tokenizer.json
```

脚本逐条编码各候选的英文短句，将归一化向量取平均并再次归一化，按照清单顺序写入 `vision/subjects.f32`。本版在独立目录重新生成的 55,296 字节与随附向量逐字节一致。不同运行库或 CPU 实现可能产生细微浮点差别。[生成脚本](../scripts/build-visual-labels.py)

### SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `clip-vision.onnx` | `583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299` |
| `ort.wasm.min.mjs` | `6ef726f355b791129f7ddf3f62e7877a16b9b777abe87004b8ab306e6b9cf265` |
| `ort-wasm-simd-threaded.mjs` | `30dd851d9c00622940500f71ddd2ff8820c5cb65270816080175b958705385a8` |
| `ort-wasm-simd-threaded.wasm` | `71aef04959c5c1b6de461b6538e2058e306610034a85aad2742d0c7fd4533fe4` |
| `subjects.json` | `8807a515af751c68547a7e67ceb649280aaa4640143eff7bab1d9c882f9b3f15` |
| `subjects.f32` | `0885073047478848525c8150160abb5482563d4d03db190f83e577e5ee8c498a` |
| `CLIP-LICENSE.txt` | `987e63b32f6c89ff5160e429458a872ff048e6860b590a3912e938f9da8f14db` |
| `ORT-LICENSE.txt` | `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c` |
| `ORT-ThirdPartyNotices.txt` | `e00f828e0a33de591a355ae6606d2625f5758da7d2c844db7821c9dd3e3647b6` |
| `text_model_quantized.onnx`（构建输入） | `73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a` |
| `tokenizer.json`（构建输入） | `f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd` |
