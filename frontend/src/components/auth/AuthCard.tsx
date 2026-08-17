import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { signInWithGoogle, supabase } from "@/lib/supabaseClient";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Mail,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { AuthTab } from "@/context/AuthModalContext";

interface AuthCardProps {
  initialTab?: AuthTab;
  onSuccess?: () => void;
  isModal?: boolean;
}

export function AuthCard({ initialTab = "signin", onSuccess, isModal = false }: AuthCardProps) {
  const { signIn, signUp, isAuthLoading } = useAuth();
  const { t, i18n } = useTranslation(["auth", "common"]);
  const isRtl = i18n.language === "ar" || i18n.dir() === "rtl";

  const [tab, setTab] = useState<AuthTab>(initialTab);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetState = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleTabChange = (newTab: AuthTab) => {
    resetState();
    setTab(newTab);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    resetState();

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage(t("signin.errors.fillAllFields", "Please enter your email address"));
      return;
    }

    if (tab === "forgot") {
      setIsSubmitting(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) {
          setErrorMessage(error.message);
        } else {
          setSuccessMessage(
            isRtl
              ? "تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني بنجاح."
              : "Password reset link sent to your email successfully."
          );
        }
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to send reset link");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!password) {
      setErrorMessage(t("signin.errors.fillAllFields", "Please enter your password"));
      return;
    }

    if (tab === "signup") {
      if (password.length < 6) {
        setErrorMessage(t("signup.errors.passwordMinLength", "Password must be at least 6 characters"));
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage(t("signup.errors.passwordsMismatch", "Passwords do not match"));
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (tab === "signup") {
        const result = await signUp(trimmedEmail, password);
        if (result?.error) {
          setErrorMessage(result.error.message);
        } else if (result?.data.session) {
          setSuccessMessage(t("signup.successRedirecting", "Account created successfully!"));
          setTimeout(() => {
            onSuccess?.();
          }, 800);
        } else {
          setSuccessMessage(
            isRtl
              ? "تم إنشاء الحساب! يرجى مراجعة بريدك الإلكتروني لتأكيد التسجيل."
              : "Account created! Please check your email to confirm your account."
          );
        }
      } else {
        const result = await signIn(trimmedEmail, password);
        if (result?.error) {
          setErrorMessage(
            result.error.message.includes("Invalid login credentials")
              ? t("signin.errors.invalidCredentials", "Email or password is incorrect")
              : result.error.message
          );
        } else if (result?.data.session) {
          setSuccessMessage(isRtl ? "تم تسجيل الدخول بنجاح!" : "Signed in successfully!");
          setTimeout(() => {
            onSuccess?.();
          }, 600);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || t("signin.errors.default", "Authentication failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    resetState();
    setIsGoogleSubmitting(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        setErrorMessage(error.message || t("signin.errors.google", "Google authentication failed"));
        setIsGoogleSubmitting(false);
      }
    } catch (err: any) {
      setErrorMessage(err.message || t("signin.errors.google", "Google authentication failed"));
      setIsGoogleSubmitting(false);
    }
  };

  return (
    <div
      className={`w-full ${
        isModal
          ? "p-0"
          : "max-w-md p-6 sm:p-8 rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl"
      }`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Brand Header */}
      <div className="flex flex-col items-center text-center mb-6">
        <div className="size-12 rounded-2xl bg-gradient-to-tr from-primary/20 via-primary/10 to-primary/5 border border-primary/20 flex items-center justify-center mb-3 shadow-inner">
          <Sparkles className="size-6 text-primary animate-pulse" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <span>Sigma AI</span>
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          {tab === "signup"
            ? isRtl
              ? "أنشئ حسابك المجاني للوصول إلى كافة الميزات"
              : "Create your free account to unlock full features"
            : tab === "forgot"
            ? isRtl
              ? "أدخل بريدك الإلكتروني لاستعادة كلمة المرور"
              : "Enter your email to receive a reset link"
            : isRtl
            ? "مرحباً بك! سجل الدخول للمتابعة"
            : "Welcome back! Sign in to continue"}
        </p>
      </div>

      {/* Tabs (Sign In / Sign Up) */}
      {tab !== "forgot" && (
        <div className="relative flex rounded-xl bg-muted/60 p-1 mb-6 border border-border/40">
          <button
            type="button"
            onClick={() => handleTabChange("signin")}
            className={`relative flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              tab === "signin"
                ? "bg-background text-foreground shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("signin.title", "تسجيل الدخول")}
          </button>
          <button
            type="button"
            onClick={() => handleTabChange("signup")}
            className={`relative flex-1 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              tab === "signup"
                ? "bg-background text-foreground shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t("signup.title", "إنشاء حساب")}
          </button>
        </div>
      )}

      {/* Alerts */}
      <AnimatePresence mode="wait">
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4 flex items-start gap-2.5 rounded-xl bg-destructive/10 border border-destructive/20 p-3.5 text-xs text-destructive leading-relaxed"
          >
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <div className="flex-1">{errorMessage}</div>
          </motion.div>
        )}

        {successMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mb-4 flex items-start gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3.5 text-xs text-emerald-600 leading-relaxed"
          >
            <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
            <div className="flex-1">{successMessage}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Social Logins */}
      {tab !== "forgot" && (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={handleGoogleAuth}
            disabled={isGoogleSubmitting || isSubmitting || isAuthLoading}
            className="w-full h-11 rounded-xl border-border/80 bg-background/80 hover:bg-muted/50 font-medium text-sm transition-all flex items-center justify-center gap-3 shadow-xs"
          >
            {isGoogleSubmitting ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <img src="/icons/google.svg" alt="Google" className="size-4.5" />
            )}
            <span>{isRtl ? "المتابعة باستخدام Google" : "Continue with Google"}</span>
          </Button>

          <div className="relative my-5 text-center text-xs after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border/60">
            <span className="relative z-10 bg-card px-3 text-muted-foreground">
              {isRtl ? "أو عبر البريد الإلكتروني" : "or continue with email"}
            </span>
          </div>
        </>
      )}

      {/* Form */}
      <form onSubmit={handleEmailAuth} className="space-y-3.5">
        {tab === "signup" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80">
              {t("signup.fullNameLabel", "الاسم الكامل")}
            </label>
            <div className="relative">
              <UserIcon
                className={`absolute top-1/2 -translate-y-1/2 size-4 text-muted-foreground/70 ${
                  isRtl ? "right-3.5" : "left-3.5"
                }`}
              />
              <Input
                type="text"
                placeholder={t("signup.fullNamePlaceholder", "أحمد علي")}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={`h-11 rounded-xl bg-background/60 border-border/70 focus-visible:ring-primary/30 ${
                  isRtl ? "pr-10 pl-4" : "pl-10 pr-4"
                }`}
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground/80">
            {t("signin.emailLabel", "البريد الإلكتروني")}
          </label>
          <div className="relative">
            <Mail
              className={`absolute top-1/2 -translate-y-1/2 size-4 text-muted-foreground/70 ${
                isRtl ? "right-3.5" : "left-3.5"
              }`}
            />
            <Input
              type="email"
              placeholder={t("signin.emailPlaceholder", "name@example.com")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`h-11 rounded-xl bg-background/60 border-border/70 focus-visible:ring-primary/30 ${
                isRtl ? "pr-10 pl-4" : "pl-10 pr-4"
              }`}
              required
              autoComplete="email"
            />
          </div>
        </div>

        {tab !== "forgot" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-foreground/80">
                {t("signin.passwordLabel", "كلمة المرور")}
              </label>
              {tab === "signin" && (
                <button
                  type="button"
                  onClick={() => handleTabChange("forgot")}
                  className="text-xs text-primary hover:underline font-medium transition-colors"
                >
                  {t("signin.forgotPassword", "نسيت كلمة المرور؟")}
                </button>
              )}
            </div>
            <div className="relative">
              <Lock
                className={`absolute top-1/2 -translate-y-1/2 size-4 text-muted-foreground/70 ${
                  isRtl ? "right-3.5" : "left-3.5"
                }`}
              />
              <Input
                type={showPassword ? "text" : "password"}
                placeholder={t("signin.passwordPlaceholder", "••••••••")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`h-11 rounded-xl bg-background/60 border-border/70 focus-visible:ring-primary/30 ${
                  isRtl ? "pr-10 pl-10" : "pl-10 pr-10"
                }`}
                required
                autoComplete={tab === "signup" ? "new-password" : "current-password"}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors p-1 ${
                  isRtl ? "left-2.5" : "right-2.5"
                }`}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
        )}

        {tab === "signup" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80">
              {t("signup.confirmPasswordLabel", "تأكيد كلمة المرور")}
            </label>
            <div className="relative">
              <Lock
                className={`absolute top-1/2 -translate-y-1/2 size-4 text-muted-foreground/70 ${
                  isRtl ? "right-3.5" : "left-3.5"
                }`}
              />
              <Input
                type={showConfirmPassword ? "text" : "password"}
                placeholder={t("signup.confirmPasswordPlaceholder", "••••••••")}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`h-11 rounded-xl bg-background/60 border-border/70 focus-visible:ring-primary/30 ${
                  isRtl ? "pr-10 pl-10" : "pl-10 pr-10"
                }`}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className={`absolute top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors p-1 ${
                  isRtl ? "left-2.5" : "right-2.5"
                }`}
              >
                {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
        )}

        <Button
          type="submit"
          disabled={isSubmitting || isGoogleSubmitting || isAuthLoading}
          className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm shadow-md transition-all mt-2"
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              <span>{isRtl ? "جارٍ التنفيذ..." : "Processing..."}</span>
            </div>
          ) : tab === "signup" ? (
            <span>{t("signup.submit", "إنشاء الحساب")}</span>
          ) : tab === "forgot" ? (
            <span>{isRtl ? "إرسال رابط الاستعادة" : "Send Reset Link"}</span>
          ) : (
            <span>{t("signin.submit", "تسجيل الدخول")}</span>
          )}
        </Button>

        {tab === "forgot" && (
          <button
            type="button"
            onClick={() => handleTabChange("signin")}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 pt-2 transition-colors font-medium"
          >
            {isRtl ? <ArrowRight className="size-3.5" /> : <ArrowLeft className="size-3.5" />}
            <span>{isRtl ? "العودة لتسجيل الدخول" : "Back to Sign In"}</span>
          </button>
        )}
      </form>
    </div>
  );
}
