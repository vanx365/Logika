import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import { publicOrigin } from "./seb.js";

const origin = publicOrigin(process.argv[2] || process.env.LOGIKA_PUBLIC_ORIGIN || "http://localhost:3000").origin;
const base = path.resolve(process.env.LOGIKA_DATA_DIR || "data");
mkdirSync(base, { recursive: true, mode: 0o700 });
const dir = mkdtempSync(path.join(base, "perfil-"));
const password = () => randomBytes(18).toString("base64url");
const admin = password();
const quit = password();
const hash = value => createHash("sha256").update(value).digest("hex").toUpperCase();
const escapeXml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapedOrigin = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rule = "^" + escapedOrigin + "/(aula/?(\\?ticket=[a-f0-9]{64})?|aula\\.(css|js)|style\\.css|terminal-stream\\.js|api/aula/[^?#]+)$";
const profile = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>sebConfigPurpose</key><integer>0</integer>
  <key>startURL</key><string>${escapeXml(origin)}/aula</string>
  <key>startURLAppendQueryParameter</key><true/>
  <key>browserViewMode</key><integer>1</integer>
  <key>createNewDesktop</key><true/>
  <key>allowSwitchToApplications</key><false/>
  <key>monitorProcesses</key><true/>
  <key>permittedProcesses</key><array/>
  <key>sebServiceIgnore</key><false/>
  <key>sebServicePolicy</key><integer>2</integer>
  <key>allowQuit</key><true/>
  <key>hashedQuitPassword</key><string>${hash(quit)}</string>
  <key>hashedAdminPassword</key><string>${hash(admin)}</string>
  <key>allowDownUploads</key><false/>
  <key>allowDeveloperConsole</key><false/>
  <key>enableAltTab</key><false/>
  <key>enableAltF4</key><false/>
  <key>sendBrowserExamKey</key><true/>
  <key>URLFilterEnable</key><true/>
  <key>URLFilterEnableContentFilter</key><true/>
  <key>URLFilterRules</key><array><dict>
    <key>active</key><true/><key>regex</key><true/><key>action</key><integer>1</integer>
    <key>expression</key><string>${escapeXml(rule)}</string>
  </dict></array>
</dict></plist>
`;
writeFileSync(path.join(dir, "supervisor.txt"), "Administración: " + admin + "\nSalida: " + quit + "\n", { mode: 0o600 });
writeFileSync(path.join(dir, "preparacion.seb"), profile, { mode: 0o600 });
console.log("Perfil de preparación en " + dir);
console.log("Ábrelo desde SEB Configuration Tool y guarda el archivo final cifrado. Las contraseñas del supervisor están en supervisor.txt.");
