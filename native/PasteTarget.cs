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
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly Dictionary<string, TextBox> Fields = new Dictionary<string, TextBox>();
    private static readonly object OutputLock = new object();
    private static string output;
    private static Form form;

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
        var label = new Label { Left = 16, Top = 12, Width = 610, Height = 32, Text = "Synthetic input test only. This window sends no messages and has no network connection." };
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
            else throw new ArgumentException();
            Emit(new { command = type, ok = true });
        }
        catch { Emit(new { ok = false }); }
    }

    private static void Emit(object value)
    {
        lock (OutputLock) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    }
}
