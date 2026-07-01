# CC-Tools Desktop

基于 Electron + React 的桌面客户端。

## 开发

```bash
bun install
bun run electron:dev
```

## 构建

```bash
# macOS (Apple Silicon)
./scripts/build-macos-arm64.sh

# Windows (x64, installer)
.\scripts\build-windows-x64.ps1

# Windows (x64, portable)
.\scripts\build-windows-x64-portable.ps1
```

构建产物位于 `build-artifacts/` 目录，文件名会显式包含平台、架构和包类型。

## 常见问题

### macOS 提示"已损坏，无法打开"

```bash
xattr -cr /Applications/CC-Tools.app
```
