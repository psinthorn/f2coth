// Next 16 removed the `next lint` subcommand; lint via the ESLint CLI. Next 16's
// eslint-config-next ships a native ESLint flat-config array, so it composes
// directly — the same rule set `next lint` used before.
import next from "eslint-config-next";

export default [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**"] },
  ...next,
  {
    // eslint-config-next 16 pulls in the newer eslint-plugin-react-hooks, which
    // promotes several React-Compiler-era rules to errors. This codebase predates
    // them (e.g. setState-in-effect with a `cancelled` guard is used widely and is
    // valid), so keep them as warnings — matching the strictness the check had
    // before the Next 16 upgrade — rather than refactoring ~55 call sites here.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
];
