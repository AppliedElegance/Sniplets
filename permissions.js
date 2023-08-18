/* global getStorageData */
document.addEventListener('click', async (event) => {
  if (event.target.tagName.toUpperCase() != "BUTTON") return;
  let origins;
  switch (event.target.dataset.target) {
  case "this": {
    const details = await getStorageData("origins");
    if (!details) return;
    origins = details.origins;
    // removeStorageData("origins");
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