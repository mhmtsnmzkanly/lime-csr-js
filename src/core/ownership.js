const OWNERS_KEY = Symbol.for('lime.nodeOwners');
const owners = (globalThis[OWNERS_KEY] ??= new WeakMap());

export function setNodeOwner(node, target, parent = node?.parentNode) {
  if (!node) return;
  if (parent === node) parent = node.parentNode;
  owners.set(node, { target, parent: parent || owners.get(node)?.parent || null });
}

export function getNodeOwner(node) {
  return owners.get(node)?.target || null;
}

// Structural fragments retain their originating ancestry until placement.
export function getLogicalParent(node) {
  return node?.parentNode || owners.get(node)?.parent || null;
}
