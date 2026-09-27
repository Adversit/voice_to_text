# 右 Alt 与可配置快捷键验收

日期：2026-09-27。Windows 11 x64，Node.js 22.14.0，Electron 40.2.1。规格见 [SHORTCUT-SPEC.md](SHORTCUT-SPEC.md)。

## 已完成验证

- `node --test tests/*.test.cjs`：131 通过，0 失败，0 跳过，3916.8757 ms。完整 TAP 在本地 `artifacts/shortcut-unit.tap`。
- 包含 35 项核心配置/迁移测试、9 项快捷键控制器测试、7 项原生快捷键测试、11 项 UI 测试（1184 个组合与核心语法对照），以及既有音频/推理/监控/回填/路径/打包测试。
- 真实 .NET 编译执行状态机断言与 hook ready/EOF/父进程退出测试。缺失助手、运行目录后置 junction、旧保留组合加载、一次迁移、原子写失败、等价别名、注册冲突、候选启动即退出及保存失败均有对应检查。
- 实际打包 EXE 的 22 项集成检查通过，时间 2026-09-27T11:53:26.879Z；完整结果保存在 [TEST-PACKAGED-SHORTCUT-PASS.md](TEST-PACKAGED-SHORTCUT-PASS.md)。随后仅调整快捷键说明文字对比度与截图等待时间，再打包运行；此轮 14 项通过，但用户按 Esc 停止 Computer Use 后，测试窗未获前台焦点，原生测试未继续。该次复验不算完整通过，保留在 [TEST-PACKAGED.md](TEST-PACKAGED.md)。
- 设置页经真实 preload/IPC 完成监听暂停、拒绝录音、过期 token 不能释放新录入、隐藏后恢复；DOM 合成键事件完成组合录入、草稿与已存配置分离、保存、恢复右 Alt、Esc 和离页取消。
- Windows 测试窗经 Computer Use 激活后，固定标记的合成 Right Alt 输入通过实际低级 hook，开始/结束 Chromium 合成麦克风录音，经 loopback ASR 和真实 Ctrl+V 回填。长按重复只切换一次；测试菜单激活次数为 0，原输入框保持焦点。合成左 Alt、AltGr、和弦与无标记注入没有误触录音。
- 改为 F8 后实际 Electron 全局注册、录音及回填通过，随后恢复原生右 Alt；密码/只读/焦点变化/剪贴板变化保护与 renderer 重载回归仍通过。

## 测试过程与边界

早期开发测试脚本把键事件发送给 window，但产品监听 document，导致超时；修正为 document 事件。下一轮过早点击保存期间禁用的恢复按钮，导致超时；脚本改为等待保存结束。一次测试窗未获前台焦点，产品拒绝回填，保留失败报告在 TEST-DESKTOP-AUTO.md。最终打包验证先通过 Computer Use 定位并激活唯一受控测试窗，再执行合成输入；没有绕过产品的焦点保护。

测试没有人工按物理键盘，也没有验证所有键盘布局或第三方菜单/编辑器。生产监听忽略注入事件；受控输入测试只在 smoke 模式、匹配测试 PID 与特定标记时接受合成事件。状态机和真实 hook/菜单验证不能冒充物理按键验收。真实麦克风语音、模型权重加载、CUDA、云 API 仍待用户后续准备；本轮模型下载为 0。

原始键盘事件、capture token、目标应用信息不写入历史/导出/监控。新增持久字段仅为 private `migrations.rightAltDefault`，历史与导出 schema 不变。

## 最终文件核对

继续收尾时未再操作桌面窗口。确认测试进程均已退出；检查最新设置页截图，文字对比度、按键展示和按钮布局正常。逐字节核对打包目录的 39 个源码/资源/原生助手文件与项目文件一致；`Murmur.exe` 存在，SHA-256 为 `0216bf0cc7500b115df3f1931aa25c3a27b246c91f55297a12ea2a9f83edeacc`。此一致性检查不是新的 OS 行为测试。`models/` 只有 `.gitkeep`。

最后执行 `node scripts/check.cjs`：46 个 JavaScript 文件语法检查、20 份文档 UTF-8 重读通过；`git diff --check` 无空白错误。第二轮独立只读复核未发现新的阻断缺陷。
