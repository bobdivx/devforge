module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        message: [
          "python -m pip install --upgrade pip",
          "pip install \"litellm[proxy]>=1.97.0\"",
        ].join(" && "),
      },
    },
    {
      method: "log",
      params: {
        text: "LiteLLM installé. Vérifiez litellm-config.yaml puis lancez Start.",
      },
    },
  ],
};
