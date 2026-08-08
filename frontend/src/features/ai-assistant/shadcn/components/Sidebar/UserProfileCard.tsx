
import { useState, useEffect, type FC } from "react";
import { supabase, signOut } from "@/lib/supabaseClient";
import { getUserAvatarUrl } from "@/lib/cn";
import { LogOut } from "lucide-react";

export const useUserProfile = () => {
  const [profile, setProfile] = useState<{ name: string; avatar: string; email: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        const email = user.email || "";
        const metaName = user.user_metadata?.full_name || user.user_metadata?.name || "";
        const metaAvatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || "";
        let name = metaName || email.split("@")[0] || "User";
        let avatarUrl = metaAvatar;

        // Try public_profiles for the local avatar
        try {
          const { data: pp } = await supabase
            .from("public_profiles")
            .select("avatar_url, full_name, username")
            .eq("id", user.id)
            .maybeSingle();
          if (pp && !cancelled) {
            if (pp.avatar_url?.trim()) avatarUrl = pp.avatar_url;
            if (pp.full_name || pp.username) name = pp.full_name || pp.username;
          }
        } catch (e) {
          console.warn("[UserProfile] public_profiles fetch failed", e);
        }

        if (cancelled) return;

        // If avatar is a local Supabase storage URL, download it to bypass RLS
        if (avatarUrl && avatarUrl.includes("/storage/v1/object/public/")) {
          try {
            const { data, error } = await supabase.storage.from("chat_media").download(
              avatarUrl.split("/object/public/chat_media/")[1]
            );
            if (data && !error) {
              const blobUrl = URL.createObjectURL(data);
              setProfile({ name, avatar: blobUrl, email });
              return;
            }
          } catch (e) {
            console.warn("[UserProfile] storage download failed, using URL directly", e);
          }
        }

        const avatar = avatarUrl || getUserAvatarUrl(null, name, 32);
        if (!cancelled) setProfile({ name, avatar, email });
      } catch (err) {
        console.warn("[UserProfile] Failed to load profile", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return profile;
};

export const UserProfileCard: FC = () => {
  const profile = useUserProfile();

  const handleLogout = async () => {
    await signOut();
    window.location.href = "/";
  };

  if (!profile) return null;

  return (
    <div className="flex items-center gap-2.5 border-t border-border px-1 pt-3">
      <img
        src={profile.avatar}
        alt={profile.name}
        className="size-8 shrink-0 rounded-full object-cover ring-1 ring-white/10"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).src = getUserAvatarUrl(null, profile.name, 32);
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{profile.name}</p>
        <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
      </div>
      <button
        onClick={handleLogout}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        title="Sign out"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
};
