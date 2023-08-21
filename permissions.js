/* global getStorageData removeStorageData */
document.addEventListener("click", async (event) => {
  if (event.target.tagName.toUpperCase() != "BUTTON") return;
  let origins;
  switch (event.target.dataset.target) {
  case "this": {
    const data = await getStorageData("origins");
    if (!data) return;
    origins = data.origins;
    break; }
  case "all":
    origins = ["<all_urls>"];
    break;
  default:
    break;
  }
  if (!origins) return;
  chrome.permissions.request({ origins: origins }, (granted) => {
    if (granted) {
      close();
    } else {
      return;
    }
  });
}, false);

document.addEventListener("DOMContentLoaded", () => {
  const buttons = document.getElementsByTagName("button");
  Array.from(buttons).forEach((button) => {
    button.disabled = false;
  });
}, false);

document.addEventListener("beforeunload", () => {
  removeStorageData("origins");
});