using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Controlled test surface only: never connects to an external application.
// Usage: Murmur.PasteTarget.exe --output <project-contained UTF-8 file>
// Optional --password / --read-only change the primary control for negative tests.
// stdin: exit, or JSON {command:"focus",field:"primary"|"secondary"|"password"|"readonly"},
// {command:"clipboard",text:"synthetic text"}, {command:"read"}.
internal static class PasteTarget
{
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
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
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly Dictionary<string, TextBox> Fields = new Dictionary<string, TextBox>();
    private static readonly object OutputLock = new object();
    private static string output;
    private static Form form;
    private static int menuActivations;
    private static bool menuActive;

    [STAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false);
        bool password = false, readOnly = false;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--output" && i + 1 < args.Length) output = args[++i];
            else if (args[i] == "--password") password = true;
            else if (args[i] == "--read-only") readOnly = true;
            else return 2;
        }
        if (String.IsNullOrEmpty(output) || !Path.IsPathRooted(output)) return 2;
        string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        output = Path.GetFullPath(output);
        if (!output.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return 2;
        string cursor = Path.GetDirectoryName(output);
        while (cursor.Length >= root.Length)
        {
            if (Directory.Exists(cursor) && (File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0) return 2;
            string parent = Path.GetDirectoryName(cursor);
            if (parent == null || parent == cursor) break;
            cursor = parent;
        }
        if (File.Exists(output) && (File.GetAttributes(output) & FileAttributes.ReparsePoint) != 0) return 2;
        Directory.CreateDirectory(Path.GetDirectoryName(output));
        Application.EnableVisualStyles();
        form = new Form { Text = "Murmur controlled paste test", Width = 650, Height = 410, StartPosition = FormStartPosition.CenterScreen };
        var menu = new MenuStrip();
        var fileMenu = new ToolStripMenuItem("&File");
        fileMenu.DropDownItems.Add(new ToolStripMenuItem("No action"));
        menu.Items.Add(fileMenu);
        menu.MenuActivate += delegate { menuActive = true; menuActivations++; };
        menu.MenuDeactivate += delegate { menuActive = false; };
        form.MainMenuStrip = menu;
        form.Controls.Add(menu);
        var label = new Label { Left = 16, Top = 25, Width = 610, Height = 24, Text = "Synthetic input test only. This window sends no messages and has no network connection." };
        form.Controls.Add(label);
        AddField("primary", 50, 120, password, readOnly);
        AddField("secondary", 190, 38, false, false);
        AddField("password", 245, 30, true, false);
        AddField("readonly", 300, 30, false, true);
        Fields["primary"].TextChanged += delegate { File.WriteAllText(output, Fields["primary"].Text, new UTF8Encoding(false)); };
        form.Shown += delegate
        {
            File.WriteAllText(output, "", new UTF8Encoding(false));
            Focus("primary");
            var ready = new { pid = Process.GetCurrentProcess().Id, hwnd = form.Handle.ToInt64().ToString(), focused = GetForegroundWindow() == form.Handle };
            File.WriteAllText(output + ".ready.json", Json.Serialize(ready), new UTF8Encoding(false));
            Emit(new { ready = ready });
            var input = new Thread(ReadCommands) { IsBackground = true };
            input.Start();
        };
        Application.Run(form);
        return 0;
    }

    private static void AddField(string name, int top, int height, bool password, bool readOnly)
    {
        var box = new TextBox { Name = name, Left = 16, Top = top, Width = 600, Height = height, Multiline = !password, ReadOnly = readOnly, UseSystemPasswordChar = password, AcceptsReturn = true, AcceptsTab = true };
        Fields.Add(name, box);
        form.Controls.Add(box);
    }

    private static void Focus(string name)
    {
        form.Show();
        form.Activate();
        SetForegroundWindow(form.Handle);
        Fields[name].Focus();
    }

    private static void ReadCommands()
    {
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            string command = line;
            if (form.IsDisposed) return;
            try { form.BeginInvoke((Action)(() => Handle(command))); } catch { return; }
        }
        try { if (!form.IsDisposed) form.BeginInvoke((Action)(() => form.Close())); } catch { }
    }

    private static void Handle(string line)
    {
        try
        {
            if (line == "exit") { form.Close(); return; }
            var command = Json.Deserialize<Dictionary<string, object>>(line);
            string type = (string)command["command"];
            if (type == "focus") Focus((string)command["field"]);
            else if (type == "clear") Fields["primary"].Clear();
            else if (type == "clipboard") Clipboard.SetText((string)command["text"], TextDataFormat.UnicodeText);
            else if (type == "read") { Emit(new { command = type, text = Fields["primary"].Text, secondary = Fields["secondary"].Text }); return; }
            else if (type == "shortcut") { Shortcut((string)command["scenario"]); return; }
            else throw new ArgumentException();
            Emit(new { command = type, ok = true });
        }
        catch { Emit(new { ok = false }); }
    }

    private static INPUT Key(ushort key, bool up, bool tagged)
    {
        uint flags = up ? 2u : 0u;
        if (key == 0xA5 || key == 0xA3) flags |= 1;
        return new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { key = key, flags = flags, extra = tagged ? new UIntPtr(0x4D555254u) : UIntPtr.Zero } } };
    }

    // Fixed synthetic scenarios only; never accepts key codes, text or a target
    // handle. Refuse all injection unless our own fixture is foreground.
    private static void Shortcut(string scenario)
    {
        if (GetForegroundWindow() != form.Handle) { Emit(new { command = "shortcut", scenario = scenario, ok = false }); return; }
        INPUT[] keys;
        switch (scenario)
        {
            case "right-alt": keys = new INPUT[] { Key(0xA5, false, true), Key(0xA5, true, true) }; break;
            case "right-alt-repeat": keys = new INPUT[] { Key(0xA5, false, true), Key(0xA5, false, true), Key(0xA5, false, true), Key(0xA5, false, true), Key(0xA5, true, true) }; break;
            case "left-alt": keys = new INPUT[] { Key(0xA4, false, true), Key(0xA4, true, true) }; break;
            case "altgr": keys = new INPUT[] { Key(0xA2, false, false), Key(0xA5, false, true), Key(0xA5, true, true), Key(0xA2, true, false) }; break;
            case "right-alt-chord": keys = new INPUT[] { Key(0xA5, false, true), Key(0x41, false, true), Key(0x41, true, true), Key(0xA5, true, true) }; break;
            case "injected-right-alt": keys = new INPUT[] { Key(0xA5, false, false), Key(0xA5, true, false) }; break;
            case "injected-paste": keys = new INPUT[] { Key(0xA2, false, false), Key(0x56, false, false), Key(0x56, true, false), Key(0xA2, true, false) }; break;
            case "f8": keys = new INPUT[] { Key(0x77, false, true), Key(0x77, true, true) }; break;
            case "escape": keys = new INPUT[] { Key(0x1B, false, false), Key(0x1B, true, false) }; break;
            default: throw new ArgumentException();
        }
        menuActivations = 0;
        bool sent = SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(INPUT))) == keys.Length;
        var timer = new System.Windows.Forms.Timer { Interval = 200 };
        timer.Tick += delegate
        {
            timer.Stop(); timer.Dispose();
            Emit(new { command = "shortcut", scenario = scenario, ok = sent, focused = GetForegroundWindow() == form.Handle, primaryFocused = Fields["primary"].Focused, menuActive = menuActive, menuActivations = menuActivations });
        };
        timer.Start();
    }

    private static void Emit(object value)
    {
        lock (OutputLock) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    }
}
