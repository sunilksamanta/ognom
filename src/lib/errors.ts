import { errMsg } from "@/lib/api";

/** True when the server refused a command because the user lacks a privilege
 *  (MongoDB error code 13, "not authorized on <db> to execute command"). */
export function isUnauthorized(e: unknown): boolean {
  const m = errMsg(e);
  return /\(Unauthorized\)|code 13\b|not authorized|requires authentication|Unauthorized/i.test(m);
}

/** Short, human version of a driver error: strips the echoed command body and
 *  the session / cluster-time noise MongoDB appends. */
export function friendlyError(e: unknown): string {
  let m = errMsg(e);
  m = m.replace(/^Command failed:\s*/i, "");
  // "... to execute command { currentOp: 1, ... }" -> keep only the command name
  m = m.replace(/to execute command \{\s*([A-Za-z$_.]+)[^]*$/, (_, cmd) => `to execute ${cmd}`);
  m = m.replace(/\s*\{[^{}]*\$clusterTime[^]*$/, "");
  return m.trim();
}
