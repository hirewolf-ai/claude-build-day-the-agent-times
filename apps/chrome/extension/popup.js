const dot = document.getElementById("status-dot");
const btn = document.getElementById("connect-btn");

function render(connected) {
  if (connected) {
    dot.classList.add("is-active");
    dot.title = "Active";
    btn.textContent = "Disconnect";
    btn.className = "btn btn-danger";
  } else {
    dot.classList.remove("is-active");
    dot.title = "Inactive";
    btn.textContent = "Connect";
    btn.className = "btn btn-primary";
  }
}

async function init() {
  const { connected = false } = await chrome.storage.local.get("connected");
  render(connected);
  const { version } = chrome.runtime.getManifest();
  document.getElementById("version").textContent = `v${version}`;
}

btn.addEventListener("click", async () => {
  const { connected = false } = await chrome.storage.local.get("connected");
  const next = !connected;
  await chrome.storage.local.set({ connected: next });
  render(next);
  chrome.runtime.sendMessage({ type: "wolf.setConnected", connected: next });
});

init();
