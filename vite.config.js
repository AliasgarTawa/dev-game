import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: { port: Number(env.PORT) || 3000 },
    build: {
      rolldownOptions: {
        input: { main: 'index.html', rootsAudio: 'roots-audio.html' },
      },
    },
  };
});
