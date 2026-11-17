/** Tailwind 预编译配置：build.mjs 通过环境变量 QMS_CONTENT 传入要扫描的源码目录 */
const content = process.env.QMS_CONTENT ? JSON.parse(process.env.QMS_CONTENT) : ['./src/**/*.{js,html}'];

module.exports = {
  content,
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef5ff', 100: '#d9e8ff', 200: '#bcd6ff', 300: '#8ebcff', 400: '#5996ff', 500: '#3478f6', 600: '#1f63e0', 700: '#1a4fb8', 800: '#1b4392', 900: '#1c3a74' },
        ink: { DEFAULT: '#1d1d1f', 2: '#424245', 3: '#6e6e73', 4: '#86868b', 5: '#aeaeb2' },
        canvas: '#f5f5f7',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"PingFang SC"', '"Hiragino Sans GB"', '"Microsoft YaHei"', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"SF Mono"', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.04)',
        lift: '0 2px 6px rgba(0,0,0,.05), 0 18px 40px rgba(0,0,0,.08)',
        pop: '0 24px 64px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.08)',
      },
      transitionTimingFunction: {
        apple: 'cubic-bezier(.32,.72,0,1)',
        spring: 'cubic-bezier(.34,1.56,.64,1)',
      },
    },
  },
  plugins: [],
};
