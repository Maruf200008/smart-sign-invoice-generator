"use client";

import { Eye, LogIn, UserPlus } from "lucide-react";
import Image from "next/image";
import { type FormEvent, type InputHTMLAttributes, type ReactNode, useEffect, useState } from "react";
import { BrandLoader, BrandLoaderOverlay } from "@/components/brand/BrandLoader";
import { ActionButton } from "@/components/controls/ActionButton";
import favIcon from "@/assets/fav_icon.svg";
import { clearStoredAuthUser, getStoredAuthUser, loginUser, requestLoginOtp, signupUser, verifyLoginOtp } from "@/lib/auth-client";
import type { AuthUser } from "@/types/auth";

export function AuthGate({ children }: { children: (user: AuthUser, onSignOut: () => void) => ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setUser(getStoredAuthUser());
    setIsReady(true);
  }, []);

  function handleSignOut() {
    clearStoredAuthUser();
    setUser(null);
  }

  if (!isReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f4f4]">
        <BrandLoader />
      </main>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={setUser} />;
  }

  return <>{children(user, handleSignOut)}</>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "otp">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      if (mode === "forgot") {
        await requestLoginOtp({ email, username });
        setMode("otp");
        return;
      }

      const user = mode === "signup"
        ? await signupUser({ email, username, password })
        : mode === "otp"
          ? await verifyLoginOtp({ email, username, otp })
          : await loginUser({ identifier, password });

      onAuthenticated(user);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f4f4f4] px-4 py-8 text-zinc-950">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto h-[420px] max-w-[650px] -translate-y-1/2 bg-[linear-gradient(rgba(224,27,36,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(224,27,36,0.07)_1px,transparent_1px)] bg-[size:34px_34px] [mask-image:radial-gradient(circle,black_0%,transparent_70%)]" />

      <section className="relative w-full max-w-[460px] rounded-[22px] border border-white/80 bg-white/95 px-8 py-8 shadow-[0_24px_80px_rgba(0,0,0,0.10)] sm:px-9">
        <div className="mb-7 text-center">
          <Image src={favIcon} alt="Smart Sign" width={64} height={64} className="mx-auto mb-5 size-16 object-contain" />
          <h1 className="text-2xl font-black tracking-normal text-black">{authTitle(mode)}</h1>
          <p className="mt-2 text-sm font-medium text-zinc-500">
            {authSubtitle(mode)}
          </p>
        </div>

        <div className="mb-7 flex items-center gap-3 text-xs font-semibold uppercase text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" />
          <span>{authDivider(mode)}</span>
          <span className="h-px flex-1 bg-zinc-200" />
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          {mode === "signup" || mode === "forgot" || mode === "otp" ? (
            <>
              <AuthInput label="E-Mail Address" placeholder="Enter your email..." value={email} type="email" onChange={setEmail} />
              <AuthInput label="Username" placeholder={mode === "signup" ? "Choose a username..." : "Enter your username..."} value={username} onChange={setUsername} />
            </>
          ) : (
            <AuthInput label="Username or Gmail" placeholder="Enter username or email..." value={identifier} onChange={setIdentifier} />
          )}
          {mode === "otp" ? (
            <AuthInput label="OTP Code" placeholder="Enter 6 digit OTP..." value={otp} inputMode="numeric" onChange={setOtp} />
          ) : mode !== "forgot" ? (
            <AuthInput label="Password" placeholder="Enter your password..." value={password} type="password" onChange={setPassword} />
          ) : null}

          {mode === "login" && <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium text-zinc-500">Stays signed in until logout</span>
            <button type="button" className="font-medium text-zinc-700 underline underline-offset-4" onClick={() => {
              setError("");
              setMode("forgot");
            }}>
              Forgot password?
            </button>
          </div>}

          {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

          <ActionButton
            type="submit"
            icon={mode === "signup" ? <UserPlus className="size-4" /> : <LogIn className="size-4" />}
            disabled={isSubmitting}
            variant="primary"
            className="mt-1 w-full border border-zinc-950 bg-[#202020] shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_14px_30px_rgba(0,0,0,0.18)] hover:bg-black"
          >
            {isSubmitting ? "Working..." : authButtonText(mode)}
          </ActionButton>
        </form>

        <p className="mt-7 text-center text-sm text-zinc-600">
          {mode === "signup" ? "Already have an account?" : mode === "login" ? "Don't have an account yet?" : "Remember your password?"}{" "}
          <button
            type="button"
            className="font-black text-black"
            onClick={() => {
              setError("");
              setMode(mode === "signup" || mode === "forgot" || mode === "otp" ? "login" : "signup");
            }}
          >
            {mode === "signup" || mode === "forgot" || mode === "otp" ? "Sign In" : "Sign Up"}
          </button>
        </p>
      </section>

      {isSubmitting && <BrandLoaderOverlay label="Please wait" />}
    </main>
  );
}

function authTitle(mode: "login" | "signup" | "forgot" | "otp") {
  if (mode === "signup") return "Create account";
  if (mode === "forgot") return "Verify your account";
  if (mode === "otp") return "Enter OTP";
  return "Welcome back";
}

function authSubtitle(mode: "login" | "signup" | "forgot" | "otp") {
  if (mode === "signup") return "Please enter your details to sign up.";
  if (mode === "forgot") return "Enter your username and Gmail to receive an OTP.";
  if (mode === "otp") return "Use the OTP sent to your Gmail to sign in.";
  return "Please enter your details to sign in.";
}

function authDivider(mode: "login" | "signup" | "forgot" | "otp") {
  if (mode === "signup") return "Sign Up";
  if (mode === "forgot") return "OTP Request";
  if (mode === "otp") return "OTP Login";
  return "Sign In";
}

function authButtonText(mode: "login" | "signup" | "forgot" | "otp") {
  if (mode === "signup") return "Sign up";
  if (mode === "forgot") return "Send OTP";
  if (mode === "otp") return "Login with OTP";
  return "Sign in";
}

function AuthInput({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  type?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <label className="grid gap-2 text-sm font-semibold text-black">
      {label}
      <span className="relative">
        <input
          className={`h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-[#e01b24] focus:ring-4 focus:ring-red-500/10 ${isPassword ? "pr-10" : ""}`}
          type={isPassword && showPassword ? "text" : type}
          inputMode={inputMode}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {isPassword && (
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
            onClick={() => setShowPassword((visible) => !visible)}
          >
            <Eye className="size-4" />
          </button>
        )}
      </span>
    </label>
  );
}
