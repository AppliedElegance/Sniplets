const snip = window.opener.snip;
const form = document.getElementById('fields');
console.log(form);

if (snip?.hasCustomFields) {

  // TODO: replace modal with popup so the selection won't lose focus
  // // process custom fields
  // const params = {};
  // // get custom parameters, all builtins should already be replaced
  // for (let match of text.matchAll(/\$\[(.+?)(?:\{(.+?)\})?\]/g)) {
  //   if (match[1] in params) continue;
  //   if (match[2]) {
  //     const defs = match[2].split("|");
  //     params[match[1]] = defs;
  //   } else {
  //     params[match[1]] = [""];
  //   }
  // }
  // if (!nosubst && (params !== {})) {
  //   // generate modal for getting values
  //   const modal = document.createElement("div");
  //   modal.style.zIndex = "9999";
  //   modal.style.position = "fixed";
  //   modal.style.top = "0";
  //   modal.style.left = "0";
  //   modal.style.width = "100vw";
  //   modal.style.height = "100vh";
  //   modal.style.transition = "all 0.3s ease";
  //   modal.style.display = "flex";
  //   modal.style.alignItems = "center";
  //   modal.style.justifyContent = "center";
  //   const modalBg = document.createElement("div");
  //   modalBg.style.cssText = "position: absolute; width: 100%; height: 100%; background: black;";
  //   modal.appendChild(modalBg);
  //   const modalCard = document.createElement("div");
  //   modalCard.style.cssText = "position: relative; border-radius: 10px; background: #fff; padding: 30px;";
  //   const modalParams = [];
  //   for (let param in params) {
  //     const modalParam = document.createElement("div");
  //     const modalLabel = document.createElement("label");
  //     modalLabel.htmlFor = "snippets-" + param;
  //     modalLabel.appendChild(document.createTextNode(param));
  //     modalLabel.style.display = "inline-block";
  //     modalLabel.style.width = "100px";
  //     modalParam.appendChild(modalLabel);
  //     let modalInput;
  //     if (params[param].length > 1) {
  //       modalInput = document.createElement("select");
  //       params[param].forEach((value) => {
  //         modalInput.add(new Option(value, value));
  //       })
  //     } else {
  //       modalInput = document.createElement("input");
  //       modalInput.value = params[param][0] || "";
  //     }
  //     modalInput.name = "snippets-" + param;
  //     modalInput.id = "snippets-" + param;
  //     modalInput.style.width = "300px";
  //     modalParam.appendChild(modalInput);
  //     modalCard.appendChild(modalParam);
  //     // save for retrieving values
  //     modalParams.push(modalParam);
  //   }
  //   const modalActions = document.createElement("div");
  //   modalActions.style.textAlign = "right";
  //   const modalCancel = document.createElement("button");
  //   modalCancel.appendChild(document.createTextNode("Cancel"));
  //   modalCancel.style.width = "100px";
  //   modalCancel.addEventListener('click', () => {
  //     modal.remove();
  //   });
  //   modalActions.appendChild(modalCancel);
  //   modalActions.appendChild(document.createTextNode(" "));
  //   const modalSubmit = document.createElement("button");
  //   modalSubmit.appendChild(document.createTextNode("Submit"));
  //   modalSubmit.style.width = "100px";
  //   modalSubmit.addEventListener('click', () => {
  //     // retrieve values
  //     modalParams.forEach((element) => {
  //       const input = element.lastChild;
  //       params[input.id.slice(9)] = input.value;
  //     });
  //     text = text.replaceAll(/\$\[(.+?)(?:\{.+?\})?\]/g, (match, p1) => {
  //       return params[p1];
  //     });
  //     // complete paste action and remove modal
  //     paste(text);
  //     modal.remove();
  //   });
  //   modalActions.appendChild(modalSubmit);
  //   modalCard.appendChild(modalActions);
  //   modal.appendChild(modalCard);
  //   document.body.appendChild(modal);
  //   return;
  // }
}