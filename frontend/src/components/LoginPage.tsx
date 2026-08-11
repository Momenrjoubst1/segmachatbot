import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogIn, Mail, Lock, Loader2 } from "lucide-react";

export function LoginPage() {
  const { signIn, signUp, isAuthLoading } = useAuth();
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState("");
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmittingLogin(true);

    try {
      const result = isSignUp
        ? await signUp(email, password)
        : await signIn(email, password);

      if (result?.error) {
        setError(result.error.message || String(result.error));
      }
    } catch {
      setError("An unexpected error occurred");
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-foreground">
            {isSignUp ? t("signup.title") : t("signin.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSignUp ? t("signup.subtitle") : t("signin.subtitle")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              {t("signin.emailLabel")}
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder={t("signin.emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              {t("signin.passwordLabel")}
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder={t("signin.passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9"
                required
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmittingLogin || isAuthLoading}>
            {isSubmittingLogin ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogIn className="size-4" />
            )}
            {isSignUp ? t("signup.submit") : t("signin.submit")}
          </Button>

          <div className="text-center text-sm">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
              }}
              className="text-primary hover:underline"
            >
              {isSignUp ? t("signin.noAccount") + " " + t("signin.switchSignup") : t("signup.hasAccount") + " " + t("signup.switchSignin")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
