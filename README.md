# Plady LUT 批量套色与水印

这个仓库包含一个可直接发布到 GitHub Pages 的网页版，以及原生端实现。

## 网页版

入口文件：

```text
web/index.html
```

功能：

- 批量导入 JPG / PNG / WebP 图片
- 导入 `.cube` LUT 并在浏览器本地套色
- 调整 LUT 强度、曝光、对比、饱和
- 添加信息水印或画框水印
- 批量导出 JPEG ZIP

所有图片处理都在浏览器本地完成，不需要后端服务。

本地预览：

```bash
python3 -m http.server 8000 --directory web
```

然后打开：

```text
http://localhost:8000
```

## 原生端

- `native-macos/`：macOS 版本
- `native-android/`：Android 版本

### macOS

```bash
cd native-macos
xcodebuild -project LUTBatchMac.xcodeproj -scheme LUTBatchMac -configuration Debug -derivedDataPath build-xcode build
```

构建产物：

```text
native-macos/build-xcode/Build/Products/Debug/Plady.app
```

### Android

Android 项目位于：

```text
native-android/
```
