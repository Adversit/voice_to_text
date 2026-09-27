using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Only clean physical Right Alt taps are published. Keys and target identities
// never leave this process. Ordinary keyboard/mouse events always pass through.
internal static class ShortcutBridge
{
    internal const ulong TestTag = 0x4D555254;
    private const ulong MaskTag = 0x4D55524D;
    private const uint WM_QUIT = 0x12;
    private static readonly TapState State = new TapState();
    private static readonly BlockingCollection<string> Output = new BlockingCollection<string>(32);
    private static readonly HookProc KeyboardCallback = Keyboard;
    private static readonly HookProc MouseCallback = Mouse;
    private static IntPtr keyboardHook, mouseHook;
    private static uint threadId;
    private static volatile bool stopping;
    private static bool testMode;
    private static int testTargetPid;

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int hook, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] private static extern int GetMessage(out MSG message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out MSG message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint id, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);

    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int x, y; }
    [StructLayout(LayoutKind.Sequential)] private struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT point; public uint extra; }
    [StructLayout(LayoutKind.Sequential)] private struct KEY { public uint key, scan, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] private struct INPUTUNION
    {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
        [FieldOffset(0)] public HARDWAREINPUT hardware;
    }
    [StructLayout(LayoutKind.Sequential)] private struct KEYBDINPUT { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct MOUSEINPUT { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] private struct HARDWAREINPUT { public uint message; public ushort low, high; }

    // One bit per held key is volatile input state, never a keyboard history.
    internal sealed class TapState
    {
        private readonly bool[] held = new bool[256];
        private bool armed;
        internal void Seed(int key, bool down) { if (key >= 8 && key < 256 && key != 0x10 && key != 0x11 && key != 0x12) held[key] = down; }
        internal void Cancel() { armed = false; }
        internal bool Step(int key, bool up, bool trusted, bool mouseHeld = false)
        {
            if (key < 8 || key >= 256) { armed = false; return false; }
            bool wasDown = held[key];
            if (!trusted) armed = false;
            if (up)
            {
                held[key] = false;
                bool activate = key == 0xA5 && wasDown && armed && trusted;
                armed = false;
                return activate;
            }
            if (key != 0xA5) armed = false;
            else if (!wasDown)
            {
                armed = trusted && !mouseHeld;
                for (int i = 8; i < held.Length; i++) if (held[i]) { armed = false; break; }
            }
            held[key] = true;
            return false;
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length == 1 && args[0] == "self-test") return SelfTest();
        int ownerPid;
        if ((args.Length != 2 && args.Length != 3) || args[0] != "listen" || !Int32.TryParse(args[1], out ownerPid) || ownerPid <= 0 || (args.Length == 3 && args[2] != "--test-mode")) return 2;
        testMode = args.Length == 3;
        threadId = GetCurrentThreadId();
        MSG message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, 0); // Establish the thread queue before EOF/parent watcher can stop us.
        Thread writer = new Thread(WriteOutput) { IsBackground = true };
        writer.Start();
        try
        {
            using (Process owner = Process.GetProcessById(ownerPid))
            {
                owner.EnableRaisingEvents = true;
                owner.Exited += delegate { Stop(); };
                if (owner.HasExited) return 2;
                keyboardHook = SetWindowsHookEx(13, KeyboardCallback, GetModuleHandle(null), 0);
                mouseHook = SetWindowsHookEx(14, MouseCallback, GetModuleHandle(null), 0);
                if (keyboardHook == IntPtr.Zero || mouseHook == IntPtr.Zero) throw new InvalidOperationException();
                for (int key = 8; key < 256; key++) State.Seed(key, (GetAsyncKeyState(key) & 0x8000) != 0);
                var input = new Thread(ReadInput) { IsBackground = true };
                input.Start();
                Publish("{\"type\":\"ready\"}");
                while (!stopping && GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
            }
        }
        catch { Publish("{\"type\":\"error\",\"code\":\"SHORTCUT_UNAVAILABLE\"}"); }
        finally
        {
            stopping = true;
            if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
            if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
            Output.CompleteAdding();
            writer.Join(500);
        }
        return 0;
    }

    private static void Publish(string message)
    {
        try { if (!Output.TryAdd(message)) Stop(); } catch { Stop(); }
    }
    private static void Stop() { stopping = true; PostThreadMessage(threadId, WM_QUIT, UIntPtr.Zero, IntPtr.Zero); }
    private static void WriteOutput()
    {
        try { foreach (string message in Output.GetConsumingEnumerable()) { Console.WriteLine(message); Console.Out.Flush(); } }
        catch { Stop(); }
    }
    private static void ReadInput()
    {
        try
        {
            var line = new StringBuilder();
            int value;
            while ((value = Console.Read()) >= 0)
            {
                if (value == 10)
                {
                    if (!testMode) { Stop(); return; }
                    var command = new JavaScriptSerializer { MaxJsonLength = 256, RecursionLimit = 4 }.Deserialize<TestTarget>(line.ToString());
                    if (command == null || command.type != "testTarget" || command.pid < 0) { Stop(); return; }
                    Interlocked.Exchange(ref testTargetPid, command.pid);
                    line.Length = 0;
                }
                else if (value != 13) { if (line.Length >= 256) { Stop(); return; } line.Append((char)value); }
            }
        }
        catch { }
        Stop();
    }
    public sealed class TestTarget { public string type { get; set; } public int pid { get; set; } }
    private static bool TrustedTest(KEY input)
    {
        int expected = Volatile.Read(ref testTargetPid);
        if (!testMode || expected <= 0 || input.extra.ToUInt64() != TestTag) return false;
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        return pid == (uint)expected;
    }
    private static IntPtr Keyboard(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && !stopping)
        {
            try
            {
                KEY input = (KEY)Marshal.PtrToStructure(data, typeof(KEY));
                if (input.extra.ToUInt64() != MaskTag)
                {
                    int key = (int)input.key;
                    if (key == 0x12) key = (input.flags & 1) != 0 ? 0xA5 : 0xA4;
                    if (key == 0x11) key = (input.flags & 1) != 0 ? 0xA3 : 0xA2;
                    if (key == 0x10) key = input.scan == 0x36 ? 0xA1 : 0xA0;
                    bool trusted = (input.flags & 0x12) == 0 || TrustedTest(input);
                    bool up = (input.flags & 0x80) != 0;
                    // GetAsyncKeyState is used only for prior mouse-button
                    // state, never for the keyboard event currently in flight.
                    bool mouseHeld = key == 0xA5 && !up && MouseButtonsDown();
                    if (State.Step(key, up, trusted, mouseHeld))
                    {
                        // Standard Alt-menu mask: no character or Enter, and no
                        // suppression/replay of the user's modifier/chord events.
                        INPUT[] mask = { Mask(false), Mask(true) };
                        if (SendInput(2, mask, Marshal.SizeOf(typeof(INPUT))) == 2) Publish("{\"type\":\"activate\"}");
                        else { SendInput(1, new INPUT[] { Mask(true) }, Marshal.SizeOf(typeof(INPUT))); Publish("{\"type\":\"error\",\"code\":\"SHORTCUT_MASK_FAILED\"}"); Stop(); }
                    }
                }
            }
            catch { State.Cancel(); Publish("{\"type\":\"error\",\"code\":\"SHORTCUT_UNAVAILABLE\"}"); Stop(); }
        }
        return CallNextHookEx(keyboardHook, code, message, data);
    }
    private static INPUT Mask(bool up)
    {
        return new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { key = 0xE8, flags = up ? 2u : 0u, extra = new UIntPtr(MaskTag) } } };
    }
    private static bool MouseButtonsDown()
    {
        foreach (int button in new int[] { 1, 2, 4, 5, 6 }) if ((GetAsyncKeyState(button) & 0x8000) != 0) return true;
        return false;
    }
    private static IntPtr Mouse(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && message.ToInt64() != 0x200) State.Cancel(); // Buttons/wheel cancel; no coordinate access.
        return CallNextHookEx(mouseHook, code, message, data);
    }
    private static int SelfTest()
    {
        int passed = 0;
        try
        {
            var s = new TapState(); s.Step(0xA5, false, true); Check(s.Step(0xA5, true, true), ref passed);
            s = new TapState(); s.Step(0xA5, false, true); for (int i = 0; i < 20; i++) Check(!s.Step(0xA5, false, true), ref passed); Check(s.Step(0xA5, true, true) && !s.Step(0xA5, true, true), ref passed);
            s = new TapState(); s.Step(0xA4, false, true); Check(!s.Step(0xA4, true, true), ref passed);
            s = new TapState(); s.Step(0xA5, false, true); s.Step(0x41, false, true); s.Step(0x41, true, true); Check(!s.Step(0xA5, true, true), ref passed);
            s = new TapState(); s.Step(0xA2, false, false); s.Step(0xA5, false, true); Check(!s.Step(0xA5, true, true), ref passed); s.Step(0xA2, true, false); s.Step(0xA5, false, true); Check(s.Step(0xA5, true, true), ref passed);
            s = new TapState(); s.Step(0xA5, false, false); Check(!s.Step(0xA5, true, false), ref passed);
            s = new TapState(); s.Step(0xA5, false, true); s.Step(0xA2, false, false); s.Step(0x56, false, false); s.Step(0x56, true, false); s.Step(0xA2, true, false); Check(!s.Step(0xA5, true, true), ref passed);
            s = new TapState(); s.Seed(0xA5, true); Check(!s.Step(0xA5, true, true), ref passed); s.Step(0xA5, false, true); Check(s.Step(0xA5, true, true), ref passed);
            s = new TapState(); s.Seed(0x41, true); s.Step(0xA5, false, true); Check(!s.Step(0xA5, true, true), ref passed);
            s = new TapState(); s.Step(0xA5, false, true); s.Cancel(); Check(!s.Step(0xA5, true, true), ref passed);
            s = new TapState(); s.Step(0xA5, false, true, true); Check(!s.Step(0xA5, true, true), ref passed);
            Console.WriteLine("{\"ok\":true,\"assertions\":" + passed + ",\"cases\":[\"solo\",\"repeat\",\"left-alt\",\"chord\",\"altgr\",\"injected\",\"paste\",\"startup-held\",\"other-held\",\"mouse-cancel\"]}");
            return 0;
        }
        catch { Console.WriteLine("{\"ok\":false}"); return 1; }
    }
    private static void Check(bool condition, ref int passed) { if (!condition) throw new InvalidOperationException(); passed++; }
}
