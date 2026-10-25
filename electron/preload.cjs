const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("tofu", {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  updateProfile: (patch) => ipcRenderer.invoke("profile:update", patch),
  updatePrefs: (patch) => ipcRenderer.invoke("prefs:update", patch),
  care: (action) => ipcRenderer.invoke("care:do", action),

  openSettings: () => ipcRenderer.invoke("app:open-settings"),
  closeSettings: () => ipcRenderer.invoke("app:close-settings"),
  minimizeSettings: () => ipcRenderer.invoke("app:minimize-settings"),
  hidePet: () => ipcRenderer.invoke("app:hide-pet"),
  quit: () => ipcRenderer.invoke("app:quit"),

  resetPosition: () => ipcRenderer.invoke("app:reset-position"),
  resetCare: () => ipcRenderer.invoke("app:reset-care"),
  showPet: () => ipcRenderer.invoke("app:show-pet"),

  showContextMenu: () => ipcRenderer.invoke("app:show-context-menu"),
  copyText: (text) => ipcRenderer.invoke("app:copy-text", text),
  demo: (kind) => ipcRenderer.invoke("app:demo", kind),
  markOnboardingSeen: () => ipcRenderer.invoke("app:mark-onboarding"),

  dragStart: () => ipcRenderer.invoke("app:drag-start"),
  dragEnd: () => ipcRenderer.invoke("app:drag-end"),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke("app:set-ignore-mouse", ignore),
  setBubbleVisible: (visible) => ipcRenderer.invoke("app:bubble-visible", visible),

  onState: (callback) => subscribe("tofu:state", callback),
  onAgent: (callback) => subscribe("tofu:agent", callback),
  onCommand: (callback) => subscribe("tofu:command", callback),
});
