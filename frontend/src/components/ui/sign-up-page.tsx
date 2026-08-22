import { useState } from "react";
import { Eye, EyeOff, Loader2, ArrowLeft, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { signInWithGoogle, supabase } from "@/lib/supabaseClient";
import { useTranslation } from "react-i18next";
import { ButterflyOverlay } from "@/components/ui/ButterflyOverlay";
import { ParallaxImage } from "@/components/ui/ParallaxImage";

interface SignupPageProps {
  initialMode?: "signup" | "signin";
  onSuccess?: () => void;
}

export function SignupPage({
  initialMode = "signup",
  onSuccess,
}: SignupPageProps) {
  const navigate = useNavigate();
  const { signIn, signUp, isAuthLoading } = useAuth();
  const { t, i18n } = useTranslation(["auth", "common"]);
  const isRtl = i18n?.language === "ar" || (typeof i18n?.dir === "function" ? i18n.dir() === "rtl" : false);

  const [isSignUp, setIsSignUp] = useState(initialMode === "signup");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    agreeToTerms: true,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const email = formData.email.trim();
    if (!email || !formData.password) {
      setErrorMessage(isRtl ? "يرجى ملء جميع الحقول المطلوبة" : "Please fill in all required fields");
      return;
    }

    if (isSignUp && !formData.agreeToTerms) {
      setErrorMessage(isRtl ? "يرجى الموافقة على الشروط والأحكام" : "Please agree to the Terms & Conditions");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isSignUp) {
        const result = await signUp(email, formData.password);
        if (result?.error) {
          setErrorMessage(result.error.message);
        } else if (result?.data.session) {
          setSuccessMessage(isRtl ? "تم إنشاء الحساب بنجاح!" : "Account created successfully!");
          setTimeout(() => {
            if (onSuccess) onSuccess();
            else navigate("/");
          }, 800);
        } else {
          setSuccessMessage(
            t("signin.errors.emailNotConfirmed", {
              defaultValue: isRtl
                ? "تم إنشاء الحساب! يرجى التحقق من بريدك الإلكتروني لتأكيد التسجيل."
                : "Account created! Please check your email inbox to confirm your account.",
            })
          );
        }
      } else {
        const result = await signIn(email, formData.password);
        if (result?.error) {
          setErrorMessage(
            result.error.message.includes("Invalid login credentials")
              ? isRtl
                ? "البريد الإلكتروني أو كلمة المرور غير صحيحة"
                : "Invalid email or password"
              : result.error.message
          );
        } else if (result?.data.session) {
          setSuccessMessage(isRtl ? "تم تسجيل الدخول بنجاح!" : "Signed in successfully!");
          setTimeout(() => {
            if (onSuccess) onSuccess();
            else navigate("/");
          }, 600);
        }
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsGoogleLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result?.error) {
        const msg = result.error.message || "";
        if (msg.includes("not enabled") || msg.includes("validation_failed")) {
          setErrorMessage(
            isRtl
              ? "تسجيل الدخول عبر Google غير مفعّل حالياً في لوحة تحكم Supabase. يرجى تفعيله من (Authentication -> Providers -> Google) أو استخدام البريد الإلكتروني."
              : "Google Sign-In is not enabled in Supabase Dashboard (Authentication -> Providers -> Google). Please sign in with email."
          );
        } else {
          setErrorMessage(msg || (isRtl ? "فشل تسجيل الدخول عبر Google" : "Google sign in failed"));
        }
        setIsGoogleLoading(false);
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : (isRtl ? "فشل تسجيل الدخول عبر Google" : "Failed to sign in with Google"));
      setIsGoogleLoading(false);
    }
  };

  const handleBack = () => {
    if (onSuccess) {
      onSuccess();
    } else {
      navigate("/");
    }
  };

  return (
    <div
      className="w-full h-screen h-[100dvh] flex flex-col md:flex-row overflow-hidden bg-white text-zinc-900"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Left Panel (Full-height Visual Image) */}
      <div className="flex-1 relative overflow-hidden md:block hidden h-full bg-zinc-950">
        {/* Back Button */}
        <div className={`absolute top-6 ${isRtl ? "right-6" : "left-6"} z-20`}>
          <button
            type="button"
            onClick={handleBack}
            className="size-11 bg-black/10 backdrop-blur-md border border-zinc-200 rounded-full flex items-center justify-center hover:bg-black/10 text-zinc-900 transition-all shadow-lg hover:scale-105 active:scale-95"
            title={isRtl ? "العودة إلى الدردشة" : "Back to Chat"}
          >
            {isRtl ? <ArrowRight className="size-5" /> : <ArrowLeft className="size-5" />}
          </button>
        </div>

        {/* Left Panel (Full-height Parallax Visual) */}
        <div className="absolute inset-0">
          <ParallaxImage />
        </div>

        {/* Butterfly animation overlay */}
        <ButterflyOverlay />
      </div>

      {/* Right Panel (Full-height Scrollable Form) */}
      <div className="flex-1 h-full overflow-y-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-12 lg:py-16 flex flex-col max-w-xl mx-auto w-full">
        {/* Brand Header - Fixed at Top */}
        <div className="flex items-center gap-3 mb-8 -mt-10 sm:-mt-14 -ml-4 sm:-ml-8">
          <img
            src="/icons/ai-assistant-logo.svg"
            alt="Sigma AI"
            className="size-11"
            draggable={false}
          />
          <span className="text-2xl font-bold tracking-tight leading-none">
            Sigma
          </span>
        </div>

        {/* Centered Form Content */}
        <div className="flex-1 flex flex-col justify-center">
          <div className="border border-zinc-200 bg-white/60 backdrop-blur-sm rounded-2xl p-10 sm:p-12 shadow-sm">

        {/* Mobile Back Button */}
        <div className="md:hidden flex items-center mb-6">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-2 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            {isRtl ? <ArrowRight className="size-4" /> : <ArrowLeft className="size-4" />}
            <span>{isRtl ? "العودة إلى الدردشة" : "Back to Chat"}</span>
          </button>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
            {isSignUp
              ? t("signup.title", { defaultValue: isRtl ? "أنشئ حسابك في سيقما" : "Create Your Sigma Account" })
              : t("signin.title", { defaultValue: isRtl ? "مرحباً بعودتك إلى سيقما" : "Welcome Back to Sigma" })}
          </h1>
            <p className="text-sm text-zinc-500">
              {isSignUp
                ? isRtl
                  ? "سيقما — أكثر من مجرد مساعد ذكاء اصطناعي، هو شريكك في الإبداع والإنتاجية. أكثر من مجرد AI."
                  : "Sigma — more than just an AI assistant, your partner in creativity and productivity. More than just AI."
                : isRtl
                  ? "سيقما هنا لمساعدتك في كل ما تحتاجه. أكثر من مجرد AI."
                  : "Sigma is here to help you with everything you need. More than just AI."}
              {" "}
              <span className="text-zinc-400">
                {isRtl ? "صُنع بـ ❤️" : "Created with ❤️"}
              </span>
            </p>
            <p className="text-sm text-zinc-500 mt-2">
              {isSignUp ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignUp(false);
                      setErrorMessage(null);
                    }}
                    className="text-blue-600 hover:text-blue-700 font-semibold underline-offset-4 hover:underline transition-colors"
                  >
                    {t("signup.hasAccount", { defaultValue: isRtl ? "لديك حساب بالفعل؟ تسجيل الدخول" : "Already have an account? Log in" })}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignUp(true);
                      setErrorMessage(null);
                    }}
                    className="text-blue-600 hover:text-blue-700 font-semibold underline-offset-4 hover:underline transition-colors"
                  >
                    {t("signup.noAccount", { defaultValue: isRtl ? "ليس لديك حساب؟ إنشاء حساب" : "Don't have an account? Sign up" })}
                  </button>
                </>
              )}
            </p>
          </div>

          {/* Feedback Messages */}
          {errorMessage && (
            <div className="mb-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 font-medium">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 font-medium">
              {successMessage}
            </div>
          )}

          {/* Google Sign-in */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isGoogleLoading || isSubmitting || isAuthLoading}
            className="w-full mb-4 flex items-center justify-center gap-3 py-2.5 px-4 border border-zinc-300 rounded-xl hover:bg-zinc-50 text-sm font-medium transition-all shadow-xs disabled:opacity-50"
          >
            {isGoogleLoading ? (
              <Loader2 className="size-4 animate-spin text-zinc-500" />
            ) : (
              <img src="/icons/google.svg" alt="Google" className="w-4.5 h-4.5" />
            )}
            <span>
              {isRtl ? "المتابعة باستخدام Google" : "Continue with Google"}
            </span>
          </button>

          <div className="relative my-3 text-center text-xs after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-zinc-200">
            <span className="relative z-10 bg-white px-3 text-zinc-400">
              {isRtl ? "أو عبر البريد الإلكتروني" : "or continue with email"}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* First and Last Name (Only for Sign Up) */}
            {isSignUp && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="firstName"
                    className="block text-xs font-medium text-zinc-700 mb-1.5"
                  >
                    {isRtl ? "الاسم الأول" : "First Name"}
                  </label>
                  <input
                    type="text"
                    id="firstName"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    placeholder={isRtl ? "أحمد" : "John"}
                    className="w-full px-3.5 py-2.5 text-sm bg-zinc-50/50 border border-zinc-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="lastName"
                    className="block text-xs font-medium text-zinc-700 mb-1.5"
                  >
                    {isRtl ? "اسم العائلة" : "Last Name"}
                  </label>
                  <input
                    type="text"
                    id="lastName"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleInputChange}
                    placeholder={isRtl ? "علي" : "Doe"}
                    className="w-full px-3.5 py-2.5 text-sm bg-zinc-50/50 border border-zinc-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    required
                  />
                </div>
              </div>
            )}

            {/* Email Field */}
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-zinc-700 mb-1.5"
              >
                {t("signin.emailLabel", { defaultValue: isRtl ? "البريد الإلكتروني" : "Email Address" })}
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="name@example.com"
                className="w-full px-3.5 py-2.5 text-sm bg-zinc-50/50 border border-zinc-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                required
                autoComplete="email"
              />
            </div>

            {/* Password Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs font-medium text-zinc-700"
                >
                  {t("signin.passwordLabel", { defaultValue: isRtl ? "كلمة المرور" : "Password" })}
                </label>
                {!isSignUp && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!formData.email) {
                        setErrorMessage(
                          isRtl
                            ? "أدخل بريدك الإلكتروني أولاً لإرسال رابط الاستعادة"
                            : "Enter your email first to send reset link"
                        );
                        return;
                      }
                      const { error } = await supabase.auth.resetPasswordForEmail(
                        formData.email.trim()
                      );
                      if (error) setErrorMessage(error.message);
                      else
                        setSuccessMessage(
                          isRtl
                            ? "تم إرسال رابط استعادة كلمة المرور لبريدك الإلكتروني"
                            : "Reset link sent to your email"
                        );
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline"
                  >
                    {isRtl ? "نسيت كلمة المرور؟" : "Forgot Password?"}
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  placeholder={isRtl ? "••••••••" : "Password"}
                  className={`w-full py-2.5 text-sm bg-zinc-50/50 border border-zinc-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all ${
                    isRtl ? "pl-11 pr-3.5" : "pr-11 pl-3.5"
                  }`}
                  required
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={`absolute top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-600 rounded-full transition-colors ${
                    isRtl ? "left-2" : "right-2"
                  }`}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Terms Checkbox (Only for Sign Up) */}
            {isSignUp && (
              <div className="flex items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="agreeToTerms"
                  name="agreeToTerms"
                  checked={formData.agreeToTerms}
                  onChange={handleInputChange}
                  className="w-4 h-4 text-blue-600 border-zinc-300 rounded focus:ring-blue-500 cursor-pointer"
                  required
                />
                <label
                  htmlFor="agreeToTerms"
                  className="text-xs text-zinc-600 cursor-pointer select-none"
                >
                  {isRtl ? "أوافق على " : "I agree to the "}
                  <span className="text-zinc-900 font-semibold hover:underline">
                    {isRtl ? "الشروط والأحكام" : "Terms & Conditions"}
                  </span>
                </label>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || isGoogleLoading || isAuthLoading}
              className="w-full bg-[#C45A3C] text-white py-3 px-4 rounded-xl font-semibold text-sm hover:bg-[#A84830] active:scale-[0.99] transition-all shadow-md mt-2 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : isSignUp ? (
                <span>{t("signup.submit", { defaultValue: isRtl ? "إنشاء الحساب" : "Create Account" })}</span>
              ) : (
                <span>{t("signin.submit", { defaultValue: isRtl ? "تسجيل الدخول" : "Sign In" })}</span>
              )}
            </button>
          </form>
        </div>
        </div>
        </div>
      </div>
    );
}
