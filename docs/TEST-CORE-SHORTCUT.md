# 快捷键契约与迁移测试记录

日期：2026-09-27。依据 `docs/SHORTCUT-SPEC.md`。实现范围：`core/shortcuts.cjs`、`core/contracts.cjs`、`core/store.cjs`，对应 `tests/core.test.cjs` 和 `tests/shortcuts.test.cjs`。

## 执行结果

命令：`node --test tests/core.test.cjs tests/shortcuts.test.cjs`

- 初次结果：退出码 0，34 项通过，0 失败，0 跳过，1223.4455 ms。
- 增加旧系统保留组合的加载兼容后，最终结果：退出码 0，35 项通过，0 失败，0 跳过，1094.7219 ms。

没有执行全量测试、原生编译或 Electron smoke；这些由主线程统一串行执行。测试目录均在本项目 cache 下，未下载任何模型或依赖。

## 覆盖与行为

- 默认 `RightAlt` 对应原生右 Alt，virtual-key 为 165；普通组合及功能键返回 accelerator 类型和准确按键码。别名与修饰键原顺序保留，避免改变迁移判定。
- 接受规格中列出的组合主键与独立 F1–F24（F12 除外）；拒绝普通单字符、单独 Space、Fn、错误大小写、重复修饰别名、控制字符和超长输入。
- Ctrl+V、F12 和指定 Windows 保留组合在新配置及注册解析中拒绝；别名与修饰键换序不绕过检查。格式化显示中文标签，contracts 将解析错误转为可公开显示的 AppError。
- 新存储包含私有 `migrations.rightAltDefault:1`；缺标记时只有原始字面值 `CommandOrControl+Alt+Space` 改为 `RightAlt`。其他自定义组合、旧默认别名、密文、历史及其他设置保持。
- 迁移后主动选择旧默认组合，再次启动仍保留。快捷键、autoPaste 和 delivery 的缺失迁移在一次原子写入中完成；重复初始化不重复写入。
- 未知、损坏或带未识别字段的迁移标记拒绝加载并保留原文件。写入失败保留文件字节，store 保持未初始化，临时文件清理。
- `migrations` 不出现在 public settings 或历史中，更新设置/历史也不会丢失标记。
- 旧文件中语法有效但现已保留的快捷键可加载和显示，以便用户修正；严格 parser 和 saveSettings 仍拒绝。普通未知/畸形快捷键继续判定 STORE_CORRUPT，原文件保留。加载兼容仅由 store.init 使用 `validateSettings(...,{allowReservedShortcut:true})`，格式化使用 `parseShortcut(...,{allowReserved:true})`；注册及保存默认严格。

## 关联验收边界

本记录验证核心契约及持久化，不宣称物理键盘、右 Alt 钩子、AltGr、重复抑制、全局注册回滚、设置页录入或 Windows 回填已通过。主线程需验证旧保留组合显示“不可用”且仍可打开设置修正；不能因为格式化旧值导致启动失败。原生与 Electron 结果应写入相应测试记录。

所有修改文件使用 UTF-8，并在写入此记录后按显式 UTF-8 重新读取校验。
