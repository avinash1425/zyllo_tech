export type UserRole = "admin" | "user";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

interface StoredUser extends AuthUser {
  passwordHash: string;
}

interface StoredSession {
  userId: string;
}

const USERS_KEY = "zyllo.auth.users";
const SESSION_KEY = "zyllo.auth.session";

const DEFAULT_ADMIN_EMAIL = "admin@zyllotech.com";
const DEFAULT_ADMIN_PASSWORD = "Admin@12345";

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readUsers(): StoredUser[] {
  return safeParse<StoredUser[]>(localStorage.getItem(USERS_KEY)) ?? [];
}

function writeUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function readSession(): StoredSession | null {
  const local = safeParse<StoredSession>(localStorage.getItem(SESSION_KEY));
  if (local?.userId) return local;
  const session = safeParse<StoredSession>(sessionStorage.getItem(SESSION_KEY));
  return session?.userId ? session : null;
}

function writeSession(session: StoredSession, rememberMe: boolean) {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  const target = rememberMe ? localStorage : sessionStorage;
  target.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

export async function ensureDefaultAdmin() {
  const users = readUsers();
  const hasAdmin = users.some((u) => u.role === "admin");
  if (hasAdmin) return;

  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  users.push({
    id: crypto.randomUUID(),
    name: "Admin",
    email: DEFAULT_ADMIN_EMAIL,
    role: "admin",
    createdAt: new Date().toISOString(),
    passwordHash,
  });
  writeUsers(users);
}

export function getCurrentUser(): AuthUser | null {
  const session = readSession();
  if (!session) return null;
  const users = readUsers();
  const user = users.find((u) => u.id === session.userId);
  if (!user) return null;
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const users = readUsers();
  const normalizedEmail = input.email.trim().toLowerCase();
  const exists = users.some((u) => u.email.toLowerCase() === normalizedEmail);
  if (exists) {
    throw new Error("An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);
  const newUser: StoredUser = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    email: normalizedEmail,
    role: "user",
    createdAt: new Date().toISOString(),
    passwordHash,
  };

  users.push(newUser);
  writeUsers(users);

  const { passwordHash: _passwordHash, ...safeUser } = newUser;
  return safeUser;
}

export async function authenticateUser(
  email: string,
  password: string,
  rememberMe: boolean
): Promise<AuthUser> {
  const users = readUsers();
  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (!user) {
    throw new Error("Invalid email or password.");
  }

  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.passwordHash) {
    throw new Error("Invalid email or password.");
  }

  writeSession({ userId: user.id }, rememberMe);
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}
