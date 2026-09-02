module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        message: "litellm --config \"D:/pinokio/litellm-config.yaml\" --host 0.0.0.0 --port 4000",
        on: [{
          event: "/Application startup complete|Uvicorn running on/i",
          done: true,
        }],
      },
    },
    {
      method: "process.wait",
      params: {
        url: "http://127.0.0.1:4000/health/liveliness",
        interval: 2,
        title: "LiteLLM",
        description: "En attente du proxy sur le port 4000…",
      },
    },
    {
      method: "local.set",
      params: {
        url: "http://127.0.0.1:4000",
        port: 4000,
        config: "D:/pinokio/litellm-config.yaml",
      },
    },
    {
      method: "process.wait",
      params: {
        title: "LiteLLM Cursor Proxy",
        description: "Actif — Cursor → https://agent.briseteia.me/cursor",
      },
    },
  ],
};
