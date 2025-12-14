import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server:{
    proxy:{
      // все запросы, начинающиеся с /binance, отправлять на backend
      '/binance': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
