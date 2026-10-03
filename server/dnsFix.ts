// Local-dev-only workaround: this machine's local DNS resolver stub can't
// answer the SRV lookups MongoDB Atlas's mongodb+srv:// URI requires under
// Node 24 (querySrv ECONNREFUSED). Pointing Node's resolver at public DNS
// fixes it. Imported first by local.ts only — Vercel's runtime resolves SRV
// fine and never loads this file.
import dns from "node:dns";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
