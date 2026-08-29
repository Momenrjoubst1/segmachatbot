import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      "/api": {
        target: "http://localhost:3004",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          'react-vendor': ['react', 'react-dom'],
          // Router
          'router': ['react-router-dom'],
          // UI libraries
          'assistant-ui': [
            '@assistant-ui/react',
            '@assistant-ui/react-ai-sdk',
            '@assistant-ui/react-markdown',
            '@assistant-ui/react-lexical',
            '@assistant-ui/core',
            '@assistant-ui/store',
          ],
          // Animation
          'animation': ['framer-motion'],
          // Internationalization
          'i18n': ['i18next', 'react-i18next'],
          // Markdown & Code
          'markdown': ['react-markdown', 'remark-gfm', 'rehype-katex'],
          // Syntax highlighting
          // State management
          'state': ['zustand'],
          // Utilities
          'utils': ['clsx', 'tailwind-merge', 'date-fns'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
