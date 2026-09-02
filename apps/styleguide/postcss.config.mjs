import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export { default } from "../../packages/config/postcss.config.mjs";
