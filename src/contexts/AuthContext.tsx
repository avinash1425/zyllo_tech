import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  authenticateUser,
  clearSession,
  getCurrentUser,
  registerUser,
  type AuthUser,
} from "@/lib/auth";

interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

interface SignInInput {
  email: string;
  password: string;
  rememberMe: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isHydrated: boolean;
  signUp: (input: SignUpInput) => Promise<void>;
  signIn: (input: SignInInput) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setUser(getCurrentUser());
    setIsHydrated(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      isAdmin: user?.role === "admin",
      isHydrated,
      signUp: async (input) => {
        await registerUser(input);
      },
      signIn: async (input) => {
        const signedInUser = await authenticateUser(input.email, input.password, input.rememberMe);
        setUser(signedInUser);
      },
      signOut: () => {
        clearSession();
        setUser(null);
      },
    }),
    [isHydrated, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

const defaultAuthValue: AuthContextValue = {
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  isHydrated: false,
  signUp: async () => { throw new Error("AuthProvider not mounted"); },
  signIn: async () => { throw new Error("AuthProvider not mounted"); },
  signOut: () => {},
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  return context ?? defaultAuthValue;
};
