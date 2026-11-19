using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
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
            try {
                var root = Path.GetFullPath(args[1]);
                var app = Install(Path.Combine(root, "Programs"), null);
                CreateShortcut(Path.Combine(root, "Menu"), app);
                return 0;
            } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
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
    private static void CreateShortcut(string menu, string app) {
        Directory.CreateDirectory(menu);
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell", true));
        dynamic shortcut = shell.CreateShortcut(Path.Combine(menu, "Deepmine.lnk"));
        shortcut.TargetPath = Node(app);
        shortcut.Arguments = Arguments(app);
        shortcut.WorkingDirectory = app;
        shortcut.Description = "Open your local Deepmine";
        shortcut.IconLocation = Path.Combine(app, @"Deepmine\dist\mine-icon.ico") + ",0";
        shortcut.Save();
    }
}
