import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import commonjs from '@rollup/plugin-commonjs'

/*
 * 主进程与预加载脚本以 CommonJS 源码编写，使用 @rollup/plugin-commonjs
 * 把 require() 追踪进 bundle，避免官方产物只保留一个入口文件。
 */
const commonjsSource = () => commonjs({
  include: [/src[\\/]main[\\/]/, /src[\\/]preload[\\/]/],
  transformMixedEsModules: true,
})

const EXTERNAL_BINARIES = ['ffmpeg-static', '@ffprobe-installer/ffprobe']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ include: EXTERNAL_BINARIES }), commonjsSource()],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ include: EXTERNAL_BINARIES }), commonjsSource()],
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [vue()],
  },
})
