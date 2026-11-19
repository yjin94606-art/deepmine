using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("Deepmine Setup")]
[assembly: AssemblyProduct("Deepmine")]
[assembly: AssemblyVersion(BuildInfo.Version)]

internal static class DeepmineSetup {
    private static bool Chinese { get { return System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh"; } }
    private static string Copy(string english, string chinese) { return Chinese ? chinese : english; }

    [STAThread]
    private static int Main(string[] args) {
        if (args.Length == 2 && args[0] == "--verify-install") {
            string root = null, step = "Preparing the isolated install";
            try {
                root = Path.GetFullPath(args[1]);
                Directory.CreateDirectory(root);
                step = "Extracting or verifying the portable ZIP";
                var app = Install(Path.Combine(root, "Programs"), null);
                step = "Saving the Start menu shortcut";
                var shortcut = CreateShortcut(Path.Combine(root, "Menu"), app);
                step = "Reading the saved Start menu shortcut";
                File.WriteAllLines(Path.Combine(root, "verified-shortcut.txt"), ReadShortcut(shortcut), new UTF8Encoding(false));
                return 0;
            } catch (Exception error) {
                string diagnostic = step + Environment.NewLine + error.ToString();
                try {
                    if (root != null) File.WriteAllText(Path.Combine(root, "verify-install-error.txt"), diagnostic, new UTF8Encoding(false));
                } catch (IOException) {} catch (UnauthorizedAccessException) {}
                Console.Error.WriteLine(diagnostic);
                return 1;
            }
        }
        if (args.Length != 0) return 2;
        Application.EnableVisualStyles();
        using (var form = new Form())
        using (var label = new Label())
        using (var progress = new ProgressBar()) {
            form.Text = "Deepmine";
            form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            form.StartPosition = FormStartPosition.CenterScreen;
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.ControlBox = false;
            form.ClientSize = new Size(390, 92);
            label.SetBounds(18, 17, 355, 25);
            label.Text = Copy("Opening your mine…", "正在打开你的矿坑…");
            progress.SetBounds(18, 51, 354, 15);
            form.Controls.Add(label);
            form.Controls.Add(progress);
            form.Shown += async delegate {
                try {
                    string programs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
                    var reporter = new Progress<int>(value => { if (!form.IsDisposed) progress.Value = value; });
                    string app = await Task.Run(() => Install(programs, reporter));
                    CreateShortcut(Environment.GetFolderPath(Environment.SpecialFolder.Programs), app);
                    Process.Start(new ProcessStartInfo(Node(app), Arguments(app)) { WorkingDirectory = app, UseShellExecute = false });
                } catch (Exception error) {
                    Environment.ExitCode = 1;
                    MessageBox.Show(form, error.Message, Copy("Deepmine could not open", "深矿未能打开"), MessageBoxButtons.OK, MessageBoxIcon.Error);
                } finally { form.Close(); }
            };
            Application.Run(form);
        }
        return Environment.ExitCode;
    }
    private static string Node(string app) { return Path.Combine(app, @"Deepmine\runtime\node.exe"); }
    private static string Arguments(string app) { return "\"" + Path.Combine(app, @"Deepmine\scripts\open-mine.cjs") + "\""; }

    private static string Hash(Stream stream) {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    private static string Install(string programs, IProgress<int> progress) {
        string parent = Path.Combine(programs, "Deepmine");
        string target = Path.Combine(parent, BuildInfo.Version);
        Directory.CreateDirectory(parent);
        using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("Portable.zip")) {
            if (payload == null || Hash(payload) != BuildInfo.Sha256)
                throw new InvalidDataException(Copy("The download is damaged. Download the installer again.", "下载文件不完整，请重新下载安装包。"));
            payload.Position = 0;
            using (var zip = new ZipArchive(payload, ZipArchiveMode.Read, true)) {
                if (Directory.Exists(target)) { VerifyExisting(zip, target); return target; }
                string staging = Path.Combine(parent, ".install-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(staging);
                try {
                    int count = 0;
                    foreach (var item in zip.Entries) {
                        string file = Member(staging, item);
                        Directory.CreateDirectory(Path.GetDirectoryName(file));
                        item.ExtractToFile(file);
                        if (progress != null) progress.Report(++count * 100 / zip.Entries.Count);
                    }
                    try { Directory.Move(staging, target); }
                    catch (IOException) {
                        if (!Directory.Exists(target)) throw;
                        VerifyExisting(zip, target);
                    }
                } finally { if (Directory.Exists(staging)) Directory.Delete(staging, true); }
            }
        }
        return target;
    }
    private static string Member(string root, ZipArchiveEntry item) {
        string path = Path.GetFullPath(Path.Combine(root, item.FullName));
        if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || item.Name.Length == 0)
            throw new InvalidDataException("Invalid file in the Deepmine download.");
        return path;
    }
    private static void VerifyExisting(ZipArchive zip, string root) {
        foreach (var item in zip.Entries) {
            using (var expected = item.Open())
            using (var actual = File.OpenRead(Member(root, item))) {
                if (actual.Length != item.Length || Hash(actual) != Hash(expected))
                    throw new InvalidDataException(Copy("An installed file has changed. Move this program folder aside, then open Setup again: ", "已安装的程序文件发生变化。请将这个程序目录移走后重新打开安装包：") + root);
            }
        }
    }
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink {}

    // IShellLinkW vtable order from shobjidl_core.h. Windows filenames are UTF-16 on all system locales.
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, IntPtr findData, uint flags);
        void GetIDList(out IntPtr pidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder description, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string description);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string path);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }

    private static string CreateShortcut(string menu, string app) {
        Directory.CreateDirectory(menu);
        string file = Path.Combine(menu, "Deepmine.lnk");
        var link = (IShellLinkW)new ShellLink();
        try {
            link.SetPath(Node(app));
            link.SetArguments(Arguments(app));
            link.SetWorkingDirectory(app);
            link.SetDescription("Open your local Deepmine");
            link.SetIconLocation(Path.Combine(app, @"Deepmine\dist\mine-icon.ico"), 0);
            ((IPersistFile)link).Save(file, true);
        } finally { Marshal.FinalReleaseComObject(link); }
        return file;
    }

    private static string[] ReadShortcut(string file) {
        var link = (IShellLinkW)new ShellLink();
        try {
            ((IPersistFile)link).Load(file, 0);
            var node = new StringBuilder(260);
            var arguments = new StringBuilder(32768);
            var cwd = new StringBuilder(32768);
            link.GetPath(node, node.Capacity, IntPtr.Zero, 0);
            link.GetArguments(arguments, arguments.Capacity);
            link.GetWorkingDirectory(cwd, cwd.Capacity);
            return new string[] { node.ToString(), arguments.ToString(), cwd.ToString() };
        } finally { Marshal.FinalReleaseComObject(link); }
    }
}
