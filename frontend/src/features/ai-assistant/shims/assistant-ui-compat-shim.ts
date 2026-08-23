import React, { useMemo } from "react";
import * as RealAssistantUI from "@assistant-ui/react";
import {
  unstable_defaultDirectiveFormatter,
  type Unstable_TriggerAdapter,
  type Unstable_TriggerCategory,
  type Unstable_TriggerItem,
} from "@assistant-ui/core";
import type { ReadonlyJSONObject } from "assistant-stream/utils";

export * from "@assistant-ui/react";

export type Unstable_IconComponent = React.FC<{ className?: string }>;

export type Unstable_Mention = {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly icon?: string | undefined;
  readonly metadata?: ReadonlyJSONObject | undefined;
};

export type Unstable_MentionCategory = {
  readonly id: string;
  readonly label: string;
  readonly items: readonly Unstable_Mention[];
};

export const useUnstableMentionAdapter = (options?: any) => {
  const aui = RealAssistantUI.useAui();

  const items = options?.items as readonly Unstable_Mention[] | undefined;
  const categories = options?.categories as readonly Unstable_MentionCategory[] | undefined;
  const includeTools = options?.includeModelContextTools ?? (!items && !categories);
  const toolsConfig = typeof includeTools === "object" ? includeTools : undefined;
  const wantsTools = includeTools !== false;

  const formatter = options?.formatter;
  const onInserted = options?.onInserted;

  const adapter = useMemo<Unstable_TriggerAdapter>(() => {
    const getModelContextTools = (): Unstable_TriggerItem[] => {
      if (!wantsTools) return [];
      const ctx = aui.thread().getModelContext();
      const tools = ctx.tools;
      if (!tools) return [];
      const formatLabel = toolsConfig?.formatLabel;
      const defaultIcon = toolsConfig?.icon;

      return Object.entries(tools).map(([name, tool]: [string, any]) =>
        toTriggerItem({
          id: name,
          type: "tool",
          label: formatLabel ? formatLabel(name) : name,
          description: tool?.description ?? undefined,
          icon: defaultIcon,
        }),
      );
    };

    if (categories && categories.length > 0) {
      const groups: Array<{
        id: string;
        label: string;
        items: Unstable_TriggerItem[];
      }> = categories.map((cat: Unstable_MentionCategory) => ({
        id: cat.id,
        label: cat.label,
        items: cat.items.map(toTriggerItem),
      }));

      let toolCategory: { id: string; label: string; items: Unstable_TriggerItem[] } | null = null;
      if (wantsTools) {
        const toolItems = getModelContextTools();
        if (toolItems.length > 0) {
          toolCategory = {
            id: toolsConfig?.category?.id ?? "tools",
            label: toolsConfig?.category?.label ?? "Tools",
            items: toolItems,
          };
        }
      }

      const allGroups: Array<{
        id: string;
        label: string;
        items: Unstable_TriggerItem[];
      }> = toolCategory ? [...groups, toolCategory] : groups;

      return {
        categories: (): readonly Unstable_TriggerCategory[] =>
          allGroups.map(({ id, label }: { id: string; label: string }) => ({
            id,
            label,
          })),
        categoryItems: (id: string) =>
          allGroups.find((group: { id: string }) => group.id === id)?.items ?? [],
        search: (query: string) => {
          const lower = query.toLowerCase();
          return allGroups
            .flatMap((group: { items: Unstable_TriggerItem[] }) => group.items)
            .filter((item: Unstable_TriggerItem) => matchesQuery(item, lower));
        },
      };
    }

    const flatItems: Unstable_TriggerItem[] = (items ?? []).map(toTriggerItem);

    const getFlatPool = (): Unstable_TriggerItem[] => {
      if (!wantsTools) return flatItems;
      const toolItems = getModelContextTools();
      const seen = new Set(flatItems.map((item: Unstable_TriggerItem) => item.id));
      return [
        ...flatItems,
        ...toolItems.filter((item: Unstable_TriggerItem) => !seen.has(item.id)),
      ];
    };

    return {
      categories: (): readonly Unstable_TriggerCategory[] => [],
      categoryItems: () => [],
      search: (query: string): readonly Unstable_TriggerItem[] => {
        const lower = query.toLowerCase();
        return getFlatPool().filter((item) => matchesQuery(item, lower));
      },
    };
  }, [aui, items, categories, wantsTools, toolsConfig]);

  const directive = useMemo(
    () => ({
      formatter: formatter ?? unstable_defaultDirectiveFormatter,
      ...(onInserted ? { onInserted } : {}),
    }),
    [formatter, onInserted],
  );

  return {
    adapter,
    directive,
    ...(options?.iconMap ? { iconMap: options.iconMap } : {}),
    ...(options?.fallbackIcon ? { fallbackIcon: options.fallbackIcon } : {}),
  };
};

// NOTE: the installed unstable_useSlashCommandAdapter already returns the
// full `{ adapter, action }` bundle — delegate straight through instead of
// re-wrapping (double-wrapping produced an invalid nested adapter whose
// `onExecute` could never fire).
export const useUnstableSlashCommandAdapter = (options: any) =>
  RealAssistantUI.unstable_useSlashCommandAdapter(options);

export type Unstable_SlashCommand = {
  id: string;
  description?: string;
  icon?: string;
  execute: (item: any) => void;
};

function toTriggerItem(item: Unstable_Mention): Unstable_TriggerItem {
  const metadata =
    item.icon !== undefined ? { ...(item.metadata ?? {}), icon: item.icon } : item.metadata;

  return {
    id: item.id,
    type: item.type,
    label: item.label,
    ...(item.description !== undefined ? { description: item.description } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function matchesQuery(item: Unstable_TriggerItem, lower: string): boolean {
  if (!lower) return true;
  if (item.id.toLowerCase().includes(lower)) return true;
  if (item.label.toLowerCase().includes(lower)) return true;
  if (item.description?.toLowerCase().includes(lower)) return true;
  return false;
}
