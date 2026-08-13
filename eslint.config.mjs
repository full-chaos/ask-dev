import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "dist/**",
            "coverage/**",
            "playwright-report/**",
            "test-results/**",
            "node_modules/**",
            // Generated from the pinned acr contracts. Never hand-edited, so
            // never linted: the sync script is the only author.
            "src/contracts/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: globals.browser,
        },
    },
    {
        files: ["**/*.{ts,tsx}"],
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
            // Mirror dev-health-web: honor the `_` prefix for deliberately
            // unused bindings, and never let an error be swallowed silently.
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "no-restricted-syntax": [
                "error",
                {
                    selector:
                        "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression.arguments:first-child[body.type='Literal'][body.value=null]",
                    message: "Silent .catch(() => null) swallows errors. Log the error explicitly.",
                },
                {
                    selector:
                        "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression.arguments:first-child[body.type='BlockStatement'][body.body.length=0]",
                    message: "Empty .catch(() => {}) swallows errors. Log the error explicitly.",
                },
            ],
        },
    },
    {
        files: ["*.config.ts", "*.config.mjs", "scripts/**/*.mjs", "tests/**/*.ts"],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        // .mjs files are not in tsconfig's project graph, so the type-aware
        // rules have no type information for them and would fail to parse.
        files: ["**/*.mjs"],
        ...tseslint.configs.disableTypeChecked,
    },
    prettierConfig,
);
