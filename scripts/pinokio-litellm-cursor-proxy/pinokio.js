module.exports = {
  title: "LiteLLM Cursor Proxy",
  description: "Proxy pour Cursor Agent (route /cursor) vers llama-server local sur Demeter",
  icon: "icon.png",
  menu: async (kernel, info) => {
    const installed = info.exists("env/Scripts/litellm.exe") || info.exists("env/bin/litellm");
    const running = info.running("start.js");
    const ready = info.ready("start.js");

    if (installed) {
      if (ready) {
        return [{
          default: !running,
          icon: "fa-solid fa-play",
          text: running ? "Running" : "Start",
          href: "start.js",
        }, {
          icon: "fa-solid fa-globe",
          text: "Open Health",
          href: "http://127.0.0.1:4000/health/liveliness",
          target: "_blank",
        }, {
          icon: "fa-solid fa-rotate",
          text: "Reinstall",
          href: "install.js",
        }];
      }

      return [{
        default: true,
        icon: "fa-solid fa-play",
        text: "Start",
        href: "start.js",
      }, {
        icon: "fa-solid fa-rotate",
        text: "Reinstall",
        href: "install.js",
      }];
    }

    return [{
      default: true,
      icon: "fa-solid fa-download",
      text: "Install",
      href: "install.js",
    }, {
      icon: "fa-solid fa-play",
      text: "Start",
      href: "start.js",
    }];
  },
};
