const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");
const path = require("path");

module.exports = defineConfig({
  root: __dirname,
  plugins: [react()],
  publicDir: path.resolve(__dirname, "public"),
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
