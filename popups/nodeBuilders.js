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
    case 'children':
      element.append(...attributes.children);
      break;
    
    case 'dataset':
      for (let data in attributes.dataset) {
        element.dataset[data] = attributes.dataset[data];
      }
      break;

    case 'classList':
      element.classList.add(...attributes.classList);
      break;

    case 'textContent':
      element.textContent = attributes.textContent;
      break;
    
    case 'events':
      for (let e of attributes.events) {
        element.addEventListener(e.type, e.listener, e.options || false);
      }
      break;
  
    default:
      element.setAttribute(a, attributes[a]);
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
 * Builder for popover menus, normally with an icon
 * @param {string} id 
 * @param {HTMLElement[]} list 
 * @param {HTMLElement} [buttonContents] - Optional overwride for default icon with name `icon-${id}`
 */
function buildPopoverMenu(id, list, buttonContents) {
  return buildNode('div', {
    classList: [`menu`],
    children: [
      buildNode('button', {
        type: `button`,
        classList: [`icon`],
        dataset: {
          action: `open-popover`,
          target: id,
        },
        children: [buttonContents || buildSvg(
          `${ id }`,
          `icon-${ id }`
        )],
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
      children: [buildNode('h3', {
        textContent: name,
      })],
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
function buildSubMenu(name, items) {
  return buildNode('fieldset', {
    classList: [`menu-item`],
    children: [
      buildNode('legend', {
        children: [buildNode('h3', {
          textContent: `${ name }…`
        })],
      }),
      buildNode('div', {
        classList: [`card`, `menu-list`],
        children: items,
      }),
    ],
  });
}

/**
 * Menu item builder for checkbox and radio controls
 * @param {string} type Input type (`checkbox`|`radio`)
 * @param {{name:string,value:string,dataset:Object,checked:boolean}} attributes 
 * @returns 
 */
function buildMenuControl(type, id, { name, value, dataset, checked }) {
  if (![`checkbox`, `radio`].includes(type)) return document.createTextNode(``);
  return buildNode('p', {
    classList: [`menu-item`, `control`],
    children: [
      buildNode(`input`, {
        type: type,
        name: name || id,
        id: id,
        value: value,
        checked: checked,
        dataset: dataset,
        display: `none`,
      }),
      buildNode('label', {
        for: id,
        children: [
          buildNode('div', {
            classList: [`icon`],
            children: [buildSvg(
              value,
              `control-${ type }${ (checked) ? `-checked` : `` }`
            )],
          }),
          buildNode('h3', { textContent: value }),
        ],
      }),
    ],
  });
}

function buildActionIcon(name, action, sprite) {
  return buildNode('button', {
    classList: [`icon`],
    dataset: {
      action: action,
    },
    children: [buildSvg(
      name,
      sprite,
    )],
  });
}