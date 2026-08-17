import { useAuthModal } from "@/context/AuthModalContext";
import { SignupPage } from "@/components/ui/sign-up-page";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function AuthModal() {
  const { isOpen, activeTab, closeAuthModal } = useAuthModal();

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && closeAuthModal()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/70 backdrop-blur-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-full max-w-4xl translate-x-[-50%] translate-y-[-50%] p-3 sm:p-4",
            "duration-200 focus:outline-none max-h-[95vh] overflow-y-auto",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
          <DialogPrimitive.Close
            className="absolute right-6 top-6 sm:right-8 sm:top-8 z-30 rounded-full p-2 bg-black/10 hover:bg-black/10 text-zinc-900 backdrop-blur-md transition-colors focus:outline-none border border-zinc-200"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>

          <SignupPage
            initialMode={activeTab === "signup" ? "signup" : "signin"}
            isModal={true}
            onSuccess={() => {
              closeAuthModal();
            }}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

