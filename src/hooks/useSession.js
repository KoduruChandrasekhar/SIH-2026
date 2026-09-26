import { useEffect, useState } from "react";
import { getSession, onSessionChange } from "../lib/auth";

/** The signed-in identity ({ username, role, name } or null), re-rendering on login / logout. */
export function useSession() {
  const [session, setSession] = useState(getSession());
  useEffect(() => onSessionChange(setSession), []);
  return session;
}
