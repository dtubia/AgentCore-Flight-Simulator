/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        console: {
          bg: "#080b10",
          panel: "#10151d",
          panel2: "#141b25",
          rail: "#0c1118",
          line: "#263142",
          text: "#d7dee9",
          muted: "#7f8da3",
          cyan: "#39c5bb",
          amber: "#f4b454",
          red: "#ff6b6b",
          green: "#62d18f",
          blue: "#7aa8ff"
        }
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Cascadia Mono", "Consolas", "monospace"],
        sans: ["Inter", "Segoe UI", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
