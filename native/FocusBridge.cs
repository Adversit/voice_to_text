using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

// No window activation, target text reads, logging, clipboard writes or Enter.
// A fresh process handles exactly one bounded stdin/stdout JSON request.
internal static class FocusBridge
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int tokenClass, out int value, int length, out int returned);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION
    {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
        [FieldOffset(0)] public HARDWAREINPUT hardware;
    }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort key; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct HARDWAREINPUT { public uint message; public ushort low; public ushort high; }

    public sealed class Target
    {
        public string hwnd { get; set; }
        public int pid { get; set; }
        public string processStartTicks { get; set; }
        public int[] runtimeId { get; set; }
    }
    public sealed class Request
    {
        public int ownerPid { get; set; }
        public Target target { get; set; }
        public string clipboardHash { get; set; }
        public int keyCode { get; set; }
    }
    private sealed class Stop : Exception
    {
        public string Reason;
        public Stop(string reason) { Reason = reason; }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false);
        var serializer = new JavaScriptSerializer { MaxJsonLength = 8192, RecursionLimit = 12 };
        object response;
        try
        {
            if (args.Length != 1 || (args[0] != "capture" && args[0] != "paste" && args[0] != "key-release")) throw new ArgumentException();
            var buffer = new char[8193];
            int count = 0, read;
            while (count < buffer.Length && (read = Console.In.Read(buffer, count, buffer.Length - count)) > 0) count += read;
            if (count == 0 || count > 8192) throw new ArgumentException();
            Request request = serializer.Deserialize<Request>(new string(buffer, 0, count));
            if (request == null || request.ownerPid <= 0) throw new ArgumentException();
            object data = args[0] == "capture" ? Capture(request.ownerPid) : args[0] == "paste" ? Paste(request) : KeyRelease(request.keyCode);
            response = new { ok = true, data = data };
        }
        catch (Exception)
        {
            // Never expose window titles, entered text, handles, process data or stack traces.
            response = new { ok = false, error = new { code = "INPUT_UNAVAILABLE", message = "无法安全操作目标输入框，文字保留在剪贴板。" } };
        }
        Console.Write(serializer.Serialize(response));
        return 0;
    }

    private static object Capture(int ownerPid)
    {
        try { return new { target = Inspect(ownerPid), reason = "" }; }
        catch (Stop stop) { return new { target = (Target)null, reason = stop.Reason }; }
        catch { return new { target = (Target)null, reason = "无法验证当前输入框，完成后请手动粘贴。" }; }
    }

    private static Target Inspect(int ownerPid)
    {
        IntPtr window = GetForegroundWindow();
        if (window == IntPtr.Zero || !IsWindow(window)) throw new Stop("没有可用的目标窗口。 ");
        uint rawPid;
        GetWindowThreadProcessId(window, out rawPid);
        if (rawPid == 0 || rawPid > Int32.MaxValue) throw new Stop("无法识别目标窗口进程。 ");
        int pid = (int)rawPid;
        if (pid == ownerPid || pid == Process.GetCurrentProcess().Id) throw new Stop("当前焦点位于轻声，请在其他应用的输入框中使用快捷键。 ");
        string start;
        using (Process process = Process.GetProcessById(pid))
        {
            if (process.HasExited) throw new Stop("目标应用已经关闭。 ");
            if (IsElevated(process)) throw new Stop("目标应用以管理员权限运行，请手动粘贴。 ");
            start = process.StartTime.ToUniversalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        AutomationElement focus = AutomationElement.FocusedElement;
        if (focus == null) throw new Stop("未找到当前输入框。 ");
        AutomationElement.AutomationElementInformation info = focus.Current;
        if (info.ProcessId != pid || !info.HasKeyboardFocus || !info.IsEnabled || !info.IsKeyboardFocusable)
            throw new Stop("当前焦点不是可用的目标输入框。 ");
        if (info.IsPassword) throw new Stop("密码输入框不支持自动粘贴。 ");
        if (!Editable(focus, info.ControlType)) throw new Stop("当前控件无法确认可编辑，请手动粘贴。 ");
        int[] runtimeId = focus.GetRuntimeId();
        if (runtimeId == null || runtimeId.Length == 0 || runtimeId.Length > 64)
            throw new Stop("无法确认输入框身份，请手动粘贴。 ");
        // Foreground may have changed while accessibility was queried.
        if (GetForegroundWindow() != window) throw new Stop("目标窗口焦点已改变。 ");
        return new Target { hwnd = window.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture), pid = pid, processStartTicks = start, runtimeId = runtimeId };
    }

    private static bool IsElevated(Process process)
    {
        IntPtr token;
        if (!OpenProcessToken(process.Handle, 0x0008, out token)) throw new Stop("无法验证目标应用权限，请手动粘贴。 ");
        try
        {
            int elevated, returned;
            if (!GetTokenInformation(token, 20, out elevated, sizeof(int), out returned)) throw new Stop("无法验证目标应用权限，请手动粘贴。 ");
            return elevated != 0;
        }
        finally { CloseHandle(token); }
    }

    private static bool Editable(AutomationElement element, ControlType controlType)
    {
        if (controlType != ControlType.Edit && controlType != ControlType.Document && controlType != ControlType.ComboBox) return false;
        object pattern;
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
            return !((ValuePattern)pattern).Current.IsReadOnly;
        // TextPattern exposes a read-only attribute for rich edit/contenteditable.
        // Inspect only metadata; never call GetText or Value on the target.
        if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern))
        {
            object readOnly = ((TextPattern)pattern).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
            return readOnly is bool && !(bool)readOnly;
        }
        return false;
    }

    private static bool Same(Target left, Target right)
    {
        if (left == null || right == null || left.hwnd != right.hwnd || left.pid != right.pid || left.processStartTicks != right.processStartTicks)
            return false;
        if (left.runtimeId == null || right.runtimeId == null || left.runtimeId.Length != right.runtimeId.Length) return false;
        for (int i = 0; i < left.runtimeId.Length; i++) if (left.runtimeId[i] != right.runtimeId[i]) return false;
        return true;
    }

    private static bool Valid(Target target)
    {
        long handle, start;
        return target != null && target.pid > 0 && Int64.TryParse(target.hwnd, out handle) && handle > 0 &&
            Int64.TryParse(target.processStartTicks, out start) && start > 0 && target.runtimeId != null && target.runtimeId.Length > 0 && target.runtimeId.Length <= 64;
    }

    private static bool ModifiersDown()
    {
        foreach (int key in new int[] { 0x10, 0x11, 0x12, 0x5b, 0x5c })
            if ((GetAsyncKeyState(key) & 0x8000) != 0) return true;
        return false;
    }

    private static object KeyRelease(int keyCode)
    {
        if (keyCode < 1 || keyCode > 255) throw new ArgumentException();
        Stopwatch wait = Stopwatch.StartNew();
        while ((GetAsyncKeyState(keyCode) & 0x8000) != 0 && wait.ElapsedMilliseconds < 3000) Thread.Sleep(15);
        return new { released = (GetAsyncKeyState(keyCode) & 0x8000) == 0 };
    }

    private static string ClipboardDigest()
    {
        if (!Clipboard.ContainsText(TextDataFormat.UnicodeText)) throw new Stop("剪贴板中没有可粘贴的文字。 ");
        string text = Clipboard.GetText(TextDataFormat.UnicodeText);
        if (text.Length == 0 || text.Length > 20000) throw new Stop("剪贴板文字长度异常，已取消自动粘贴。 ");
        using (SHA256 hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "").ToLowerInvariant();
    }

    private static object Paste(Request request)
    {
        try
        {
            if (!Valid(request.target) || request.clipboardHash == null || !System.Text.RegularExpressions.Regex.IsMatch(request.clipboardHash, "^[a-f0-9]{64}$"))
                return new { status = "skipped", reason = "录音目标信息无效，已保留剪贴板文字。" };
            if (request.target.pid == request.ownerPid) throw new Stop("不能向轻声自身自动粘贴。 ");
            IntPtr window = new IntPtr(Int64.Parse(request.target.hwnd, System.Globalization.CultureInfo.InvariantCulture));
            if (!IsWindow(window)) throw new Stop("原来的目标窗口已经关闭。 ");
            if (GetForegroundWindow() != window) throw new Stop("您已切换窗口，文字已复制，请在需要的位置手动粘贴。 ");
            if (!Same(request.target, Inspect(request.ownerPid))) throw new Stop("原来的输入框已改变，文字已复制，请手动粘贴。 ");
            Stopwatch wait = Stopwatch.StartNew();
            while (ModifiersDown() && wait.ElapsedMilliseconds < 900) Thread.Sleep(15);
            if (ModifiersDown()) throw new Stop("快捷键仍被按住，已保留剪贴板文字，请松开后手动粘贴。 ");
            uint sequence = GetClipboardSequenceNumber();
            if (ClipboardDigest() != request.clipboardHash || GetClipboardSequenceNumber() != sequence)
                throw new Stop("剪贴板内容已改变，已取消自动粘贴。 ");
            if (!Same(request.target, Inspect(request.ownerPid))) throw new Stop("原来的输入框焦点已改变，已取消自动粘贴。 ");
            // Final checks are adjacent to one atomic SendInput batch. No focus restoration.
            if (GetForegroundWindow() != window || ModifiersDown() || GetClipboardSequenceNumber() != sequence)
                throw new Stop("窗口、快捷键或剪贴板状态发生变化，已取消自动粘贴。 ");
            INPUT[] keys = { Key(0x11, false), Key(0x56, false), Key(0x56, true), Key(0x11, true) };
            uint sent = SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(INPUT)));
            if (sent != keys.Length)
            {
                // Release only our two synthetic keys if a partial batch was inserted.
                if (sent > 0) SendInput(2, new INPUT[] { Key(0x56, true), Key(0x11, true) }, Marshal.SizeOf(typeof(INPUT)));
                return new { status = "failed", reason = "Windows 未接受完整的粘贴操作，文字仍在剪贴板；请检查目标应用权限。" };
            }
            return new { status = "pasted", reason = "已向录音开始时的输入框发送粘贴操作。" };
        }
        catch (Stop stop) { return new { status = "skipped", reason = stop.Reason.Trim() }; }
        catch { return new { status = "skipped", reason = "无法安全验证输入框或剪贴板，文字已保留，请手动粘贴。" }; }
    }

    private static INPUT Key(ushort key, bool up)
    {
        return new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { key = key, flags = up ? 2u : 0u, extra = UIntPtr.Zero } } };
    }
}
