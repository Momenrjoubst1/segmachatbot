/**
 * Fonts Library — مكتبة الخطوط
 *
 * Curated catalog of Google Fonts the chatbot can use when generating
 * HTML / React / SVG / Markdown artifacts. Each entry has:
 *   - family: the CSS font-family value (the value used inside `font-family: ...`)
 *   - weights: list of available font weights from Google Fonts
 *   - category: 'arabic' | 'sans' | 'serif' | 'mono' | 'display' | 'handwriting'
 *   - googleParam: the value used in `family=` inside the Google Fonts URL
 *   - description: short Arabic description so the LLM can pick intelligently
 *
 * To add a font: append it to the right category. The library is exported
 * via `listFonts()`, `resolveFontLinks(names)` and `resolveFontFamily(names)`.
 */

export type FontCategory =
  | 'arabic'
  | 'sans'
  | 'serif'
  | 'mono'
  | 'display'
  | 'handwriting';

export interface FontEntry {
  family: string;          // CSS font-family: 'Cairo', 'Roboto Mono', ...
  category: FontCategory;
  weights: number[];
  googleParam: string;     // `family=Cairo:wght@400;700`
  description: string;     // Arabic description for the LLM prompt
}

export const FONTS: Record<string, FontEntry> = {
  // ---------- Arabic (supports Arabic + Latin glyphs) ----------
  Cairo: {
    family: 'Cairo',
    category: 'arabic',
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    googleParam: 'Cairo:wght@200..900',
    description: 'Cairo — خط عربي حديث وأنيق، مناسب للعناوين والنصوص.',
  },
  'Tajawal': {
    family: 'Tajawal',
    category: 'arabic',
    weights: [200, 300, 400, 500, 700, 800, 900],
    googleParam: 'Tajawal:wght@200;300;400;500;700;800;900',
    description: 'Tajawal — خط عربي نظيف وواضح للقراءة الطويلة.',
  },
  Almarai: {
    family: 'Almarai',
    category: 'arabic',
    weights: [300, 400, 700, 800],
    googleParam: 'Almarai:wght@300;400;700;800',
    description: 'Almarai — خط عربي هندسي حديث.',
  },
  'IBM Plex Sans Arabic': {
    family: 'IBM Plex Sans Arabic',
    category: 'arabic',
    weights: [100, 200, 300, 400, 500, 600, 700],
    googleParam: 'IBM+Plex+Sans+Arabic:wght@100;200;300;400;500;600;700',
    description: 'IBM Plex Sans Arabic — خط عربي احترافي مناسب لواجهات المنتجات.',
  },
  'Noto Sans Arabic': {
    family: 'Noto Sans Arabic',
    category: 'arabic',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    googleParam: 'Noto+Sans+Arabic:wght@100..900',
    description: 'Noto Sans Arabic — خط عربي شامل لكل الأوزان.',
  },
  'Amiri': {
    family: 'Amiri',
    category: 'arabic',
    weights: [400, 700],
    googleParam: 'Amiri:wght@400;700',
    description: 'Amiri — خط عربي كلاسيكي أنيق مستوحى من الخط الديواني.',
  },
  'Scheherazade New': {
    family: 'Scheherazade New',
    category: 'arabic',
    weights: [400, 500, 600, 700],
    googleParam: 'Scheherazade+New:wght@400;500;600;700',
    description: 'Scheherazade New — خط عربي تقليدي مناسب للنصوص الطويلة والكتب.',
  },
  'Lateef': {
    family: 'Lateef',
    category: 'arabic',
    weights: [400, 500, 600, 700],
    googleParam: 'Lateef:wght@400;500;600;700',
    description: 'Lateef — خط عربي ناعم ومقروء.',
  },
  'Reem Kufi': {
    family: 'Reem Kufi',
    category: 'arabic',
    weights: [400, 500, 600, 700],
    googleParam: 'Reem+Kufi:wght@400..700',
    description: 'Reem Kufi — خط عربي معاصر مستوحى من خط الكوفي.',
  },
  'Markazi Text': {
    family: 'Markazi Text',
    category: 'arabic',
    weights: [400, 500, 600, 700],
    googleParam: 'Markazi+Text:wght@400..700',
    description: 'Markazi Text — خط عربي مناسب للعناوين الكبيرة.',
  },

  // ---------- Latin Sans ----------
  Inter: {
    family: 'Inter',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    googleParam: 'Inter:wght@100..900',
    description: 'Inter — خط لاتيني عصري شائع في واجهات الويب.',
  },
  Roboto: {
    family: 'Roboto',
    category: 'sans',
    weights: [100, 300, 400, 500, 700, 900],
    googleParam: 'Roboto:wght@100;300;400;500;700;900',
    description: 'Roboto — خط Google الرسمي للنصوص اللاتينية.',
  },
  Poppins: {
    family: 'Poppins',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    googleParam: 'Poppins:wght@100;200;300;400;500;600;700;800;900',
    description: 'Poppins — خط لاتيني عصري هندسي.',
  },
  Montserrat: {
    family: 'Montserrat',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    googleParam: 'Montserrat:wght@100..900',
    description: 'Montserrat — خط لاتيني أنيق للعناوين.',
  },
  'Open Sans': {
    family: 'Open Sans',
    category: 'sans',
    weights: [300, 400, 500, 600, 700, 800],
    googleParam: 'Open+Sans:wght@300;400;500;600;700;800',
    description: 'Open Sans — خط لاتيني واضح ومقروء.',
  },
  Lato: {
    family: 'Lato',
    category: 'sans',
    weights: [100, 300, 400, 700, 900],
    googleParam: 'Lato:wght@100;300;400;700;900',
    description: 'Lato — خط لاتيني دافئ وأنيق.',
  },
  Nunito: {
    family: 'Nunito',
    category: 'sans',
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    googleParam: 'Nunito:wght@200..900',
    description: 'Nunito — خط لاتيني ناعم مع زوايا مستديرة.',
  },
  'Work Sans': {
    family: 'Work Sans',
    category: 'sans',
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    googleParam: 'Work+Sans:wght@100..900',
    description: 'Work Sans — خط لاتيني مخصص للشاشات.',
  },

  // ---------- Latin Serif ----------
  Merriweather: {
    family: 'Merriweather',
    category: 'serif',
    weights: [300, 400, 700, 900],
    googleParam: 'Merriweather:wght@300;400;700;900',
    description: 'Merriweather — خط لاتيني Serif للقراءة الطويلة.',
  },
  Playfair: {
    family: 'Playfair Display',
    category: 'serif',
    weights: [400, 500, 600, 700, 800, 900],
    googleParam: 'Playfair+Display:wght@400..900',
    description: 'Playfair Display — خط لاتيني Serif فخم للعناوين.',
  },
  Lora: {
    family: 'Lora',
    category: 'serif',
    weights: [400, 500, 600, 700],
    googleParam: 'Lora:wght@400..700',
    description: 'Lora — خط Serif لاتيني دافئ ومتوازن.',
  },
  'PT Serif': {
    family: 'PT Serif',
    category: 'serif',
    weights: [400, 700],
    googleParam: 'PT+Serif:wght@400;700',
    description: 'PT Serif — خط Serif كلاسيكي بسيط.',
  },

  // ---------- Monospace ----------
  'Roboto Mono': {
    family: 'Roboto Mono',
    category: 'mono',
    weights: [100, 200, 300, 400, 500, 600, 700],
    googleParam: 'Roboto+Mono:wght@100..700',
    description: 'Roboto Mono — خط Monospace ممتاز للأكواد.',
  },
  'JetBrains Mono': {
    family: 'JetBrains Mono',
    category: 'mono',
    weights: [100, 200, 300, 400, 500, 600, 700, 800],
    googleParam: 'JetBrains+Mono:wght@100..800',
    description: 'JetBrains Mono — خط Monospace مصمم خصيصاً للمطورين.',
  },
  'Fira Code': {
    family: 'Fira Code',
    category: 'mono',
    weights: [300, 400, 500, 600, 700],
    googleParam: 'Fira+Code:wght@300;400;500;600;700',
    description: 'Fira Code — خط Monospace مع Ligatures للأكواد.',
  },
  'Source Code Pro': {
    family: 'Source Code Pro',
    category: 'mono',
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    googleParam: 'Source+Code+Pro:wght@200..900',
    description: 'Source Code Pro — خط Monospace احترافي من Adobe.',
  },
  'IBM Plex Mono': {
    family: 'IBM Plex Mono',
    category: 'mono',
    weights: [100, 200, 300, 400, 500, 600, 700],
    googleParam: 'IBM+Plex+Mono:wght@100;200;300;400;500;600;700',
    description: 'IBM Plex Mono — خط Monospace هندسي من IBM.',
  },

  // ---------- Display / Decorative ----------
  Bebas: {
    family: 'Bebas Neue',
    category: 'display',
    weights: [400],
    googleParam: 'Bebas+Neue',
    description: 'Bebas Neue — خط Display لاتيني قوي للعناوين الضخمة.',
  },
  Oswald: {
    family: 'Oswald',
    category: 'display',
    weights: [200, 300, 400, 500, 600, 700],
    googleParam: 'Oswald:wght@200..700',
    description: 'Oswald — خط Display لاتيني مكثف.',
  },
  Anton: {
    family: 'Anton',
    category: 'display',
    weights: [400],
    googleParam: 'Anton',
    description: 'Anton — خط Display لاتيني ثقيل وملفت.',
  },
  Abril: {
    family: 'Abril Fatface',
    category: 'display',
    weights: [400],
    googleParam: 'Abril+Fatface',
    description: 'Abril Fatface — خط Display Serif فخم وفني.',
  },
  Lobster: {
    family: 'Lobster',
    category: 'display',
    weights: [400],
    googleParam: 'Lobster',
    description: 'Lobster — خط Display Script لافت.',
  },

  // ---------- Handwriting ----------
  Caveat: {
    family: 'Caveat',
    category: 'handwriting',
    weights: [400, 500, 600, 700],
    googleParam: 'Caveat:wght@400..700',
    description: 'Caveat — خط يدوي عفوي.',
  },
  Pacifico: {
    family: 'Pacifico',
    category: 'handwriting',
    weights: [400],
    googleParam: 'Pacifico',
    description: 'Pacifico — خط يدوي مرح.',
  },
  Dancing: {
    family: 'Dancing Script',
    category: 'handwriting',
    weights: [400, 500, 600, 700],
    googleParam: 'Dancing+Script:wght@400..700',
    description: 'Dancing Script — خط يدوي أنيق.',
  },
  Shadows: {
    family: 'Shadows Into Light',
    category: 'handwriting',
    weights: [400],
    googleParam: 'Shadows+Into+Light',
    description: 'Shadows Into Light — خط يدوي بنمط دفتر ملاحظات.',
  },
};

/** Map of common aliases → canonical family name. */
const ALIASES: Record<string, string> = {
  'playfair': 'Playfair',
  'playfair display': 'Playfair',
  'ibm plex sans arabic': 'IBM Plex Sans Arabic',
  'ibm sans arabic': 'IBM Plex Sans Arabic',
  'noto sans arabic': 'Noto Sans Arabic',
  'noto arabic': 'Noto Sans Arabic',
  'jetbrains': 'JetBrains Mono',
  'jetbrains mono': 'JetBrains Mono',
  'fira': 'Fira Code',
  'fira mono': 'Fira Code',
  'dancing script': 'Dancing',
  'bebas neue': 'Bebas',
  'abril fatface': 'Abril',
  'pt serif': 'PT Serif',
  'work sans': 'Work Sans',
  'shadows into light': 'Shadows',
  'roboto mono': 'Roboto Mono',
  'source code pro': 'Source Code Pro',
  'ibm plex mono': 'IBM Plex Mono',
  'reem kufi': 'Reem Kufi',
  'markazi text': 'Markazi Text',
  'scheherazade new': 'Scheherazade New',
};

/** Resolve a user-provided name (case-insensitive, alias-aware) to the canonical key. */
export function resolveFontKey(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (FONTS[trimmed]) return trimmed;
  const lower = trimmed.toLowerCase();
  if (FONTS[lower]) return lower;
  if (ALIASES[lower]) return ALIASES[lower];
  // Try lowercase comparison against family values
  for (const key of Object.keys(FONTS)) {
    if (key.toLowerCase() === lower) return key;
    if (FONTS[key].family.toLowerCase() === lower) return key;
  }
  return null;
}

/**
 * Resolve an array of font names into a deduplicated list of valid Google Fonts
 * family= params (joined for a single <link> tag).
 *
 * Returns:
 *   - linkHref: the full `href` to use in `<link rel="stylesheet" href="...">`
 *   - familyStack: a CSS `font-family` stack the bot can put directly in styles
 *   - names: the canonical font keys actually used
 *   - missing: requested names that could not be resolved
 */
export interface ResolveFontsResult {
  linkHref: string;
  familyStack: string;
  names: string[];
  missing: string[];
  categories: FontCategory[];
}

export function resolveFontLinks(names: string[]): ResolveFontsResult {
  const resolved: { key: string; entry: FontEntry }[] = [];
  const missing: string[] = [];

  for (const raw of names || []) {
    const key = resolveFontKey(raw);
    if (!key) {
      missing.push(raw);
      continue;
    }
    if (!resolved.find((r) => r.key === key)) {
      resolved.push({ key, entry: FONTS[key] });
    }
  }

  const linkHref = resolved.length
    ? `https://fonts.googleapis.com/css2?${resolved
        .map(({ entry }) => `family=${entry.googleParam}`)
        .join('&')}&display=swap`
    : '';

  const familyStack = resolved.length
    ? resolved.map(({ entry }) => `'${entry.family}'`).join(', ') + ', system-ui, sans-serif'
    : '';

  return {
    linkHref,
    familyStack,
    names: resolved.map(({ key }) => key),
    missing,
    categories: [...new Set(resolved.map(({ entry }) => entry.category))],
  };
}

/** List all fonts as a short description block (for LLM prompt injection). */
export function listFonts(): { count: number; byCategory: Record<FontCategory, string[]> } {
  const byCategory: Record<FontCategory, string[]> = {
    arabic: [],
    sans: [],
    serif: [],
    mono: [],
    display: [],
    handwriting: [],
  };
  for (const [key, entry] of Object.entries(FONTS)) {
    byCategory[entry.category].push(`${entry.family} (${key})`);
  }
  return { count: Object.keys(FONTS).length, byCategory };
}

/** Build a compact prompt-friendly block describing the available fonts. */
export function buildFontsCatalogPrompt(): string {
  const { count, byCategory } = listFonts();
  const lines: string[] = [
    `# مكتبة الخطوط المتاحة (${count} خط)`,
    'يمكنك استخدام هذه الخطوط في HTML/React/SVG artifacts عبر تمرير `fonts: [...]` إلى create_artifact.',
    'كل خط له مفتاح (key) تستخدمه في `fonts`، وقيمة `family` تستخدمها في CSS.',
  ];
  for (const cat of Object.keys(byCategory) as FontCategory[]) {
    const items = byCategory[cat];
    if (!items.length) continue;
    lines.push(`\n## ${cat} (${items.length})\n- ${items.join('\n- ')}`);
  }
  return lines.join('\n');
}

/**
 * Inject the Google Fonts <link> tag into an HTML document if it isn't there yet.
 * Works on full documents and fragments. Adds a default body font-family if provided.
 */
export function injectFontsIntoHtml(html: string, names: string[], bodyFontFamily?: string): string {
  const { linkHref, familyStack } = resolveFontLinks(names);
  if (!linkHref) return html;

  const isFullDoc = /<!doctype html|<html[\s>]/i.test(html);

  if (isFullDoc) {
    // Already a full document — only inject the link tag if missing.
    if (/<link[^>]*fonts\.googleapis\.com/i.test(html)) {
      return html;
    }
    const inject = `\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${linkHref}">`;
    if (/<head[\s>]/i.test(html)) {
      return html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${inject}`);
    }
    return `<head>${inject}</head>${html}`;
  }

  // Fragment — wrap into a styled HTML document.
  const finalFamily = bodyFontFamily || familyStack || 'system-ui, sans-serif';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="${linkHref}">
    <style>
      body {
        margin: 0;
        padding: 24px;
        background: #1e1e2e;
        color: #e0e0e0;
        font-family: ${finalFamily};
      }
    </style>
  </head>
  <body>${html}</body>
</html>`;
}
