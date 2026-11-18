using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Instalador de Logika")]
[assembly: AssemblyProduct("Logika")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace Logika
{
    internal static class Setup
    {
        internal const string BundleUrl = "https://github.com/SafeExamBrowser/seb-win-refactoring/releases/download/v3.10.3/SEB_3.10.3.960_SetupBundle.exe";
        internal const string BundleSha256 = "716b25f77ada22bffdd223e147c3f21042d130c006347e35bd9be2c91e51730b";
        internal static readonly Version RequiredVersion = new Version(3, 10, 3, 960);

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }

        internal static Uri Classroom(string value)
        {
            Uri origin;
            if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out origin) ||
                (origin.Scheme != Uri.UriSchemeHttps && !(origin.Scheme == Uri.UriSchemeHttp && origin.IsLoopback)) ||
                origin.UserInfo != "" || origin.Query != "" || origin.Fragment != "" || origin.AbsolutePath != "/" ||
                value.IndexOfAny(new[] { '\r', '\n', '\\' }) >= 0)
                throw new ArgumentException("Escribe el origen HTTPS de tu institución, sin ruta. Para una prueba en esta PC puedes usar http://localhost:3000.");
            return new Uri(origin, "/aula");
        }

        // Inspect the registered application; only the official installer is ever launched by this process.
        internal static Version InstalledVersion()
        {
            using (RegistryKey key = Registry.ClassesRoot.OpenSubKey(@"sebs\shell\open\command"))
            {
                if (key == null) return null;
                var command = key.GetValue(null) as string ?? "";
                var executable = Regex.Match(command, "^\\s*\x22([^\x22]+\\.exe)\x22", RegexOptions.IgnoreCase);
                if (!executable.Success) return null;
                var file = Environment.ExpandEnvironmentVariables(executable.Groups[1].Value);
                if (!File.Exists(file)) return null;
                var info = FileVersionInfo.GetVersionInfo(file);
                if (!Path.GetFileName(file).Equals("SafeExamBrowser.exe", StringComparison.OrdinalIgnoreCase)) return null;
                return new Version(info.FileMajorPart, info.FileMinorPart, info.FileBuildPart, info.FilePrivatePart);
            }
        }

        internal static void VerifyBundle(Stream file)
        {
            using (var sha = SHA256.Create())
            {
                var digest = BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "");
                if (!String.Equals(digest, BundleSha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("La descarga no coincide con el instalador oficial de SEB 3.10.3. Intenta instalar de nuevo.");
            }
        }

        internal static void WriteShortcut(string directory, Uri classroom)
        {
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, "Logika.url"),
                "[InternetShortcut]\r\nURL=" + classroom.AbsoluteUri + "\r\n", Encoding.ASCII);
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly TextBox origin = new TextBox();
        private readonly Label status = new Label();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Button install = new Button();
        private bool active;
        private Uri installedClassroom;
        private WebClient download;

        internal SetupForm()
        {
            Text = "Instalar Logika";
            Font = new Font("Segoe UI", 10);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(540, 245);
            var label = new Label { Text = "Dirección de Logika de tu institución", Left = 22, Top = 21, AutoSize = true };
            origin.SetBounds(22, 50, 496, 28);
            using (var config = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("Logika.origin")))
                origin.Text = config.ReadToEnd().Trim();
            origin.ReadOnly = origin.Text.Length > 0;
            status.Text = "Se preparará el acceso a tu aula y el cliente oficial Safe Exam Browser para Windows. Su instalación puede pedir permisos de administrador.";
            status.SetBounds(22, 95, 496, 65);
            progress.SetBounds(22, 159, 496, 16);
            install.SetBounds(365, 191, 153, 34);
            install.Text = "Instalar";
            install.Click += Install;
            AcceptButton = install;
            Controls.AddRange(new Control[] { label, origin, status, progress, install });
            FormClosing += (sender, args) => {
                if (active) {
                    args.Cancel = true;
                    if (download != null) download.CancelAsync();
                }
            };
        }

        private async void Install(object sender, EventArgs unused)
        {
            if (installedClassroom != null) {
                try { Process.Start(new ProcessStartInfo(installedClassroom.AbsoluteUri) { UseShellExecute = true }); Close(); }
                catch (Exception ex) { MessageBox.Show(this, ex.Message, Text); }
                return;
            }
            if (active) return;
            active = true;
            install.Enabled = false;
            origin.Enabled = false;
            try {
                var classroom = Setup.Classroom(origin.Text);
                var version = Setup.InstalledVersion();
                if (version != null && version > Setup.RequiredVersion)
                    throw new InvalidOperationException("Este equipo tiene una versión más reciente de SEB. Pide a tu institución el instalador de Logika correspondiente a esa versión.");
                bool reboot = false;
                if (version != Setup.RequiredVersion) reboot = await InstallSeb();
                if (!reboot && Setup.InstalledVersion() != Setup.RequiredVersion)
                    throw new InvalidOperationException("SEB 3.10.3 no quedó registrado en Windows. Completa el asistente oficial y vuelve a intentar.");
                Setup.WriteShortcut(Environment.GetFolderPath(Environment.SpecialFolder.Programs), classroom);
                installedClassroom = classroom;
                progress.Value = 100;
                status.Text = reboot ? "Windows necesita reiniciarse. Después abre Logika desde el menú Inicio." : "Logika está listo. Puedes abrirlo ahora o desde el menú Inicio de Windows.";
                install.Text = reboot ? "Cerrar" : "Abrir Logika";
                if (reboot) { install.Click -= Install; install.Click += (s, e) => Close(); }
            } catch (Exception error) {
                status.Text = error is OperationCanceledException ? "Descarga cancelada." : error.Message;
                progress.Value = 0;
            } finally {
                active = false;
                install.Enabled = true;
                origin.Enabled = installedClassroom == null;
            }
        }

        private async Task<bool> InstallSeb()
        {
            string directory = Path.Combine(Path.GetTempPath(), "LogikaSetup-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            string bundle = Path.Combine(directory, "SEB_3.10.3.960_SetupBundle.exe");
            try {
                status.Text = "Descargando Safe Exam Browser 3.10.3 desde la publicación oficial…";
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                using (var client = new WebClient()) {
                    download = client;
                    client.DownloadProgressChanged += (s, e) => progress.Value = Math.Max(0, Math.Min(100, e.ProgressPercentage));
                    try { await client.DownloadFileTaskAsync(new Uri(Setup.BundleUrl), bundle); }
                    finally { download = null; }
                }
                status.Text = "Comprobando la integridad de la descarga…";
                using (var file = new FileStream(bundle, FileMode.Open, FileAccess.Read, FileShare.Read)) {
                    await Task.Run(() => Setup.VerifyBundle(file));
                    status.Text = "Completa el asistente oficial de SEB y acepta sus condiciones para continuar.";
                    var start = new ProcessStartInfo(bundle) { WorkingDirectory = directory, UseShellExecute = true };
                    using (var child = Process.Start(start)) {
                        await Task.Run(() => child.WaitForExit());
                        if (child.ExitCode == 3010 || child.ExitCode == 1641) return true;
                        if (child.ExitCode != 0)
                            throw new InvalidOperationException("La instalación de SEB no se completó (código " + child.ExitCode + ").");
                    }
                }
                return false;
            } finally {
                try { File.Delete(bundle); Directory.Delete(directory, false); } catch (IOException) { }
            }
        }
    }
}
