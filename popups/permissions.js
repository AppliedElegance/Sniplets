document.addEventListener("DOMContentLoaded", () => {

  const buttons = document.getElementsByTagName("button");
  Array.from(buttons).forEach((button) => {
    button.disabled = false;
  });

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
    chrome.permissions.request({ origins: origins }, async (granted) => {
      if (granted) {
        const { src } = await getStorageData("src");
        if (src) {
          switch (src.func) {
          case 'snip':
            src.func = getFullSelection;
            break;

          case 'paste':
            src.func = pasteSnippet;
            break;
        
          default:
            close();
          }
          injectScript(src);
        }
        close();
      } else {
        return;
      }
    });
  }, false);

}, false);

document.addEventListener("beforeunload", () => {
  removeStorageData("origins");
  removeStorageData("src");
});