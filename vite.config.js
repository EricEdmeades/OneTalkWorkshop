import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default {
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        stories: resolve(__dirname, 'stories.html'),
        register: resolve(__dirname, 'register.html'),
        survey: resolve(__dirname, 'survey.html'),
        solOptin: resolve(__dirname, 'said-out-loud/index.html'),
        solThanks: resolve(__dirname, 'said-out-loud/thanks.html'),
        solDownload: resolve(__dirname, 'said-out-loud/download.html'),
      },
    },
  },
};
