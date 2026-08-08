import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { proxyImage } from "@/utils/imageProxy";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getUserAvatarUrl(
  avatarUrl?: string | null,
  nameFallback?: string | null,
  size: number = 150
): string {
  if (avatarUrl && avatarUrl.trim() !== '') return avatarUrl;
  
  const name = nameFallback && nameFallback.trim() !== '' ? nameFallback : "User";
  const rawUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff&size=${size}`;
  return proxyImage(rawUrl);
}
