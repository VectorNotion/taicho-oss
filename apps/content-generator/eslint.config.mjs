import baseConfig from "../../packages/config/eslint.config.mjs";

export default [
  ...baseConfig,
  {
    files: ["app/**/*.tsx"],
    rules: {
      // This legacy dashboard loads remote data from effects throughout. Keep
      // the broader lint gate active while those screens migrate incrementally.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
