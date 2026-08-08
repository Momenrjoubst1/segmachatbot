import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "import-x": importX,
    },
    rules: {
      "import-x/first": "error",
    },
  },
  {
    ignores: ["node_modules/**", "dist/**"],
  },
);
