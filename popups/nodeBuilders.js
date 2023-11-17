/* Helpers for building and manipulating the DOM */
/* eslint-disable no-unused-vars */

/**
 * DOM helper for element creation including sub-elements
 * @param {string} tagName 
 * @param {Object} attributes
 */
function buildNode(tagName, attributes) {
  const element = document.createElement(tagName);

  for (let a in attributes) {
    // ignores falsy values
    if (!attributes[a]) continue;
    switch (a) {
    case 'children': { // append any valid nodes
      const children = attributes.children.filter((e) => e);
      if (children.length) element.append(...children);
      break; }
    
    case 'dataset': // append `data-*` attributes
      for (let key in attributes.dataset) {
        element.dataset[key] = attributes.dataset[key];
      }
      break;

    case 'classList': // append classes
      element.classList.add(...attributes.classList);
      break;

    case 'style': // append inline styles
      if (typeof attributes.style === 'string') {
        element.style.cssText = attributes.style;
      } else {
        for (let key in attributes.style) {
          element.style[key] = attributes.style[key];
        }
      }
      break;

    case 'textContent': // add text content within tag (should not be used along with children)
      element.textContent = attributes.textContent;
      break;
    
    case 'events': // attach event listeners directly to element
      for (let e of attributes.events) {
        element.addEventListener(e.type, e.listener, e.options || false);
      }
      break;
  
    default: // assume remaining attributes can be set directly
      element.setAttribute(a, (attributes[a] === true) ? `` : attributes[a]);
    }
  }
  return element;
}

/**
 * Accessible SVG element builder
 * @param {string} title - Accessible descriptor
 * @param {string} sprite - Name of sprite as found in spritesheet
 * @param {string} fill - Optional fill color to apply to the sprite
 * @returns 
 */
function buildSvg(title, sprite, fill) {
  // Create inline SVG element with the correct namespace
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', `img`);
  svg.setAttribute('focusable', false);
  // Add an acessible title field for screenreaders
  const svgTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  svgTitle.textContent = title;
  // Add a use element referencing the spritesheet
  const svgUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svgUse.setAttribute('href', `sprites.svg#${ sprite }`);
  // Set the sprite colour if requested
  if (fill) svgUse.setAttribute('fill', fill);
  // Append the title and sprite to the SVG element
  svg.append(svgTitle, svgUse);
  // return the completed SVG element
  return svg;
}

/**
 * Replace the sprite of a contained icon
 * @param {HTMLElement} target - Element containing the icon's `use` tag
 * @param {string} sprite - Name of the sprite
 */
function setSvgSprite(target, sprite) {
  target.querySelector('use').setAttribute('href', `sprites.svg#${ sprite }`);
}

/**
 * Replace the fill color of a contained icon
 * @param {HTMLElement} target - Element containing the icon's `use` tag
 * @param {string} fill - color to use for the icon
 */
function setSvgFill(target, fill) {
  target.querySelector('use').setAttribute('fill', fill);
}

/**
 * Toggle checked state of a control's SVG icon
 * @param {SVGUseElement} useNode - the `use` element of the SVG icon
 * @param {boolean} [check] - optional force option
 */
function toggleChecked(useNode, check) {
  const sprite = useNode.href.baseVal;
  const isChecked = sprite.slice(-8) === `-checked`;
  if (isChecked === check) return;
  useNode.setAttribute('href', (isChecked) ? sprite.slice(0, -8) : `${ sprite }-checked`);
}

/**
 * Builder for popover menus with an icon
 * @param {string} id 
 * @param {string} sprite 
 * @param {HTMLElement[]} list 
 */
function buildPopoverMenu(id, sprite, color, list) {
  return buildNode('div', {
    classList: [`menu`],
    children: [
      buildActionIcon(`Open ${ id } Menu`, sprite, color, {
        action: `open-popover`,
        target: id,
      }),
      buildNode('div', {
        id: id,
        classList: [`card`, `menu-list`, `popover`, `hidden`],
        children: list,
      }),
    ],
  });
}

/**
 * Build a clickable menu item
 * @param {string} name - Name to display
 * @param {Object} dataset - Should include an action and any related properties
 */
function buildMenuItem(name, dataset) {
  return buildNode('p', {
    classList: [`menu-item`],
    children: [buildNode('button', {
      type: `button`,
      dataset: dataset,
      textContent: name,
    })],
  });
}

function buildMenuSeparator() {
  return buildNode('p', {
    classList: [`menu-item`],
    children: [buildNode('hr')],
  });
}

/**
 * Submenu builder
 * @param {string} name - Menu name, will be postpended with `…`
 * @param {HTMLElement[]} items - Submenu items
 */
function buildSubMenu(name, id, items) {
  // don't build empty menus
  if (!items?.length) return;
  return buildNode('fieldset', {
    classList: [`menu-item`],
    children: [
      buildNode('legend', {
        children: [buildNode('button', {
          type: `button`,
          textContent: `${ name }…`,
          dataset: {
            action: `open-submenu`,
            target: id,
          },
        })],
      }),
      buildNode('div', {
        id: id,
        classList: [`card`, `menu-list`, `hidden`],
        children: items,
      }),
    ],
  });
}

/**
 * Menu item builder for checkbox and radio controls
 * @param {string} type - Input type (`checkbox`|`radio`)
 * @param {string} value - Value sent when checked
 * @param {{
 *   name: string
 *   id: string
 *   dataset: Object
 *   checked: boolean
 * }} attributes - At least one of id or dataset?.action is required
 */
function buildMenuControl(type, value, { name, id, dataset, checked }) {
  if (![`checkbox`, `radio`].includes(type)) return;
  return buildNode('p', {
    classList: [`menu-item`, `control`],
    children: [
      buildNode(`input`, {
        type: type,
        name: name || id || dataset?.action,
        id: id || dataset?.action,
        value: value,
        checked: checked,
        dataset: dataset,
        display: `none`,
      }),
      buildNode('label', {
        for: id || dataset?.action,
        tabindex: `0`,
        children: [
          buildNode('div', {
            classList: [`icon`],
            children: [buildSvg(
              value,
              `control-${ type }${ (checked) ? `-checked` : `` }`,
            )],
          }),
          buildNode('h3', { textContent: value }),
        ],
      }),
    ],
  });
}

function buildActionIcon(name, sprite, color, dataset) {
  return buildNode('button', {
    type: `button`,
    classList: [`icon`],
    dataset: dataset,
    children: [buildSvg(
      name,
      sprite,
      color,
    )],
  });
}

/**
 * Builder for TreeItem widgets depending on their extended class
 * @param {TreeItem} item - Folder or Snippet
 * @param {TreeItem[]} list - Folder list which includes `item`, for calculating dropzone targets
 * @returns {HTMLElement[]}
 */
function buildItemWidget(item, list, path, settings) {
  const index = list.indexOf(item);
  if (index < 0) return;
  const widget = [];
  const isFolder = item instanceof Folder;
  const isSnippet = item instanceof Snippet;

  // widget menu
  const widgetMenu = buildPopoverMenu(
    `item-menu-${ item.seq }`,
    `icon-${ item.constructor.name.toLowerCase() }`,
    colors[item.color]?.value || `inherit`,
    [
      buildSubMenu(`Colour`, `item-${ item.seq }-color-menu`, Object.keys(colors).map((color, i) =>
        buildMenuControl('radio', color, {
          name: `item-${ item.seq }-color`,
          id: `item-${ item.seq }-color-${ i }`,
          dataset: {
            action: `edit`,
            seq: item.seq,
            field: `color`,
          },
          checked: ((color === item.color) || ((color === "Default") && !item.color)),
        }),
      )),
      buildSubMenu(`Move`, `item-${ item.seq }-move-menu`, list.reduce((a, o, i) => {
        const l = list.length - 1;
        const b = (direction) => buildMenuItem(direction, {
          action: `move`,
          seq: item.seq,
          target: o.seq,
        });
        if (i === (index - 1)) {
          a.push(b(`Up`));
        } else if (i === (index + 1)) {
          a.push(b(`Down`));
        } else if (i === 0 && l > 1 && item.seq > list[1].seq) {
          a.push(b(`To Top`));
        } else if (i === l && l > 1 && item.seq < list[l-1].seq) {
          a.push(b(`To Bottom`));
        }
        return a;
      }, [])),
    ],
  );

  // only folders can be 'opened'
  const widgetTitle = buildNode('input', {
    type: (isFolder) ? `button` : `text`,
    value: item.name,
    draggable: `false`,
    dataset: {
      action: (isFolder) ? `open-folder` : `edit`,
      seq: item.seq,
      field: `name`,
    },
    'aria-label': (isFolder) ? `Folder Name` : `Snippet Name`,
  });
  if (isFolder) widgetTitle.dataset.target = path.concat([item.seq]).join('-');

  const widgetActions = buildNode('div', {
    children: [
      (isFolder) ? buildActionIcon(`Rename`, `icon-rename`, `inherit`, {
        action: `rename`,
        seq: item.seq,
      }) : buildActionIcon(`Copy`, `icon-copy`, `inherit`, {
        action: `copy`,
        field: `copy`, // so it can be focused
        seq: item.seq,
      }),
      buildActionIcon(`Delete`, `icon-delete`, colors.Red.value, {
        action: `delete`,
        seq: item.seq,
      }),
    ],
  });

  const widgetHead = buildNode('div', {
    classList: [`title`],
    children: [
      widgetMenu,
      widgetTitle,
      widgetActions,
    ],
  });

  widget.push(widgetHead);

  // Separate widget contents from title
  if (!isFolder) widget.push(buildNode('hr'));

  if (isSnippet) {
    const widgetBody = buildNode('div', {
      classList: ['snip-content'],
      children: [buildNode('textArea', {
        draggable: `false`,
        dataset: {
          action: `edit`,
          seq: item.seq,
          field: `content`,
        },
        textContent: item.content,
        'aria-label': `Snippet Contents`,
      })],
    });
    widget.push(widgetBody);
    if (item.sourceURL && settings.view.sourceURL) {
      const widgetSource = buildNode('div', {
        classList: [`source-url`],
        draggable: `false`,
        children: [
          buildNode('label', {
            for: `source-${ item.seq }`,
            textContent: `Source:`,
          }),
          buildNode('input', {
            type: `url`,
            id: `source-${ item.seq }`,
            placeholder: `…`,
            value: item.sourceURL,
            dataset: {
              action: `edit`,
              seq: item.seq,
              field: `sourceURL`,
            },
          }),
        ],
      });
      widget.push(widgetSource);
    }
  }
  return widget;
}

function buildTreeWidget(collapsible, color, target, text) {
  return buildNode('div', {
    classList: [`title`],
    draggable: true,
    children: [
      // expand/collapse button only available if subfolders were found
      buildNode('button', {
        type: `button`,
        disabled: !collapsible,
        dataset: collapsible && { action: `collapse` },
        classList: [`icon`],
        children: [
          buildSvg(`Folder`, collapsible ? `icon-folder-collapse` : `icon-folder`, color),
        ],
      }),
      // folder name
      buildNode('button', {
        type: `button`,
        classList: [`name`],
        dataset: {
          action: `open-folder`,
          target: target,
        },
        children: [
          buildNode('h2', {
            textContent: text,
          }),
        ],
      }),
    ],
  });
}