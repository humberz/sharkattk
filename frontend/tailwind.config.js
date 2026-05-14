/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        vsc: {
          // VS Code Dark+ palette
          bg:        '#1e1e1e',   // editor background
          sidebar:   '#252526',   // sidebar / activity bar
          panel:     '#2d2d2d',   // panels, hover
          border:    '#3c3c3c',   // borders / separators
          input:     '#3c3c3c',   // input background
          selection: '#264f78',   // selection highlight
          text:      '#d4d4d4',   // primary text
          muted:     '#858585',   // comments / secondary
          blue:      '#007acc',   // accent / links
          lightblue: '#4fc1ff',   // variables
          green:     '#4ec9b0',   // types / success
          yellow:    '#dcdcaa',   // functions / warning
          orange:    '#ce9178',   // strings
          red:       '#f44747',   // errors
        },
      },
    },
  },
  plugins: [],
}
