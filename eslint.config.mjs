import js from "@eslint/js";
import next from "@next/eslint-plugin-next";
import prettierConfig from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            ".next/**",
            "dist/**",
            "coverage/**",
            "playwright-report/**",
            "test-results/**",
            "node_modules/**",
            "next-env.d.ts",
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
            globals: { ...globals.browser, ...globals.node },
        },
    },
    {
        files: ["**/*.{ts,tsx}"],
        plugins: {
            "react-hooks": reactHooks,
            "@next/next": next,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            ...next.configs.recommended.rules,
            ...next.configs["core-web-vitals"].rules,
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
        // The Workbench must never render a fixture as an answer (CHAOS-3738).
        // Fixtures live under src/test and are for tests only; this makes an
        // accidental import from app, component, or lib code a lint error
        // rather than something a reviewer has to catch.
        files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["@/test/*", "@/test/**", "**/test/fixtures/*"],
                            message:
                                "Test fixtures must never reach product code. The Workbench renders only real ACR results (CHAOS-3738).",
                        },
                    ],
                },
            ],
        },
    },
    {
        // .mjs/.js config files are not in tsconfig's project graph, so the
        // type-aware rules have no type information for them and would fail to
        // parse.
        files: ["**/*.mjs", "*.js"],
        ...tseslint.configs.disableTypeChecked,
    },
    prettierConfig,
);
