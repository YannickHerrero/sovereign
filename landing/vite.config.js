import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  appType: "mpa",
  build: {
    rolldownOptions: {
      input: {
        en: fileURLToPath(new URL("./index.html", import.meta.url)),
        fr: fileURLToPath(new URL("./fr/index.html", import.meta.url)),
      },
    },
  },
});
